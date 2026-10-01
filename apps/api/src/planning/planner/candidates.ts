import type { PlanCheck } from '@wayfinder/contracts';
import { checkPlan } from '../check';
import { computeLoad } from '../load';
import { lookup } from '../lookup';
import { cargoProblems } from '../rules/cargo';
import type { EngineOrder, PlanInput } from '../types';
import { compare, effectiveWindow } from './priority';
import type { RejectionStage } from './reasons';

export interface CandidateSlot { vehicleId: string; tripNo: number; existing: boolean }
export interface CandidateAttempt {
  slot: CandidateSlot;
  input: PlanInput;
  check: PlanCheck | null;
  stage: RejectionStage | 'accepted';
  selectionReason?: string;
}
export interface CandidateSlots { slots: CandidateSlot[]; refusal?: 'no_reefer' | 'no_van' }

// Structural selection is the planner's policy. Loads, timings and fuel remain the checker's rules.
export function candidateSlots(input: PlanInput, order: EngineOrder): CandidateSlots {
  const shopOf = lookup(input.outlets, 'shop');
  const shop = shopOf(order.outletId);
  const load = computeLoad(order.lines, input.products);
  let fleet = input.vehicles.filter((v) => v.available && v.depotId === input.depotId);
  if (load.needsReefer) {
    fleet = fleet.filter((v) => v.temp === 'reefer');
    if (!fleet.length) return { slots: [], refusal: 'no_reefer' };
  }
  if (shop.parking === 'van_only') {
    fleet = fleet.filter((v) => v.type === 'van');
    if (!fleet.length) return { slots: [], refusal: 'no_van' };
  }
  const slots: CandidateSlot[] = [];
  for (const vehicle of fleet) {
    const trips = input.plan.trips.filter((t) => t.vehicleId === vehicle.id);
    for (const trip of trips) {
      const sameStop = trip.stops.find((s) => s.outletId === shop.id);
      if (sameStop ? sameStop.orderIds.length >= 300 : trip.stops.length >= 40) continue;
      if (trip.stops.every((s) => shopOf(s.outletId).district === shop.district
        && (input.settings.mixBrands || shopOf(s.outletId).brand === shop.brand))) {
        slots.push({ vehicleId: vehicle.id, tripNo: trip.tripNo, existing: true });
      }
    }
    const next = Math.max(0, ...trips.map((t) => t.tripNo)) + 1;
    if (next <= 2 && input.plan.trips.length < 76) slots.push({ vehicleId: vehicle.id, tripNo: next, existing: false });
  }
  const vehicleOf = lookup(fleet, 'vehicle');
  slots.sort((a, b) => {
    const av = vehicleOf(a.vehicleId), bv = vehicleOf(b.vehicleId);
    return Number(av.temp === 'reefer' && !load.needsReefer) - Number(bv.temp === 'reefer' && !load.needsReefer)
      || Number(av.type === 'van' && shop.parking !== 'van_only') - Number(bv.type === 'van' && shop.parking !== 'van_only')
      || Number(b.existing) - Number(a.existing)
      || a.tripNo - b.tripNo
      || bv.volumeCapM3 - av.volumeCapM3 || bv.weightCapKg - av.weightCapKg || bv.kmPerL - av.kmPerL
      || compare(av.id, bv.id) || a.tripNo - b.tripNo;
  });
  return { slots };
}

// Only this vehicle's complete day goes to the checker during a trial. No unplanned order can produce a
// coverage block, and every previously accepted order on its other trip is still protected.
export function candidateInput(input: PlanInput, order: EngineOrder, slot: CandidateSlot): PlanInput {
  const vehicle = lookup(input.vehicles, 'vehicle')(slot.vehicleId);
  const trips = input.plan.trips.filter((t) => t.vehicleId === slot.vehicleId).map(({ leaveAt: _leaveAt, ...trip }) => ({
    ...trip, stops: trip.stops.map((stop) => ({ ...stop, orderIds: [...stop.orderIds] })),
  }));
  let changed = trips.find((t) => t.tripNo === slot.tripNo);
  if (!changed) {
    // A new trip takes the vehicle's driver, so the checker's sentences about it name him (spec 026).
    changed = { vehicleId: slot.vehicleId, tripNo: slot.tripNo, ...(vehicle.driverName === undefined ? {} : { driverName: vehicle.driverName }), stops: [] };
    trips.push(changed);
  }
  const stop = changed.stops.find((s) => s.outletId === order.outletId);
  if (stop) stop.orderIds.push(order.id);
  else changed.stops.push({ outletId: order.outletId, orderIds: [order.id] });
  const shopOf = lookup(input.outlets, 'shop');
  changed.stops.sort((a, b) => {
    const aw = effectiveWindow(shopOf(a.outletId)), bw = effectiveWindow(shopOf(b.outletId));
    return aw.close - bw.close || aw.open - bw.open || compare(a.outletId, b.outletId);
  });
  const ids = new Set(trips.flatMap((t) => t.stops.flatMap((s) => s.orderIds)));
  const orders = [...input.orders.filter((o) => ids.has(o.id) && o.id !== order.id), order];
  return {
    ...input, orders, vehicles: [vehicle],
    plan: { trips: trips.sort((a, b) => a.tripNo - b.tripNo), deferrals: [] },
  };
}

// Capacity probes also serve the split search. Passing the aggregate lines through the checker avoids
// adding rounded per-order weights or inventing a second capacity comparison.
export function capacityFits(input: PlanInput, tripNo: number): boolean {
  const trip = input.plan.trips.find((t) => t.tripNo === tripNo)!;
  const orderOf = lookup(input.orders, 'order');
  const lines = trip.stops.flatMap((s) => s.orderIds).flatMap((id) => orderOf(id).lines);
  const scoped = { ...input, plan: { trips: [trip], deferrals: [] } };
  const problems = cargoProblems(scoped, [{ vehicleId: trip.vehicleId, tripNo, load: computeLoad(lines, input.products) }]);
  return !problems.some((p) => p.code === 'over_weight' || p.code === 'over_volume');
}

const windowProblem = (code: string) => code === 'window_missed' || code === 'mall_slot_missed';

export function fixDepartures(input: PlanInput): { input: PlanInput; check: PlanCheck } {
  const trial: PlanInput = {
    ...input,
    plan: { ...input.plan, trips: input.plan.trips.map(({ leaveAt: _leaveAt, ...trip }) => ({ ...trip })) },
  };
  let check = checkPlan(trial);
  // At most one fix per trip: the checker's numeric fix already reaches every stop on that trip. Recheck
  // after each fix so trip 2 sees trip 1's new return and reload. Long-wait suggestions are never applied.
  for (const trip of [...trial.plan.trips].sort((a, b) => a.tripNo - b.tripNo)) {
    const fix = check.problems.find((p) => p.vehicleId === trip.vehicleId && p.tripNo === trip.tripNo
      && windowProblem(p.code) && p.leaveAt !== undefined);
    if (fix) {
      trip.leaveAt = fix.leaveAt!;
      check = checkPlan(trial);
    }
  }
  return { input: trial, check };
}

export function tryCandidate(input: PlanInput, order: EngineOrder, slot: CandidateSlot): CandidateAttempt {
  const trial = candidateInput(input, order, slot);
  if (!capacityFits(trial, slot.tripNo)) return { slot, input: trial, check: null, stage: 'over_capacity' };
  const checked = fixDepartures(trial);
  const blocks = checked.check.problems.filter((p) => p.level === 'block');
  const stage = blocks.length === 0 ? 'accepted'
    : blocks.some((p) => p.code !== 'fuel_over_quota') ? 'window' : 'fuel';
  return { slot, ...checked, stage };
}

const needsEarlierDeparture = (attempt: CandidateAttempt) =>
  attempt.input.plan.trips.some((trip) => trip.leaveAt !== undefined);

// Attempts arrive in structural tuple order. The leading departure preference applies across all of
// them, so a usual-time run can beat even an existing run that would need an earlier start.
export function rankAttempts(attempts: CandidateAttempt[]): CandidateAttempt[] {
  return [...attempts].sort((a, b) => Number(needsEarlierDeparture(a)) - Number(needsEarlierDeparture(b)));
}

export function selectAttempt(input: PlanInput, order: EngineOrder, attempts: CandidateAttempt[]): CandidateAttempt | null {
  const passing = rankAttempts(attempts.filter((attempt) => attempt.stage === 'accepted'));
  const [best, next] = passing;
  if (!best) return null;
  let reason = 'the only run that could carry these goods';
  if (next) {
    const av = lookup(input.vehicles, 'vehicle')(best.slot.vehicleId);
    const bv = lookup(input.vehicles, 'vehicle')(next.slot.vehicleId);
    const shop = lookup(input.outlets, 'shop')(order.outletId);
    const chilled = computeLoad(order.lines, input.products).needsReefer;
    if (needsEarlierDeparture(best) !== needsEarlierDeparture(next)) reason = 'keeps the usual leaving times';
    else if (!chilled && av.temp !== bv.temp) reason = 'keeps fridge trucks free';
    else if (shop.parking !== 'van_only' && av.type !== bv.type) reason = 'keeps vans free';
    else if (best.slot.existing !== next.slot.existing) reason = 'fills an existing run';
    else if (best.slot.tripNo !== next.slot.tripNo) reason = 'uses a first run before a second';
    else if (av.volumeCapM3 !== bv.volumeCapM3) reason = 'more volume broke the tie';
    else if (av.weightCapKg !== bv.weightCapKg) reason = 'more weight capacity broke the tie';
    else if (av.kmPerL !== bv.kmPerL) reason = 'uses less fuel per kilometre';
    else reason = 'vehicle ID breaks the tie';
  }
  // A skipped earlier-departure candidate can otherwise be hidden behind another usual-time runner-up.
  if (!needsEarlierDeparture(best) && attempts.some((a) => a.stage === 'accepted' && needsEarlierDeparture(a)
    && attempts.indexOf(a) < attempts.indexOf(best))) reason = 'keeps the usual leaving times';
  return { ...best, selectionReason: reason };
}

export function chooseWhole(input: PlanInput, order: EngineOrder): CandidateSlots & {
  best: CandidateAttempt | null; stages: RejectionStage[]; attempts: CandidateAttempt[];
} {
  const candidates = candidateSlots(input, order);
  // Slots arrive in tuple order, so the first two passing trials that keep their usual departures are the
  // winner and the runner-up whose comparison names the deciding rule, and any passing trial ranked above
  // them has already been tried. Later slots cannot change the choice or its reason, so the search stops.
  // A refused order still tries every slot, and its reason uses them all.
  const trials: CandidateAttempt[] = [];
  let usualPassing = 0;
  for (const slot of candidates.slots) {
    const trial = tryCandidate(input, order, slot);
    trials.push(trial);
    if (trial.stage === 'accepted' && !needsEarlierDeparture(trial)) usualPassing += 1;
    if (usualPassing === 2) break;
  }
  const attempts = rankAttempts(trials.filter((attempt) => attempt.stage !== 'accepted'));
  return {
    ...candidates, best: selectAttempt(input, order, trials), attempts,
    stages: attempts.map((attempt) => attempt.stage as RejectionStage),
  };
}
