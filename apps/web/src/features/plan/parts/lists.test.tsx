import { renderToStaticMarkup } from 'react-dom/server';
import { PlanBoard, type DraftTrip } from '@wayfinder/contracts';
import { expect, it, vi } from 'vitest';
import type { BoardScreen } from '../board';
import { planOf } from '../draft';
import { CardStops, DoneList } from './DoneList';
import { indexOf } from './lookup';
import { TripPanel } from './TripPanel';
import { VehicleRow } from './VehicleRow';

// Spec 022's stop lists, drawn as the page draws them: Done's card opening to its stops with one chevron for both
// states, and the depot at both ends of a trip's stops, in the card and in the middle's "Stops in order", from the
// checker's leaving and return times. The board is made up: VEH004 leaves Peliyagoda at 03:30 for two Colombo shops
// and is back at 05:24, and VEH002's trip has no times from the checker.

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
const tripOf = (vehicleId: string) => BOARD.plan.trips.find((t) => t.vehicleId === vehicleId)!;

// The text of each row a list draws: the depot's rows and each stop.
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const rowsOf = (html: string) => [...html.matchAll(/<(?:div data-depot="(?:start|end)"|li\b)[^>]*>(.*?)<\/(?:div|li)>/g)].map(([, inside]) => textOf(inside!));

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

it('spec 022 Done\'s opened card puts the depot before stop 1 and the return after the last stop', () => {
  const times = INDEX.trip('VEH004', 1)!.times;
  expect(rowsOf(renderToStaticMarkup(<CardStops trip={tripOf('VEH004')} times={times} depot="Peliyagoda" index={INDEX} />))).toEqual([
    '0 Peliyagoda · leaves 03:30',
    '1 04:07 Fresh Colombo Fort 03:00 to 08:00',
    '2 04:31 Fresh Wellawatte 03:00 to 08:00',
    'Peliyagoda · back 05:24',
  ]);
  // A trip with no times from the checker shows neither.
  expect(rowsOf(renderToStaticMarkup(<CardStops trip={tripOf('VEH002')} times={null} depot="Peliyagoda" index={INDEX} />))).toEqual(['1 --:-- Fresh Galle Fort 03:00 to 08:00']);
});

it('spec 022 "Stops in order" puts the depot before stop 1 and the return after the last stop, as quiet rows', () => {
  const panel = (vehicleId: string) => renderToStaticMarkup(
    <TripPanel
      screen={SCREEN} index={INDEX} trip={tripOf(vehicleId)} group={null}
      change={() => undefined} act={async () => null} onCrew={() => undefined} onRemoved={() => undefined} onDone={() => undefined} onAddStop={() => undefined} onJoin={() => undefined}
    />,
  );
  const stops = (markup: string) => markup.slice(markup.indexOf('Stops in order'), markup.indexOf('Add a stop'));
  const veh004 = stops(panel('VEH004'));
  const rows = rowsOf(veh004);
  expect(rows[0]).toBe('0 Peliyagoda · leaves 03:30');
  expect(rows.slice(1, 3).map((row) => row.split(' ').slice(0, 2).join(' '))).toEqual(['1 04:07', '2 04:31']);
  expect(rows.at(-1)).toBe('Peliyagoda · back 05:24');
  expect(rows).toHaveLength(4);
  // Quiet rows, not stops: the list of stops holds only the stops.
  expect(veh004).toMatch(/<div data-depot="start" class="[^"]*text-muted-foreground[^"]*">/);
  expect(veh004.match(/<ol\b[^>]*>(.*)<\/ol>/)![1]).not.toContain('data-depot');
  // VEH002's trip has no times yet, so neither row.
  expect(rowsOf(stops(panel('VEH002'))).filter((row) => row.includes('Peliyagoda'))).toEqual([]);
});

it('spec 023 View plan\'s vehicle row draws the same single chevron, turned while its stops are open', () => {
  const markup = renderToStaticMarkup(<VehicleRow vehicleId="VEH004" trips={[tripOf('VEH004')]} driverName="Lasantha" index={INDEX} />);
  const [button, inside] = markup.match(/<button type="button" aria-expanded="false"[^>]*>(.*?)<\/button>/)!;
  expect(button).toMatch(/class="group [^"]*"/);
  expect(inside).toMatch(/^<svg [^>]*class="lucide lucide-chevron-down size-3\.5 transition-transform group-aria-expanded:rotate-180"[^>]*>/);
  expect(markup).not.toMatch(/[⌄⌃]/);
});
