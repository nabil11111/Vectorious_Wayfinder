import type { DeferralCode } from '@wayfinder/contracts';
import { checkPlan } from '../check';
import { computeLoad } from '../load';
import { lookup } from '../lookup';
import { FRESH_DEADLINE } from '../timeline';
import type { EngineOutlet, PlanDeferral, PlannerDecision, PlannerInput, PlannerOrder } from '../types';
import { kg, litres, m3, toClock } from '../words';
import type { CandidateAttempt } from './candidates';
import { effectiveWindow, isWaiting } from './priority';

export type PlannerDeferralCode = Exclude<DeferralCode, 'dispatcher_choice'>;
export type RejectionStage = 'over_capacity' | 'window' | 'fuel';

// A candidate reaching a later stage proves the preceding stage still had a survivor. This deliberately
// ignores the order in which vehicles were tried and the order in which the checker displays problems.
export function furthestRejection(stages: readonly RejectionStage[]): RejectionStage {
  if (stages.includes('fuel')) return 'fuel';
  if (stages.includes('window')) return 'window';
  return 'over_capacity';
}

// Gregorian weekdays from the supplied date only. The planner never reads a clock or timezone.
const weekday = (date: string): string => {
  let year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)), day = Number(date.slice(8, 10));
  if (month < 3) year -= 1;
  const offset = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4][month - 1]!;
  const index = (year + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400) + offset + day) % 7;
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][index]!;
};
const shopOf = (input: PlannerInput, order: PlannerOrder): EngineOutlet => lookup(input.outlets, 'shop')(order.outletId);
const displayName = (name: string): string => name.length <= 48 ? name : `${name.slice(0, 47).trimEnd()}…`;
const readableName = (shop: EngineOutlet): string => {
  const name = shop.name.trim();
  return name === shop.id || /\bOUT\d+\b/i.test(name) || name.length > 48 ? displayName(shop.district.trim()) : name;
};
export const shopName = (input: PlannerInput, order: PlannerOrder): string => readableName(shopOf(input, order));
export const quantityWord = (input: PlannerInput, order: PlannerOrder): 'cartons' | 'boxes' | 'items' =>
  ({ Fresh: 'cartons', Style: 'boxes', Tech: 'items' } as const)[shopOf(input, order).brand];

const delaysOtherShops = (order: PlannerOrder, attempts: readonly CandidateAttempt[]): boolean => attempts.some((attempt) => {
  if (attempt.stage !== 'window') return false;
  const own = attempt.check?.trips.find((trip) => trip.tripNo === attempt.slot.tripNo && trip.vehicleId === attempt.slot.vehicleId)
    ?.times?.stops.find((stop) => stop.outletId === order.outletId);
  return own?.late === false && !!attempt.check?.trips.some((trip) => trip.times?.stops.some((stop) =>
    stop.late && (stop.outletId !== order.outletId || trip.tripNo !== attempt.slot.tripNo)));
});
const windowDeadline = (shop: EngineOutlet): string => {
  const closing = Math.min(shop.windowClose, shop.mallClose ?? shop.windowClose);
  return shop.brand === 'Fresh' && closing >= FRESH_DEADLINE
    ? `before ${toClock(FRESH_DEADLINE)}`
    : `before its ${shop.mallClose !== undefined && shop.mallClose < shop.windowClose ? 'mall slot' : 'window'} closed at ${toClock(closing)}`;
};
const splitLimitWords = (detail: string | undefined, place: string, day: string): string | null => {
  if (detail?.includes('300-order')) return `The plan has reached its 300-order limit, so the order for ${place} cannot be divided on ${day}.`;
  if (detail?.includes('999')) return `The order for ${place} cannot be divided on ${day} because a product quantity exceeds 999.`;
  if (detail?.includes('10 product')) return `The order for ${place} has more than 10 products, so it cannot be divided on ${day}.`;
  if (detail?.includes('cannot be split again')) return `The order for ${place} has already been divided and cannot be divided again for ${day}.`;
  return null;
};

export function deferralFor(
  input: PlannerInput, order: PlannerOrder, code: PlannerDeferralCode,
  options: { detail?: string; split?: { keptUnits: number; remainingUnits: number }; attempts?: readonly CandidateAttempt[] } = {},
): PlanDeferral {
  const shop = shopOf(input, order), day = weekday(input.date);
  const otherLate = delaysOtherShops(order, options.attempts ?? []);
  const cannotDivideAgain = code === 'over_capacity' && options.detail?.includes('cannot be split again');
  const sentence = (place: string): string => {
    if (options.split) {
      const { keptUnits: kept, remainingUnits: rest } = options.split;
      const cause = code === 'window'
        ? otherLate ? 'carrying them would make other shops late' : `no truck could reach the shop ${windowDeadline(shop)}`
        : code === 'fuel' ? "the trucks did not have enough of this week's fuel left"
          : code === 'no_reefer' ? 'no fridge truck was free'
            : code === 'no_van' ? 'no van was free'
              : cannotDivideAgain ? 'the remainder cannot be divided again' : 'the truck was full';
      return `${kept} of the ${kept + rest} ${quantityWord(input, order)} for ${place} go on ${day}; the other ${rest} wait for the next plan because ${cause}.`;
    }
    if (code === 'no_reefer') return `No fridge truck was free for ${place} on ${day}.`;
    if (code === 'no_van') return `No van was free for ${place} on ${day}, which takes vans only.`;
    if (code === 'fuel') return `The trucks that could reach ${place} on ${day} did not have enough of this week's fuel left.`;
    if (code === 'over_capacity') return splitLimitWords(options.detail, place, day) ?? `The trucks going to ${place} on ${day} were full.`;
    if (shop.mallOpen !== undefined && shop.mallOpen > shop.windowClose) {
      return `The delivery window for ${place} closes at ${toClock(shop.windowClose)}, before the mall opens at ${toClock(shop.mallOpen)} on ${day}.`;
    }
    if (shop.mallClose !== undefined && shop.mallClose < shop.windowOpen) {
      return `The mall slot for ${place} closes at ${toClock(shop.mallClose)}, before the shop opens at ${toClock(shop.windowOpen)} on ${day}.`;
    }
    return otherLate
      ? `The truck that could reach ${place} in time would then have been late for its other shops on ${day}.`
      : `No truck could reach ${place} ${windowDeadline(shop)} on ${day}.`;
  };
  let reason = sentence(readableName(shop));
  if (reason.length > 200) reason = sentence(displayName(shop.district.trim()));
  // Only exceptionally long supplied names or quantities need the compact form; retain the cause and
  // weekday, rather than chopping a sentence in half or losing its time.
  if (reason.length > 200 && options.split) {
    const { keptUnits: kept, remainingUnits: rest } = options.split;
    const why = code === 'window' ? otherLate ? 'other shops would be late' : `delivery must be ${windowDeadline(shop)}`
      : code === 'fuel' ? "this week's fuel left was not enough"
        : cannotDivideAgain ? 'the remainder cannot be divided again' : 'the truck was full';
    reason = `${displayName(shop.district)}: ${kept} ${quantityWord(input, order)} go on ${day}; ${rest} wait because ${why}.`;
  }
  return { orderId: order.id, code, reason };
}

export function priorityReason(input: PlannerInput, order: PlannerOrder, rank: number, compact = false): string {
  const shop = shopOf(input, order), load = computeLoad(order.lines, input.products);
  const wantedDay = weekday(order.deliveryDate);
  const waiting = isWaiting(order, input.date) ? `waited since ${compact ? wantedDay.slice(0, 3) : wantedDay}` : 'new order';
  if (compact) return `Rank ${rank}: ${waiting}; ${load.needsReefer ? 'chilled' : 'dry'}; ${displayName(shop.district)} by ${toClock(effectiveWindow(shop).close)}`;
  const restrictions = [shop.brand === 'Fresh' ? 'Fresh' : '', shop.mallOpen === undefined ? '' : 'mall slot', shop.parking === 'van_only' ? 'vans only' : ''].filter(Boolean);
  const freshDeadline = shop.brand === 'Fresh' && Math.min(shop.windowClose, shop.mallClose ?? shop.windowClose) >= FRESH_DEADLINE;
  return `Rank ${rank}: ${waiting}; ${load.needsReefer ? 'chilled' : 'dry'}; ${readableName(shop)} ${freshDeadline ? 'due' : 'closes'} ${toClock(effectiveWindow(shop).close)}${restrictions.length ? `; ${restrictions.join(', ')}` : ''}`;
}

export function placementReason(input: PlannerInput, order: PlannerOrder, attempt: CandidateAttempt, compact = false): string {
  const district = displayName(shopOf(input, order).district);
  if (compact) {
    const shorter: Record<string, string> = {
      'the only run that could carry these goods': 'only usable run',
      'keeps the usual leaving times': 'usual leaving times',
      'keeps fridge trucks free': 'keeps fridge trucks free',
      'keeps vans free': 'keeps vans free',
      'fills an existing run': 'fills existing run',
      'uses a first run before a second': 'first run preferred',
      'more volume broke the tie': 'more space',
      'more weight capacity broke the tie': 'higher weight limit',
      'uses less fuel per kilometre': 'less fuel per km',
      'vehicle ID breaks the tie': 'vehicle ID tie',
    };
    const why = attempt.selectionReason ? shorter[attempt.selectionReason] ?? attempt.selectionReason : 'fits delivery limits';
    return `${attempt.slot.existing ? 'joined' : 'on'} ${attempt.slot.vehicleId} trip ${attempt.slot.tripNo} (${why})`;
  }
  const placed = attempt.slot.existing
    ? `joined ${attempt.slot.vehicleId}'s run to ${district} (trip ${attempt.slot.tripNo})`
    : `new run on ${attempt.slot.vehicleId} to ${district} (trip ${attempt.slot.tripNo})`;
  return `${placed}, ${attempt.selectionReason ?? 'within its capacity, receiving hours and fuel'}`;
}

export function refusedReason(input: PlannerInput, order: PlannerOrder, attempts: readonly CandidateAttempt[], code: PlannerDeferralCode, compact = false): string {
  const attempt = attempts.find((candidate) => candidate.stage === code);
  if (!attempt) return deferralFor(input, order, code).reason;
  const checked = attempt.check ?? checkPlan(attempt.input);
  const problem = checked.problems.find((problem) => problem.level === 'block' && (code === 'fuel'
    ? problem.code === 'fuel_over_quota' : code === 'over_capacity'
      ? problem.code === 'over_weight' || problem.code === 'over_volume' : problem.code !== 'fuel_over_quota'));
  if (!problem) return deferralFor(input, order, code, { attempts }).reason;
  if (compact) {
    const vehicle = lookup(attempt.input.vehicles, 'vehicle')(problem.vehicleId ?? attempt.slot.vehicleId);
    const trip = checked.trips.find((trip) => trip.vehicleId === vehicle.id && trip.tripNo === (problem.tripNo ?? attempt.slot.tripNo));
    const called = `${vehicle.id}${problem.tripNo === undefined ? '' : ` trip ${problem.tripNo}`}`;
    if (problem.code === 'over_weight' && trip) return `${called}: ${kg(trip.load.kg)} exceeds ${kg(vehicle.weightCapKg)}.`;
    if (problem.code === 'over_volume' && trip) return `${called}: ${m3(trip.load.m3)} exceeds ${m3(vehicle.volumeCapM3)}.`;
    if (problem.code === 'fuel_over_quota') {
      const fuel = checked.vehicles.find((fuel) => fuel.vehicleId === vehicle.id)!;
      return `${called} exceeds its fuel quota before rounding: ${litres(fuel.litresPlan)} needed, ${litres(fuel.quotaL - fuel.litresBefore)} left.`;
    }
    const stop = trip?.times?.stops.find((stop) => stop.outletId === problem.outletId && stop.seq === problem.stopSeq);
    if (stop && (problem.code === 'window_missed' || problem.code === 'mall_slot_missed')) {
      const shop = lookup(input.outlets, 'shop')(stop.outletId);
      const place = displayName(shop.district);
      if (stop.windowOpen > stop.windowClose) return shop.mallOpen !== undefined && shop.mallOpen > shop.windowClose
        ? `${called}: ${place} closes ${toClock(shop.windowClose)}; mall opens ${toClock(shop.mallOpen)}.`
        : `${called}: ${place} opens ${toClock(shop.windowOpen)}; mall closes ${toClock(shop.mallClose!)}.`;
      const deadline = shop.brand === 'Fresh' && stop.windowClose >= FRESH_DEADLINE ? FRESH_DEADLINE : stop.windowClose;
      return `${called} reaches ${place} at ${toClock(stop.arriveAt)}, missing the ${toClock(deadline)} deadline.`;
    }
  }
  let reason = problem.message;
  for (const shop of input.outlets) reason = reason.split(shop.id).join(readableName(shop));
  return reason;
}

export function deferralDecisions(input: PlannerInput, order: PlannerOrder, deferral: PlanDeferral): PlannerDecision[] {
  const decisions: PlannerDecision[] = [];
  if (isWaiting(order, input.date)) decisions.push({ kind: 'waited_again', orderId: order.id, reason: deferral.reason });
  if (deferral.code === 'window') decisions.push({ kind: 'late_order', orderId: order.id, reason: deferral.reason });
  return decisions;
}
