import type { BoardOrder, DraftPlan } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import { addOrders, moveStop, takeOff } from '../draft';
import { truckCalled } from '../words';
import { canLand, dropOf, type Called, type Dragged, type Landing } from './drops';

// Spec 023: every drop on the plan board is the change its button or menu makes, one change of the draft with a line
// naming it for Undo (rule 1), and nothing here judges the plan: the checker does, after the drop (rule 2). The day is
// made up: VEH035 runs Fresh Nugegoda (OUT001), Fresh Kotahena (OUT003) and Fresh Wellawatte (OUT002), and VEH002 one
// Galle stop. Fresh Dehiwala (OUT005) and Fresh Pettah (OUT007) are unplanned.

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const order = (n: number, outletId: string) => ({ id: uuid(n), outletId }) as BoardOrder;
const PLAN: DraftPlan = {
  mixBrands: false, deferrals: [],
  trips: [
    { vehicleId: 'VEH035', tripNo: 1, leaveAt: null, driverId: null, stops: [{ outletId: 'OUT001', orderIds: [uuid(1), uuid(11)] }, { outletId: 'OUT003', orderIds: [uuid(3)] }, { outletId: 'OUT002', orderIds: [uuid(2)] }] },
    { vehicleId: 'VEH002', tripNo: 1, leaveAt: null, driverId: null, stops: [{ outletId: 'OUT051', orderIds: [uuid(51)] }] },
  ],
};
// The trucks named by their drivers, as the board's index names them (spec 026): Wasantha's reefer van VEH035, Chaminda's
// dry truck VEH002, and VEH004, a reefer truck with no driver yet.
const DRIVERS: Record<string, string | null> = { VEH035: 'Wasantha', VEH002: 'Chaminda', VEH004: null };
const TRUCKS = { VEH035: { type: 'van', temp: 'reefer' }, VEH002: { type: 'truck', temp: 'ambient' }, VEH004: { type: 'truck', temp: 'reefer' } } as const;
const called: Called = (trip) => truckCalled({ id: trip.vehicleId, ...TRUCKS[trip.vehicleId as keyof typeof TRUCKS] }, DRIVERS[trip.vehicleId] ?? null, trip.tripNo);
const COLOMBO = { brand: 'Fresh' as const, district: 'Colombo' };
const dehiwala: Dragged = { kind: 'orders', orders: [order(5, 'OUT005')], group: COLOMBO, label: 'Fresh Dehiwala', detail: '12 cartons chilled' };
const group: Dragged = { kind: 'orders', orders: [order(5, 'OUT005'), order(7, 'OUT007')], group: COLOMBO, label: 'Fresh · Colombo', detail: '2 orders' };
const nugegoda: Dragged = { kind: 'stop', tripKey: 'VEH035-1', index: 0, label: 'Fresh Nugegoda', brand: 'Fresh' };
const stops = (at: number): Landing => ({ kind: 'stops', tripKey: 'VEH035-1', at });
const CARD: Landing = { kind: 'card', tripKey: 'VEH002-1' };

it('spec 023 AC-1 an order dropped among the open trip\'s stops goes where it lands, at the end as "Add" puts it', () => {
  expect(dropOf(PLAN, dehiwala, stops(1), called)).toEqual({
    kind: 'change', plan: addOrders(PLAN, 'VEH035-1', dehiwala.orders, 1), undo: { line: 'Fresh Dehiwala added to Wasantha\'s reefer van', tripKey: 'VEH035-1' },
  });
  expect(dropOf(PLAN, dehiwala, stops(3), called)).toMatchObject({ plan: addOrders(PLAN, 'VEH035-1', dehiwala.orders) });
  // A whole group is its orders, as the group's shop rows add them.
  expect(dropOf(PLAN, group, stops(0), called)).toMatchObject({ plan: addOrders(PLAN, 'VEH035-1', group.orders, 0), undo: { line: 'Fresh · Colombo added to Wasantha\'s reefer van' } });
});

it('spec 023 AC-1 an order dropped on a trip\'s card in Done joins that trip at the end, with the line on that card', () => {
  expect(dropOf(PLAN, dehiwala, CARD, called)).toEqual({
    kind: 'change', plan: addOrders(PLAN, 'VEH002-1', dehiwala.orders), undo: { line: 'Fresh Dehiwala added to Chaminda\'s dry truck', tripKey: 'VEH002-1' },
  });
  // A second trip is named as its card names it.
  const second: DraftPlan = { ...PLAN, trips: [...PLAN.trips, { ...PLAN.trips[1]!, tripNo: 2, stops: [] }] };
  expect(dropOf(second, dehiwala, { kind: 'card', tripKey: 'VEH002-2' }, called)).toMatchObject({ undo: { line: 'Fresh Dehiwala added to the second trip of Chaminda\'s dry truck', tripKey: 'VEH002-2' } });
});

it('spec 023 AC-4 an order dropped in the empty middle opens the crew picker for its group, starting with it (spec 026)', () => {
  expect(dropOf(PLAN, dehiwala, { kind: 'middle' }, called)).toEqual({ kind: 'start', pick: { kind: 'start', group: COLOMBO, orders: dehiwala.orders, startWith: dehiwala.orders, dropped: 'Fresh Dehiwala' } });
});

it('spec 023 AC-3 a stop dragged up or down is the menu\'s move, by as many places as it went', () => {
  expect(dropOf(PLAN, nugegoda, stops(2), called)).toEqual({
    kind: 'change', plan: moveStop(PLAN, 'VEH035-1', 0, 2), undo: { line: 'Stops 1 and 3 moved', tripKey: 'VEH035-1' },
  });
  // One place is the menu's swap, said as the menu says it.
  expect(dropOf(PLAN, { ...nugegoda, index: 2, label: 'Fresh Wellawatte' }, stops(1), called)).toMatchObject({ plan: moveStop(PLAN, 'VEH035-1', 2, -1), undo: { line: 'Stops 2 and 3 swapped' } });
  // The end of the list is the last place, and its own place changes nothing.
  expect(dropOf(PLAN, nugegoda, stops(3), called)).toMatchObject({ plan: moveStop(PLAN, 'VEH035-1', 0, 2) });
  expect(dropOf(PLAN, nugegoda, stops(0), called)).toBeNull();
});

it('spec 023 AC-3 a stop dropped on Unplanned orders comes off its trip, and on another trip\'s card moves there', () => {
  expect(dropOf(PLAN, nugegoda, { kind: 'unplanned' }, called)).toEqual({
    kind: 'change', plan: takeOff(PLAN, [uuid(1), uuid(11)]), undo: { line: 'Fresh Nugegoda taken off Wasantha\'s reefer van', tripKey: 'VEH035-1' },
  });
  const moved = addOrders(PLAN, 'VEH002-1', [{ id: uuid(1), outletId: 'OUT001' }, { id: uuid(11), outletId: 'OUT001' }]);
  expect(dropOf(PLAN, nugegoda, CARD, called)).toEqual({ kind: 'change', plan: moved, undo: { line: 'Fresh Nugegoda moved to Chaminda\'s dry truck', tripKey: 'VEH035-1' } });
  expect(moved.trips.map((t) => t.stops.map((s) => s.outletId))).toEqual([['OUT003', 'OUT002'], ['OUT051', 'OUT001']]);
});

it('spec 023 rule 2 lands anything anywhere it can go, and puts it back from anywhere else with nothing changed', () => {
  const landings: Landing[] = [stops(1), CARD, { kind: 'unplanned' }, { kind: 'middle' }];
  expect(landings.map((landing) => canLand(dehiwala, landing))).toEqual([true, true, false, true]);
  expect(landings.map((landing) => canLand(nugegoda, landing))).toEqual([true, true, true, false]);
  // A stop goes only among its own trip's stops.
  expect(canLand(nugegoda, { kind: 'stops', tripKey: 'VEH002-1', at: 0 })).toBe(false);
  expect(dropOf(PLAN, dehiwala, { kind: 'unplanned' }, called)).toBeNull();
  expect(dropOf(PLAN, nugegoda, { kind: 'middle' }, called)).toBeNull();
  // A trip that is no longer in the draft takes nothing.
  expect(dropOf(PLAN, dehiwala, { kind: 'card', tripKey: 'VEH009-1' }, called)).toBeNull();
});
