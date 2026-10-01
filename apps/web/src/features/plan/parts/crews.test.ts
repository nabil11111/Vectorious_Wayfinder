import { CrewList, PlanBoard, type Crew, type DraftTrip } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import { planOf, startTrip, swapTruck } from '../draft';
import { crewChange, crewRows, pickOrders, type Pick } from './crews';
import { indexOf } from './lookup';

// Spec 026's crew picker, without the screen: its rows as the crews read gives them, what each says before the press
// (AC-1, rule 2), and the one change of the draft a pick makes, with its one Undo (rule 1). The board is made up:
// Chaminda drives VEH011, a dry truck, to Fresh Galle Fort; Dilshan VEH001, a reefer truck, to Fresh Colombo Fort.
// Fresh Dehiwala's chilled order is unplanned.

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [CHAMINDA, DILSHAN, WASANTHA] = [uuid(1), uuid(2), uuid(3)] as [string, string, string];
const [GALLE, FORT, DEHIWALA] = [uuid(51), uuid(6), uuid(5)] as [string, string, string];
const shop = (id: string, name: string, district: string, parking = 'normal') => ({
  id, name, brand: 'Fresh', district, dockType: 'street', parking, windowOpen: 180, windowClose: 480, mallOpen: null, mallClose: null, unloadMin: 15,
});
const order = (id: string, outletId: string) => ({
  id, outletId, temp: 'chilled', deliveryDate: '2026-06-25', lines: [{ productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', quantity: 12 }],
  load: { kg: 82.8, m3: 0.444, units: 12, needsReefer: true, needsTailLift: false, keepUpright: false },
  carriedOver: false, timesDeferred: 0, lastDeferral: null, splitFrom: null, originalUnits: null,
});
const vehicle = (id: string, type: string, temp: string, weightCapKg: number, volumeCapM3: number, working = true) =>
  ({ id, type, temp, weightCapKg, volumeCapM3, working, offReason: working ? null : 'Brake service', litresLeft: 300, fuelLeftPct: 62 });
const trip = (vehicleId: string, driverId: string | null, outletId: string, orderId: string, tripNo: 1 | 2 = 1): DraftTrip =>
  ({ vehicleId, tripNo, leaveAt: null, driverId, stops: [{ outletId, orderIds: [orderId] }] });
const BOARD = PlanBoard.parse({
  depot: 'Peliyagoda', demoDay: 1, day: { date: '2026-06-25', cutoffAt: '2026-06-24T10:30:00.000Z', open: true },
  plan: { mixBrands: false, trips: [trip('VEH011', CHAMINDA, 'OUT051', GALLE), trip('VEH001', DILSHAN, 'OUT006', FORT)], deferrals: [], id: uuid(100), revision: 3, status: 'draft', savedAt: '2026-06-24T10:31:00.000Z', sentAt: null, canUnsend: false },
  dropped: [], check: null, orders: [order(GALLE, 'OUT051'), order(FORT, 'OUT006'), order(DEHIWALA, 'OUT005')],
  shops: [shop('OUT051', 'Fresh Galle Fort', 'Galle'), shop('OUT006', 'Fresh Colombo Fort', 'Colombo'), shop('OUT005', 'Fresh Dehiwala', 'Colombo', 'van_only')],
  vehicles: [vehicle('VEH011', 'truck', 'ambient', 7200, 38), vehicle('VEH001', 'truck', 'reefer', 5510, 26.4), vehicle('VEH035', 'van', 'reefer', 1040, 7), vehicle('VEH005', 'truck', 'reefer', 6840, 33.4, false)],
  drivers: [{ id: CHAMINDA, name: 'Chaminda' }, { id: DILSHAN, name: 'Dilshan' }, { id: WASANTHA, name: 'Wasantha' }],
  figures: null, counts: null, suggestion: null,
});
const INDEX = indexOf(BOARD);
const DRAFT = planOf(BOARD);
const crew = (vehicleId: string, driverId: string | null, change: Partial<Crew> = {}): Crew => {
  const v = BOARD.vehicles.find((x) => x.id === vehicleId)!;
  return { vehicleId, driverId, type: v.type, temp: v.temp, weightCapKg: v.weightCapKg, volumeCapM3: v.volumeCapM3, fuelLeftPct: v.fuelLeftPct,
    lastDistricts: [], ranHere: false, fits: true, misfits: [], unavailable: null, ...change };
};
// Fresh Dehiwala's order dropped in the empty middle: a chilled order for a van-only shop.
const DROPPED: Pick = { kind: 'start', group: { brand: 'Fresh', district: 'Colombo' }, orders: [BOARD.orders[2]!], startWith: [BOARD.orders[2]!], dropped: 'Fresh Dehiwala' };
const LIST = CrewList.parse({
  orderIds: [DEHIWALA], revision: 3, load: { kg: 82.8, m3: 0.444 },
  crews: [
    crew('VEH035', WASANTHA, { lastDistricts: ['Colombo'], ranHere: true }),
    crew('VEH001', DILSHAN, { fits: false, misfits: [{ code: 'van_only', orderId: null, outletId: 'OUT005' }] }),
    crew('VEH011', CHAMINDA, { fits: false, misfits: [{ code: 'van_only', orderId: null, outletId: 'OUT005' }, { code: 'needs_reefer', orderId: DEHIWALA, outletId: 'OUT005' }], lastDistricts: ['Galle'] }),
    crew('VEH005', null, { unavailable: { kind: 'workshop', reason: 'Brake service' } }),
  ],
});

it('AC-1 reads each crew as "Wasantha · reefer van · 1.0 t · 7 m³", with what matters for the orders under it, in the read\'s order', () => {
  expect(crewRows(LIST, DROPPED, DRAFT, INDEX)).toEqual([
    { vehicleId: 'VEH035', driverId: WASANTHA, title: 'Wasantha · reefer van · 1.0 t · 7 m³', line: 'fits · ran Colombo last time · fuel 62% left', warning: null, disabled: false },
    { vehicleId: 'VEH001', driverId: DILSHAN, title: 'Dilshan · reefer truck · 5.5 t · 26.4 m³', line: 'cannot reach Fresh Dehiwala: van only · trip 2 · fuel 62% left', warning: null, disabled: false },
    { vehicleId: 'VEH011', driverId: CHAMINDA, title: 'Chaminda · dry truck · 7.2 t · 38 m³', line: 'cannot reach Fresh Dehiwala: van only · no fridge for the chilled order · trip 2 · ran Galle last time · fuel 62% left', warning: null, disabled: false },
    { vehicleId: 'VEH005', driverId: null, title: 'reefer truck VEH005 · 6.8 t · 33.4 m³', line: 'in the workshop: brake service', warning: null, disabled: true },
  ]);
});

it('AC-1 shows too heavy and too big against the truck\'s own limits, and greys a truck on two trips', () => {
  const heavy = { ...LIST, load: { kg: 7600, m3: 41.2 }, crews: [crew('VEH011', CHAMINDA, { fits: false, misfits: [{ code: 'over_weight', orderId: null, outletId: null }, { code: 'over_volume', orderId: null, outletId: null }] }), crew('VEH001', DILSHAN, { unavailable: { kind: 'two_trips' } })] };
  expect(crewRows(heavy, DROPPED, DRAFT, INDEX).map((row) => [row.line, row.disabled])).toEqual([
    ['too heavy: 7.6 t of 7.2 t · too big: 41.2 m³ of 38 m³ · trip 2 · fuel 62% left', false],
    ['on two trips already', true],
  ]);
  // Every chilled order without a fridge is counted once, and a van-only shop named once.
  const many = { ...LIST, crews: [crew('VEH011', CHAMINDA, { fits: false, misfits: [
    { code: 'van_only', orderId: null, outletId: 'OUT005' }, { code: 'needs_reefer', orderId: DEHIWALA, outletId: 'OUT005' },
    { code: 'van_only', orderId: null, outletId: 'OUT005' }, { code: 'needs_reefer', orderId: FORT, outletId: 'OUT006' },
  ] })] };
  expect(crewRows(many, DROPPED, DRAFT, INDEX)[0]!.line).toBe('cannot reach Fresh Dehiwala: van only · no fridge for 2 chilled orders · trip 2 · fuel 62% left');
});

it('rule 2 says before the press when the crew\'s driver drives another truck, which will have no driver', () => {
  // Dilshan's crew on VEH035: he drives VEH001 now, which keeps its trip.
  const moving = { ...LIST, crews: [crew('VEH035', DILSHAN)] };
  expect(crewRows(moving, DROPPED, DRAFT, INDEX)[0]!.warning).toBe('Dilshan drives VEH001 now; it will have no driver');
  // Swapping VEH001's only trip onto his crew leaves VEH001 with no trip, so nothing is left without him.
  const swap: Pick = { kind: 'swap', key: 'VEH001-1' };
  expect(crewRows(moving, swap, DRAFT, INDEX)[0]!.warning).toBeNull();
  // A swap lists every truck but the trip's own.
  expect(crewRows(LIST, swap, DRAFT, INDEX).map((row) => row.vehicleId)).toEqual(['VEH035', 'VEH011', 'VEH005']);
});

it('rule 1 a pick is one change of the draft with one Undo, naming the crew', () => {
  const button: Pick = { kind: 'start', group: { brand: 'Fresh', district: 'Colombo' }, orders: [BOARD.orders[2]!], startWith: [] };
  expect(crewChange(button, DRAFT, { vehicleId: 'VEH035', driverId: WASANTHA }, INDEX)).toEqual({
    ...startTrip(DRAFT, { vehicleId: 'VEH035', driverId: WASANTHA })!, undo: { before: DRAFT, line: 'Trip started on Wasantha\'s reefer van', tripKey: 'VEH035-1' },
  });
  expect(crewChange(DROPPED, DRAFT, { vehicleId: 'VEH035', driverId: WASANTHA }, INDEX)).toMatchObject({ undo: { line: 'Fresh Dehiwala added to Wasantha\'s reefer van' } });
  // A driver who moves is said in the same line, and the one Undo puts him back.
  expect(crewChange(DROPPED, DRAFT, { vehicleId: 'VEH035', driverId: DILSHAN }, INDEX)).toMatchObject({
    key: 'VEH035-1', undo: { before: DRAFT, line: 'Fresh Dehiwala added to Dilshan\'s reefer van. VEH001 has no driver now.' },
  });
  expect(crewChange({ kind: 'swap', key: 'VEH011-1' }, DRAFT, { vehicleId: 'VEH035', driverId: WASANTHA }, INDEX)).toEqual({
    ...swapTruck(DRAFT, 'VEH011-1', { vehicleId: 'VEH035', driverId: WASANTHA })!, undo: { before: DRAFT, line: 'Trip moved to Wasantha\'s reefer van', tripKey: 'VEH035-1' },
  });
  // A second trip says so.
  expect(crewChange(button, DRAFT, { vehicleId: 'VEH011', driverId: CHAMINDA }, INDEX)).toMatchObject({ key: 'VEH011-2', undo: { line: 'Second trip started on Chaminda\'s dry truck' } });
});

it('rule 1 picks for the group\'s orders, the dropped ones, or the trip\'s, and a truck already on two trips takes nothing', () => {
  expect(pickOrders(DROPPED, DRAFT, INDEX)).toEqual([BOARD.orders[2]]);
  expect(pickOrders({ kind: 'swap', key: 'VEH011-1' }, DRAFT, INDEX)).toEqual([BOARD.orders[0]]);
  const full = { ...DRAFT, trips: [...DRAFT.trips, trip('VEH011', CHAMINDA, 'OUT006', uuid(7), 2)] };
  expect(crewChange(DROPPED, full, { vehicleId: 'VEH011', driverId: CHAMINDA }, INDEX)).toBeNull();
  expect(crewRows({ ...LIST, crews: [crew('VEH011', CHAMINDA)] }, DROPPED, full, INDEX)[0]).toMatchObject({ line: 'on two trips already', disabled: true });
});
