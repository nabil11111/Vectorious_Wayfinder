import { describe, expect, it } from 'vitest';
import { PlanInputError } from '../errors';
import { vehicleFuel } from '../fuel';
import { inputFor, vehicles } from '../testing/shared';
import { timeVehicleDay } from '../timeline';
import type { EngineVehicle, PlanInput, PlanTrip, VehicleFuel } from '../types';
import { dayProblems } from './day';

// A trip from its shops in stop order. The day rules never look at the orders, so the stops carry none.
const trip = (vehicleId: string, tripNo: number, outletIds: string[]): PlanTrip =>
  ({ vehicleId, tripNo, stops: outletIds.map((outletId) => ({ outletId, orderIds: [] })) });

// Five Fresh stops in Galle: 120 + 10 × 4 + 120 = 280 km.
const galle = (vehicleId: string) => trip(vehicleId, 1, ['OUT051', 'OUT053', 'OUT050', 'OUT052', 'OUT054']);
// The chained day on dry truck VEH012 (6.8 km per litre, 540 litres a week): 70 km and then 36 km.
const gampaha = trip('VEH012', 1, ['OUT026', 'OUT030', 'OUT028']);
const colombo = trip('VEH012', 2, ['OUT006', 'OUT004', 'OUT007', 'OUT014']);

// The fleet with one vehicle changed.
const fleet = (vehicleId: string, change: Partial<EngineVehicle>) => vehicles.map((v) => (v.id === vehicleId ? { ...v, ...change } : v));
// The fuel of every vehicle of the plan, worked out the way the checker does it.
const fuelOf = (input: PlanInput): VehicleFuel[] => [...new Set(input.plan.trips.map((t) => t.vehicleId))].map((id) => vehicleFuel(input, timeVehicleDay(input, id)));
const check = (trips: PlanTrip[], parts: { vehicles?: EngineVehicle[]; operatingDay?: boolean } = {}) => {
  const input = inputFor('Peliyagoda', { ...parts, trips });
  return dayProblems(input, fuelOf(input));
};

describe('rules for fuel and the day', () => {
  it('AC-34 reports fuel_over_quota, with the litres over, when the litres used this week plus this plan\'s pass the weekly quota', () => {
    const over = (vehicleId: string, used: string, plan: string, by: string, quota: string) => [{
      code: 'fuel_over_quota', level: 'block', vehicleId,
      message: `${vehicleId} has used ${used} litres this week and this plan needs ${plan} litres more, which is ${by} over its weekly quota of ${quota} litres.`,
      fix: `Take ${by} of driving off ${vehicleId}.`,
    }];
    const galleOn = (vehicleId: string, litresUsedThisWeek: number) => check([galle(vehicleId)], { vehicles: fleet(vehicleId, { litresUsedThisWeek }) });

    // VEH006 (4.4 km per litre, 380 litres a week) with 330 used: the 280 km are 63.6 litres, 13.6 too many.
    expect(galleOn('VEH006', 330)).toEqual(over('VEH006', '330', '63.6', '13.6 litres', '380'));
    // With 300 used it ends on 363.6.
    expect(galleOn('VEH006', 300)).toEqual([]);
    // With 316.4 used it makes 380.036 litres, which is over, although the shown figures add up to 380.0.
    expect(galleOn('VEH006', 316.4)).toEqual(over('VEH006', '316.4', '63.6', 'less than 0.1 litres', '380'));
    expect(galleOn('VEH006', 316.3)).toEqual([]);
    // VEH010 (5.6 km per litre, 540 litres a week) with 490 used ends on exactly 540, and that is allowed.
    expect(galleOn('VEH010', 490)).toEqual([]);
    expect(galleOn('VEH010', 490.1)).toEqual(over('VEH010', '490.1', '50', '0.1 litres', '540'));

    // A vehicle's two trips count together. The chained day is 106 km, 15.588 litres, shown as 10.3 + 5.3.
    expect(check([gampaha, colombo], { vehicles: fleet('VEH012', { litresUsedThisWeek: 524.4 }) })).toEqual([]);
    expect(check([gampaha, colombo], { vehicles: fleet('VEH012', { litresUsedThisWeek: 524.5 }) })).toEqual(over('VEH012', '524.5', '15.6', '0.1 litres', '540'));
    // The sentence goes by the litres all the plan's kilometres need, so its figures add up. Two trips of 24 km
    // show as 3.5 litres each, and their 48 km need 7.06 litres: with 533.1 used that is 0.16 over.
    const twoShort = [trip('VEH012', 1, ['OUT005']), trip('VEH012', 2, ['OUT006'])];
    expect(check(twoShort, { vehicles: fleet('VEH012', { litresUsedThisWeek: 532.9 }) })).toEqual([]);
    expect(check(twoShort, { vehicles: fleet('VEH012', { litresUsedThisWeek: 533.1 }) })).toEqual(over('VEH012', '533.1', '7.1', '0.2 litres', '540'));
    // Two 63 km trips to Gampaha on VEH010 show as 11.3 litres each, and their 126 km need exactly 22.5. With
    // 517.5 used that ends on the quota and passes, and the vehicle's line then shows 0.0 left, never -0.1.
    const twice63 = [trip('VEH010', 1, ['OUT026', 'OUT030']), trip('VEH010', 2, ['OUT028', 'OUT031'])];
    expect(check(twice63, { vehicles: fleet('VEH010', { litresUsedThisWeek: 517.5 }) })).toEqual([]);
    expect(fuelOf(inputFor('Peliyagoda', { trips: twice63, vehicles: fleet('VEH010', { litresUsedThisWeek: 517.5 }) }))[0]).toMatchObject({ litresPlan: 22.5, litresLeft: 0 });
    expect(check(twice63, { vehicles: fleet('VEH010', { litresUsedThisWeek: 517.6 }) })).toEqual(over('VEH010', '517.6', '22.5', '0.1 litres', '540'));

    // The vehicles table keeps km per litre to 2 decimals, and all of it counts. No vehicle in the data uses the
    // second one, so this figure is made up: at 4.45 km per litre the 280 km are 62.92 litres.
    const thirstier = (litresUsedThisWeek: number) => check([galle('VEH006')], { vehicles: fleet('VEH006', { kmPerL: 4.45, litresUsedThisWeek }) });
    expect(thirstier(317)).toEqual([]);
    expect(thirstier(317.1)).toEqual(over('VEH006', '317.1', '62.9', 'less than 0.1 litres', '380'));

    // Each vehicle is measured against its own quota.
    const both = check([galle('VEH006'), galle('VEH010')], { vehicles: fleet('VEH006', { litresUsedThisWeek: 330 }) });
    expect(both).toEqual(over('VEH006', '330', '63.6', '13.6 litres', '380'));

    // A vehicle this plan does not drive cannot be taken past its quota by it, whatever it has used already.
    const parked = inputFor('Peliyagoda', { vehicles: fleet('VEH006', { litresUsedThisWeek: 400 }) });
    expect(dayProblems(parked, [vehicleFuel(parked, timeVehicleDay(parked, 'VEH006'))])).toEqual([]);
  });

  it('AC-35 reports not_operating_day when the plan date is not an operating day', () => {
    // Whether the date operates reaches the checker with the input: Sun 28 Jun 2026 does not, and Sat 30 May 2026
    // is a holiday that still does.
    const closed = [{ code: 'not_operating_day', level: 'block', message: 'The plan is for a day that is not an operating day, so nothing can be delivered on it.' }];
    expect(check([gampaha, colombo], { operatingDay: false })).toEqual(closed);
    expect(check([gampaha, colombo], { operatingDay: true })).toEqual([]);
    // It is about the whole plan, so it is said once and needs no trip to be said.
    expect(check([], { operatingDay: false })).toEqual(closed);
  });

  it('AC-36 reports vehicle_off for a trip whose vehicle is unavailable that day', () => {
    const off = (tripNo: number) => ({
      code: 'vehicle_off', level: 'block', vehicleId: 'VEH012', tripNo,
      message: `VEH012 trip ${tripNo} is planned on a day when VEH012 is not available.`,
    });
    const other = trip('VEH008', 1, ['OUT005']);
    // Both trips of the vehicle are reported, and the other vehicle's trip is not.
    expect(check([gampaha, other, colombo], { vehicles: fleet('VEH012', { available: false }) })).toEqual([off(1), off(2)]);
    expect(check([gampaha, other, colombo])).toEqual([]);
    // A vehicle that is off and has no trip is nobody's problem.
    expect(check([other], { vehicles: fleet('VEH012', { available: false }) })).toEqual([]);
  });

  it('leaves the input as it came and says the same thing twice', () => {
    const input = inputFor('Peliyagoda', { trips: [colombo, galle('VEH006'), gampaha], operatingDay: false, vehicles: fleet('VEH006', { litresUsedThisWeek: 330, available: false }) });
    const before = structuredClone(input);
    const first = dayProblems(input, fuelOf(input));
    expect(first.map((p) => p.code)).toEqual(['vehicle_off', 'fuel_over_quota', 'not_operating_day']);
    expect(dayProblems(input, fuelOf(input))).toEqual(first);
    expect(input).toEqual(before);
  });

  it('throws an error that names a vehicle the input does not hold', () => {
    const input = inputFor('Peliyagoda', { trips: [gampaha] });
    const missing: [string, () => unknown][] = [
      ['No vehicle VEH999', () => dayProblems(inputFor('Peliyagoda', { trips: [trip('VEH999', 1, ['OUT006'])] }), [])],
      ['No vehicle VEH999', () => dayProblems(input, [...fuelOf(input), { vehicleId: 'VEH999', litresBefore: 0, litresPlan: 0, litresLeft: 0, quotaL: 0, kmPlan: 0 }])],
    ];
    for (const [named, plan] of missing) {
      expect(plan).toThrow(PlanInputError);
      expect(plan).toThrow(named);
    }
  });

  it('throws when a vehicle with a trip comes without its fuel, so its quota never passes unchecked', () => {
    const input = inputFor('Peliyagoda', { trips: [gampaha, trip('VEH008', 1, ['OUT005'])] });
    expect(() => dayProblems(input, [])).toThrow(PlanInputError);
    expect(() => dayProblems(input, [])).toThrow('No fuel figures were given for VEH012');
    expect(() => dayProblems(input, fuelOf(input).slice(0, 1))).toThrow('No fuel figures were given for VEH008');
  });
});
