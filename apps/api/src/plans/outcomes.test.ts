import type { PlanOutcome } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import { comparisonSummary, coverageOf, fuelDelta } from './outcomes';

const outcome = (change: Partial<PlanOutcome>): PlanOutcome => ({
  originalDue: 2, originalFull: 2, originalPart: 0, originalDeferred: 0, originalWaiting: 0,
  vehicles: 1, trips: 1, stops: 1, stopsOnTime: 1, fuelL: 10, km: 20, vehicleHours: 2,
  blockers: 0, warnings: 0, driversMissing: 0, ...change,
});

it('counts a split as one original order, fully covered only when both parts are on trips', () => {
  const orders = [
    { id: 'part-a', splitFrom: 'parent' },
    { id: 'part-b', splitFrom: 'parent' },
    { id: 'whole', splitFrom: null },
  ];
  expect(coverageOf(orders, new Set(['part-a', 'whole']), new Set(['part-b']))).toEqual({
    originalDue: 2, originalFull: 1, originalPart: 1, originalDeferred: 0, originalWaiting: 0,
  });
  expect(coverageOf(orders, new Set(['part-a', 'part-b', 'whole']), new Set())).toMatchObject({ originalFull: 2, originalPart: 0 });
  expect(coverageOf([{ id: 'waiting', splitFrom: null }], new Set(), new Set())).toMatchObject({ originalWaiting: 1, originalDue: 1 });
});

it('does not call lower fuel a saving when the suggestion covers less', () => {
  const current = outcome({ fuelL: 20, originalFull: 2 });
  const thinner = outcome({ fuelL: 12, originalFull: 1, originalWaiting: 1 });
  expect(comparisonSummary(current, thinner, null)).toBe('Lower estimated fuel because less demand is covered');
  expect(comparisonSummary(current, outcome({ fuelL: 14 }), null)).toBe('Lower estimated fuel for the same demand covered');
  expect(comparisonSummary(current, outcome({ fuelL: 24 }), null)).toBe('Your plan uses less estimated fuel');
  expect(comparisonSummary(current, outcome({ fuelL: 20 }), null)).toBe('No meaningful change');
  expect(comparisonSummary(current, outcome({ fuelL: null }), null)).toBe('Fuel cannot be estimated for both plans');
  expect(fuelDelta(20, 14)).toBe(6);
  expect(fuelDelta(null, 14)).toBeNull();
});
