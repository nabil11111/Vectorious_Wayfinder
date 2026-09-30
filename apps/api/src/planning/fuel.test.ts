import { describe, expect, it } from 'vitest';
import { PlanInputError } from './errors';
import { tripKm, tripLitres, vehicleFuel } from './fuel';
import { inputFor, travel, vehicles } from './testing/shared';
import { timeVehicleDay } from './timeline';
import type { PlanTrip, TravelRow } from './types';

// A trip from its shops in stop order. Fuel never looks at the orders, so the stops carry none.
const trip = (vehicleId: string, tripNo: number, outletIds: string[]): PlanTrip =>
  ({ vehicleId, tripNo, stops: outletIds.map((outletId) => ({ outletId, orderIds: [] })) });

// Five Fresh stops in Galle on fridge truck VEH006 (4.4 km per litre, 380 litres a week).
const galle = trip('VEH006', 1, ['OUT051', 'OUT053', 'OUT050', 'OUT052', 'OUT054']);
// The chained day on dry truck VEH012 (6.8 km per litre, 540 litres a week).
const gampaha = trip('VEH012', 1, ['OUT026', 'OUT030', 'OUT028']);
const colombo = trip('VEH012', 2, ['OUT006', 'OUT004', 'OUT007', 'OUT014']);

// The drive to a district as the data has it. Every district is reached from one depot only.
const driveTo = (district: string): TravelRow => {
  const row = travel.find((r) => r.district === district);
  if (!row) throw new Error(`No drive to ${district} in data/shared`);
  return row;
};

// A vehicle's fuel for the day, timed the way the checker times it, with the litres it has used this week.
const fuelOf = (vehicleId: string, trips: PlanTrip[], usedThisWeek = 0) => {
  const input = inputFor('Peliyagoda', { trips, vehicles: vehicles.map((v) => (v.id === vehicleId ? { ...v, litresUsedThisWeek: usedThisWeek } : v)) });
  return vehicleFuel(input, timeVehicleDay(input, vehicleId));
};

describe('trip and vehicle fuel', () => {
  it('AC-15 gives a trip\'s kilometres as the drive out and back plus the drive between its stops, and its litres to 1 decimal', () => {
    // Galle is 120 km from Peliyagoda and its stops are 10 km apart: 120 + 10 × 4 + 120 = 280 km, 63.6 litres.
    expect(tripKm(driveTo('Galle'), 5)).toBe(280);
    expect(tripLitres(280, 4.4)).toBe(63.6);
    // One stop has no drive between stops.
    expect(tripKm(driveTo('Galle'), 1)).toBe(240);
    // The chained day: 28 × 2 + 7 × 2 = 70 km for 10.3 litres, and 12 × 2 + 4 × 3 = 36 km for 5.3.
    expect(tripKm(driveTo('Gampaha'), 3)).toBe(70);
    expect(tripLitres(70, 6.8)).toBe(10.3);
    expect(tripKm(driveTo('Colombo'), 4)).toBe(36);
    expect(tripLitres(36, 6.8)).toBe(5.3);

    // The travel table keeps the kilometres between stops to 1 decimal, though every district in the data has a
    // whole number. So this district is made up. Plain JavaScript says 8 × 2 + 4.1 × 3 is 28.299999999999997.
    const hills: TravelRow = { district: 'Hills', depotId: 'Kandy', outMin: 16, outKm: 8, betweenMin: 9, betweenKm: 4.1 };
    expect(tripKm(hills, 4)).toBe(28.3);
    // 12.1 km at 4.4 km per litre is exactly 2.75 litres, which shows as 2.8. Plain JavaScript divides it to
    // 2.7499999999999996 and would show 2.7.
    expect(tripLitres(12.1, 4.4)).toBe(2.8);

    // A timed trip carries both.
    const input = inputFor('Peliyagoda', { trips: [galle, gampaha, colombo] });
    expect(timeVehicleDay(input, 'VEH006').trips.map(({ times }) => times && [times.km, times.litres])).toEqual([[280, 63.6]]);
    expect(timeVehicleDay(input, 'VEH012').trips.map(({ times }) => times && [times.km, times.litres])).toEqual([[70, 10.3], [36, 5.3]]);
  });

  it('AC-16 gives a vehicle\'s litres used before this plan, the litres in this plan and the litres left', () => {
    // 300 + 63.6 leaves 16.4 of 380.
    expect(fuelOf('VEH006', [galle], 300)).toEqual({ vehicleId: 'VEH006', litresBefore: 300, litresPlan: 63.6, litresLeft: 16.4, quotaL: 380, kmPlan: 280 });
    // The chained day with nothing used yet. Plain JavaScript says 10.3 + 5.3 is 15.600000000000001.
    expect(fuelOf('VEH012', [gampaha, colombo])).toEqual({ vehicleId: 'VEH012', litresBefore: 0, litresPlan: 15.6, litresLeft: 524.4, quotaL: 540, kmPlan: 106 });

    // The litres in the plan are the trips' shown litres added up, so a screen's lines add up. Two trips of 24 km
    // are 3.5 litres each and 7.0 together, though 48 km in one go would show as 7.1.
    expect(fuelOf('VEH012', [trip('VEH012', 1, ['OUT005']), trip('VEH012', 2, ['OUT006'])])).toEqual({ vehicleId: 'VEH012', litresBefore: 0, litresPlan: 7, litresLeft: 533, quotaL: 540, kmPlan: 48 });

    // Exactly on the shown quota nothing is left. Plain JavaScript says 380 - 316.4 - 63.6 is 0.00000000000002.
    expect(fuelOf('VEH006', [galle], 316.4)).toEqual({ vehicleId: 'VEH006', litresBefore: 316.4, litresPlan: 63.6, litresLeft: 0, quotaL: 380, kmPlan: 280 });
    // Past the quota the litres left go below zero: 330 + 63.6 is 13.6 more than 380.
    expect(fuelOf('VEH006', [galle], 330)).toEqual({ vehicleId: 'VEH006', litresBefore: 330, litresPlan: 63.6, litresLeft: -13.6, quotaL: 380, kmPlan: 280 });

    // A trip that cannot be timed is not driven: OUT026 is in Gampaha and OUT006 in Colombo.
    expect(fuelOf('VEH012', [trip('VEH012', 1, ['OUT026', 'OUT006']), colombo])).toEqual({ vehicleId: 'VEH012', litresBefore: 0, litresPlan: 5.3, litresLeft: 534.7, quotaL: 540, kmPlan: 36 });
    expect(fuelOf('VEH012', [], 120.5)).toEqual({ vehicleId: 'VEH012', litresBefore: 120.5, litresPlan: 0, litresLeft: 419.5, quotaL: 540, kmPlan: 0 });
    // The litres used are kept to 1 decimal like the rest, so the three figures always add up to the quota. Added
    // up in plain JavaScript, 0.1 + 0.2 litres would arrive as 0.30000000000000004.
    expect(fuelOf('VEH012', [], 0.1 + 0.2)).toEqual({ vehicleId: 'VEH012', litresBefore: 0.3, litresPlan: 0, litresLeft: 539.7, quotaL: 540, kmPlan: 0 });
  });

  it('throws an error that names a vehicle the input does not hold', () => {
    const fuel = () => vehicleFuel(inputFor('Peliyagoda'), { vehicleId: 'VEH999', trips: [] });
    expect(fuel).toThrow(PlanInputError);
    expect(fuel).toThrow('No vehicle VEH999');
  });
});
