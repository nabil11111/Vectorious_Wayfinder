import { Suggestion, type BoardSuggestion, type DraftPlan, type SuggestionDecision } from '@wayfinder/contracts';
import type { PlannerDecision, PlannerResult } from '../planning';

// The suggested plan's plain parts (spec 014), with no database: the planner's result as the draft a build saves and
// the suggestion the plan keeps (D-53), and whether each of the planner's decisions is still open (rule 6, D-54).

export type Planned = Exclude<PlannerResult, { status: 'unavailable' }>;

// A decision's key: early_leave:VEH002:1, waited_again:<order id> or late_order:<order id>.
const keyOf = (decision: PlannerDecision) =>
  (decision.kind === 'early_leave' ? `early_leave:${decision.vehicleId}:${decision.tripNo}` : `${decision.kind}:${decision.orderId}`);

// Each vehicle's usual driver (spec 026): the driver who drove it on the depot's latest sent plan (history), else a
// fixed pairing of the depot's drivers in staff ID order with its vehicles in id order, skipping the drivers history
// already pairs. vehicleIds are the depot's vehicles in id order and staff its drivers in staff ID order. History of a
// vehicle that is not one of them, such as one archived since, reserves nobody. A vehicle past the last driver has none.
export function usualPairing(vehicleIds: readonly string[], history: ReadonlyMap<string, string>, staff: readonly string[]): Map<string, string | null> {
  const paired = new Set(vehicleIds.flatMap((vehicleId) => history.get(vehicleId) ?? []));
  const free = staff.filter((driverId) => !paired.has(driverId));
  return new Map(vehicleIds.map((vehicleId) => [vehicleId, history.get(vehicleId) ?? free.shift() ?? null]));
}

// The driver of each vehicle the suggestion uses (D-97, spec 026), in id order: the one the draft before gave it, as
// the dispatcher's choice wins; else its usual driver, while no other vehicle of the plan has them; else the depot's
// first free driver in staff ID order. Vehicles take their usual drivers before any takes a free one, so none takes
// another's usual driver ahead of it. The driver of a vehicle the suggestion leaves out is free again. A driver is
// chosen per vehicle, so both its trips have them (D-31). A vehicle has none only once every driver is taken.
export function driversFor(vehicleIds: readonly string[], earlier: ReadonlyMap<string, string>, usual: ReadonlyMap<string, string | null>, staff: readonly string[]): Map<string, string | null> {
  const used = [...new Set(vehicleIds)].sort();
  const drivers = new Map<string, string | null>();
  const taken = new Set<string>();
  const give = (vehicleId: string, driverId: string | null | undefined) => {
    if (!driverId || taken.has(driverId)) return;
    drivers.set(vehicleId, driverId);
    taken.add(driverId);
  };
  for (const vehicleId of used) give(vehicleId, earlier.get(vehicleId));
  for (const vehicleId of used) if (!drivers.has(vehicleId)) give(vehicleId, usual.get(vehicleId));
  const free = staff.filter((driverId) => !taken.has(driverId));
  return new Map(used.map((vehicleId) => [vehicleId, drivers.get(vehicleId) ?? free.shift() ?? null]));
}

// The driver each vehicle is named by in the planner's sentences (spec 026), once drivers has given the vehicles of the
// plan theirs (driversFor): a vehicle of the plan by its own, and any other by the one first gave it before the build,
// unless the plan gave that driver to a vehicle of its own, so no two vehicles are named by one driver.
export function namedDrivers(first: ReadonlyMap<string, string | null>, drivers: ReadonlyMap<string, string | null>): Map<string, string | null> {
  const taken = new Set([...drivers.values()].filter((driverId) => driverId !== null));
  return new Map([...first].map(([vehicleId, driverId]) => {
    if (drivers.has(vehicleId)) return [vehicleId, drivers.get(vehicleId) ?? null] as const;
    return [vehicleId, driverId !== null && taken.has(driverId) ? null : driverId] as const;
  }));
}

// The planner names a split's two parts split:<id>:keep and split:<id>:rest until the build has made them. parts maps
// each of those names to the part's own id, and drivers each vehicle to its driver (driversFor). Every trip, stop,
// leaving time and deferral is the planner's own, with the planner's "Mix brands". builtAt is the clock instant of the
// build. The suggestion's plan is the draft as made here; the build keeps the draft as the board reads it back.
export function suggestionOf(
  result: Planned, parts: ReadonlyMap<string, string>, drivers: ReadonlyMap<string, string | null>, builtAt: string,
): { draft: DraftPlan; suggestion: Suggestion } {
  const idOf = (id: string) => {
    if (!id.startsWith('split:')) return id;
    const part = parts.get(id);
    if (!part) throw new Error(`The planner placed ${id}, and no part was made for it.`);
    return part;
  };
  const plan = {
    mixBrands: result.input.settings.mixBrands,
    trips: result.input.plan.trips.map((trip) => ({
      vehicleId: trip.vehicleId, tripNo: trip.tripNo, leaveAt: trip.leaveAt ?? null, driverId: drivers.get(trip.vehicleId) ?? null,
      stops: trip.stops.map((stop) => ({ outletId: stop.outletId, orderIds: stop.orderIds.map(idOf) })),
    })),
    deferrals: result.input.plan.deferrals.map((deferral) => ({ orderId: idOf(deferral.orderId), code: deferral.code, reason: deferral.reason })),
  };
  const decisions = result.decisions.map((decision) => (decision.kind === 'early_leave'
    ? { key: keyOf(decision), kind: decision.kind, reason: decision.reason, orderId: null, vehicleId: decision.vehicleId, tripNo: decision.tripNo, leaveAt: decision.leaveAt, acceptedAt: null }
    : { key: keyOf({ ...decision, orderId: idOf(decision.orderId) }), kind: decision.kind, reason: decision.reason, orderId: idOf(decision.orderId), vehicleId: null, tripNo: null, leaveAt: null, acceptedAt: null }));
  const choices = result.choices.map((choice) => ({ orderId: choice.orderId, rank: choice.rank, resultOrderIds: choice.resultOrderIds.map(idOf), reason: choice.reason }));
  // The planner's plan is always a valid draft and its words fit the contract (spec 011, AC-16 and AC-17), so one that
  // does not is a fault on our side, never the dispatcher's.
  const checked = Suggestion.safeParse({ builtAt, plan, choices, decisions });
  if (!checked.success) throw new Error(`The planner's result does not fit a suggestion: ${checked.error.message}`);
  return { draft: checked.data.plan, suggestion: checked.data };
}

// Rule 6: a decision is open while it is not accepted and the draft still holds the planner's own choice. An early
// departure is open while its trip leaves at that time, and a waiting or late order while the draft defers it with the
// code and reason the suggestion's saved draft gave it. An edit that changes the choice ends the decision.
export function decisionOpen(decision: SuggestionDecision, suggested: DraftPlan, draft: DraftPlan): boolean {
  if (decision.acceptedAt !== null) return false;
  if (decision.kind === 'early_leave') {
    return draft.trips.some((trip) => trip.vehicleId === decision.vehicleId && trip.tripNo === decision.tripNo && trip.leaveAt === decision.leaveAt);
  }
  const planned = suggested.deferrals.find((deferral) => deferral.orderId === decision.orderId);
  const now = draft.deferrals.find((deferral) => deferral.orderId === decision.orderId);
  return planned !== undefined && now !== undefined && now.code === planned.code && now.reason === planned.reason;
}

// Whether the draft still holds anything of the suggestion (L-18): an order on the truck and trip the suggestion gave
// it, or an order the suggestion deferred, for whatever reason now.
function holdsAny(suggested: DraftPlan, draft: DraftPlan): boolean {
  const placed = new Set(suggested.trips.flatMap((trip) => trip.stops.flatMap((stop) => stop.orderIds.map((id) => `${trip.vehicleId}:${trip.tripNo}:${id}`))));
  const deferred = new Set(suggested.deferrals.map((deferral) => deferral.orderId));
  return draft.trips.some((trip) => trip.stops.some((stop) => stop.orderIds.some((id) => placed.has(`${trip.vehicleId}:${trip.tripNo}:${id}`))))
    || draft.deferrals.some((deferral) => deferred.has(deferral.orderId));
}

// The suggestion as the board answers it, each decision judged on the board's draft, and whether the draft still holds
// any of it. The saved draft stays here.
export function boardSuggestion(stored: Suggestion, draft: DraftPlan): BoardSuggestion {
  return {
    builtAt: stored.builtAt,
    choices: stored.choices,
    inDraft: holdsAny(stored.plan, draft),
    decisions: stored.decisions.map((decision) => ({ ...decision, open: decisionOpen(decision, stored.plan, draft) })),
  };
}
