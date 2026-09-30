import { DeferralCode, levelOf, type Problem, type ProblemCode } from '@wayfinder/contracts';
import { lookup } from '../lookup';
import type { CoverageProblems } from '../types';

// Every order accounted for (spec 007, AC-24 to AC-28 and AC-48): each of the day's orders is on one stop or
// deferred once with a reason and sits at its own shop, and no trip is empty or stops at a shop twice.

type About = Pick<Problem, 'vehicleId' | 'tripNo' | 'stopSeq' | 'outletId' | 'orderId'>;

const list = new Intl.ListFormat('en-GB');

export const coverageProblems: CoverageProblems = (input) => {
  const vehicleOf = lookup(input.vehicles, 'vehicle');
  const outletOf = lookup(input.outlets, 'shop');
  // Where the plan puts each of the day's orders: the stops it is on, and how many times it is deferred.
  const places = input.orders.map((order) => ({ id: order.id, outletId: order.outletId, shop: outletOf(order.outletId).name, stops: [] as string[], deferrals: 0 }));
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
      else report('stop_repeated', here, `${name} has ${outlet.name} as stop ${first} and again as stop ${stopSeq}.`);
      if (stop.orderIds.length === 0) report('empty_trip', here, `${name} has a stop at ${outlet.name} with no orders.`);

      for (const orderId of stop.orderIds) {
        const order = placeOf(orderId);
        if (order.outletId !== outlet.id) {
          report('order_wrong_outlet', { ...here, orderId }, `${name} has an order for ${order.shop} on its stop at ${outlet.name}.`);
        }
        order.stops.push(`on ${name} stop ${stopSeq}`);
      }
    }
  }

  for (const { orderId, code, reason } of input.plan.deferrals) {
    const order = placeOf(orderId);
    order.deferrals += 1;
    const missing: string[] = [];
    if (!DeferralCode.safeParse(code).success) missing.push('a reason from the list');
    if (reason.trim() === '') missing.push('a written reason');
    if (missing.length > 0) {
      report('deferral_incomplete', { orderId, outletId: order.outletId }, `An order for ${order.shop} is deferred without ${missing.join(' or ')}.`);
    }
  }

  for (const { id, outletId, shop, stops, deferrals } of places) {
    const about = { orderId: id, outletId };
    const times = stops.length + deferrals;
    if (times === 0) report('order_not_planned', about, `An order for ${shop} is on no trip and is not deferred.`);
    if (times > 1) {
      const where = deferrals === 0 ? stops : [...stops, deferrals === 1 ? 'deferred' : `deferred ${deferrals} times`];
      report('order_twice', about, `An order for ${shop} is ${list.format(where)}, and an order can be in the plan only once.`);
    }
  }

  return problems;
};
