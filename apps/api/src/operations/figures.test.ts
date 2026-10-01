import { randomUUID } from 'node:crypto';
import type { DriverTrip, OperationsTrip } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import { figuresOf, groupTrips, nextDemand, progress, stopCounts } from './figures';

const raw = (brand: DriverTrip['brand'] = 'Fresh'): DriverTrip => ({ tripId: randomUUID(), revision: 0, vehicleId: 'VEH035', vehicleType: 'van', vehicleTemp: 'reefer', tripNo: 1,
  brand, district: 'Colombo', status: 'ready', leavesAt: '2026-06-25T00:00:00Z', backBy: '2026-06-25T03:00:00Z', readyAt: null, leftAt: null, backAt: null, problems: [],
  stops: [{ id: randomUUID(), seq: 1, revision: 0, retriedAt: null, outletId: 'OUT001', shopName: 'Fresh Nugegoda', district: 'Colombo', dockType: 'street', windowOpen: '05:00', windowClose: '09:00', note: null,
    arrivedAt: '2026-06-25T00:00:00Z', doneAt: '2026-06-25T00:01:00Z', outcome: 'refused', lines: [{ lineId: randomUUID(), orderId: randomUUID(), productId: 'fresh-dry-carton', name: 'Dry carton', unit: 'carton', temp: 'dry', quantity: 4, loaded: 0, delivered: 0 }] }] });
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
