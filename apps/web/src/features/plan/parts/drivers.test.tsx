import { renderToStaticMarkup } from 'react-dom/server';
import { PlanBoard, type DraftPlan, type DraftTrip } from '@wayfinder/contracts';
import { expect, it, vi } from 'vitest';
import type { BoardScreen } from '../board';
import { planOf, setDriver } from '../draft';
import { DoneList } from './DoneList';
import { driverChange, driverRows } from './drivers';
import { indexOf } from './lookup';
import { TripPanel } from './TripPanel';
import { VehicleRow } from './VehicleRow';
import { decisionTitle } from '../words';

// Spec 022's drivers on the plan board, drawn as the page draws them: Done's cards and the open trip's header name the
// truck by its driver (spec 026, AC-3), or by its kind and number with "no driver" in the warning colour (AC-4). The board is made up: VEH004 with
// Chaminda to a Colombo shop, and VEH002 with nobody to a Galle shop. The driver menu offers a driver who drives
// another vehicle as a move, which leaves that vehicle with no driver, made as one change of the draft (spec 026, rule 2).

vi.mock('sonner', () => ({ toast: vi.fn() }));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [CHAMINDA, DILSHAN, SANJEEWA] = [uuid(1), uuid(2), uuid(3)] as [string, string, string];
const [COLOMBO_ORDER, GALLE_ORDER] = [uuid(11), uuid(12)] as [string, string];

const shop = (id: string, name: string, district: string) => ({
  id, name, brand: 'Fresh', district, dockType: 'street', parking: 'normal', windowOpen: 180, windowClose: 480, mallOpen: null, mallClose: null, unloadMin: 15,
});
const vehicle = (id: string, type = 'truck') => ({ id, type, temp: 'reefer', weightCapKg: 6800, volumeCapM3: 33.4, working: true, offReason: null, litresLeft: 300, fuelLeftPct: 80 });
const order = (id: string, outletId: string) => ({
  id, outletId, temp: 'chilled', deliveryDate: '2026-06-25', lines: [{ productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', quantity: 12 }],
  load: { kg: 82.8, m3: 0.444, units: 12, needsReefer: true, needsTailLift: false, keepUpright: false },
  carriedOver: false, timesDeferred: 0, lastDeferral: null, splitFrom: null, originalUnits: null,
});
const trip = (vehicleId: string, driverId: string | null, outletId: string, orderId: string, tripNo: 1 | 2 = 1): DraftTrip =>
  ({ vehicleId, tripNo, leaveAt: null, driverId, stops: [{ outletId, orderIds: [orderId] }] });

const boardWith = (trips: DraftTrip[]) => PlanBoard.parse({
  depot: 'Peliyagoda', demoDay: 1, day: { date: '2026-06-25', cutoffAt: '2026-06-24T10:30:00.000Z', open: true },
  plan: { mixBrands: false, trips, deferrals: [], id: uuid(100), revision: 3, status: 'draft', savedAt: '2026-06-24T10:31:00.000Z', sentAt: null, canUnsend: false, lockedReason: null },
  dropped: [], check: null, orders: [order(COLOMBO_ORDER, 'OUT006'), order(GALLE_ORDER, 'OUT051')],
  shops: [shop('OUT006', 'Fresh Colombo Fort', 'Colombo'), shop('OUT051', 'Fresh Galle Fort', 'Galle')],
  vehicles: [vehicle('VEH004'), vehicle('VEH002'), vehicle('VEH035', 'van')],
  drivers: [{ id: CHAMINDA, name: 'Chaminda' }, { id: DILSHAN, name: 'Dilshan' }, { id: SANJEEWA, name: 'Sanjeewa' }],
  figures: null, counts: null, suggestion: null,
});
const BOARD = boardWith([trip('VEH004', CHAMINDA, 'OUT006', COLOMBO_ORDER), trip('VEH002', null, 'OUT051', GALLE_ORDER)]);
const screenOf = (board: PlanBoard): BoardScreen => ({ board, draft: planOf(board), saving: 'saved', refused: null, acting: false, undo: null, history: { undo: null, redo: null } });

const doneList = (board: PlanBoard) => renderToStaticMarkup(<DoneList screen={screenOf(board)} index={indexOf(board)} openKey={null} onOpen={() => undefined} />);
const tripPanel = (board: PlanBoard, vehicleId: string) => renderToStaticMarkup(
  <TripPanel
    screen={screenOf(board)} index={indexOf(board)} trip={board.plan.trips.find((t) => t.vehicleId === vehicleId)!} group={null}
    change={() => undefined} act={async () => null} onUndo={() => undefined} onCrew={() => undefined} onRemoved={() => undefined} onDone={() => undefined} onAddStop={() => undefined} onJoin={() => undefined}
  />,
);

it('spec 026 AC-3 Done\'s cards name the truck by its driver, with no number: "Chaminda · reefer truck · Fresh · Colombo"', () => {
  expect(doneList(BOARD)).toContain('<span class="block">Chaminda · reefer truck ·</span><span class="block">Fresh · Colombo</span>');
  // A second trip says so.
  const second = boardWith([trip('VEH004', CHAMINDA, 'OUT006', COLOMBO_ORDER), trip('VEH004', CHAMINDA, 'OUT051', GALLE_ORDER, 2)]);
  expect(doneList(second)).toContain('<span class="block">Chaminda · reefer truck · trip 2 ·</span><span class="block">Fresh · Galle</span>');
  expect(doneList(BOARD)).not.toContain('VEH004');
});

it('spec 026 AC-3 a truck with no driver reads by its kind and number on its card, "no driver" in the warning colour (spec 022)', () => {
  const markup = doneList(BOARD);
  expect(markup).toContain('<span class="block">reefer truck VEH002 · <span class="text-warn-ink">no driver</span> ·</span><span class="block">Fresh · Galle</span>');
  // The button that opens a card's stops says whose they are.
  expect(markup).toContain('aria-label="Show the stops of reefer truck VEH002 · no driver · Fresh · Galle"');
  expect(markup).toContain('aria-label="Show the stops of Chaminda · reefer truck · Fresh · Colombo"');
});

it('spec 026 AC-3 the open trip\'s header names the truck by its driver, whose name is the driver menu', () => {
  expect(tripPanel(BOARD, 'VEH004')).toMatch(/<h2 class="[^"]*">Planning · <button[^>]*>Chaminda<\/button> · reefer truck<\/h2>/);
  expect(tripPanel(BOARD, 'VEH002')).toMatch(/<h2 class="[^"]*">Planning · reefer truck VEH002 · <button[^>]*class="[^"]*text-warn-ink[^"]*"[^>]*>no driver<\/button><\/h2>/);
  const second = boardWith([trip('VEH004', CHAMINDA, 'OUT006', COLOMBO_ORDER), trip('VEH004', CHAMINDA, 'OUT051', GALLE_ORDER, 2)]);
  const markup = renderToStaticMarkup(
    <TripPanel
      screen={screenOf(second)} index={indexOf(second)} trip={second.plan.trips[1]!} group={null}
      change={() => undefined} act={async () => null} onUndo={() => undefined} onCrew={() => undefined} onRemoved={() => undefined} onDone={() => undefined} onAddStop={() => undefined} onJoin={() => undefined}
    />,
  );
  expect(markup).toMatch(/<h2 class="[^"]*">Planning · <button[^>]*>Chaminda<\/button> · reefer truck · trip 2<\/h2>/);
  expect(markup).toContain('6.8 t · 33.4 m³ · VEH004 · trip 2 of 2');
});

it('spec 026 AC-3 View plan\'s rows name the truck by its driver, and by its kind and number with none', () => {
  const row = (vehicleId: string, driverName: string | null) => renderToStaticMarkup(
    <VehicleRow vehicleId={vehicleId} trips={BOARD.plan.trips.filter((t) => t.vehicleId === vehicleId)} driverName={driverName} index={indexOf(BOARD)} />,
  );
  expect(row('VEH004', 'Chaminda')).toMatch(/<p class="[^"]*">Chaminda · reefer truck<span class="font-normal text-muted-foreground"> · VEH004<\/span><\/p>/);
  expect(row('VEH002', null)).toMatch(/<p class="[^"]*">reefer truck VEH002<span class="text-warn-ink"> · No driver<\/span><\/p>/);
});

it('spec 026 AC-3 an early departure\'s title names its truck by its driver', () => {
  const early = { kind: 'early_leave' as const, leaveAt: 187 };
  expect(decisionTitle(early, null, 'Chaminda\'s dry truck')).toBe('Chaminda\'s dry truck leaves early, at 03:07');
  expect(decisionTitle(early, null, 'the second trip of the dry truck VEH044')).toBe('The second trip of the dry truck VEH044 leaves early, at 03:07');
  expect(decisionTitle({ kind: 'waited_again', leaveAt: null }, 'Fresh Dickwella', null)).toBe('Fresh Dickwella waits again');
});

// Spec 026's move (rule 2): Dilshan drives VEH001 on both its trips, Sanjeewa VEH035 and Chaminda VEH004.
const DAY: DraftPlan = {
  mixBrands: false, deferrals: [],
  trips: [
    trip('VEH001', DILSHAN, 'OUT006', uuid(21)), trip('VEH001', DILSHAN, 'OUT006', uuid(22), 2),
    trip('VEH035', SANJEEWA, 'OUT006', uuid(23)), trip('VEH004', CHAMINDA, 'OUT051', uuid(24)),
  ],
};
const driversIn = (plan: DraftPlan) => plan.trips.map((t) => [t.vehicleId, t.tripNo, t.driverId]);
const dilshan = BOARD.drivers.find((d) => d.id === DILSHAN)!;
const chaminda = BOARD.drivers.find((d) => d.id === CHAMINDA)!;

it('spec 026 rule 2 choosing a driver who drives another vehicle moves him, and that vehicle is left with no driver', () => {
  expect(driversIn(setDriver(DAY, 'VEH035', DILSHAN))).toEqual([['VEH001', 1, null], ['VEH001', 2, null], ['VEH035', 1, DILSHAN], ['VEH004', 1, CHAMINDA]]);
  // A free driver, or none, changes only the vehicle chosen for.
  const free = setDriver({ ...DAY, trips: DAY.trips.filter((t) => t.vehicleId !== 'VEH004') }, 'VEH035', CHAMINDA);
  expect(driversIn(free)).toEqual([['VEH001', 1, DILSHAN], ['VEH001', 2, DILSHAN], ['VEH035', 1, CHAMINDA]]);
  expect(driversIn(setDriver(DAY, 'VEH001', null))).toEqual([['VEH001', 1, null], ['VEH001', 2, null], ['VEH035', 1, SANJEEWA], ['VEH004', 1, CHAMINDA]]);
});

it('spec 026 rule 2 the menu lets every driver be chosen and says before the press who moves: "drives VEH001 now; it will have no driver"', () => {
  expect(driverRows(DAY, 'VEH035', BOARD.drivers, SANJEEWA)).toEqual([
    { id: CHAMINDA, name: 'Chaminda', chosen: false, movesFrom: 'VEH004', note: 'drives VEH004 now; it will have no driver' },
    { id: DILSHAN, name: 'Dilshan', chosen: false, movesFrom: 'VEH001', note: 'drives VEH001 now; it will have no driver' },
    { id: SANJEEWA, name: 'Sanjeewa', chosen: true, movesFrom: null, note: null },
  ]);
});

it('spec 026 rule 2 a move is one change of the draft, with Undo putting the driver back on his truck', () => {
  const move = driverChange(DAY, 'VEH035-1', 'VEH035', dilshan);
  expect(move.plan).toEqual(setDriver(DAY, 'VEH035', DILSHAN));
  expect(move.undo).toEqual({ line: 'Dilshan moved from VEH001, which has no driver now', tripKey: 'VEH035-1' });
  // Choosing a free driver, or none, touches one vehicle: a step of the history with no line on the trip (spec 027).
  expect(driverChange({ ...DAY, trips: DAY.trips.filter((t) => t.vehicleId !== 'VEH004') }, 'VEH035-1', 'VEH035', chaminda).undo).toEqual({ line: 'Chaminda chosen as the driver', tripKey: null });
  expect(driverChange(DAY, 'VEH035-1', 'VEH035', null)).toEqual({ plan: setDriver(DAY, 'VEH035', null), undo: { line: 'Driver taken off the truck', tripKey: null } });
});

it('L-07 says "trip 1 of 2" only when the truck has a second trip, and no count for its only trip', () => {
  expect(tripPanel(BOARD, 'VEH004')).toMatch(/<p class="[^"]*">6\.8 t · 33\.4 m³ · VEH004<\/p>/);
  expect(tripPanel(BOARD, 'VEH004')).not.toContain('of 2');
  const both = boardWith([trip('VEH004', CHAMINDA, 'OUT006', COLOMBO_ORDER), trip('VEH004', CHAMINDA, 'OUT051', GALLE_ORDER, 2)]);
  expect(tripPanel(both, 'VEH004')).toContain('6.8 t · 33.4 m³ · VEH004 · trip 1 of 2');
});

it('L-03 a View plan row for a truck\'s second trip alone says "· trip 2", as its card does', () => {
  const split = boardWith([trip('VEH004', CHAMINDA, 'OUT006', COLOMBO_ORDER), trip('VEH004', CHAMINDA, 'OUT051', GALLE_ORDER, 2)]);
  const row = (trips: DraftTrip[]) => renderToStaticMarkup(<VehicleRow vehicleId="VEH004" trips={trips} driverName="Chaminda" index={indexOf(split)} />);
  expect(row([split.plan.trips[1]!])).toMatch(/<p class="[^"]*">Chaminda · reefer truck · trip 2<span class="font-normal text-muted-foreground"> · VEH004<\/span><\/p>/);
  expect(row([split.plan.trips[0]!])).toMatch(/<p class="[^"]*">Chaminda · reefer truck<span class="font-normal text-muted-foreground"> · VEH004<\/span><\/p>/);
  // Both trips on one row are the truck's whole day.
  expect(row(split.plan.trips)).toMatch(/<p class="[^"]*">Chaminda · reefer truck<span class="font-normal text-muted-foreground"> · VEH004<\/span><\/p>/);
});
