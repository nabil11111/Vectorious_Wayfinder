import type { DeferralCode } from '@wayfinder/contracts';
import { checkPlan } from '../check';
import { computeLoad } from '../load';
import { lookup } from '../lookup';
import { FRESH_DEADLINE } from '../timeline';
import type { EngineOutlet, EngineVehicle, PlanDeferral, PlanInput, PlannerDecision, PlannerInput, PlannerOrder } from '../types';
import { capital, driverNameOf, isSecondTrip, itsTrip, kg, kindAndId, litreFigure, litres, m3, onItsTrip, toClock, tripCalled, vehicleCalled } from '../words';
import type { CandidateAttempt } from './candidates';
import { effectiveWindow, isWaiting } from './priority';

export type PlannerDeferralCode = Exclude<DeferralCode, 'dispatcher_choice'>;
export type RejectionStage = 'over_capacity' | 'window' | 'fuel';

// How fully a reason is worded, from the fullest to the shortest. The planner keeps every reason within 200 characters
// (spec 011) by taking the first wording that fits: whole sentences, then the short forms; then the tight form, which
// leaves out words that carry no fact, such as the "the" before a truck and a shop the reason has named already; then
// the tightest, which also leaves out the deciding rule in brackets, "(only usable run)"; and then the shortest, which
// also says a refused truck's limit before its load: "Reefer truck VEH039 over its 6,180 kg limit with 9,722.1 kg on its
// second trip". All of these name trucks by their drivers (spec 026). The drivers' names give way last: only when no
// form with them fits are the short, tight, tightest and shortest forms tried again with every truck by its kind and id
// ('plain' is the short form so). A truck is named by its driver unless the 200-character reason has no room for it.
// None leaves out a truck, a trip, a quantity, a time or a limit, or cuts a word.
export type Wording = 'full' | 'short' | 'named tight' | 'named tightest' | 'named shortest' | 'plain' | 'tight' | 'tightest' | 'shortest';
const WORDINGS: readonly Wording[] = ['full', 'short', 'named tight', 'named tightest', 'named shortest', 'plain', 'tight', 'tightest', 'shortest'];

// The whole reason in the fullest wording that fits. One still longer at the shortest keeps its length rather than be
// cut or lose a fact: the 200 characters are the planner's own aim (spec 011), and the contract takes up to 1,000.
// The longest the sweeps found came to 201 before the shortest wording and fit with it (demo-fixture.test.ts).
export function fittedReason(render: (wording: Wording) => string): string {
  let reason = '';
  for (const wording of WORDINGS) {
    reason = render(wording);
    if (reason.length <= 200) return reason;
  }
  return reason;
}

// A truck, and one of its trips, as a wording names them: by the driver the planner's input gives the vehicle until the
// wording falls back to kind and id, and in the tight forms without "the" and with a second trip after the truck.
const byDriver = (wording: Wording) => wording === 'full' || wording === 'short' || wording.startsWith('named ');
const formOf = (wording: Wording) => wording.replace('named ', '');
const isTight = (wording: Wording) => ['tight', 'tightest', 'shortest'].includes(formOf(wording));
const withoutRule = (wording: Wording) => ['tightest', 'shortest'].includes(formOf(wording));
const isShortest = (wording: Wording) => formOf(wording) === 'shortest';
// In a tight form a truck with a driver is "Chaminda's dry truck", which has no "the", and one with none "dry truck VEH044".
const tightTruck = (vehicle: EngineVehicle, wording: Wording) => {
  const name = byDriver(wording) ? driverNameOf(vehicle.driverName) : undefined;
  return name ? vehicleCalled(vehicle, name) : kindAndId(vehicle);
};
const truckIn = (vehicle: EngineVehicle, wording: Wording) =>
  (isTight(wording) ? tightTruck(vehicle, wording) : vehicleCalled(vehicle, byDriver(wording) ? vehicle.driverName : undefined));
const tripIn = (vehicle: EngineVehicle, tripNo: number, wording: Wording) => (isTight(wording)
  ? `${tightTruck(vehicle, wording)}${isSecondTrip(tripNo) ? '\'s second trip' : ''}`
  : tripCalled(vehicle, tripNo, byDriver(wording) ? vehicle.driverName : undefined));
// A trial with no driver's name on its trucks or trips, so the checker's own sentence it gives names none either.
const hasDrivers = (input: PlanInput) => input.plan.trips.some((trip) => driverNameOf(trip.driverName) !== undefined);
const withoutDrivers = (input: PlanInput): PlanInput => ({
  ...input,
  vehicles: input.vehicles.map(({ driverName: _driverName, ...vehicle }) => vehicle),
  plan: { ...input.plan, trips: input.plan.trips.map(({ driverName: _driverName, ...trip }) => trip) },
});

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
// The only vehicles the search could use: fridge ones for chilled goods, vans for a van-only shop. Saying
// "truck" alone would be untrue when a dry truck reaches the same shop in time on the same plan.
const vehicleWord = (input: PlannerInput, order: PlannerOrder): string =>
  `${computeLoad(order.lines, input.products).needsReefer ? 'fridge ' : ''}${shopOf(input, order).parking === 'van_only' ? 'van' : 'truck'}`;

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
  const shop = shopOf(input, order), day = weekday(input.date), vehicle = vehicleWord(input, order);
  const otherLate = delaysOtherShops(order, options.attempts ?? []);
  const cannotDivideAgain = code === 'over_capacity' && options.detail?.includes('cannot be split again');
  const sentence = (place: string): string => {
    if (options.split) {
      const { keptUnits: kept, remainingUnits: rest } = options.split;
      const cause = code === 'window'
        ? otherLate ? 'carrying them would make other shops late' : `no ${vehicle} could reach the shop ${windowDeadline(shop)}`
        : code === 'fuel' ? `the ${vehicle}s did not have enough of this week's fuel left`
          : code === 'no_reefer' ? 'no fridge truck was free'
            : code === 'no_van' ? 'no van was free'
              : cannotDivideAgain ? 'the remainder cannot be divided again' : `the ${vehicle} was full`;
      return `${kept} of the ${kept + rest} ${quantityWord(input, order)} for ${place} go on ${day}; the other ${rest} wait for the next plan because ${cause}.`;
    }
    if (code === 'no_reefer') return `No fridge truck was free for ${place} on ${day}.`;
    if (code === 'no_van') return `No van was free for ${place} on ${day}, which takes vans only.`;
    if (code === 'fuel') return `The ${vehicle}s that could reach ${place} on ${day} did not have enough of this week's fuel left.`;
    if (code === 'over_capacity') return splitLimitWords(options.detail, place, day) ?? `The ${vehicle}s going to ${place} on ${day} were full.`;
    if (shop.mallOpen !== undefined && shop.mallOpen > shop.windowClose) {
      return `The delivery window for ${place} closes at ${toClock(shop.windowClose)}, before the mall opens at ${toClock(shop.mallOpen)} on ${day}.`;
    }
    if (shop.mallClose !== undefined && shop.mallClose < shop.windowOpen) {
      return `The mall slot for ${place} closes at ${toClock(shop.mallClose)}, before the shop opens at ${toClock(shop.windowOpen)} on ${day}.`;
    }
    return otherLate
      ? `The ${vehicle} that could reach ${place} in time would then have been late for its other shops on ${day}.`
      : `No ${vehicle} could reach ${place} ${windowDeadline(shop)} on ${day}.`;
  };
  let reason = sentence(readableName(shop));
  if (reason.length > 200) reason = sentence(displayName(shop.district.trim()));
  // Only exceptionally long supplied names or quantities need the compact form; retain the cause and
  // weekday, rather than chopping a sentence in half or losing its time.
  if (reason.length > 200 && options.split) {
    const { keptUnits: kept, remainingUnits: rest } = options.split;
    const why = code === 'window' ? otherLate ? 'other shops would be late' : `delivery must be ${windowDeadline(shop)}`
      : code === 'fuel' ? "this week's fuel left was not enough"
        : cannotDivideAgain ? 'the remainder cannot be divided again' : `the ${vehicle} was full`;
    reason = `${displayName(shop.district)}: ${kept} ${quantityWord(input, order)} go on ${day}; ${rest} wait because ${why}.`;
  }
  return { orderId: order.id, code, reason };
}

export function priorityReason(input: PlannerInput, order: PlannerOrder, rank: number, wording: Wording = 'full'): string {
  const compact = wording !== 'full';
  const shop = shopOf(input, order), load = computeLoad(order.lines, input.products);
  const wantedDay = weekday(order.deliveryDate);
  const waiting = isWaiting(order, input.date) ? `waited since ${compact ? wantedDay.slice(0, 3) : wantedDay}` : 'new order';
  if (compact) return `Rank ${rank}: ${waiting}; ${load.needsReefer ? 'chilled' : 'dry'}; ${displayName(shop.district)} by ${toClock(effectiveWindow(shop).close)}`;
  const restrictions = [shop.brand === 'Fresh' ? 'Fresh' : '', shop.mallOpen === undefined ? '' : 'mall slot', shop.parking === 'van_only' ? 'vans only' : ''].filter(Boolean);
  const freshDeadline = shop.brand === 'Fresh' && Math.min(shop.windowClose, shop.mallClose ?? shop.windowClose) >= FRESH_DEADLINE;
  return `Rank ${rank}: ${waiting}; ${load.needsReefer ? 'chilled' : 'dry'}; ${readableName(shop)} ${freshDeadline ? 'due' : 'closes'} ${toClock(effectiveWindow(shop).close)}${restrictions.length ? `; ${restrictions.join(', ')}` : ''}`;
}

// The run an order joins or starts, the vehicle by the driver the planner's input gives it (spec 026) or else by its
// kind and id, and only a second trip by its number (spec 024): "new run on Chaminda's dry truck to Gampaha", "joined
// the dry truck VEH012 on its second trip to Gampaha".
export function placementReason(input: PlannerInput, order: PlannerOrder, attempt: CandidateAttempt, wording: Wording = 'full'): string {
  const district = displayName(shopOf(input, order).district);
  const { vehicleId, tripNo, existing } = attempt.slot;
  const vehicle = lookup(input.vehicles, 'vehicle')(vehicleId);
  if (wording !== 'full') {
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
    // The tightest wordings leave out the deciding rule, and only that.
    return `${existing ? 'joined' : 'on'} ${tripIn(vehicle, tripNo, wording)}${withoutRule(wording) ? '' : ` (${why})`}`;
  }
  const placed = existing
    ? `joined ${truckIn(vehicle, wording)} on ${itsTrip(tripNo) ?? 'its run'} to ${district}`
    : `new ${isSecondTrip(tripNo) ? 'second trip' : 'run'} on ${truckIn(vehicle, wording)} to ${district}`;
  return `${placed}, ${attempt.selectionReason ?? 'within its capacity, receiving hours and fuel'}`;
}

// named is a vehicle the explanation has already named, as a split's does for the part that went: its short form then
// calls that vehicle "it" (spec 024).
export function refusedReason(
  input: PlannerInput, order: PlannerOrder, attempts: readonly CandidateAttempt[], code: PlannerDeferralCode, wording: Wording = 'full', named?: string,
): string {
  const attempt = attempts.find((candidate) => candidate.stage === code);
  if (!attempt) return deferralFor(input, order, code).reason;
  // Once the drivers' names have given way, the trial is checked again without them, so a sentence of the checker's
  // own that the reason quotes names its trucks by kind and id too.
  const checked = byDriver(wording) || !hasDrivers(attempt.input) ? attempt.check ?? checkPlan(attempt.input) : checkPlan(withoutDrivers(attempt.input));
  const problem = checked.problems.find((problem) => problem.level === 'block' && (code === 'fuel'
    ? problem.code === 'fuel_over_quota' : code === 'over_capacity'
      ? problem.code === 'over_weight' || problem.code === 'over_volume' : problem.code !== 'fuel_over_quota'));
  if (!problem) return deferralFor(input, order, code, { attempts }).reason;
  // The short forms follow the checker's rules (spec 024, spec 026): the shop first at a stop, the vehicle by its driver
  // or else its kind, and only a second trip by its number.
  if (wording !== 'full') {
    const vehicle = lookup(attempt.input.vehicles, 'vehicle')(problem.vehicleId ?? attempt.slot.vehicleId);
    const tripNo = problem.tripNo ?? attempt.slot.tripNo;
    const trip = checked.trips.find((trip) => trip.vehicleId === vehicle.id && trip.tripNo === tripNo);
    const again = vehicle.id === named;
    const theVehicle = again ? 'It' : capital(truckIn(vehicle, wording));
    const onTrip = again ? itsTrip(tripNo) ?? 'it' : tripIn(vehicle, tripNo, wording);
    const never = again ? 'it can never be reached in time' : `${onTrip} can never reach it in time`;
    const over = (load: string, limit: string) => (isShortest(wording)
      ? `${again ? 'It is' : theVehicle} over its ${limit} limit with ${load}${onItsTrip(tripNo)}.`
      : `${theVehicle} carries ${load}${onItsTrip(tripNo)}, over its ${limit} limit.`);
    if (problem.code === 'over_weight' && trip) return over(kg(trip.load.kg), kg(vehicle.weightCapKg));
    if (problem.code === 'over_volume' && trip) return over(m3(trip.load.m3), m3(vehicle.volumeCapM3));
    if (problem.code === 'fuel_over_quota') {
      const fuel = checked.vehicles.find((fuel) => fuel.vehicleId === vehicle.id)!;
      const left = fuel.quotaL - fuel.litresBefore;
      // In the tight form the litres it needs and has left say it is over, unless rounding them hides that.
      if (isTight(wording)) {
        return Math.round(fuel.litresPlan * 10) > Math.round(left * 10)
          ? `${theVehicle} needs ${litres(fuel.litresPlan)}, with ${litreFigure(left)} left of its quota.`
          : `${theVehicle} exceeds its quota before rounding: ${litres(fuel.litresPlan)} needed, ${litreFigure(left)} left.`;
      }
      return `${theVehicle} exceeds its fuel quota before rounding: ${litres(fuel.litresPlan)} needed, ${litres(left)} left.`;
    }
    const stop = trip?.times?.stops.find((stop) => stop.outletId === problem.outletId && stop.seq === problem.stopSeq);
    if (stop && (problem.code === 'window_missed' || problem.code === 'mall_slot_missed')) {
      const shop = lookup(input.outlets, 'shop')(stop.outletId);
      const place = displayName(shop.district);
      if (stop.windowOpen > stop.windowClose) return shop.mallOpen !== undefined && shop.mallOpen > shop.windowClose
        ? `${place} closes at ${toClock(shop.windowClose)}, before its mall opens at ${toClock(shop.mallOpen)}, so ${never}.`
        : `${place} opens at ${toClock(shop.windowOpen)}, after its mall closes at ${toClock(shop.mallClose!)}, so ${never}.`;
      const deadline = shop.brand === 'Fresh' && stop.windowClose >= FRESH_DEADLINE ? FRESH_DEADLINE : stop.windowClose;
      // The tight form leaves out the order's own shop, which its rank has named already, though another shop it would
      // make late keeps its name; and it leaves out "is" and "the deadline", keeping the times.
      if (isTight(wording)) {
        return `${stop.outletId === order.outletId ? '' : `${place} `}reached at ${toClock(stop.arriveAt)} by ${onTrip}, after ${toClock(deadline)}.`;
      }
      return `${place} is reached at ${toClock(stop.arriveAt)} by ${onTrip}, after the ${toClock(deadline)} deadline.`;
    }
  }
  let reason = problem.message;
  for (const shop of input.outlets) reason = reason.split(shop.id).join(readableName(shop));
  return reason;
}

// The early departure the planner asks the dispatcher to accept, the order that forced it first and the vehicle by its
// driver or else its kind (spec 024, spec 026): "The rank 4 order for Badulla makes the dry truck VEH044 leave at 02:59
// instead of 03:30."
export function earlyLeaveReason(
  input: PlannerInput, trip: { vehicleId: string; tripNo: number; leaveAt: number; usual: number }, rank: number, order: PlannerOrder,
  wording: Wording = 'full',
): string {
  const vehicle = lookup(input.vehicles, 'vehicle')(trip.vehicleId);
  return `The rank ${rank} order for ${shopName(input, order)} makes ${tripIn(vehicle, trip.tripNo, wording)} leave at ${toClock(trip.leaveAt)} instead of ${toClock(trip.usual)}.`;
}

export function deferralDecisions(input: PlannerInput, order: PlannerOrder, deferral: PlanDeferral): PlannerDecision[] {
  const decisions: PlannerDecision[] = [];
  if (isWaiting(order, input.date)) decisions.push({ kind: 'waited_again', orderId: order.id, reason: deferral.reason });
  if (deferral.code === 'window') decisions.push({ kind: 'late_order', orderId: order.id, reason: deferral.reason });
  return decisions;
}
