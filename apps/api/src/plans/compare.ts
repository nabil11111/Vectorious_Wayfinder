import { ApplyCompareRequest, PlanComparison, type PlanBoard, type PlanOutcome } from '@wayfinder/contracts';
import { eq } from 'drizzle-orm';
import { db, type Tx } from '../db/client';
import { auditLog, orders, plans } from '../db/schema';
import { HttpError } from '../lib/errors';
import { announce } from '../lib/live';
import { buildSuggestedPlan, type PlannerResult } from '../planning';
import { snapshot } from '../orders/store-orders';
import type { Planner } from '../routes/plans';
import { readBoard } from './board';
import { crewsOf } from './crews';
import { finishPlan, openPlan, replaceDraft, validateDraft } from './draft';
import { comparisonSummary, fuelDelta, fuelFigures, outcomeOf } from './outcomes';
import { makeParts } from './split';
import { driversFor, namedDrivers, suggestionOf } from './suggestion';
import { plannerInputOf, withDrivers } from './suggest';

// Your saved draft beside a suggestion for the same orders, fleet and settings. Nothing here writes until Apply.

const demandKeyOf = (board: PlanBoard) => JSON.stringify({
  revision: board.plan.revision,
  mixBrands: board.plan.mixBrands,
  orders: board.orders.map((order) => [order.id, order.outletId, order.splitFrom, order.lines.map((line) => [line.productId, line.quantity])]).sort(),
  vehicles: board.vehicles.map((vehicle) => [vehicle.id, vehicle.working, vehicle.temp, vehicle.type, vehicle.weightCapKg, vehicle.volumeCapM3]).sort(),
});

export function planFingerprint(result: Exclude<PlannerResult, { status: 'unavailable' }>): string {
  return JSON.stringify({
    trips: result.input.plan.trips.map((trip) => ({
      vehicleId: trip.vehicleId, tripNo: trip.tripNo, leaveAt: trip.leaveAt ?? null,
      stops: trip.stops.map((stop) => ({ outletId: stop.outletId, orderIds: stop.orderIds })),
    })),
    deferrals: result.input.plan.deferrals.map((deferral) => [deferral.orderId, deferral.code]),
    splits: result.splits.map((split) => ({ orderId: split.orderId, keep: split.keep })),
  });
}

function outcomeFromBoard(board: PlanBoard): PlanOutcome {
  const placed = new Set(board.plan.trips.flatMap((trip) => trip.stops.flatMap((stop) => stop.orderIds)));
  const deferred = new Set(board.plan.deferrals.map((deferral) => deferral.orderId));
  const used = new Set(board.plan.trips.map((trip) => trip.vehicleId));
  const timings = board.check?.trips.flatMap((trip) => (trip.times ? [trip.times] : [])) ?? [];
  return outcomeOf({
    orders: board.orders, placed, deferred,
    vehicles: used.size, trips: board.plan.trips.length,
    stops: board.plan.trips.reduce((sum, trip) => sum + trip.stops.length, 0),
    stopsOnTime: timings.flatMap((trip) => trip.stops).filter((stop) => !stop.late).length,
    fuel: fuelFigures(board.check, used),
    blockers: board.check?.problems.filter((problem) => problem.level === 'block').length ?? 0,
    warnings: board.check?.problems.filter((problem) => problem.level === 'warn').length ?? 0,
    driversMissing: board.plan.trips.filter((trip) => trip.driverId === null).length,
  });
}

function shopsOf(plan: { trips: { vehicleId: string; stops: { outletId: string }[] }[] }) {
  const at = new Map<string, Set<string>>();
  for (const trip of plan.trips) for (const stop of trip.stops) {
    const vehicles = at.get(stop.outletId) ?? new Set<string>();
    vehicles.add(trip.vehicleId);
    at.set(stop.outletId, vehicles);
  }
  return at;
}

const list = (ids: Iterable<string>) => [...ids].sort().join(', ');

async function generated(caller: Planner, date: string, tx: Tx) {
  const { board, input } = await readBoard(tx, caller.depotId, date);
  if (!input || !board.day) throw new Error('A dated plan board has no checker input.');
  const crews = await crewsOf(tx, caller.depotId, date);
  const earlier = new Map(board.plan.trips.flatMap((trip) => (trip.driverId ? [[trip.vehicleId, trip.driverId] as const] : [])));
  const day = plannerInputOf(board, input);
  const initial = driversFor(day.vehicles.map((vehicle) => vehicle.id), earlier, crews.usual, []);
  let planned = buildSuggestedPlan(withDrivers(day, initial, crews.staff));
  if (planned.status !== 'unavailable') {
    const drivers = driversFor(planned.input.plan.trips.map((trip) => trip.vehicleId), earlier, crews.usual, crews.staff.map((driver) => driver.id));
    const named = namedDrivers(initial, drivers);
    if ([...named].some(([vehicleId, driverId]) => initial.get(vehicleId) !== driverId)) {
      const again = buildSuggestedPlan(withDrivers(day, named, crews.staff));
      if (again.status !== 'unavailable') planned = again;
    }
  }
  return { board, input, planned, crews, earlier };
}

const splitFromOf = (order: object): string | null => ('splitFrom' in order && typeof order.splitFrom === 'string' ? order.splitFrom : null);

function comparisonOf(board: PlanBoard, planned: PlannerResult, names: Map<string, string>, drivers: ReadonlyMap<string, string | null>): PlanComparison {
  const current = outcomeFromBoard(board);
  if (planned.status === 'unavailable') {
    return PlanComparison.parse({
      revision: board.plan.revision, demandKey: demandKeyOf(board), fingerprint: '',
      summary: 'No suggested plan passed every check.', fuelDeltaL: null, current, suggested: null, changes: [],
      canApply: false, unavailable: 'No suggested plan passed every check.',
    });
  }
  const used = new Set(planned.input.plan.trips.map((trip) => trip.vehicleId));
  const placed = new Set(planned.input.plan.trips.flatMap((trip) => trip.stops.flatMap((stop) => stop.orderIds)));
  const deferred = new Set(planned.input.plan.deferrals.map((deferral) => deferral.orderId));
  const orders = planned.input.orders.map((order) => ({ id: order.id, splitFrom: splitFromOf(order) }));
  const timings = planned.check.trips.flatMap((trip) => (trip.times ? [trip.times] : []));
  const suggested = outcomeOf({
    orders, placed, deferred, vehicles: used.size, trips: planned.input.plan.trips.length,
    stops: planned.input.plan.trips.reduce((sum, trip) => sum + trip.stops.length, 0),
    stopsOnTime: timings.flatMap((trip) => trip.stops).filter((stop) => !stop.late).length,
    fuel: fuelFigures(planned.check, used),
    blockers: planned.check.problems.filter((problem) => problem.level === 'block').length,
    warnings: planned.check.problems.filter((problem) => problem.level === 'warn').length,
    driversMissing: 0,
  });
  const yours = shopsOf(board.plan);
  const theirs = shopsOf(planned.input.plan);
  const outlets = [...new Set([...yours.keys(), ...theirs.keys()])];
  const changes = outlets.flatMap((outletId) => {
    const left = list(yours.get(outletId) ?? []);
    const right = list(theirs.get(outletId) ?? []);
    if (left === right) return [];
    const shop = names.get(outletId) ?? outletId;
    const detail = `${left ? `Your plan: ${left}` : 'Not in your plan'}. ${right ? `Suggested: ${right}` : 'Not in the suggested plan'}.`;
    return [{ shop, detail }];
  }).slice(0, 40);
  const driverless = planned.input.plan.trips.some((trip) => (drivers.get(trip.vehicleId) ?? null) === null);
  return PlanComparison.parse({
    revision: board.plan.revision, demandKey: demandKeyOf(board), fingerprint: planFingerprint(planned),
    summary: comparisonSummary(current, suggested, null), fuelDeltaL: fuelDelta(current.fuelL, suggested.fuelL),
    current, suggested, changes, canApply: planned.check.ok && !driverless, unavailable: null,
  });
}

export function previewComparison(caller: Planner, date: string) {
  return snapshot(async (tx) => {
    const { board, planned, crews, earlier } = await generated(caller, date, tx);
    if (board.plan.status === 'published') throw new HttpError(409, 'plan_sent', 'This plan has been sent.');
    const used = planned.status === 'unavailable' ? [] : planned.input.plan.trips.map((trip) => trip.vehicleId);
    const drivers = driversFor(used, earlier, crews.usual, crews.staff.map((driver) => driver.id));
    return comparisonOf(board, planned, new Map(board.shops.map((shop) => [shop.id, shop.name])), drivers);
  });
}

export async function applyComparison(caller: Planner, date: string, body: ApplyCompareRequest) {
  const request = ApplyCompareRequest.parse(body);
  const board = await db.transaction(async (tx) => {
    const opened = await openPlan(tx, caller, date, request);
    const { board: current, planned, crews, earlier } = await generated(caller, date, tx);
    if (demandKeyOf(current) !== request.demandKey || planned.status === 'unavailable' || planFingerprint(planned) !== request.fingerprint) {
      throw new HttpError(409, 'stale', 'The day changed while the comparison was open. Compare again.');
    }
    const drivers = driversFor(planned.input.plan.trips.map((trip) => trip.vehicleId), earlier, crews.usual, crews.staff.map((driver) => driver.id));
    if ([...drivers.values()].some((driverId) => driverId === null)) throw new HttpError(409, 'driver_required', 'The suggested plan needs a driver on every trip.');
    const parts = new Map<string, string>();
    for (const proposal of planned.splits) {
      const [original] = await tx.select().from(orders).where(eq(orders.id, proposal.orderId));
      if (!original) throw new Error(`The planner split ${proposal.orderId}, which is not an order.`);
      const [first, second] = await makeParts(tx, caller, original, proposal.keep);
      parts.set(proposal.keptOrderId, first.id);
      parts.set(proposal.remainderOrderId, second.id);
    }
    const { draft, suggestion } = suggestionOf(planned, parts, drivers, opened.moment.at.toISOString());
    const saved = await readBoard(tx, caller.depotId, date, opened.moment);
    validateDraft(draft, saved.board);
    await replaceDraft(tx, opened.plan.id, draft);
    const after = await readBoard(tx, caller.depotId, date, opened.moment);
    if (!after.board.check?.ok) throw new Error('The suggested plan does not pass the board\'s own check.');
    const kept = { ...suggestion, plan: { mixBrands: after.board.plan.mixBrands, trips: after.board.plan.trips, deferrals: after.board.plan.deferrals } };
    await tx.update(plans).set({ suggestion: kept }).where(eq(plans.id, opened.plan.id));
    await tx.insert(auditLog).values({
      actorId: caller.userId, action: 'plan.compared', entity: 'plan', entityId: opened.plan.id,
      before: { revision: opened.plan.revision }, after: { fingerprint: request.fingerprint },
    });
    return finishPlan(tx, opened);
  });
  announce({ topic: 'plans', depotId: caller.depotId });
  return board;
}
