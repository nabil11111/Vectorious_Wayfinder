import { PlanBoard, type DraftTrip } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import { planOf } from '../draft';
import { indexOf } from './lookup';
import { removeTripChange, startOverChange, takeStopOffChange } from './changes';

// Spec 027's removals, each one change of the draft named for the history: a trip off a Done card, a stop off the open
// trip with its ×, and Start over. The board is made up: Chaminda's reefer truck runs Fresh Colombo Fort and Fresh
// Galle Fort, and one order waits deferred.

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const shop = (id: string, name: string) => ({ id, name, brand: 'Fresh', district: 'Colombo', dockType: 'street', parking: 'normal', windowOpen: 180, windowClose: 480, mallOpen: null, mallClose: null, unloadMin: 15 });
const order = (id: string, outletId: string) => ({
  id, outletId, temp: 'chilled', deliveryDate: '2026-06-25', lines: [{ productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', quantity: 12 }],
  load: { kg: 82.8, m3: 0.444, units: 12, needsReefer: true, needsTailLift: false, keepUpright: false }, carriedOver: false, timesDeferred: 0, lastDeferral: null, splitFrom: null, originalUnits: null,
});
const trip: DraftTrip = { vehicleId: 'VEH004', tripNo: 1, leaveAt: null, driverId: uuid(1), stops: [{ outletId: 'OUT006', orderIds: [uuid(11), uuid(12)] }, { outletId: 'OUT051', orderIds: [uuid(13)] }] };
const BOARD = PlanBoard.parse({
  depot: 'Peliyagoda', demoDay: 1, day: { date: '2026-06-25', cutoffAt: '2026-06-24T10:30:00.000Z', open: true },
  plan: { mixBrands: false, trips: [trip], deferrals: [{ orderId: uuid(14), code: 'dispatcher_choice', reason: 'Friday.' }], id: uuid(100), revision: 3, status: 'draft', savedAt: null, sentAt: null, canUnsend: false, lockedReason: null },
  dropped: [], check: null, orders: [order(uuid(11), 'OUT006'), order(uuid(12), 'OUT006'), order(uuid(13), 'OUT051'), order(uuid(14), 'OUT051')],
  shops: [shop('OUT006', 'Fresh Colombo Fort'), shop('OUT051', 'Fresh Galle Fort')],
  vehicles: [{ id: 'VEH004', type: 'truck', temp: 'reefer', weightCapKg: 6840, volumeCapM3: 33.4, working: true, offReason: null, litresLeft: 300, fuelLeftPct: 80 }],
  drivers: [{ id: uuid(1), name: 'Chaminda' }], figures: null, counts: null, suggestion: null,
});
const DRAFT = planOf(BOARD);
const INDEX = indexOf(BOARD);

it('AC-3 removes a trip from its Done card as one step, its orders back in Unplanned', () => {
  expect(removeTripChange(DRAFT, trip, INDEX)).toEqual({ plan: { ...DRAFT, trips: [] }, said: { line: 'Trip on Chaminda\'s reefer truck removed', tripKey: null } });
});

it('L-16 removes the open trip as a step whose Undo opens it again, and whose Redo closes it', () => {
  expect(removeTripChange(DRAFT, trip, INDEX, true).said).toEqual({ line: 'Trip on Chaminda\'s reefer truck removed', tripKey: null, from: 'VEH004-1' });
});

it('AC-3 takes a stop off the open trip with its × as one step, every order of it', () => {
  expect(takeStopOffChange(DRAFT, trip, 0, INDEX)).toEqual({
    plan: { ...DRAFT, trips: [{ ...trip, stops: [trip.stops[1]!] }] },
    said: { line: 'Fresh Colombo Fort taken off Chaminda\'s reefer truck', tripKey: 'VEH004-1' },
  });
});

it('AC-4 starts over as one step: no trip and no deferral, Mix brands as it was', () => {
  expect(startOverChange({ ...DRAFT, mixBrands: true }, null)).toEqual({ plan: { mixBrands: true, trips: [], deferrals: [] }, said: { line: 'Plan started over', tripKey: null } });
  // With a trip open, Undo opens it again (L-16).
  expect(startOverChange(DRAFT, 'VEH004-1').said).toEqual({ line: 'Plan started over', tripKey: null, from: 'VEH004-1' });
});
