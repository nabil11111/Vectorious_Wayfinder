import { CrewList, PlanBoard, type Crew, type DraftTrip } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import { planOf, startTrip, swapTruck } from '../draft';
import { crewsKey } from '../board';
import { crewChange, crewRows, crewsFor, pickOrders, type Pick } from './crews';
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
  plan: { mixBrands: false, trips: [trip('VEH011', CHAMINDA, 'OUT051', GALLE), trip('VEH001', DILSHAN, 'OUT006', FORT)], deferrals: [], id: uuid(100), revision: 3, status: 'draft', savedAt: '2026-06-24T10:31:00.000Z', sentAt: null, canUnsend: false, lockedReason: null },
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
  return {
    vehicleId, driverId, type: v.type, temp: v.temp, weightCapKg: v.weightCapKg, volumeCapM3: v.volumeCapM3, fuelLeftPct: v.fuelLeftPct, readyAt: null,
    lastDistricts: [], ranHere: false, fits: true, misfits: [], ...change,
    readiness: change.readiness ?? 'ready', why: change.why ?? '', advisories: change.advisories ?? [], leaveAt: change.leaveAt ?? null,
    tripFuelL: change.tripFuelL ?? null, quotaLeftL: change.quotaLeftL ?? null, unavailable: change.unavailable ?? null,
  };
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

it('AC-1 reads each crew as "Wasantha · reefer van · 1.0 t · 7 m³", and a hard miss cannot be chosen', () => {
  const rows = crewRows(LIST, DROPPED, DRAFT, INDEX);
  expect(rows.map((row) => [row.vehicleId, row.title, row.badge, row.disabled])).toEqual([
    ['VEH035', 'Wasantha · reefer van · 1.0 t · 7 m³', 'Ready for these orders', false],
    ['VEH001', 'Dilshan · reefer truck · 5.5 t · 26.4 m³', 'Cannot take these orders', true],
    ['VEH011', 'Chaminda · dry truck · 7.2 t · 38 m³', 'Cannot take these orders', true],
    ['VEH005', 'reefer truck VEH005 · 6.8 t · 33.4 m³', 'Unavailable', true],
  ]);
  expect(rows[0]!.line).toContain('Can take this load');
  expect(rows[1]!.detail).toContain('cannot reach Fresh Dehiwala: van only');
  expect(rows[2]!.detail).toContain('no fridge for the chilled order');
  expect(rows[3]!.line).toBe('In the workshop: brake service');
});

it('AC-1 shows too heavy and too big against the truck\'s own limits, and greys a truck on two trips', () => {
  const heavy = { ...LIST, load: { kg: 7600, m3: 41.2 }, crews: [crew('VEH011', CHAMINDA, { fits: false, misfits: [{ code: 'over_weight', orderId: null, outletId: null }, { code: 'over_volume', orderId: null, outletId: null }] }), crew('VEH001', DILSHAN, { unavailable: { kind: 'two_trips' } })] };
  expect(crewRows(heavy, DROPPED, DRAFT, INDEX).map((row) => [row.disabled, row.detail.includes('too heavy: 7.6 t of 7.2 t'), row.line])).toEqual([
    [true, true, expect.stringContaining('too heavy')],
    [true, false, 'On two trips already'],
  ]);
  // Every chilled order without a fridge is counted once, and a van-only shop named once. The detail keeps it; the row cannot be chosen.
  const many = { ...LIST, crews: [crew('VEH011', CHAMINDA, { fits: false, misfits: [
    { code: 'van_only', orderId: null, outletId: 'OUT005' }, { code: 'needs_reefer', orderId: DEHIWALA, outletId: 'OUT005' },
    { code: 'van_only', orderId: null, outletId: 'OUT005' }, { code: 'needs_reefer', orderId: FORT, outletId: 'OUT006' },
  ] })] };
  expect(crewRows(many, DROPPED, DRAFT, INDEX)[0]).toMatchObject({ disabled: true, detail: 'cannot reach Fresh Dehiwala: van only. no fridge for 2 chilled orders' });
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
  // A started trip's Undo opens what was open before it (L-16): nothing here, Chaminda's trip below.
  expect(crewChange(button, DRAFT, { vehicleId: 'VEH035', driverId: WASANTHA }, INDEX, null)).toEqual({
    ...startTrip(DRAFT, { vehicleId: 'VEH035', driverId: WASANTHA })!, undo: { line: 'Trip started on Wasantha\'s reefer van', tripKey: 'VEH035-1', from: null },
  });
  expect(crewChange(button, DRAFT, { vehicleId: 'VEH035', driverId: WASANTHA }, INDEX, 'VEH011-1')).toMatchObject({ undo: { tripKey: 'VEH035-1', from: 'VEH011-1' } });
  expect(crewChange(DROPPED, DRAFT, { vehicleId: 'VEH035', driverId: WASANTHA }, INDEX, null)).toMatchObject({ undo: { line: 'Fresh Dehiwala added to Wasantha\'s reefer van' } });
  // A driver who moves is said in the same line, and the one Undo puts him back.
  expect(crewChange(DROPPED, DRAFT, { vehicleId: 'VEH035', driverId: DILSHAN }, INDEX, null)).toMatchObject({
    key: 'VEH035-1', undo: { line: 'Fresh Dehiwala added to Dilshan\'s reefer van. VEH001 has no driver now.' },
  });
  expect(crewChange({ kind: 'swap', key: 'VEH011-1' }, DRAFT, { vehicleId: 'VEH035', driverId: WASANTHA }, INDEX, 'VEH011-1')).toEqual({
    ...swapTruck(DRAFT, 'VEH011-1', { vehicleId: 'VEH035', driverId: WASANTHA })!, // Chaminda drove the trip, and Wasantha drives it now, so the line says Chaminda is off his truck.
    // The swapped trip's old key, which Undo opens again (L-10).
    undo: { line: 'Trip moved to Wasantha\'s reefer van. Chaminda is off VEH011 now.', tripKey: 'VEH035-1', from: 'VEH011-1' },
  });
  // A second trip says so.
  expect(crewChange(button, DRAFT, { vehicleId: 'VEH011', driverId: CHAMINDA }, INDEX, null)).toMatchObject({ key: 'VEH011-2', undo: { line: 'Second trip started on Chaminda\'s dry truck' } });
});

it('rule 1 picks for the group\'s orders, the dropped ones, or the trip\'s, and a truck already on two trips takes nothing', () => {
  expect(pickOrders(DROPPED, DRAFT, INDEX)).toEqual([BOARD.orders[2]]);
  expect(pickOrders({ kind: 'swap', key: 'VEH011-1' }, DRAFT, INDEX)).toEqual([BOARD.orders[0]]);
  const full = { ...DRAFT, trips: [...DRAFT.trips, trip('VEH011', CHAMINDA, 'OUT006', uuid(7), 2)] };
  expect(crewChange(DROPPED, full, { vehicleId: 'VEH011', driverId: CHAMINDA }, INDEX, null)).toBeNull();
  expect(crewRows({ ...LIST, crews: [crew('VEH011', CHAMINDA)] }, DROPPED, full, INDEX)[0]).toMatchObject({ line: 'On two trips already', disabled: true });
});

// Review of 026: a crews read is offered only for the draft it was read from, and a pick names every driver it moves.
it('rule 2 names every driver a pick displaces, the truck\'s own driver too', () => {
  // A read from before Chaminda took VEH001 and Dilshan moved to VEH002 still offers VEH001 with Dilshan.
  const now = { ...DRAFT, trips: [trip('VEH001', CHAMINDA, 'OUT006', FORT), trip('VEH002', DILSHAN, 'OUT051', GALLE)] };
  const old = { ...LIST, crews: [crew('VEH001', DILSHAN)] };
  expect(crewRows(old, DROPPED, now, INDEX)[0]!.warning)
    .toBe('Dilshan drives VEH002 now; it will have no driver. Chaminda drives VEH001 now and will be taken off it');
  expect(crewChange(DROPPED, now, { vehicleId: 'VEH001', driverId: DILSHAN }, INDEX, null)!.undo.line)
    .toBe('Fresh Dehiwala added to the second trip of Dilshan\'s reefer truck. VEH002 has no driver now. Chaminda is off VEH001 now.');
});

it('offers a crews read only while it is for the saved draft on screen, and keys it by the draft\'s revision', () => {
  expect(crewsKey('2026-06-25', [DEHIWALA], 3)).toEqual(['plans', '2026-06-25', 'crews', DEHIWALA, 3]);
  expect(crewsFor(LIST, BOARD, DRAFT)).toBe(LIST);
  // Read at another revision, or with a change on screen not yet saved: none, and the picker says it is finding them.
  expect(crewsFor({ ...LIST, revision: 2 }, BOARD, DRAFT)).toBeNull();
  expect(crewsFor(LIST, BOARD, { ...DRAFT, trips: DRAFT.trips.slice(1) })).toBeNull();
  expect(crewsFor(undefined, BOARD, DRAFT)).toBeNull();
});

it('L-04 says when a second trip is ready, and that it is after every window closes when the read says so', () => {
  const ready = { ...LIST, crews: [
    crew('VEH001', DILSHAN, { readyAt: 418 }),
    crew('VEH011', CHAMINDA, { readyAt: 498, fits: false, misfits: [{ code: 'ready_late', orderId: null, outletId: null }] }),
  ] };
  const rows = crewRows(ready, DROPPED, DRAFT, INDEX);
  expect(rows[0]).toMatchObject({ badge: 'Ready for these orders', disabled: false });
  expect(rows[0]!.line).toContain('trip 2, ready 06:58');
  expect(rows[1]).toMatchObject({ badge: 'Cannot take these orders', disabled: true });
  expect(rows[1]!.detail).toContain('ready 08:18, after every window closes');
});

it('L-17 says a crew whose trip would reach a shop after its window does not fit, and by how much', () => {
  const late = { ...LIST, crews: [
    crew('VEH001', DILSHAN, { readyAt: 418, fits: false, misfits: [{ code: 'arrives_late', orderId: null, outletId: 'OUT005', lateMin: 111 }] }),
    crew('VEH035', WASANTHA, { fits: false, misfits: [{ code: 'arrives_late', orderId: null, outletId: 'OUT005', lateMin: 40 }] }),
    crew('VEH011', CHAMINDA, { readyAt: 418, fits: false, misfits: [{ code: 'arrives_late', orderId: null, outletId: 'OUT005', lateMin: 0 }] }),
  ] };
  const rows = crewRows(late, DROPPED, DRAFT, INDEX);
  expect(rows.every((row) => row.disabled)).toBe(true);
  expect(rows.map((row) => row.detail)).toEqual([
    'reaches Fresh Dehiwala 1 h 51 min after its window',
    'reaches Fresh Dehiwala 40 min after its window',
    'reaches Fresh Dehiwala too late for its window',
  ]);
});
