import { AcceptDecisionsRequest, Suggestion, SuggestPlanRequest, type PlanBoard, type Problem } from '@wayfinder/contracts';
import { eq } from 'drizzle-orm';
import { db, type Tx } from '../db/client';
import { auditLog, orders, plans } from '../db/schema';
import { HttpError } from '../lib/errors';
import { announce } from '../lib/live';
import { buildSuggestedPlan, type PlanInput, type PlannerInput } from '../planning';
import type { Planner } from '../routes/plans';
import { boardOf, readBoard } from './board';
import { dayLabel } from './board-day';
import { crewsOf } from './crews';
import { finishPlan, openPlan, replaceDraft, validateDraft } from './draft';
import { joinableParts, joinParts, makeParts } from './split';
import { driversFor, namedDrivers, suggestionOf, type Planned } from './suggestion';

// The suggested plan on the board (spec 014): building it in one write (D-51, D-52), and accepting the planner's
// decisions (D-54). Both are planning writes, so each takes the depot's locks first and answers with the board.

// Spec 011 plans at most this many orders, and refuses more before it starts.
const MOST_ORDERS = 300;

// The checker's input that readBoard returns, with each board order's wanted day, times deferred and original: the
// planner's input for the board's day (rule 2). Mix brands is the draft's, in the settings.
export function plannerInputOf(board: PlanBoard, input: PlanInput): PlannerInput {
  if (!board.day) throw new Error('A board with no day has nothing to plan.');
  const { orders: _orders, plan: _plan, ...day } = input;
  return {
    ...day,
    date: board.day.date,
    orders: board.orders.map((order) => ({
      id: order.id, outletId: order.outletId, lines: order.lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      deliveryDate: order.deliveryDate, timesDeferred: order.timesDeferred, splitFrom: order.splitFrom,
    })),
  };
}

// The planner's input with each vehicle named by its driver (spec 026), which the planner gives every trip it builds on
// the vehicle, so its sentences call the truck "Chaminda's dry truck". A vehicle with no driver goes by its kind and id.
function withDrivers(input: PlannerInput, drivers: ReadonlyMap<string, string | null>, staff: readonly { id: string; name: string }[]): PlannerInput {
  return {
    ...input,
    vehicles: input.vehicles.map(({ driverName: _driverName, ...vehicle }) => {
      const name = staff.find((d) => d.id === drivers.get(vehicle.id))?.name;
      return name === undefined ? vehicle : { ...vehicle, driverName: name };
    }),
  };
}

// The plan a planner's result makes, without its words: its trips and stops, deferrals and splits.
const planOf = (result: Planned) => JSON.stringify({
  trips: result.input.plan.trips.map(({ driverName: _driverName, ...trip }) => trip),
  deferrals: result.input.plan.deferrals.map((d) => [d.orderId, d.code]),
  splits: result.splits,
});

const plannerUnavailable = (message: string, blocks: Problem[]) => new HttpError(409, 'planner_unavailable', message, { blocks });

// A hand save's checks failing on the planner's own plan, or a split of the planner's that does not fit its order, is
// a fault on our side: it is answered as a server error, and the transaction leaves nothing behind. The log keeps the
// check's own words.
const plannerFault = (what: string) => (error: unknown): never => {
  throw new Error(`The planner's ${what} failed a hand save's check: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
};

// The split originals of the day whose two parts are both among the day's orders, placed, and on no stop or deferral of
// another plan (rule 4), joined back as spec 010's Join does. This plan's draft is empty by now, so no stop or
// deferral of it names a part. A part a sent plan deferred stays a part. Answers the originals joined back.
async function joinSplits(tx: Tx, caller: Planner, planId: string, day: PlanBoard) {
  const partsOf = new Map<string, string[]>();
  for (const order of day.orders) if (order.splitFrom) partsOf.set(order.splitFrom, [...(partsOf.get(order.splitFrom) ?? []), order.id]);
  const joined: (typeof orders.$inferSelect)[] = [];
  for (const [originalId, parts] of [...partsOf].sort(([a], [b]) => a.localeCompare(b))) {
    if (parts.length !== 2) continue;
    const [original] = await tx.select().from(orders).where(eq(orders.id, originalId));
    if (!original) throw new Error(`A part names ${originalId}, which is not an order.`);
    const joinable = await joinableParts(tx, planId, original);
    if (!joinable) continue;
    await joinParts(tx, caller, original, joinable);
    joined.push(original);
  }
  return joined;
}

// POST /plans/:date/suggest: plans every order of the day with spec 011's planner and saves its plan as the board's
// draft, splits included, in one transaction (plan.md "The build", steps 1 to 10). A refusal changes nothing.
export async function suggestPlan(caller: Planner, date: string, body: SuggestPlanRequest): Promise<PlanBoard> {
  const request = SuggestPlanRequest.parse(body);
  const result = await db.transaction(async (tx) => {
    // 1. The depot's locks, the clock instant read under them, the day's checks and the plan reference.
    const opened = await openPlan(tx, caller, date, request);
    // 2. The draft being replaced: its drivers, which stay with their vehicles (D-31, D-97), and its Mix brands.
    const before = await boardOf(tx, caller.depotId, date, opened.moment);
    const earlier = new Map(before.plan.trips.flatMap((t) => (t.driverId !== null && before.drivers.some((d) => d.id === t.driverId) ? [[t.vehicleId, t.driverId] as const] : [])));
    // 3. An empty draft, Mix brands kept, so no stop or deferral of this plan names a part any more.
    await replaceDraft(tx, opened.plan.id, { mixBrands: before.plan.mixBrands, trips: [], deferrals: [] });
    // 4. This draft's splits joined back, so the planner plans the shops' orders.
    const joined = await joinSplits(tx, caller, opened.plan.id, before);
    // 5. The day as the planner gets it.
    const { board, input } = await readBoard(tx, caller.depotId, date, opened.moment);
    if (!input) throw new Error('A dated plan board has no checker input.');
    if (board.orders.length > MOST_ORDERS) {
      throw plannerUnavailable(`The planner plans at most ${MOST_ORDERS} orders, and ${dayLabel(date)} has ${board.orders.length}.`, []);
    }
    // 6. The planner, each vehicle named by its driver (spec 026): first the one the draft gave it or its usual driver,
    // and once the plan's vehicles have their drivers (D-97), by those. The names never change what the planner chooses,
    // so a second run with the plan's own drivers plans the same. When it finds no plan that passes every check, the
    // transaction takes back steps 1 to 4.
    const crews = await crewsOf(tx, caller.depotId, date);
    const day = plannerInputOf(board, input);
    const initial = driversFor(day.vehicles.map((v) => v.id), earlier, crews.usual, []);
    let planned = buildSuggestedPlan(withDrivers(day, initial, crews.staff));
    if (planned.status === 'unavailable') {
      throw plannerUnavailable('The planner could not build a plan that passes every check, so the draft is as it was.', planned.check.problems.filter((p) => p.level === 'block'));
    }
    const drivers = driversFor(planned.input.plan.trips.map((t) => t.vehicleId), earlier, crews.usual, crews.staff.map((d) => d.id));
    const named = namedDrivers(initial, drivers);
    if ([...named].some(([vehicleId, driverId]) => initial.get(vehicleId) !== driverId)) {
      const again = buildSuggestedPlan(withDrivers(day, named, crews.staff));
      if (again.status === 'unavailable' || planOf(again) !== planOf(planned)) throw new Error('The planner chose another plan once its trucks were named by their drivers.');
      planned = again;
    }
    // 7. The planner's splits, made as a hand split makes them, in its order.
    const parts = new Map<string, string>();
    const split: (typeof orders.$inferSelect)[] = [];
    for (const proposal of planned.splits) {
      const [original] = await tx.select().from(orders).where(eq(orders.id, proposal.orderId));
      if (!original) throw new Error(`The planner split ${proposal.orderId}, which is not an order.`);
      const [first, second] = await makeParts(tx, caller, original, proposal.keep).catch(plannerFault(`split of ${original.id}`));
      parts.set(proposal.keptOrderId, first.id);
      parts.set(proposal.remainderOrderId, second.id);
      split.push(original);
    }
    // 8. The planner's plan as a draft, with a driver of the depot for every vehicle it uses (D-97, spec 026), checked as
    // a save would be against the day with its new parts.
    const { draft, suggestion } = suggestionOf(planned, parts, drivers, opened.moment.at.toISOString());
    const withParts = await boardOf(tx, caller.depotId, date, opened.moment);
    try {
      validateDraft(draft, withParts);
    } catch (error) {
      plannerFault('plan')(error);
    }
    // 9. The draft saved, and the suggestion kept with the draft as the board reads it back (D-53).
    await replaceDraft(tx, opened.plan.id, draft);
    const saved = await boardOf(tx, caller.depotId, date, opened.moment);
    if (!saved.check?.ok) throw new Error('The planner\'s plan does not pass the board\'s own check.');
    const kept: Suggestion = { ...suggestion, plan: { mixBrands: saved.plan.mixBrands, trips: saved.plan.trips, deferrals: saved.plan.deferrals } };
    await tx.update(plans).set({ suggestion: kept }).where(eq(plans.id, opened.plan.id));
    // 10. What the build did, then the revision and the time it was saved.
    await tx.insert(auditLog).values({ actorId: caller.userId, action: 'plan.suggested', entity: 'plan', entityId: opened.plan.id,
      before: { revision: opened.plan.revision, trips: before.plan.trips, deferrals: before.plan.deferrals },
      after: { revision: opened.plan.revision + 1, trips: draft.trips.length, ordersOnTrips: draft.trips.reduce((n, t) => n + t.stops.reduce((m, s) => m + s.orderIds.length, 0), 0),
        deferrals: draft.deferrals.length, partsMade: [...parts.values()], splitsJoined: joined.map((o) => o.id), decisions: kept.decisions.map((d) => d.key) } });
    return { board: await finishPlan(tx, opened), shops: [...new Set([...joined, ...split].map((o) => o.outletId))].sort() };
  });
  announce({ topic: 'plans', depotId: caller.depotId });
  if (result.shops.length) {
    announce({ topic: 'orders', depotId: caller.depotId });
    for (const outletId of result.shops) announce({ topic: 'orders', outletId });
  }
  return result.board;
}

// POST /plans/:date/decisions: accepts the planner's decisions the request names, each open on the saved draft, at the
// clock instant. An accepted decision stays accepted.
export async function acceptDecisions(caller: Planner, date: string, body: AcceptDecisionsRequest): Promise<PlanBoard> {
  const request = AcceptDecisionsRequest.parse(body);
  const board = await db.transaction(async (tx) => {
    const opened = await openPlan(tx, caller, date, request);
    const current = await boardOf(tx, caller.depotId, date, opened.moment);
    const open = new Set(current.suggestion?.decisions.filter((d) => d.open).map((d) => d.key) ?? []);
    if (opened.plan.suggestion === null || request.keys.some((key) => !open.has(key))) {
      throw new HttpError(400, 'invalid_input', 'That is not an open decision of this plan.');
    }
    const stored = Suggestion.parse(opened.plan.suggestion);
    const at = opened.moment.at.toISOString();
    const named = new Set(request.keys);
    await tx.update(plans).set({ suggestion: { ...stored, decisions: stored.decisions.map((d) => (named.has(d.key) ? { ...d, acceptedAt: at } : d)) } })
      .where(eq(plans.id, opened.plan.id));
    await tx.insert(auditLog).values({ actorId: caller.userId, action: 'plan.decided', entity: 'plan', entityId: opened.plan.id,
      before: { revision: opened.plan.revision }, after: { revision: opened.plan.revision + 1, keys: request.keys, acceptedAt: at } });
    return finishPlan(tx, opened);
  });
  announce({ topic: 'plans', depotId: caller.depotId });
  return board;
}
