import { createHash } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import { trips } from '../db/schema';
import { PlanScenario, type PlanScenarioRequest, type ScenarioOutcome, type ScenarioOrder } from '@wayfinder/contracts';
import { depotDate, depotMinutes } from '../lib/clock';
import { HttpError } from '../lib/errors';
import { snapshot } from '../orders/store-orders';
import { buildSuggestedPlan, type PlannerInput, type PlannerResult } from '../planning';
import type { Planner } from '../routes/plans';
import { operatingDays, readBoard, readMoment } from './board';
import { boardDay, dayMovedOn } from './board-day';
import { plannerInputOf } from './suggest';

// A split remains outstanding demand from its original order. Generated parts exist only in the pure result.
export function scenarioOutcome(source: PlannerInput, result: Exclude<PlannerResult, { status: 'unavailable' }>): ScenarioOutcome {
  const roots = new Map<string, string>();
  for (const order of source.orders) roots.set(order.id, order.splitFrom ?? order.id);
  for (const choice of result.choices) for (const id of choice.resultOrderIds) roots.set(id, roots.get(choice.orderId) ?? choice.orderId);
  for (const split of result.splits) for (const id of [split.keptOrderId, split.remainderOrderId]) roots.set(id, roots.get(split.orderId) ?? split.orderId);
  const groups = new Map<string, { order: ScenarioOrder; wanted: Map<string, number>; planned: Map<string, number> }>();
  for (const part of source.orders) {
    const id = roots.get(part.id)!;
    let group = groups.get(id);
    if (!group) {
      group = { order: { orderId: id, outletId: part.outletId, shopName: source.outlets.find((o) => o.id === part.outletId)!.name,
        status: 'deferred', waitedBefore: false, vehicleIds: [], reasons: [] }, wanted: new Map(), planned: new Map() };
      groups.set(id, group);
    }
    group.order.waitedBefore ||= part.timesDeferred > 0;
    for (const line of part.lines) group.wanted.set(line.productId, (group.wanted.get(line.productId) ?? 0) + line.quantity);
  }
  const placed = new Map<string, string>();
  for (const trip of result.input.plan.trips) for (const stop of trip.stops) for (const id of stop.orderIds) placed.set(id, trip.vehicleId);
  for (const part of result.input.orders) {
    const group = groups.get(roots.get(part.id) ?? part.id);
    const vehicle = placed.get(part.id);
    if (!group || !vehicle) continue;
    if (!group.order.vehicleIds.includes(vehicle)) group.order.vehicleIds.push(vehicle);
    for (const line of part.lines) group.planned.set(line.productId, (group.planned.get(line.productId) ?? 0) + line.quantity);
  }
  for (const choice of result.choices) {
    const group = groups.get(roots.get(choice.orderId) ?? choice.orderId);
    if (group && !group.order.reasons.includes(choice.reason)) group.order.reasons.push(choice.reason);
  }
  for (const deferred of result.input.plan.deferrals) {
    const group = groups.get(roots.get(deferred.orderId) ?? deferred.orderId);
    if (group && !group.order.reasons.includes(deferred.reason)) group.order.reasons.push(deferred.reason);
  }
  const orders = [...groups.values()].map(({ order, wanted, planned }) => ({ ...order,
    status: [...wanted].every(([product, quantity]) => (planned.get(product) ?? 0) >= quantity) ? 'planned' as const
      : [...planned.values()].some((quantity) => quantity > 0) ? 'partial' as const : 'deferred' as const,
    vehicleIds: order.vehicleIds.sort(),
  }));
  const shops = new Set(orders.map((o) => o.outletId));
  return { orders, check: result.check, summary: {
    totalOrders: orders.length, fullyPlanned: orders.filter((o) => o.status === 'planned').length,
    partiallyPlanned: orders.filter((o) => o.status === 'partial').length, deferred: orders.filter((o) => o.status === 'deferred').length,
    shopsFullyPlanned: [...shops].filter((id) => orders.filter((o) => o.outletId === id).every((o) => o.status === 'planned')).length,
    shopsWithWaiting: new Set(orders.filter((o) => o.status !== 'planned').map((o) => o.outletId)).size,
    vehicles: new Set(result.input.plan.trips.map((t) => t.vehicleId)).size, trips: result.input.plan.trips.length,
    fuelLitres: Math.round(result.check.trips.reduce((sum, trip) => sum + (trip.times?.litres ?? 0), 0) * 10) / 10,
    repeatedDeferrals: orders.filter((o) => o.waitedBefore && o.status !== 'planned').length,
  } };
}

export async function previewPlanScenario(caller: Planner, date: string, request: PlanScenarioRequest): Promise<PlanScenario> {
  return snapshot(async (tx) => {
    const moment = await readMoment(tx);
    const { board, input } = await readBoard(tx, caller.depotId, date, moment);
    const ref = request.ref;
    const stale = () => new HttpError(409, 'stale', 'The planning inputs changed. Refresh the board and compare again.');
    if (ref.planId === null ? ref.demoDay !== moment.demoDay || board.plan.id !== null : ref.planId !== board.plan.id) throw stale();
    const day = boardDay(depotDate(moment.at), depotMinutes(moment.at), await operatingDays(tx));
    if (!day) throw new HttpError(409, 'no_plan_day', 'No delivery day is left to plan.');
    if (day.date !== date) throw new HttpError(409, 'day_moved', dayMovedOn(date, false), { date: day.date });
    if (!day.open) throw new HttpError(409, 'orders_open', 'Orders are still open. Compare after orders close.');
    if (board.plan.status !== 'draft') throw new HttpError(409, 'plan_sent', 'This plan was sent. Comparisons are available only before Send.');
    if (ref.planId !== null && ref.revision !== board.plan.revision) throw stale();
    const started = board.plan.id ? await tx.select({ id: trips.id }).from(trips).where(and(eq(trips.planId, board.plan.id), ne(trips.status, 'planned'))).limit(1) : [];
    if (started.length) throw new HttpError(409, 'plan_locked', 'Loading has started. Comparisons are available only before loading.');
    if (board.plan.lockedReason) throw new HttpError(409, 'plan_locked', board.plan.lockedReason);
    if (!input) throw new HttpError(409, 'scenario_unavailable', 'The planning inputs could not be read. Refresh the board.');
    const source = plannerInputOf(board, input);
    if (source.orders.length > 300) throw new HttpError(409, 'scenario_unavailable', 'This comparison supports up to 300 outstanding order parts.');
    const vehicle = source.vehicles.find((v) => v.id === request.excludedVehicleId);
    if (!vehicle?.available) throw new HttpError(409, 'scenario_vehicle', 'Choose a working vehicle from this depot.');
    const snapshotKey = createHash('sha256').update(JSON.stringify({ source, plan: board.plan, demoDay: moment.demoDay, ref })).digest('hex');
    const baseline = buildSuggestedPlan(structuredClone(source));
    const failed = (result: PlannerResult) => new HttpError(409, 'scenario_unavailable', 'The planner could not produce a checked comparison. The saved plan has not changed.', { blocks: result.check.problems.filter((p) => p.level === 'block') });
    if (baseline.status === 'unavailable' || !baseline.check.ok) throw failed(baseline);
    const without = structuredClone(source);
    without.vehicles.find((v) => v.id === vehicle.id)!.available = false;
    const scenario = buildSuggestedPlan(without);
    if (scenario.status === 'unavailable' || !scenario.check.ok) throw failed(scenario);
    return PlanScenario.parse({ depot: caller.depotId, date, ref, excludedVehicleId: vehicle.id, comparedAt: moment.at.toISOString(), snapshotKey,
      baseline: scenarioOutcome(source, baseline), scenario: scenarioOutcome(source, scenario) });
  });
}
