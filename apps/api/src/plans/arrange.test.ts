import { expect, it } from 'vitest';
import type { EngineVehicle } from '../planning/types';
import { plannerInput, plannerOrder } from '../planning/planner/testing/input';
import { arrangeSelection, crewWhy, draftFrom, type Arranged, type Placement } from './arrange';

const van = (id: string, weightCapKg: number): EngineVehicle => ({
  id, type: 'van', temp: 'ambient', weightCapKg, volumeCapM3: 20, kmPerL: 8,
  weeklyFuelQuotaL: 500, depotId: 'Peliyagoda', available: true, litresUsedThisWeek: 0,
});

const empty = { trips: [], deferrals: [] };

it('uses one vehicle when one can take the orders, and keeps another trip\'s orders where they are', () => {
  const seed = plannerInput([]);
  const shops = seed.outlets.filter((shop) => shop.depotId === 'Peliyagoda' && shop.district === 'Colombo' && shop.parking === 'normal' && shop.brand === 'Fresh');
  const kept = plannerOrder('kept', shops[0]!.id, 'fresh-dry-carton', 5);
  const one = plannerOrder('one', shops[1]!.id, 'fresh-dry-carton', 20);
  const raw = plannerInput([kept, one], { vehicles: [van('V1', 800), van('V2', 800)] });
  const parked = { trips: [{ vehicleId: 'V1', tripNo: 1, stops: [{ outletId: kept.outletId, orderIds: [kept.id] }] }], deferrals: [] };
  const arranged = arrangeSelection(raw, parked, [one.id]);
  expect(arranged.singleVehicle).toBe(true);
  expect(arranged.waiting).toEqual([]);
  expect(arranged.plan.trips.some((trip) => trip.stops.some((stop) => stop.orderIds.includes(kept.id)))).toBe(true);
  expect(arranged.placements.map((placement) => placement.orderId)).toEqual([one.id]);
});

it('splits the group across vehicles when one van cannot take it, without dropping an order already planned', () => {
  const seed = plannerInput([]);
  const shops = seed.outlets.filter((shop) => shop.depotId === 'Peliyagoda' && shop.district === 'Colombo' && shop.parking === 'normal' && shop.brand === 'Fresh');
  const kept = plannerOrder('kept', shops[0]!.id, 'fresh-dry-carton', 5);
  const first = plannerOrder('first', shops[1]!.id, 'fresh-dry-carton', 100);
  const second = plannerOrder('second', shops[2]!.id, 'fresh-dry-carton', 100);
  const raw = plannerInput([kept, first, second], { vehicles: [van('V1', 800), van('V2', 800)] });
  const parked = { trips: [{ vehicleId: 'V1', tripNo: 1, stops: [{ outletId: kept.outletId, orderIds: [kept.id] }] }], deferrals: [] };
  const arranged = arrangeSelection(raw, parked, [first.id, second.id]);
  expect(arranged.singleVehicle).toBe(false);
  expect(arranged.summary).toMatch(/No single vehicle/);
  expect(arranged.plan.trips.some((trip) => trip.stops.some((stop) => stop.orderIds.includes(kept.id)))).toBe(true);
  const placed = new Set(arranged.placements.map((placement) => placement.orderId));
  expect(placed.has(first.id) || arranged.splits.some((split) => split.orderId === first.id)).toBe(true);
  expect(placed.has(second.id) || arranged.splits.some((split) => split.orderId === second.id)).toBe(true);
  expect(arranged.waiting.filter((item) => item.reason.startsWith('No van') || item.reason.startsWith('No refrigerated'))).toEqual([]);
});

it('names what each crew carries, and says when it has no driver', () => {
  const place = (orderId: string, note: string, chilled: boolean): Placement => ({ orderId, outletId: orderId, vehicleId: 'V1', tripNo: 1, newTrip: true, note });
  const orders = [{ id: 'a', load: { needsReefer: true } }, { id: 'b', load: { needsReefer: false } }];
  expect(crewWhy([place('a', 'keeps fridge trucks free', true), place('b', 'keeps fridge trucks free', false)], orders, 'driver')).toBe('1 chilled and 1 dry · 2 shops. Keeps a refrigerated truck free.');
  expect(crewWhy([place('a', 'the only run that could carry these goods', true)], orders, null)).toBe('Needs a driver. 1 chilled · 1 shop. The only vehicle that can take them.');
});

it('keeps an empty trip when another group is arranged', () => {
  const empty = { vehicleId: 'V9', tripNo: 1 as const, leaveAt: null, driverId: 'driver', stops: [] };
  const arranged = { selectedIds: ['one'], placements: [], plan: { trips: [], deferrals: [] }, waiting: [], splits: [], singleVehicle: false, summary: '', input: { orders: [] } } as unknown as Arranged;
  const next = draftFrom({ mixBrands: false, trips: [empty], deferrals: [] }, arranged, new Map(), new Map());
  expect(next.trips).toEqual([empty]);
});

it('says when no van can reach a van-only shop', () => {
  const seed = plannerInput([]);
  const shop = seed.outlets.find((outlet) => outlet.depotId === 'Peliyagoda' && outlet.parking === 'van_only' && outlet.brand === 'Fresh');
  expect(shop).toBeTruthy();
  const order = plannerOrder('van-only', shop!.id, 'fresh-dry-carton', 1);
  const truck: EngineVehicle = { ...van('T1', 5000), type: 'truck' };
  const arranged = arrangeSelection(plannerInput([order], { vehicles: [truck] }), empty, [order.id]);
  expect(arranged.placements).toEqual([]);
  expect(arranged.waiting.map((item) => item.reason)).toEqual(['No van can reach this shop']);
});
