import type { BoardCounts } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import { impactLine } from './impact';

const counts = (change: Partial<BoardCounts> = {}): BoardCounts => ({
  vehiclesUsed: 1, vehiclesWorking: 2, trips: 1, ordersDue: 4, ordersOnTrips: 2, ordersDeferred: 0, ordersUnplanned: 2,
  fuelWeekPct: 10, fridgeM3Used: 0, fridgeM3Working: 1, fridgePeakM3: 0, stops: 1, stopsOnTime: 1, km: 10, hoursOnRoad: 2,
  drivers: 1, originalDue: 4, originalFull: 2, originalPart: 0, originalDeferred: 0, originalWaiting: 2,
  planFuelL: 12, vehicleHours: 2, waitHours: 0, ...change,
});

it('says what an edit changed, and does not treat a split as more service', () => {
  expect(impactLine(counts(), counts({ originalFull: 3, trips: 2, planFuelL: 14.5 }))).toBe(
    'One more original order fully covered. One additional trip. Fuel estimate up 2.5 L',
  );
  expect(impactLine(counts(), counts())).toBe('Fuel estimate unchanged');
  expect(impactLine(counts({ vehicleHours: 2 }), counts({ vehicleHours: 2.36 }), { before: 1, after: 2 })).toBe('Fuel estimate unchanged. Vehicle-hours up 0.4. 1 new problem');
  expect(impactLine(counts({ planFuelL: null }), counts({ planFuelL: 4 }))).toContain('Fuel estimate not available yet');
});
