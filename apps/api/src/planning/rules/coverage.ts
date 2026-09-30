import { DeferralCode, levelOf, type Problem, type ProblemCode } from '@wayfinder/contracts';
import { PlanInputError } from '../errors';
import type { CoverageProblems } from '../types';

// Every order accounted for (spec 007, AC-24 to AC-28 and AC-48): each of the day's orders is on one stop or
// deferred once with a reason and sits at its own shop, and no trip is empty or stops at a shop twice.

type About = Pick<Problem, 'vehicleId' | 'tripNo' | 'stopSeq' | 'outletId' | 'orderId'>;

// An id the input does not hold is a programming mistake, not a problem with the plan, so it throws.
const lookup = <T extends { id: string }>(rows: T[], what: string) => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return (id: string): T => {
    const row = byId.get(id);
    if (!row) throw new PlanInputError(`No ${what} ${id} in the input`);
    return row;
  };
};

const list = new Intl.ListFormat('en-GB');

export const coverageProblems: CoverageProblems = (input) => {
  const vehicleOf = lookup(input.vehicles, 'vehicle');
  const outletOf = lookup(input.outlets, 'shop');
  // Where the plan puts each of the day's orders: the stops it is on, and how many times it is deferred.
  const places = input.orders.map((order) => ({ id: order.id, outletId: order.outletId, stops: [] as string[], deferrals: 0 }));
  const placeOf = lookup(places, 'order');
  const problems: Problem[] = [];
  const report = (code: ProblemCode, about: About, message: string) => {
    problems.push({ code, level: levelOf(code), message, ...about });
  };

  for (const trip of input.plan.trips) {
    const vehicle = vehicleOf(trip.vehicleId);
    const name = `${vehicle.id} trip ${trip.tripNo}`;
    const about = { vehicleId: vehicle.id, tripNo: trip.tripNo };
    if (trip.stops.length === 0) report('empty_trip', about, `${name} has no stops.`);

    const firstStopAt = new Map<string, number>();
    for (const [i, stop] of trip.stops.entries()) {
      const outlet = outletOf(stop.outletId);
      const stopSeq = i + 1;
      const here = { ...about, stopSeq, outletId: outlet.id };
      const first = firstStopAt.get(outlet.id);
      if (first === undefined) firstStopAt.set(outlet.id, stopSeq);
      else report('stop_repeated', here, `${name} has ${outlet.id} as stop ${first} and again as stop ${stopSeq}.`);
      if (stop.orderIds.length === 0) report('empty_trip', here, `${name} has a stop at ${outlet.id} with no orders.`);

      for (const orderId of stop.orderIds) {
        const order = placeOf(orderId);
        if (order.outletId !== outlet.id) {
          report('order_wrong_outlet', { ...here, orderId }, `${name} has an order for ${order.outletId} on its stop at ${outlet.id}.`);
        }
        order.stops.push(`on ${name} stop ${stopSeq}`);
      }
    }
  }

  for (const { orderId, code, reason } of input.plan.deferrals) {
    const order = placeOf(orderId);
    order.deferrals += 1;
    const missing = [
      ...(DeferralCode.safeParse(code).success ? [] : ['a reason from the list']),
      ...(reason.trim() === '' ? ['a written reason'] : []),
    ];
    if (missing.length > 0) {
      report('deferral_incomplete', { orderId, outletId: order.outletId }, `An order for ${order.outletId} is deferred without ${list.format(missing)}.`);
    }
  }

  for (const { id, outletId, stops, deferrals } of places) {
    const about = { orderId: id, outletId };
    const times = stops.length + deferrals;
    if (times === 0) report('order_not_planned', about, `An order for ${outletId} is on no trip and is not deferred.`);
    if (times > 1) {
      const where = deferrals === 0 ? stops : [...stops, deferrals === 1 ? 'deferred' : `deferred ${deferrals} times`];
      report('order_twice', about, `An order for ${outletId} is ${list.format(where)}, and an order can be in the plan only once.`);
    }
  }

  return problems;
};
