import { randomUUID } from 'node:crypto';
import type { DriverTrip, OperationsTrip } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import { districtMap, figuresOf, goodsHandedOver, groupTrips, nextDemand, progress, stopCounts } from './figures';

const raw = (brand: DriverTrip['brand'] = 'Fresh'): DriverTrip => ({ tripId: randomUUID(), revision: 0, vehicleId: 'VEH035', vehicleType: 'van', vehicleTemp: 'reefer', tripNo: 1,
  brand, district: 'Colombo', status: 'ready', leavesAt: '2026-06-25T00:00:00Z', backBy: '2026-06-25T03:00:00Z', backByWords: 'back by 08:30', readyAt: null, leftAt: null, backAt: null, problems: [],
  stops: [{ id: randomUUID(), seq: 1, revision: 0, retriedAt: null, outletId: 'OUT001', shopName: 'Fresh Nugegoda', district: 'Colombo', dockType: 'street', windowOpen: '05:00', windowClose: '09:00', note: null,
    arrivedAt: '2026-06-25T00:00:00Z', doneAt: '2026-06-25T00:01:00Z', outcome: 'refused', lines: [{ lineId: randomUUID(), orderId: randomUUID(), productId: 'fresh-dry-carton', name: 'Dry carton', unit: 'carton', temp: 'dry', quantity: 4, loaded: 0, wontFit: 0, delivered: 0 }] }] });
const shown = (driver = raw()): OperationsTrip => ({ detailRecorded: true, tripId: driver.tripId, planId: randomUUID(), date: '2026-06-25', vehicleId: driver.vehicleId, vehicleType: driver.vehicleType, vehicleTemp: driver.vehicleTemp, tripNo: driver.tripNo,
  driver: null, brand: driver.brand, district: driver.district, status: driver.status, openIssueIds: [], stopsTotal: driver.stops.length, action: 'open', outRow: null,
  trip: driver, figures: figuresOf(driver), onSoFar: null, lastReportAt: null, attention: { kind: 'none' }, schedule: { leavesAt: driver.leavesAt, backAt: driver.backBy }, stopDetails: [] });

it('AC-15 brand and district counts distinguish stops trips and distinct vehicles', () => {
  const first = shown(), second = shown({ ...raw(), district: 'Gampaha', tripNo: 2 }), mixed = shown(raw(null));
  const result = groupTrips([mixed, second, first]);
  expect(result.brandTotals.map(row => [row.brand, row.tripsTotal, row.vehiclesTotal, row.stopsTotal, row.stopsDone])).toEqual([['Fresh', 2, 1, 2, 2], [null, 1, 1, 1, 1]]);
  expect(result.groups.map(row => [row.brand, row.district, row.vehiclesTotal])).toEqual([['Fresh', 'Colombo', 1], ['Fresh', 'Gampaha', 1], [null, 'Colombo', 1]]);
  expect(stopCounts([first])).toEqual({ stopsTotal: 1, stopsDelivered: 0, stopsDone: 1, partialStops: 0, noGoodsStops: 1, closedStops: 0 });
  expect(progress(1, 2)).toEqual({ numerator: 1, denominator: 2, percent: 50 });
  expect(progress(0, 0).percent).toBe(0);
  expect(progress(null, 2).percent).toBeNull();
});

it('AC-15 final load is unknown before ready at every level', () => {
  const figures = figuresOf({ ...raw(), status: 'loading' });
  expect(figures).toMatchObject({ loaded: null, short: null, byTemp: { dry: { loaded: null, short: null } } });
  expect(figures.byStop[0]).toMatchObject({ loaded: null, short: null, byLine: [{ loaded: null, short: null }] });
  expect(figuresOf(raw())).toMatchObject({ loaded: 0, short: 4 });
});

// Spec 019 rule 3: one stop's lines and how it ended, at a given shop.
type Stop = DriverTrip['stops'][number];
const line = (loaded: number | null, delivered: number | null) => ({ lineId: randomUUID(), orderId: randomUUID(), productId: 'fresh-dry-carton', name: 'Dry carton', unit: 'carton',
  temp: 'dry' as const, quantity: 48, loaded, wontFit: 0, delivered });
const stopAt = (outletId: string, outcome: Stop['outcome'], lines = [line(48, outcome === null ? null : 48)]): Stop => ({ ...raw().stops[0]!, id: randomUUID(), outletId, outcome, lines });
const tripOf = (stops: Stop[], tripNo = 1) => shown({ ...raw(), tripNo, stops });

it('AC-1 the stops delivered tile and the map share one test of a stop: goods were handed over', () => {
  const stops = { delivered: stopAt('OUT001', 'delivered'), partial: stopAt('OUT002', 'refused', [line(48, 46)]), refusedInFull: stopAt('OUT002', 'refused', [line(48, 0)]),
    closed: stopAt('OUT002', 'closed', [line(48, null)]), notYet: stopAt('OUT002', null) };
  expect(Object.fromEntries(Object.entries(stops).map(([name, stop]) => [name, goodsHandedOver(stop)])))
    .toEqual({ delivered: true, partial: true, refusedInFull: false, closed: false, notYet: false });
  expect(stopCounts([tripOf(Object.values(stops))])).toEqual({ stopsTotal: 5, stopsDelivered: 2, stopsDone: 4, partialStops: 1, noGoodsStops: 1, closedStops: 1 });
});

it('AC-1 a shop is delivered once every stop it had on the day handed goods over, by district in name order', () => {
  const shops = [{ id: 'OUT026', district: 'Gampaha' }, { id: 'OUT001', district: 'Colombo' }, { id: 'OUT002', district: 'Colombo' }, { id: 'OUT003', district: 'Colombo' }];
  // Nugegoda is delivered on the first trip and waits for its second stop; Wellawatte refused some; Kotahena had no
  // stop today; the Gampaha shop refused everything.
  const first = tripOf([stopAt('OUT001', 'delivered'), stopAt('OUT002', 'refused', [line(48, 46)])]);
  const waiting = tripOf([stopAt('OUT001', null), stopAt('OUT026', 'refused', [line(48, 0)])], 2);
  expect(districtMap(shops, [first, waiting])).toEqual({ shops: 4, districts: [{ district: 'Colombo', shops: 3, shopsDelivered: 1 }, { district: 'Gampaha', shops: 1, shopsDelivered: 0 }] });
  const both = tripOf([stopAt('OUT001', 'delivered'), stopAt('OUT026', 'refused', [line(48, 0)])], 2);
  expect(districtMap(shops, [first, both]).districts).toEqual([{ district: 'Colombo', shops: 3, shopsDelivered: 2 }, { district: 'Gampaha', shops: 1, shopsDelivered: 0 }]);
  expect(districtMap(shops, [])).toEqual({ shops: 4, districts: [{ district: 'Colombo', shops: 3, shopsDelivered: 0 }, { district: 'Gampaha', shops: 1, shopsDelivered: 0 }] });
});

it('AC-1 a trip without recorded detail leaves every district delivered count unknown, as the tile is', () => {
  const shops = [{ id: 'OUT001', district: 'Colombo' }, { id: 'OUT026', district: 'Gampaha' }];
  const recorded = tripOf([stopAt('OUT001', 'delivered')]);
  const legacy: OperationsTrip = { detailRecorded: false, reason: 'legacy_plan', tripId: randomUUID(), planId: randomUUID(), date: '2026-06-25', vehicleId: 'VEH004', vehicleType: 'truck',
    vehicleTemp: 'reefer', tripNo: 1, driver: null, brand: 'Fresh', district: 'Gampaha', status: 'out', openIssueIds: [], stopsTotal: 1, action: 'open', outRow: null,
    stops: [{ id: randomUUID(), seq: 1, outletId: 'OUT026', shopName: 'Fresh Gampaha' }] };
  expect(stopCounts([recorded, legacy]).stopsDelivered).toBeNull();
  expect(districtMap(shops, [recorded, legacy])).toEqual({ shops: 2, districts: [{ district: 'Colombo', shops: 1, shopsDelivered: null }, { district: 'Gampaha', shops: 1, shopsDelivered: null }] });
});

it('AC-2 AC-15 next demand deduplicates published membership and excludes split parents and future orders', () => {
  const rows = [
    { id: 'early', deliveryDate: '2026-06-24', status: 'deferred' },
    { id: 'watch', deliveryDate: '2026-06-25', status: 'placed' },
    { id: 'next', deliveryDate: '2026-06-26', status: 'placed' },
    { id: 'planned', deliveryDate: '2026-06-26', status: 'planned' },
    { id: 'split', deliveryDate: '2026-06-26', status: 'split' },
    { id: 'draft', deliveryDate: '2026-06-26', status: 'draft' },
    { id: 'cancel', deliveryDate: '2026-06-26', status: 'cancelled' },
    { id: 'future', deliveryDate: '2026-06-27', status: 'placed' },
  ];
  const membership = new Set(['next', 'planned', 'split', 'draft', 'cancel', 'future', 'early']);
  expect(nextDemand(rows, membership, '2026-06-25', '2026-06-26', false)).toBe(2);
  expect(nextDemand(rows, membership, '2026-06-25', '2026-06-26', true)).toBe(4);
  expect(nextDemand(rows.map(row => row.id === 'next' ? { ...row, status: 'planned' } : row), membership, '2026-06-25', '2026-06-26', false)).toBe(2);
});
