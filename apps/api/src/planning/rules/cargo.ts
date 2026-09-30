import { levelOf, type Brand, type Problem, type ProblemCode } from '@wayfinder/contracts';
import { PlanInputError } from '../errors';
import { computeLoad } from '../load';
import { lookup } from '../lookup';
import type { CargoProblems } from '../types';
import { kg, m3, orderCalled } from '../words';

// What each vehicle carries (spec 007, AC-17 to AC-23): weight, volume, chilled goods, van-only shops, depots,
// tail-lift items and mixed brands.

type About = Pick<Problem, 'vehicleId' | 'tripNo' | 'stopSeq' | 'outletId' | 'orderId'>;

// How far a load is past its limit, in the load's own unit. Both are turned into whole numbers first (hundredths
// of a kilo, litres), so a load exactly at the limit is 0 over whatever JavaScript makes of the decimals.
const over = (load: number, limit: number, perUnit: number) => (Math.round(load * perUnit) - Math.round(limit * perUnit)) / perUnit;

const nameOf = (trip: { vehicleId: string; tripNo: number }) => `${trip.vehicleId} trip ${trip.tripNo}`;
const list = new Intl.ListFormat('en-GB');

export const cargoProblems: CargoProblems = (input, tripLoads) => {
  const vehicleOf = lookup(input.vehicles, 'vehicle');
  const outletOf = lookup(input.outlets, 'shop');
  const orderOf = lookup(input.orders, 'order');
  const problems: Problem[] = [];
  const report = (code: ProblemCode, about: About, message: string, fix?: string) => {
    problems.push({ code, level: levelOf(code), message, ...(fix ? { fix } : {}), ...about });
  };

  for (const tripLoad of tripLoads) {
    const { vehicleId, tripNo, load } = tripLoad;
    const vehicle = vehicleOf(vehicleId);
    const overKg = over(load.kg, vehicle.weightCapKg, 100);
    if (overKg > 0) {
      report('over_weight', { vehicleId, tripNo }, `${nameOf(tripLoad)} carries ${kg(load.kg)} and its limit is ${kg(vehicle.weightCapKg)}.`, `Take ${kg(overKg)} off this trip.`);
    }
    const overM3 = over(load.m3, vehicle.volumeCapM3, 1000);
    if (overM3 > 0) {
      report('over_volume', { vehicleId, tripNo }, `${nameOf(tripLoad)} carries ${m3(load.m3)} and its limit is ${m3(vehicle.volumeCapM3)}.`, `Take ${m3(overM3)} off this trip.`);
    }
  }

  const loaded = new Set(tripLoads.map(nameOf));
  for (const trip of input.plan.trips) {
    const vehicle = vehicleOf(trip.vehicleId);
    const name = nameOf(trip);
    // Weight and volume are checked from the loads handed in, so a trip without one would pass unchecked.
    if (!loaded.has(name)) throw new PlanInputError(`No load was given for ${name}`);
    const about = { vehicleId: vehicle.id, tripNo: trip.tripNo };
    if (vehicle.depotId !== input.depotId) {
      report('wrong_depot', about, `${name} is in the ${input.depotId} plan, and ${vehicle.id} belongs to the ${vehicle.depotId} depot.`);
    }

    const brands = new Set<Brand>();
    for (const [i, stop] of trip.stops.entries()) {
      const outlet = outletOf(stop.outletId);
      const here = { ...about, stopSeq: i + 1, outletId: outlet.id };
      brands.add(outlet.brand);
      if (outlet.parking === 'van_only' && vehicle.type === 'truck') {
        report('van_only', here, `${name} stops at ${outlet.name}, which only a van can reach, and ${vehicle.id} is a truck.`);
      }
      if (outlet.depotId !== vehicle.depotId) {
        report('wrong_depot', here, `${name} stops at ${outlet.name}, which belongs to the ${outlet.depotId} depot, and ${vehicle.id} belongs to ${vehicle.depotId}.`);
      }

      for (const orderId of stop.orderIds) {
        const load = computeLoad(orderOf(orderId).lines, input.products);
        const order = orderCalled(load.kg, load.needsReefer, outlet.name);
        if (load.needsReefer && vehicle.temp !== 'reefer') {
          report('needs_reefer', { ...here, orderId }, `${name} carries the ${order}, and ${vehicle.id} is not a fridge vehicle.`);
        }
        // Trucks have a tail lift and vans do not (D-24).
        if (load.needsTailLift && vehicle.type === 'van') {
          report('no_tail_lift', { ...here, orderId }, `${name} carries the ${order}, which needs a tail lift, and ${vehicle.id} is a van without one.`);
        }
      }
    }
    if (brands.size > 1 && !input.settings.mixBrands) {
      report('mixed_brands', about, `${name} mixes shops of ${brands.size} brands, ${list.format(brands)}.`);
    }
  }

  return problems;
};
