import { expect, it } from 'vitest';
import { KANDY_DAY, PELIYAGODA_DAY, dayOf, issueOf, listOf } from '@/test/both-days';
import { agreed, openCount, openOf, percentOf, sumCounts, sumFuel, sumNextRun } from './sums';

// Spec 021, rule 1: Both adds the two depots up and never mixes them. On the seeded Wednesday before any plan, the tiles
// read orders for Thursday 166, trucks out 0 / 60 and fuel 6,945 / 29,260 L, which is 24%. A figure one depot did not
// record, or could not read, leaves the sum unknown rather than one depot's number standing for both.

it('AC-5 the seeded Wednesday adds up as rule 1 says', () => {
  const days = [PELIYAGODA_DAY(), KANDY_DAY()];
  expect(sumNextRun(days.map((day) => day.nextRun))).toEqual({ date: '2026-06-25', cutoffAt: '2026-06-24T10:30:00.000Z', orders: 166 });
  const counts = sumCounts(days.map((day) => day.counts));
  expect([counts.vehiclesOut, counts.vehiclesTotal]).toEqual([0, 60]);
  expect(counts.truckProgress).toEqual({ numerator: 0, denominator: 60, percent: 0 });
  expect(counts.deferredOrders).toBe(4);
  expect(sumFuel(days.map((day) => day.fuel))).toEqual({ isoYear: 2026, isoWeek: 26, litres: 6945, quotaLitres: 29260, percent: 24 });
});

it('AC-5 each count is the two depots\' added, with the server\'s rounding for the bars', () => {
  const peliyagoda = dayOf({ depot: 'Peliyagoda', orders: 1, fuel: null, deferred: 2, plan: true, stops: { delivered: 1, total: 3 },
    out: [{ tripId: 1, vehicleId: 'VEH035', district: 'Colombo' }, { tripId: 2, vehicleId: 'VEH004', district: 'Galle' }] });
  const kandy = dayOf({ depot: 'Kandy', orders: 1, fuel: null, deferred: 5, plan: true, stops: { delivered: 1, total: 6 }, out: [{ tripId: 3, vehicleId: 'VEH045', district: 'Kandy' }] });
  const counts = sumCounts([peliyagoda.counts, kandy.counts]);
  expect(counts).toMatchObject({ stopsTotal: 9, stopsDelivered: 2, tripsTotal: 3, vehiclesOut: 3, vehiclesTotal: 60, deferredOrders: 7, partialStops: 0 });
  expect(counts.deliveryProgress).toEqual({ numerator: 2, denominator: 9, percent: 22 });
  expect(counts.truckProgress).toEqual({ numerator: 3, denominator: 60, percent: 5 });
  // Litres are kept to the tenth, as the server sums them.
  expect(sumFuel([{ isoYear: 2026, isoWeek: 26, litres: 0.1, quotaLitres: 10, percent: 1 }, { isoYear: 2026, isoWeek: 26, litres: 0.2, quotaLitres: 0, percent: null }]))
    .toEqual({ isoYear: 2026, isoWeek: 26, litres: 0.3, quotaLitres: 10, percent: 3 });
  expect(percentOf(6945, 29260)).toBe(24);
  expect(percentOf(1, 0)).toBe(0);
});

it('AC-5 a figure one depot did not record or could not give leaves the sum unknown', () => {
  const recorded = dayOf({ depot: 'Peliyagoda', orders: 1, fuel: null, deferred: 0, plan: true, stops: { delivered: 3, total: 4 } });
  const unrecorded = dayOf({ depot: 'Kandy', orders: 1, fuel: null, deferred: 0, plan: true, stops: { delivered: null, total: 5 } });
  const counts = sumCounts([recorded.counts, unrecorded.counts]);
  expect(counts).toMatchObject({ stopsTotal: 9, stopsDelivered: null, partialStops: null });
  expect(counts.deliveryProgress).toEqual({ numerator: null, denominator: 9, percent: null });
  // A week with no fuel to read, a quota of none, or two different weeks are no sum.
  const fuel = PELIYAGODA_DAY().fuel!;
  expect(sumFuel([fuel, null])).toBeNull();
  expect(sumFuel([fuel, { ...fuel, isoWeek: 27 }])).toBeNull();
  expect(sumFuel([{ ...fuel, quotaLitres: 0, percent: null }, { ...fuel, quotaLitres: 0, percent: null }])).toMatchObject({ quotaLitres: 0, percent: null });
  // Next runs that are not the same day are no sum either; none at all is none.
  const run = PELIYAGODA_DAY().nextRun!;
  expect(sumNextRun([run, { ...run, date: '2026-06-26' }])).toBe('differ');
  expect(sumNextRun([run, null])).toBe('differ');
  expect(sumNextRun([null, null])).toBeNull();
});

it('AC-5 one depot is its own read, untouched', () => {
  const day = PELIYAGODA_DAY();
  expect(sumCounts([day.counts])).toBe(day.counts);
  expect(sumFuel([day.fuel])).toBe(day.fuel);
  expect(sumNextRun([day.nextRun])).toBe(day.nextRun);
  expect(sumNextRun([null])).toBeNull();
});

it('AC-5 the open problems count both depots only when both lists are read, and list oldest first with their depot', () => {
  const flag = issueOf({ n: 1, shop: 'Fresh Nugegoda', vehicleId: 'VEH035', raisedBy: 'Kasun', raisedAt: '2026-06-23T21:03:00.000Z' });
  const older = issueOf({ n: 2, shop: 'Fresh Kandy', vehicleId: 'VEH045', raisedBy: 'Nimal', raisedAt: '2026-06-23T20:58:00.000Z' });
  const read = (list: ReturnType<typeof listOf>) => ({ data: list, isError: false });
  expect(openCount([read(listOf([flag])), read(listOf([older]))])).toBe(2);
  expect(openCount([read(listOf([flag]))])).toBe(1);
  // One list not read yet, one that failed, or one whose refresh failed: no count stands for both.
  expect(openCount([read(listOf([flag])), { data: undefined, isError: false }])).toBeNull();
  expect(openCount([read(listOf([flag])), { data: undefined, isError: true }])).toBeNull();
  expect(openCount([read(listOf([flag])), { data: listOf([older]), isError: true }])).toBeNull();
  expect(openOf([{ depot: 'Peliyagoda', list: listOf([flag]) }, { depot: 'Kandy', list: listOf([older]) }]))
    .toEqual([{ depot: 'Kandy', issue: older }, { depot: 'Peliyagoda', issue: flag }]);
});

it('a value both depots agree on is shown, and one they do not is not', () => {
  expect(agreed(['2026-06-24', '2026-06-24'])).toBe('2026-06-24');
  expect(agreed(['2026-06-24', '2026-06-25'])).toBeUndefined();
  expect(agreed([null, null])).toBeNull();
  expect(agreed([])).toBeUndefined();
});
