import { renderToStaticMarkup } from 'react-dom/server';
import { PlanBoard, type DraftTrip } from '@wayfinder/contracts';
import { expect, it, vi } from 'vitest';
import type { BoardScreen } from '../board';
import { planOf } from '../draft';
import { DoneList } from './DoneList';
import { indexOf } from './lookup';

// Spec 022's stop lists, drawn as the page draws them: Done's card opening to its stops with one chevron for both
// states. The board is made up: VEH004 leaves Peliyagoda at 03:30 for two Colombo shops and is back at 05:24, and
// VEH002's trip has no times from the checker.

vi.mock('sonner', () => ({ toast: vi.fn() }));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [FORT, WELLAWATTE, GALLE] = [uuid(11), uuid(12), uuid(13)] as [string, string, string];

const shop = (id: string, name: string, district: string) => ({
  id, name, brand: 'Fresh', district, dockType: 'street', parking: 'normal', windowOpen: 180, windowClose: 480, mallOpen: null, mallClose: null, unloadMin: 15,
});
const load = { kg: 82.8, m3: 0.444, units: 12, needsReefer: true, needsTailLift: false, keepUpright: false };
const order = (id: string, outletId: string) => ({
  id, outletId, temp: 'chilled', deliveryDate: '2026-06-25', lines: [{ productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', quantity: 12 }],
  load, carriedOver: false, timesDeferred: 0, lastDeferral: null, splitFrom: null, originalUnits: null,
});
const stopTime = (seq: number, outletId: string, arriveAt: number) => ({ seq, outletId, arriveAt, waitMin: 0, startAt: arriveAt, leaveAt: arriveAt + 15, windowOpen: 180, windowClose: 480, late: false, lateMin: 0 });
const TRIPS: DraftTrip[] = [
  { vehicleId: 'VEH004', tripNo: 1, leaveAt: null, driverId: null, stops: [{ outletId: 'OUT006', orderIds: [FORT] }, { outletId: 'OUT004', orderIds: [WELLAWATTE] }] },
  { vehicleId: 'VEH002', tripNo: 1, leaveAt: null, driverId: null, stops: [{ outletId: 'OUT051', orderIds: [GALLE] }] },
];
const BOARD = PlanBoard.parse({
  depot: 'Peliyagoda', demoDay: 1, day: { date: '2026-06-25', cutoffAt: '2026-06-24T10:30:00.000Z', open: true },
  plan: { mixBrands: false, trips: TRIPS, deferrals: [], id: uuid(100), revision: 3, status: 'draft', savedAt: '2026-06-24T10:31:00.000Z', sentAt: null, canUnsend: false },
  dropped: [],
  check: {
    ok: true, problems: [], vehicles: [],
    trips: [
      { vehicleId: 'VEH004', tripNo: 1, load, times: { district: 'Colombo', leaveAt: 210, stops: [stopTime(1, 'OUT006', 247), stopTime(2, 'OUT004', 271)], lastDoneAt: 286, backAt: 324, readyAgainAt: 354, tripMin: 101, km: 63, litres: 14.3 } },
      { vehicleId: 'VEH002', tripNo: 1, load, times: null },
    ],
  },
  orders: [order(FORT, 'OUT006'), order(WELLAWATTE, 'OUT004'), order(GALLE, 'OUT051')],
  shops: [shop('OUT006', 'Fresh Colombo Fort', 'Colombo'), shop('OUT004', 'Fresh Wellawatte', 'Colombo'), shop('OUT051', 'Fresh Galle Fort', 'Galle')],
  vehicles: [{ id: 'VEH004', type: 'truck', temp: 'reefer', weightCapKg: 6800, volumeCapM3: 33.4, working: true, offReason: null, litresLeft: 300, fuelLeftPct: 80 }],
  drivers: [], figures: null, counts: null, suggestion: null,
});
const INDEX = indexOf(BOARD);
const SCREEN: BoardScreen = { board: BOARD, draft: planOf(BOARD), saving: 'saved', refused: null, acting: false, undo: null };

it('spec 022 Done\'s card draws one chevron for both states, at one size, turned while the card is open', () => {
  const markup = renderToStaticMarkup(<DoneList screen={SCREEN} index={INDEX} openKey={null} onOpen={() => undefined} />);
  const toggles = [...markup.matchAll(/<button type="button" aria-expanded="false"[^>]*>(.*?)<\/button>/g)].map(([button, inside]) => [button.match(/class="(group [^"]*)"/)?.[1] !== undefined, inside]);
  expect(toggles).toHaveLength(2);
  for (const [grouped, inside] of toggles) {
    expect(grouped).toBe(true);
    expect(inside).toMatch(/^<svg [^>]*class="lucide lucide-chevron-down size-3\.5 transition-transform group-aria-expanded:rotate-180"[^>]*>/);
  }
  expect(markup).not.toMatch(/[⌄⌃]/);
});
