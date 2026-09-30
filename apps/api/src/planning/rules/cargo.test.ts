import { describe, expect, it } from 'vitest';
import { PlanInputError } from '../errors';
import { computeLoad } from '../load';
import { inputFor, order } from '../testing/shared';
import type { EngineOrder, PlanInput, PlanSettings, PlanTrip, TripLoad } from '../types';
import { cargoProblems } from './cargo';

// One trip with a stop for each order, in the order given.
const tripOf = (vehicleId: string, orders: EngineOrder[], tripNo = 1): PlanTrip =>
  ({ vehicleId, tripNo, stops: orders.map((o) => ({ outletId: o.outletId, orderIds: [o.id] })) });

// Each trip's load, worked out the way the checker does it: from every line of every order on the trip.
const loadsOf = (input: PlanInput): TripLoad[] => input.plan.trips.map((trip) => {
  const onTrip = trip.stops.flatMap((stop) => stop.orderIds);
  const lines = input.orders.filter((o) => onTrip.includes(o.id)).flatMap((o) => o.lines);
  return { vehicleId: trip.vehicleId, tripNo: trip.tripNo, load: computeLoad(lines, input.products) };
});

const check = (depotId: string, orders: EngineOrder[], trips: PlanTrip[], settings?: Partial<PlanSettings>) => {
  const input = inputFor(depotId, { orders, trips, settings });
  return cargoProblems(input, loadsOf(input));
};
// The usual case: one vehicle carries every order on one trip.
const carried = (depotId: string, vehicleId: string, orders: EngineOrder[], settings?: Partial<PlanSettings>) =>
  check(depotId, orders, [tripOf(vehicleId, orders)], settings);

describe('rules for what a vehicle carries', () => {
  it('AC-17 reports over_weight and says how many kilos to take off', () => {
    // Three chilled orders of 60 cartons on van VEH035: 1,242.0 kg against 1,040 kg, while their 6.66 m³ fits in its 7.0 m³.
    const chilled = (id: string, outletId: string) => order(id, outletId, 'fresh-chilled-carton', 60);
    const three = [chilled('a', 'OUT004'), chilled('b', 'OUT006'), chilled('c', 'OUT007')];
    expect(carried('Peliyagoda', 'VEH035', three)).toEqual([{
      code: 'over_weight', level: 'block', vehicleId: 'VEH035', tripNo: 1,
      message: 'VEH035 trip 1 carries 1,242 kg and its limit is 1,040 kg.', fix: 'Take 202 kg off this trip.',
    }]);

    // Each trip is weighed by itself. A fourth order alone on trip 1 is 414 kg and fits, so only trip 2 is over.
    const fourth = chilled('d', 'OUT005');
    expect(check('Peliyagoda', [fourth, ...three], [tripOf('VEH035', [fourth], 1), tripOf('VEH035', three, 2)])).toEqual([{
      code: 'over_weight', level: 'block', vehicleId: 'VEH035', tripNo: 2,
      message: 'VEH035 trip 2 carries 1,242 kg and its limit is 1,040 kg.', fix: 'Take 202 kg off this trip.',
    }]);

    // A load exactly at the limit is allowed: 20 pallets of small appliances are 3,800 kg, the limit of VEH008.
    expect(carried('Peliyagoda', 'VEH008', [order('pallets', 'OUT024', 'tech-small', 20)])).toEqual([]);
  });

  it('AC-18 reports over_volume and says how many cubic metres to take off', () => {
    // 80 rail boxes of hanging garments on VEH008: 24.0 m³ against 22.0 m³, while the 1,120.0 kg is well inside its 3,800 kg.
    const rails = [order('rails', 'OUT019', 'style-hanging', 80)];
    expect(carried('Peliyagoda', 'VEH008', rails)).toEqual([{
      code: 'over_volume', level: 'block', vehicleId: 'VEH008', tripNo: 1,
      message: 'VEH008 trip 1 carries 24 m³ and its limit is 22 m³.', fix: 'Take 2 m³ off this trip.',
    }]);

    // A load exactly at the limit is allowed: the same 24.0 m³ is the limit of VEH012.
    expect(carried('Peliyagoda', 'VEH012', rails)).toEqual([]);

    // 50 cartons of bags are 7.0 m³, the limit of van VEH035. Plain JavaScript says 0.14 × 50 is 7.000000000000001,
    // so a load handed over with that noise in it still counts as exactly at the limit.
    const bags = order('bags', 'OUT019', 'style-bags', 50);
    expect(carried('Peliyagoda', 'VEH035', [bags])).toEqual([]);
    const input = inputFor('Peliyagoda', { orders: [bags], trips: [tripOf('VEH035', [bags])] });
    const noisy = { ...computeLoad(bags.lines, input.products), m3: 0.14 * 50 };
    expect(cargoProblems(input, [{ vehicleId: 'VEH035', tripNo: 1, load: noisy }])).toEqual([]);
  });

  it('AC-19 reports needs_reefer for a chilled order on a vehicle that is not a fridge vehicle', () => {
    // A chilled order next to a dry one on dry truck VEH012: only the chilled one is refused.
    const orders = [order('dry', 'OUT006', 'fresh-dry-carton', 48), order('chilled', 'OUT005', 'fresh-chilled-carton', 40)];
    expect(carried('Peliyagoda', 'VEH012', orders)).toEqual([{
      code: 'needs_reefer', level: 'block', vehicleId: 'VEH012', tripNo: 1, stopSeq: 2, outletId: 'OUT005', orderId: 'chilled',
      message: 'VEH012 trip 1 carries the 276 kg chilled order for OUT005, and VEH012 is not a fridge vehicle.',
    }]);

    // A fridge vehicle carrying dry goods is fine: the same two orders on fridge truck VEH003.
    expect(carried('Peliyagoda', 'VEH003', orders)).toEqual([]);
  });

  it('AC-20 reports van_only for a stop at a van-only shop on a truck', () => {
    const cartons = [order('cartons', 'OUT001', 'fresh-dry-carton', 48)];
    expect(carried('Peliyagoda', 'VEH008', cartons)).toEqual([{
      code: 'van_only', level: 'block', vehicleId: 'VEH008', tripNo: 1, stopSeq: 1, outletId: 'OUT001',
      message: 'VEH008 trip 1 stops at OUT001, which only a van can reach, and VEH008 is a truck.',
    }]);

    expect(carried('Peliyagoda', 'VEH035', cartons)).toEqual([]);
  });

  it('AC-21 reports wrong_depot for a vehicle of another depot than the plan and a shop of another depot than the vehicle', () => {
    // OUT084 belongs to Kandy, so it is refused on Peliyagoda's VEH008.
    const cartons = [order('cartons', 'OUT084', 'fresh-dry-carton', 48)];
    expect(carried('Peliyagoda', 'VEH008', cartons)).toEqual([{
      code: 'wrong_depot', level: 'block', vehicleId: 'VEH008', tripNo: 1, stopSeq: 1, outletId: 'OUT084',
      message: 'VEH008 trip 1 stops at OUT084, which belongs to the Kandy depot, and VEH008 belongs to Peliyagoda.',
    }]);

    // Kandy's van VEH059 may serve OUT084, but not in Peliyagoda's plan.
    expect(carried('Peliyagoda', 'VEH059', cartons)).toEqual([{
      code: 'wrong_depot', level: 'block', vehicleId: 'VEH059', tripNo: 1,
      message: 'VEH059 trip 1 is in the Peliyagoda plan, and VEH059 belongs to the Kandy depot.',
    }]);

    expect(carried('Kandy', 'VEH059', cartons)).toEqual([]);
  });

  it('AC-22 warns with no_tail_lift for an order with a tail-lift item on a van', () => {
    // Two crates of washing machines, 420.0 kg, for OUT093 on van VEH059.
    expect(carried('Kandy', 'VEH059', [order('washers', 'OUT093', 'tech-washer', 2)])).toEqual([{
      code: 'no_tail_lift', level: 'warn', vehicleId: 'VEH059', tripNo: 1, stopSeq: 1, outletId: 'OUT093', orderId: 'washers',
      message: 'VEH059 trip 1 carries the 420 kg dry order for OUT093, which needs a tail lift, and VEH059 is a van without one.',
    }]);

    // Trucks have a tail lift (D-24), and a van with nothing that needs one is fine.
    expect(carried('Kandy', 'VEH044', [order('washers', 'OUT095', 'tech-washer', 2)])).toEqual([]);
    expect(carried('Kandy', 'VEH059', [order('televisions', 'OUT093', 'tech-tv', 1)])).toEqual([]);
  });

  it('AC-23 warns with mixed_brands for a trip with shops of more than one brand, unless mixing is on', () => {
    // OUT019 (Style) and OUT024 (Tech), both in Colombo, on one trip.
    const orders = [order('style', 'OUT019', 'style-folded', 15), order('tech', 'OUT024', 'tech-tv', 1)];
    expect(carried('Peliyagoda', 'VEH012', orders)).toEqual([{
      code: 'mixed_brands', level: 'warn', vehicleId: 'VEH012', tripNo: 1,
      message: 'VEH012 trip 1 mixes shops of 2 brands, Style and Tech.',
    }]);

    expect(carried('Peliyagoda', 'VEH012', orders, { mixBrands: true })).toEqual([]);
  });

  it('throws an error that names a vehicle, shop, order or product the input does not hold', () => {
    const cartons = order('cartons', 'OUT004', 'fresh-dry-carton', 48);
    // The trip's load is handed over as nothing, so it is the rules that meet whatever is missing.
    const run = (orders: EngineOrder[], trip: PlanTrip) => () => {
      const input = inputFor('Peliyagoda', { orders, trips: [trip] });
      return cargoProblems(input, [{ vehicleId: trip.vehicleId, tripNo: trip.tripNo, load: computeLoad([], input.products) }]);
    };
    const missing: [string, () => unknown][] = [
      ['No vehicle VEH999', run([cartons], { vehicleId: 'VEH999', tripNo: 1, stops: [{ outletId: 'OUT004', orderIds: ['cartons'] }] })],
      ['No shop OUT999', run([cartons], { vehicleId: 'VEH012', tripNo: 1, stops: [{ outletId: 'OUT999', orderIds: ['cartons'] }] })],
      ['No order pallets', run([cartons], { vehicleId: 'VEH012', tripNo: 1, stops: [{ outletId: 'OUT004', orderIds: ['pallets'] }] })],
      ['No product fresh-frozen-carton', run([order('cartons', 'OUT004', 'fresh-frozen-carton', 48)], tripOf('VEH012', [cartons]))],
    ];
    for (const [named, plan] of missing) {
      expect(plan).toThrow(PlanInputError);
      expect(plan).toThrow(named);
    }
  });

  it('throws when a trip comes without its load, so its weight and volume never pass unchecked', () => {
    const cartons = order('cartons', 'OUT004', 'fresh-dry-carton', 48);
    const input = inputFor('Peliyagoda', { orders: [cartons], trips: [tripOf('VEH012', [cartons])] });
    expect(() => cargoProblems(input, [])).toThrow(PlanInputError);
    expect(() => cargoProblems(input, [])).toThrow('No load was given for VEH012 trip 1');
  });
});
