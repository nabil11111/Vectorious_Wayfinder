import { renderToStaticMarkup } from 'react-dom/server';
import { PlanBoard, type DraftTrip } from '@wayfinder/contracts';
import { expect, it, vi } from 'vitest';
import type { BoardScreen } from '../board';
import { planOf } from '../draft';
import { DoneList } from './DoneList';
import { indexOf } from './lookup';
import { TripPanel } from './TripPanel';

// Spec 022's drivers on the plan board, drawn as the page draws them: Done's cards and the open trip's header name the
// driver after the vehicle, or say "no driver" in the warning colour (AC-4). The board is made up: VEH004 with
// Chaminda to a Colombo shop, and VEH002 with nobody to a Galle shop.

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
  plan: { mixBrands: false, trips, deferrals: [], id: uuid(100), revision: 3, status: 'draft', savedAt: '2026-06-24T10:31:00.000Z', sentAt: null, canUnsend: false },
  dropped: [], check: null, orders: [order(COLOMBO_ORDER, 'OUT006'), order(GALLE_ORDER, 'OUT051')],
  shops: [shop('OUT006', 'Fresh Colombo Fort', 'Colombo'), shop('OUT051', 'Fresh Galle Fort', 'Galle')],
  vehicles: [vehicle('VEH004'), vehicle('VEH002'), vehicle('VEH035', 'van')],
  drivers: [{ id: CHAMINDA, name: 'Chaminda' }, { id: DILSHAN, name: 'Dilshan' }, { id: SANJEEWA, name: 'Sanjeewa' }],
  figures: null, counts: null, suggestion: null,
});
const BOARD = boardWith([trip('VEH004', CHAMINDA, 'OUT006', COLOMBO_ORDER), trip('VEH002', null, 'OUT051', GALLE_ORDER)]);
const screenOf = (board: PlanBoard): BoardScreen => ({ board, draft: planOf(board), saving: 'saved', refused: null, acting: false, undo: null });

const doneList = (board: PlanBoard) => renderToStaticMarkup(<DoneList screen={screenOf(board)} index={indexOf(board)} openKey={null} onOpen={() => undefined} />);
const tripPanel = (board: PlanBoard, vehicleId: string) => renderToStaticMarkup(
  <TripPanel
    screen={screenOf(board)} index={indexOf(board)} trip={board.plan.trips.find((t) => t.vehicleId === vehicleId)!} group={null}
    change={() => undefined} act={async () => null} onSwap={() => undefined} onRemoved={() => undefined} onDone={() => undefined} onAddStop={() => undefined} onJoin={() => undefined}
  />,
);

it('AC-4 Done\'s cards name the driver after the vehicle, as the frame does: "VEH004 · Chaminda · Fresh · Colombo"', () => {
  expect(doneList(BOARD)).toContain('<span class="block">VEH004 · Chaminda ·</span><span class="block">Fresh · Colombo</span>');
});

it('AC-4 a trip with no driver reads "VEH002 · no driver" on its card, in the warning colour', () => {
  const markup = doneList(BOARD);
  expect(markup).toContain('<span class="block">VEH002 · <span class="text-warn-ink">no driver</span> ·</span><span class="block">Fresh · Galle</span>');
  // The button that opens a card's stops says whose they are.
  expect(markup).toContain('aria-label="Show the stops of VEH002 · no driver · Fresh · Galle"');
  expect(markup).toContain('aria-label="Show the stops of VEH004 · Chaminda · Fresh · Colombo"');
});

it('AC-4 the open trip\'s header names its driver after the vehicle the same way', () => {
  expect(tripPanel(BOARD, 'VEH004')).toMatch(/<h2 class="[^"]*">Planning · VEH004 · <button[^>]*>Chaminda<\/button><\/h2>/);
  expect(tripPanel(BOARD, 'VEH002')).toMatch(/<h2 class="[^"]*">Planning · VEH002 · <button[^>]*class="[^"]*text-warn-ink[^"]*"[^>]*>no driver<\/button><\/h2>/);
});
