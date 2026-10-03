import { PlanBoard, type BoardOrder } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import { addOrders, defer, planOf, takeOff, undefer } from '../draft';
import { activeOrders, shopSummaries, summaryLine } from './shop-summary';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const order = (n: number, extra: Partial<BoardOrder> = {}) => ({
  id: id(n), outletId: 'OUT001', temp: 'chilled', deliveryDate: '2026-06-25',
  lines: [{ productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', quantity: 12 }],
  load: { kg: 82.8, m3: 0.444, units: 12, needsReefer: true, needsTailLift: false, keepUpright: false },
  carriedOver: false, timesDeferred: 0, lastDeferral: null, splitFrom: null, originalUnits: null, ...extra,
});
export const BOARD = PlanBoard.parse({
  depot: 'Peliyagoda', demoDay: 1, day: { date: '2026-06-25', cutoffAt: '2026-06-24T10:30:00Z', open: true },
  plan: { id: id(100), revision: 3, mixBrands: false, status: 'draft', savedAt: null, sentAt: null, canUnsend: false, lockedReason: null,
    trips: [{ vehicleId: 'VEH004', tripNo: 1, leaveAt: null, driverId: null, stops: [{ outletId: 'OUT001', orderIds: [id(1)] }] }],
    deferrals: [{ orderId: id(3), code: 'over_capacity', reason: 'The reefer is full.' }] },
  orders: [order(1), order(2), order(3), order(4, { carriedOver: true, deliveryDate: '2026-06-24', timesDeferred: 1,
    lastDeferral: { date: '2026-06-24', code: 'over_capacity', reason: 'The reefer was full.' } }), order(5, { outletId: 'OUT002' })],
  shops: [{ id: 'OUT001', name: 'Fresh Nugegoda', brand: 'Fresh', district: 'Colombo', dockType: 'street', parking: 'normal', windowOpen: 300, windowClose: 450, mallOpen: null, mallClose: null, unloadMin: 15 }],
  dropped: [], check: null, vehicles: [], drivers: [], figures: null, counts: null, suggestion: null,
});
it('counts the whole shop day across multiple orders, carried demand and another shop without summing unlike units', () => {
  const summary = shopSummaries(BOARD.orders, planOf(BOARD)).get('OUT001');
  expect(summary).toEqual({ orders: 4, parts: 0, onTrips: 1, waiting: 2, deferred: 1, carriedOver: 1 });
  expect(summaryLine(summary!)).toBe('4 orders · 1 on trips · 2 waiting · 1 deferred · 1 carried over');
  expect(shopSummaries(BOARD.orders, planOf(BOARD)).get('OUT002')?.waiting).toBe(1);
});
it('follows add, remove, defer, restore and undo immediately rather than the last saved plan', () => {
  const original = planOf(BOARD);
  const added = addOrders(original, 'VEH004-1', [BOARD.orders[1]!]);
  expect(shopSummaries(BOARD.orders, added).get('OUT001')).toMatchObject({ onTrips: 2, waiting: 1, deferred: 1 });
  const removed = takeOff(added, [id(1)]);
  expect(shopSummaries(BOARD.orders, removed).get('OUT001')).toMatchObject({ onTrips: 1, waiting: 2 });
  const postponed = defer(removed, [{ orderId: id(2), code: 'over_capacity', reason: 'No space today.' }]);
  expect(shopSummaries(BOARD.orders, postponed).get('OUT001')).toMatchObject({ onTrips: 0, waiting: 2, deferred: 2 });
  expect(shopSummaries(BOARD.orders, undefer(postponed, id(3))).get('OUT001')).toMatchObject({ waiting: 3, deferred: 1 });
  expect(shopSummaries(BOARD.orders, original).get('OUT001')).toMatchObject({ onTrips: 1, waiting: 2, deferred: 1 });
});
it('counts persisted split pieces explicitly and excludes their parent and repeated IDs', () => {
  const orders = [order(10), order(11, { splitFrom: id(10), originalUnits: 24 }), order(12, { splitFrom: id(10), originalUnits: 24 }), order(13), order(13)];
  const draft = addOrders({ mixBrands: false, trips: [], deferrals: [{ orderId: id(12), code: 'over_capacity', reason: 'Part waits.' }] }, 'missing', []);
  draft.trips = [{ vehicleId: 'VEH004', tripNo: 1, leaveAt: null, driverId: null, stops: [{ outletId: 'OUT001', orderIds: [id(11), id(11), id(10)] }] }];
  expect(activeOrders(orders).map(o => o.id)).toEqual([id(11), id(12), id(13)]);
  const summary = shopSummaries(orders, draft).get('OUT001')!;
  expect(summary).toEqual({ orders: 1, parts: 2, onTrips: 1, waiting: 1, deferred: 1, carriedOver: 0 });
  expect(summaryLine(summary)).toBe('1 order + 2 split parts · 1 on trips · 1 waiting · 1 deferred');
  expect(summaryLine(shopSummaries(orders.slice(0, 3), draft).get('OUT001')!)).toBe('2 split parts · 1 on trips · 0 waiting · 1 deferred');
});
