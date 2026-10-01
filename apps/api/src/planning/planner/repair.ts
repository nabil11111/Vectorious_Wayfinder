import { checkPlan } from '../check';
import { lookup } from '../lookup';
import type { EngineOrder, PlanInput, PlanTrip } from '../types';
import {
  capacityFits, candidateInput, compatibleFleet, slotOrder, tryCandidate, type CandidateAttempt, type CandidateSlot,
} from './candidates';

// Before an order is deferred, the planner tries to free a run for it from goods the plan already carries (spec 011,
// AC-23, D-102). Orders are placed one at a time in priority order, so an earlier order can hold a run that a later one
// needed while its goods would also have gone elsewhere: a shop's dry cartons on a run of their own when its chilled
// ones already stop there on another van. The pass never defers or splits an accepted order. It moves the goods of one
// run, either onto runs that already stop at the same shops or whole onto a vehicle's free run, and then tries the
// waiting order on the run that frees. Every move is checked by the checker with the vehicle's departures as they are,
// so no accepted goods, window or departure the plan already holds can change, and the final plan is checked whole.
//
// The search is bounded and fixed: for each vehicle that could carry the order, in the order of AC-6, only its last run
// is freed (a vehicle's first run stays when it has a second); each of that run's stops tries the other runs that stop
// at its shop, in AC-6's order for its goods, and a run that cannot be shared out tries each vehicle with a free run.
// The first vehicle whose run frees and then carries the order wins, so the result does not depend on row order.

export interface Move { orderIds: string[]; to: { vehicleId: string; tripNo: number }; whole: boolean }
export interface FreedRun {
  // Every trip of the plan once the run is freed and its goods moved, the waiting order not yet on it.
  trips: PlanTrip[];
  freed: { vehicleId: string; tripNo: number };
  moves: Move[];
  // The waiting order on the freed run, as tryCandidate checked it.
  attempt: CandidateAttempt;
}

const copy = (trip: PlanTrip): PlanTrip => ({ ...trip, stops: trip.stops.map((stop) => ({ ...stop, orderIds: [...stop.orderIds] })) });

// One vehicle's day with its departures as the plan has them, for the checker.
const dayOf = (input: PlanInput, trips: readonly PlanTrip[], vehicleId: string): PlanInput => {
  const own = trips.filter((trip) => trip.vehicleId === vehicleId).sort((a, b) => a.tripNo - b.tripNo);
  const ids = new Set(own.flatMap((trip) => trip.stops.flatMap((stop) => stop.orderIds)));
  return {
    ...input, orders: input.orders.filter((order) => ids.has(order.id)), vehicles: [lookup(input.vehicles, 'vehicle')(vehicleId)],
    plan: { trips: own, deferrals: [] },
  };
};
const keeps = (day: PlanInput, tripNo: number): boolean =>
  capacityFits(day, tripNo) && !checkPlan(day).problems.some((problem) => problem.level === 'block');

// How a run's goods can move away, by vehicle and trip number. It does not depend on the waiting order, so while the plan
// is unchanged one search serves every waiting order; the caller starts a new one once a run is freed.
export type Relocations = Map<string, { trips: PlanTrip[]; moves: Move[] } | null>;

export function freeRunFor(input: PlanInput, order: EngineOrder, relocations: Relocations = new Map()): FreedRun | null {
  const { fleet, refusal } = compatibleFleet(input, order);
  if (refusal) return null;
  const orderOf = lookup(input.orders, 'order');
  const priority = new Map(input.orders.map((o, i) => [o.id, i]));
  const goodsOf = (outletId: string, orderIds: readonly string[]): EngineOrder =>
    ({ id: 'moved goods', outletId, lines: orderIds.flatMap((id) => orderOf(id).lines) });

  const lastRuns = fleet.flatMap((vehicle) => {
    const own = input.plan.trips.filter((trip) => trip.vehicleId === vehicle.id);
    return own.length ? [{ vehicleId: vehicle.id, tripNo: Math.max(...own.map((trip) => trip.tripNo)), existing: false }] : [];
  }).sort(slotOrder(input, order));

  for (const slot of lastRuns) {
    const run = input.plan.trips.find((trip) => trip.vehicleId === slot.vehicleId && trip.tripNo === slot.tripNo)!;
    const rest = input.plan.trips.filter((trip) => trip !== run).map(copy);
    const without: PlanInput = { ...input, plan: { ...input.plan, trips: rest } };
    // The order must fit the freed run alone, by load and then by the checker, before any goods move.
    if (!capacityFits(candidateInput(without, order, slot), slot.tripNo)) continue;
    const alone = tryCandidate(without, order, slot);
    if (alone.stage !== 'accepted') continue;

    const key = `${run.vehicleId}:${run.tripNo}`;
    if (!relocations.has(key)) relocations.set(key, shareOut(input, rest, run, goodsOf, priority) ?? moveWhole(input, rest, run, goodsOf));
    const moved = relocations.get(key);
    if (!moved) continue;
    const trips = moved.trips;
    // A move onto this vehicle's other run changes the day the order was tried on, so it is tried again.
    const attempt = moved.moves.some((move) => move.to.vehicleId === slot.vehicleId)
      ? tryCandidate({ ...input, plan: { ...input.plan, trips } }, order, slot) : alone;
    if (attempt.stage !== 'accepted') continue;
    return { trips, freed: { vehicleId: slot.vehicleId, tripNo: slot.tripNo }, moves: moved.moves, attempt };
  }
  return null;

  function shareOut(
    plan: PlanInput, trips: PlanTrip[], run: PlanTrip, goods: typeof goodsOf, rank: Map<string, number>,
  ): { trips: PlanTrip[]; moves: Move[] } | null {
    let working = trips.map(copy);
    const moves: Move[] = [];
    for (const stop of run.stops) {
      const load = goods(stop.outletId, stop.orderIds);
      const allowed = new Set(compatibleFleet(plan, load).fleet.map((v) => v.id));
      const targets: CandidateSlot[] = working
        .filter((trip) => allowed.has(trip.vehicleId)
          && trip.stops.some((s) => s.outletId === stop.outletId && s.orderIds.length + stop.orderIds.length <= 300))
        .map((trip) => ({ vehicleId: trip.vehicleId, tripNo: trip.tripNo, existing: true }))
        .sort(slotOrder(plan, load));
      let placed = false;
      for (const target of targets) {
        const trial = working.map(copy);
        const into = trial.find((trip) => trip.vehicleId === target.vehicleId && trip.tripNo === target.tripNo)!
          .stops.find((s) => s.outletId === stop.outletId)!;
        into.orderIds = [...into.orderIds, ...stop.orderIds].sort((a, b) => rank.get(a)! - rank.get(b)!);
        if (!keeps(dayOf(plan, trial, target.vehicleId), target.tripNo)) continue;
        working = trial;
        moves.push({ orderIds: [...stop.orderIds], to: { vehicleId: target.vehicleId, tripNo: target.tripNo }, whole: false });
        placed = true;
        break;
      }
      if (!placed) return null;
    }
    return { trips: working, moves };
  }

  function moveWhole(plan: PlanInput, trips: PlanTrip[], run: PlanTrip, goods: typeof goodsOf): { trips: PlanTrip[]; moves: Move[] } | null {
    // A vehicle that may carry every stop's goods, with a run free, other than the one being freed.
    const loads = run.stops.map((stop) => goods(stop.outletId, stop.orderIds));
    const allowed = loads.map((load) => new Set(compatibleFleet(plan, load).fleet.map((v) => v.id)));
    const vehicleOf = lookup(plan.vehicles, 'vehicle');
    const targets: CandidateSlot[] = plan.vehicles
      .filter((v) => v.id !== run.vehicleId && allowed.every((ids) => ids.has(v.id)))
      .flatMap((v) => {
        const next = Math.max(0, ...trips.filter((trip) => trip.vehicleId === v.id).map((trip) => trip.tripNo)) + 1;
        return next <= 2 ? [{ vehicleId: v.id, tripNo: next, existing: false }] : [];
      })
      .sort(slotOrder(plan, { ...loads[0]!, lines: loads.flatMap((load) => load.lines) }));
    for (const target of targets) {
      const { driverName } = vehicleOf(target.vehicleId);
      const moved: PlanTrip = {
        vehicleId: target.vehicleId, tripNo: target.tripNo, ...(driverName === undefined ? {} : { driverName }),
        stops: run.stops.map((stop) => ({ ...stop, orderIds: [...stop.orderIds] })),
      };
      const trial = [...trips.map(copy), moved];
      if (!keeps(dayOf(plan, trial, target.vehicleId), target.tripNo)) continue;
      return {
        trips: trial,
        moves: [{ orderIds: run.stops.flatMap((stop) => stop.orderIds), to: { vehicleId: target.vehicleId, tripNo: target.tripNo }, whole: true }],
      };
    }
    return null;
  }
}
