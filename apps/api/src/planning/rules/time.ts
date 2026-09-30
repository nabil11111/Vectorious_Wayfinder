import { levelOf, type Problem, type ProblemCode } from '@wayfinder/contracts';
import { PlanInputError } from '../errors';
import { lookup } from '../lookup';
import { budgetMinutes, earliestLeaveFor, FRESH_DEADLINE, timeTrip, tripsOf } from '../timeline';
import type { Minutes, PlanInput, PlanTrip, TimeProblems } from '../types';
import { toClock } from '../words';

// Time (spec 007, AC-29 to AC-33, AC-37 to AC-39, AC-47 and AC-49): a trip stays in one district the data has
// a drive to, a vehicle runs at most two trips and the second after the first, every shop is reached inside
// its window and its mall's slot, and the day's budgets, leaving early and long waits are pointed out.

type About = Pick<Problem, 'vehicleId' | 'tripNo' | 'stopSeq' | 'outletId' | 'orderId'>;

const list = new Intl.ListFormat('en-GB');
const minutes = (n: number) => `${n} ${n === 1 ? 'minute' : 'minutes'}`;
const overBudget = (vehicleId: string, trips: string, took: number, budget: number) =>
  `${vehicleId}'s ${trips} trips take ${took} minutes of driving and unloading, and their budget for the day is ${budget}.`;

// The latest leaving time before the trip's own that reaches every stop in time, or null when there is none
// (AC-47). Leaving earlier never makes a stop later, so it steps back a minute at a time and the first time
// with no late stop is the latest one. It never goes before notBefore, which is midnight or when the vehicle is
// ready from its earlier trip.
const earlierLeave = (input: PlanInput, trip: PlanTrip, own: Minutes, notBefore: Minutes): Minutes | null => {
  for (let leaveAt = own - 1; leaveAt >= notBefore; leaveAt -= 1) {
    const times = timeTrip(input, trip, leaveAt);
    if (times?.stops.every((stop) => !stop.late)) return leaveAt;
  }
  return null;
};

export const timeProblems: TimeProblems = (input, vehicleTimes) => {
  const vehicleOf = lookup(input.vehicles, 'vehicle');
  const outletOf = lookup(input.outlets, 'shop');
  const problems: Problem[] = [];
  const report = (code: ProblemCode, about: About, message: string, fix?: string | null, leaveAt?: Minutes | null) => {
    // Trips may run past midnight, but a departure the screen can apply must fit the plan day's time field.
    const suggestion = leaveAt != null && Number.isInteger(leaveAt) && leaveAt >= 0 && leaveAt <= 1439 ? { leaveAt } : {};
    problems.push({ code, level: levelOf(code), message, ...(fix ? { fix } : {}), ...suggestion, ...about });
  };

  const vehicleIds = new Set(input.plan.trips.map((trip) => vehicleOf(trip.vehicleId).id));
  for (const vehicleId of vehicleIds) {
    // In the order the trips are timed in, so each one meets its own times below.
    const trips = tripsOf(input, vehicleId);
    const numbers = trips.map((trip) => trip.tripNo);
    const odd = numbers.find((n) => n !== 1 && n !== 2);
    if (numbers.length > 2) {
      report('too_many_trips', { vehicleId }, `${vehicleId} has ${numbers.length} trips, and a vehicle runs at most two a day.`);
    } else if (odd !== undefined) {
      report('too_many_trips', { vehicleId, tripNo: odd }, `${vehicleId} has a trip numbered ${odd}, and a vehicle's trips are numbered 1 and 2.`);
    } else if (numbers.length === 2 && numbers[0] === numbers[1]) {
      report('too_many_trips', { vehicleId, tripNo: numbers[0] }, `${vehicleId} has two trips numbered ${numbers[0]}, and a vehicle's trips are numbered 1 and 2.`);
    }

    const day = vehicleTimes.find((times) => times.vehicleId === vehicleId);
    // The trip before, once it has been timed: the vehicle cannot leave again until it is back and reloaded.
    let earlier: { tripNo: number; readyAt: Minutes } | null = null;
    for (const [i, trip] of trips.entries()) {
      const name = `${vehicleId} trip ${trip.tripNo}`;
      const about = { vehicleId, tripNo: trip.tripNo };
      const shops = trip.stops.map((stop) => outletOf(stop.outletId));
      const districts = [...new Set(shops.map((shop) => shop.district))];
      const [district] = districts;

      // A trip with no stops, with stops in two districts or with no drive to its district cannot be timed, so it
      // has no times to check. The first of the three is reported with the orders (AC-28).
      if (district === undefined) continue;
      if (districts.length > 1) {
        report('cross_district', about, `${name} has stops in ${districts.length} districts, ${list.format(districts)}, and a trip stays inside one district.`);
        continue;
      }
      if (!input.travel.some((row) => row.depotId === input.depotId && row.district === district)) {
        report('no_travel_data', about, `${name} goes to ${district}, and there are no travel figures from the ${input.depotId} depot to ${district}.`);
        continue;
      }

      const timed = day?.trips[i];
      const times = timed?.tripNo === trip.tripNo ? timed.times : null;
      // Everything below reads the times handed in, so a trip that comes without them would pass unchecked.
      if (!times) throw new PlanInputError(`No times were given for ${name}`);

      if (earlier && times.leaveAt < earlier.readyAt) {
        report('trips_overlap', about, `${name} leaves at ${toClock(times.leaveAt)}, before ${vehicleId} is back from trip ${earlier.tripNo} and reloaded at ${toClock(earlier.readyAt)}.`, `Leave at ${toClock(earlier.readyAt)} or later.`, earlier.readyAt);
      }
      // A trip with no leaving time of its own never leaves before this, so only a set time can.
      const earliest = earliestLeaveFor(input.settings, shops);
      if (times.leaveAt < earliest) {
        const fresh = shops.some((shop) => shop.brand === 'Fresh') ? 'with' : 'without';
        report('leaves_early', about, `${name} leaves at ${toClock(times.leaveAt)}, and a trip ${fresh} a Fresh shop normally leaves at ${toClock(earliest)} or later.`);
      }

      // One time for the whole trip, carried by each of its late stops.
      const leaveBy = times.stops.some((stop) => stop.late) ? earlierLeave(input, trip, times.leaveAt, earlier?.readyAt ?? 0) : null;
      const fix = leaveBy === null ? null : `Leave by ${toClock(leaveBy)} to reach every stop in time.`;
      for (const stop of times.stops) {
        const shop = outletOf(stop.outletId);
        const here = { ...about, stopSeq: stop.seq, outletId: shop.id };
        const reaches = `${name} reaches ${shop.name} at ${toClock(stop.arriveAt)}`;
        const { mallOpen, mallClose } = shop;
        const inMall = mallOpen !== undefined && mallClose !== undefined;
        // The closing time stays the shop's own, so a Fresh shop reached at 08:00 can be late inside its window.
        const freshRule = shop.brand === 'Fresh' && stop.arriveAt >= FRESH_DEADLINE ? `, and Fresh shops must be reached before ${toClock(FRESH_DEADLINE)}` : '';

        if (stop.late && stop.windowOpen > stop.windowClose) {
          // No leaving time helps a window that opens after it closes, so there is no fix. A mall slot that never
          // meets the shop's own window gives one, and so does a shop whose own window is the wrong way round.
          const never = inMall
            ? `which takes deliveries from ${toClock(shop.windowOpen)} to ${toClock(shop.windowClose)} while its mall lets them in only from ${toClock(mallOpen)} to ${toClock(mallClose)}`
            : `whose delivery window opens at ${toClock(stop.windowOpen)} and closes at ${toClock(stop.windowClose)}`;
          report(inMall ? 'mall_slot_missed' : 'window_missed', here, `${name} stops at ${shop.name}, ${never}, so it can never be reached in time.`);
        } else if (stop.late && inMall && stop.arriveAt > mallClose) {
          report('mall_slot_missed', here, `${reaches}, ${minutes(stop.arriveAt - mallClose)} after its mall's delivery hours of ${toClock(mallOpen)} to ${toClock(mallClose)} end${freshRule}.`, fix, leaveBy);
        } else if (stop.late) {
          const afterClosing = stop.arriveAt > stop.windowClose ? `, ${minutes(stop.arriveAt - stop.windowClose)} after its delivery window closes at ${toClock(stop.windowClose)}` : '';
          report('window_missed', here, `${reaches}${afterClosing}${freshRule}.`, fix, leaveBy);
        } else if (stop.waitMin > input.settings.waitWarnMin) {
          // Only at the first stop does leaving later take the wait away. A later stop follows the ones before it.
          const leaveLater = stop.seq === 1 ? times.leaveAt + stop.waitMin : null;
          const fix = leaveLater === null ? null : `Leave at ${toClock(leaveLater)} to arrive as it opens.`;
          report('long_wait', here, `${reaches} and waits ${minutes(stop.waitMin)} for its delivery window to open at ${toClock(stop.windowOpen)}.`, fix, leaveLater);
        }
      }
      earlier = { tripNo: trip.tripNo, readyAt: times.readyAgainAt };
    }

    if (day) {
      const { freshMin, styleTechMin } = budgetMinutes(input, day);
      const { fresh, styleTech } = input.settings.budgetMin;
      if (freshMin > fresh) report('over_time_budget', { vehicleId }, overBudget(vehicleId, 'Fresh', freshMin, fresh));
      if (styleTechMin > styleTech) report('over_time_budget', { vehicleId }, overBudget(vehicleId, 'Style and Tech', styleTechMin, styleTech));
    }
  }

  return problems;
};
