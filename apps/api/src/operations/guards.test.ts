// Spec 016's counts at their edges: a delivered stop with nothing to hand over, and attention that ends on arrival.
import { randomUUID } from 'node:crypto';
import type { DriverTrip, OperationsTrip } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import { depotInstant } from '../lib/clock';
import { attentionOf } from './attention';
import { figuresOf, stopCounts } from './figures';

const at = (min: number) => depotInstant('2026-06-25', min).toISOString();
const line = (loaded: number, delivered: number) => ({ lineId: randomUUID(), orderId: randomUUID(), productId: 'fresh-dry-carton', name: 'Dry carton', unit: 'carton', temp: 'dry' as const, quantity: 4, loaded, wontFit: 0, delivered });
const trip = (stop: Partial<DriverTrip['stops'][number]>): DriverTrip => ({ tripId: randomUUID(), revision: 0, vehicleId: 'VEH035', vehicleType: 'van', vehicleTemp: 'reefer', tripNo: 1,
  brand: 'Fresh', district: 'Colombo', status: 'out', leavesAt: at(276), backBy: at(370), readyAt: at(156), leftAt: at(211), backAt: null, problems: [],
  stops: [{ id: randomUUID(), seq: 1, revision: 0, retriedAt: null, outletId: 'OUT001', shopName: 'Fresh Nugegoda', district: 'Colombo', dockType: 'street', windowOpen: '05:00', windowClose: '09:00', note: null,
    arrivedAt: null, doneAt: null, outcome: null, lines: [line(4, 4)], ...stop }] });
const shown = (driver: DriverTrip): OperationsTrip => ({ detailRecorded: true, tripId: driver.tripId, planId: randomUUID(), date: '2026-06-25', vehicleId: driver.vehicleId, vehicleType: driver.vehicleType,
  vehicleTemp: driver.vehicleTemp, tripNo: driver.tripNo, driver: null, brand: driver.brand, district: driver.district, status: driver.status, openIssueIds: [], stopsTotal: driver.stops.length,
  action: 'open', outRow: null, trip: driver, figures: figuresOf(driver), onSoFar: null, lastReportAt: null, attention: { kind: 'none' }, schedule: { leavesAt: driver.leavesAt, backAt: driver.backBy }, stopDetails: [] });

// Rule 3 / D-67 / AC-15: "a zero-load completion is finished but not delivered". The committed AC-15 fixture is a
// refused stop with nothing loaded, so it never exercises a *delivered* outcome with zero goods.
it('AC-15 a delivered stop with zero goods loaded is finished, not delivered', () => {
  const empty = shown(trip({ arrivedAt: at(214), doneAt: at(218), outcome: 'delivered', lines: [line(0, 0)] }));
  expect(stopCounts([empty])).toEqual({ stopsTotal: 1, stopsDelivered: 0, stopsDone: 1, partialStops: 0, noGoodsStops: 1, closedStops: 0 });
});

// Rule 4 / AC-16: an arrival ends the "Arrival not reported" attention, including for a stop sent back with Try again.
it('AC-16 arrival at the next stop ends its attention', () => {
  const arrivals = new Map<string, string>();
  const plain = trip({ arrivedAt: at(310) });
  arrivals.set(plain.stops[0]!.id, at(300));
  expect(attentionOf(plain, arrivals, at(400))).toEqual({ kind: 'none' });
  const retried = trip({ retriedAt: at(320), arrivedAt: at(330) });
  arrivals.set(retried.stops[0]!.id, at(300));
  expect(attentionOf(retried, arrivals, at(400))).toEqual({ kind: 'none' });
});
