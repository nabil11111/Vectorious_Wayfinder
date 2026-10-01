import type { DraftPlan } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import { addOrders, moveStop, setDriver, startTrip, swapTruck, vehicleOfDriver } from './draft';

// The draft changes a drop shares with the board's buttons and menus (spec 023): a new stop put where an order is
// dropped, and a stop moved more than one place. The buttons' own changes stay as they were. Spec 026's crews: a truck
// and its driver set together, and a driver who moves leaving his truck with none.

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

// Spec 026: a crew is a truck and its driver, picked as one. VEH004 runs two trips with Chaminda, and VEH035 one with
// nobody; Dilshan drives VEH001.
const [CHAMINDA, DILSHAN] = [uuid(91), uuid(92)];
const CREWS: DraftPlan = {
  mixBrands: false, deferrals: [],
  trips: [
    { vehicleId: 'VEH004', tripNo: 1, leaveAt: null, driverId: CHAMINDA, stops: [stop('OUT026', 26)] },
    { vehicleId: 'VEH004', tripNo: 2, leaveAt: null, driverId: CHAMINDA, stops: [stop('OUT028', 28)] },
    { vehicleId: 'VEH001', tripNo: 1, leaveAt: null, driverId: DILSHAN, stops: [stop('OUT006', 6)] },
    { vehicleId: 'VEH035', tripNo: 1, leaveAt: null, driverId: null, stops: [stop('OUT001', 1)] },
  ],
};
const crewsOf = (plan: DraftPlan) => plan.trips.map((t) => [t.vehicleId, t.tripNo, t.driverId]);

it('spec 026 rule 1 starts a trip on a crew, the truck and its driver in one change', () => {
  const started = startTrip(CREWS, { vehicleId: 'VEH002', driverId: DILSHAN }, [{ id: uuid(51), outletId: 'OUT051' }])!;
  expect(started.key).toBe('VEH002-1');
  // Dilshan leaves VEH001, which is left with no driver (rule 2).
  expect(crewsOf(started.plan)).toEqual([['VEH004', 1, CHAMINDA], ['VEH004', 2, CHAMINDA], ['VEH001', 1, null], ['VEH035', 1, null], ['VEH002', 1, DILSHAN]]);
  expect(started.plan.trips.at(-1)!.stops).toEqual([stop('OUT051', 51)]);
  // A second trip of a truck: the crew's driver is on both its trips.
  const second = startTrip(CREWS, { vehicleId: 'VEH035', driverId: CHAMINDA })!;
  expect(second.key).toBe('VEH035-2');
  expect(crewsOf(second.plan)).toEqual([['VEH004', 1, null], ['VEH004', 2, null], ['VEH001', 1, DILSHAN], ['VEH035', 1, CHAMINDA], ['VEH035', 2, CHAMINDA]]);
  // A crew with no driver keeps whatever driver its truck has, and a truck on two trips takes no third.
  expect(crewsOf(startTrip({ ...CREWS, trips: CREWS.trips.filter((t) => t.tripNo === 1) }, { vehicleId: 'VEH004', driverId: null })!.plan).at(-1)).toEqual(['VEH004', 2, CHAMINDA]);
  expect(startTrip(CREWS, { vehicleId: 'VEH004', driverId: DILSHAN })).toBeNull();
});

it('spec 026 rule 1 swaps a trip onto a crew, the truck and its driver in one change', () => {
  // VEH001's trip goes to VEH002 with Chaminda, who leaves VEH004's two trips with no driver.
  const moved = swapTruck(CREWS, 'VEH001-1', { vehicleId: 'VEH002', driverId: CHAMINDA })!;
  expect(moved.key).toBe('VEH002-1');
  expect(crewsOf(moved.plan)).toEqual([['VEH004', 1, null], ['VEH004', 2, null], ['VEH035', 1, null], ['VEH002', 1, CHAMINDA]]);
  expect(moved.plan.trips.at(-1)!.stops).toEqual([stop('OUT006', 6)]);
  // Moving VEH004's second trip to VEH035 with Chaminda leaves trip 1 on VEH004 with no driver.
  expect(crewsOf(swapTruck(CREWS, 'VEH004-2', { vehicleId: 'VEH035', driverId: CHAMINDA })!.plan))
    .toEqual([['VEH004', 1, null], ['VEH001', 1, DILSHAN], ['VEH035', 1, CHAMINDA], ['VEH035', 2, CHAMINDA]]);
  // Moving his own truck's only trip to his usual truck takes nobody else's driver away.
  const only = { ...CREWS, trips: CREWS.trips.filter((t) => t.vehicleId !== 'VEH004') };
  expect(crewsOf(swapTruck(only, 'VEH001-1', { vehicleId: 'VEH006', driverId: DILSHAN })!.plan)).toEqual([['VEH035', 1, null], ['VEH006', 1, DILSHAN]]);
  expect(swapTruck(CREWS, 'VEH001-1', { vehicleId: 'VEH004', driverId: CHAMINDA })).toBeNull();
});

it('spec 026 rule 2 moves a driver chosen in the driver menu, leaving the truck he drove with no driver', () => {
  expect(crewsOf(setDriver(CREWS, 'VEH035', CHAMINDA))).toEqual([['VEH004', 1, null], ['VEH004', 2, null], ['VEH001', 1, DILSHAN], ['VEH035', 1, CHAMINDA]]);
  // Not a swap: VEH004 does not take Dilshan.
  expect(crewsOf(setDriver(CREWS, 'VEH001', CHAMINDA))).toEqual([['VEH004', 1, null], ['VEH004', 2, null], ['VEH001', 1, CHAMINDA], ['VEH035', 1, null]]);
  expect(crewsOf(setDriver(CREWS, 'VEH001', null))).toEqual([['VEH004', 1, CHAMINDA], ['VEH004', 2, CHAMINDA], ['VEH001', 1, null], ['VEH035', 1, null]]);
  expect(vehicleOfDriver(CREWS, CHAMINDA, 'VEH035')).toBe('VEH004');
  expect(vehicleOfDriver(CREWS, CHAMINDA, 'VEH004')).toBeNull();
});
