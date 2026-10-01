import { DeferralCode, levelOf, type Problem, type ProblemCode } from '@wayfinder/contracts';
import { computeLoad } from '../load';
import { lookup } from '../lookup';
import type { CoverageProblems } from '../types';
import { capital, itsTrip, orderCalled, tripCalled, vehicleCalled } from '../words';

// Every order accounted for (spec 007, AC-24 to AC-28 and AC-48): each of the day's orders is on one stop or
// deferred once with a reason and sits at its own shop, and no trip is empty or stops at a shop twice. The
// sentences follow spec 024: the order or the shop first, and the vehicle by its kind.

type About = Pick<Problem, 'vehicleId' | 'tripNo' | 'stopSeq' | 'outletId' | 'orderId'>;

const list = new Intl.ListFormat('en-GB');

export const coverageProblems: CoverageProblems = (input) => {
  const vehicleOf = lookup(input.vehicles, 'vehicle');
  const outletOf = lookup(input.outlets, 'shop');
  // Where the plan puts each of the day's orders: the stops it is on, and how many times it is deferred. And
  // what a sentence calls it, so the dispatcher can tell a shop's chilled order from its dry one.
  const places = input.orders.map((order) => {
    const load = computeLoad(order.lines, input.products);
    return { id: order.id, outletId: order.outletId, called: orderCalled(load.kg, load.needsReefer, outletOf(order.outletId).name), stops: [] as string[], deferrals: 0 };
  });
  const placeOf = lookup(places, 'order');
  const problems: Problem[] = [];
  const report = (code: ProblemCode, about: About, message: string, fix: string) => {
    problems.push({ code, level: levelOf(code), message, fix, ...about });
  };

  for (const trip of input.plan.trips) {
    const vehicle = vehicleOf(trip.vehicleId);
    const onTrip = tripCalled(vehicle, trip.tripNo);
    const about = { vehicleId: vehicle.id, tripNo: trip.tripNo };
    if (trip.stops.length === 0) {
      // A first or only trip is not numbered, so the sentence says it is one of the vehicle's trips.
      const empty = itsTrip(trip.tripNo) === null ? `${vehicleCalled(vehicle)} has a trip with no stops.` : `${onTrip} has no stops.`;
      report('empty_trip', about, capital(empty), 'Add a stop or remove the trip.');
    }

    const firstStopAt = new Map<string, number>();
    for (const [i, stop] of trip.stops.entries()) {
      const outlet = outletOf(stop.outletId);
      const stopSeq = i + 1;
      const here = { ...about, stopSeq, outletId: outlet.id };
      const first = firstStopAt.get(outlet.id);
      if (first === undefined) firstStopAt.set(outlet.id, stopSeq);
      else report('stop_repeated', here, `${outlet.name} is both stop ${first} and stop ${stopSeq} on ${onTrip}.`, 'Put its orders on one stop.');
      if (stop.orderIds.length === 0) report('empty_trip', here, `${outlet.name} is a stop with no orders on ${onTrip}.`, 'Add its orders or take the stop off.');

      for (const orderId of stop.orderIds) {
        const order = placeOf(orderId);
        if (order.outletId !== outlet.id) {
          report('order_wrong_outlet', { ...here, orderId }, `The ${order.called} goes to ${outlet.name} on ${onTrip}.`, `Move it to a stop at ${outletOf(order.outletId).name}.`);
        }
        order.stops.push(`on ${onTrip} at stop ${stopSeq}`);
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
      report('deferral_incomplete', { orderId, outletId: order.outletId }, `The ${order.called} is deferred without ${missing.join(' or ')}.`, `Give it ${missing.join(' and ')}.`);
    }
  }

  for (const { id, outletId, called, stops, deferrals } of places) {
    const about = { orderId: id, outletId };
    const times = stops.length + deferrals;
    if (times === 0) report('order_not_planned', about, `The ${called} is on no trip and is not deferred.`, 'Put it on a trip or defer it with a reason.');
    if (times > 1) {
      const where = deferrals === 0 ? stops : [...stops, deferrals === 1 ? 'deferred' : `deferred ${deferrals} times`];
      report('order_twice', about, `The ${called} is ${list.format(where)}, and an order can be in the plan only once.`, 'Keep it in one place only.');
    }
  }

  return problems;
};
