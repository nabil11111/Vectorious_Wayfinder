import type { DraftPlan } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import { addOrders, moveStop } from './draft';

// The draft changes a drop shares with the board's buttons and menus (spec 023): a new stop put where an order is
// dropped, and a stop moved more than one place. The buttons' own changes stay as they were.

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stop = (outletId: string, n: number) => ({ outletId, orderIds: [uuid(n)] });
// VEH035 with three Colombo stops: Fresh Nugegoda (OUT001), Fresh Kotahena (OUT003) and Fresh Wellawatte (OUT002).
const PLAN: DraftPlan = {
  mixBrands: false, deferrals: [],
  trips: [{ vehicleId: 'VEH035', tripNo: 1, leaveAt: null, driverId: null, stops: [stop('OUT001', 1), stop('OUT003', 3), stop('OUT002', 2)] }],
};
const shopsOf = (plan: DraftPlan) => plan.trips[0]!.stops.map((s) => [s.outletId, s.orderIds.length]);

it('spec 023 AC-1 puts an order\'s new stop where it is dropped, and still at the end for the Add button', () => {
  const dehiwala = [{ id: uuid(5), outletId: 'OUT005' }];
  expect(shopsOf(addOrders(PLAN, 'VEH035-1', dehiwala, 1))).toEqual([['OUT001', 1], ['OUT005', 1], ['OUT003', 1], ['OUT002', 1]]);
  expect(shopsOf(addOrders(PLAN, 'VEH035-1', dehiwala, 0))).toEqual([['OUT005', 1], ['OUT001', 1], ['OUT003', 1], ['OUT002', 1]]);
  expect(shopsOf(addOrders(PLAN, 'VEH035-1', dehiwala, 3))).toEqual(shopsOf(addOrders(PLAN, 'VEH035-1', dehiwala)));
  expect(shopsOf(addOrders(PLAN, 'VEH035-1', dehiwala))).toEqual([['OUT001', 1], ['OUT003', 1], ['OUT002', 1], ['OUT005', 1]]);
  // Two shops dropped together keep their order there, and a shop already on the trip takes the order on its stop.
  const two = [{ id: uuid(6), outletId: 'OUT006' }, { id: uuid(7), outletId: 'OUT001' }, { id: uuid(8), outletId: 'OUT007' }];
  expect(shopsOf(addOrders(PLAN, 'VEH035-1', two, 1))).toEqual([['OUT001', 2], ['OUT006', 1], ['OUT007', 1], ['OUT003', 1], ['OUT002', 1]]);
});

it('spec 023 AC-3 moves a stop any number of places, and one place is the menu\'s swap', () => {
  expect(shopsOf(moveStop(PLAN, 'VEH035-1', 0, 2)).map(([id]) => id)).toEqual(['OUT003', 'OUT002', 'OUT001']);
  expect(shopsOf(moveStop(PLAN, 'VEH035-1', 2, -2)).map(([id]) => id)).toEqual(['OUT002', 'OUT001', 'OUT003']);
  expect(shopsOf(moveStop(PLAN, 'VEH035-1', 1, 1)).map(([id]) => id)).toEqual(['OUT001', 'OUT002', 'OUT003']);
  expect(shopsOf(moveStop(PLAN, 'VEH035-1', 1, -1)).map(([id]) => id)).toEqual(['OUT003', 'OUT001', 'OUT002']);
  // Nowhere to go: the draft is as it was.
  expect(moveStop(PLAN, 'VEH035-1', 0, -1)).toEqual(PLAN);
  expect(moveStop(PLAN, 'VEH035-1', 2, 1)).toEqual(PLAN);
  expect(moveStop(PLAN, 'VEH035-1', 1, 0)).toEqual(PLAN);
});
