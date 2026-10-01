import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ClockState, LoadingDay, LoadingStop, LoadingTruck } from '@wayfinder/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { clockKey } from '@/lib/clock';
import { FlagPage } from './FlagPage';
import { loadingKey } from './loading';
import { lastLoaded } from './stops';
import { TruckPage } from './TruckPage';
import { undoFirstWords, undoStopWords } from './words';

// The loader's screens as the live QA run found them (phase 3, Q-16 to Q-23). The pages are drawn as the server would
// draw them, from a loading day in the query and the app clock at Thu 25 Jun 02:35. These fixtures live in the test only.

// The tab's own stores (the ticks, a kept refusal, the plan's changes) are read the same way on the server.
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return { ...react, useSyncExternalStore: <T,>(subscribe: (change: () => void) => () => void, snapshot: () => T, serverSnapshot?: () => T) => react.useSyncExternalStore(subscribe, snapshot, serverSnapshot ?? snapshot) };
});

type Line = [lineId: string, quantity: number, temp?: 'chilled' | 'dry'];
interface StopSpec { seq: number; shop: string; lines: Line[]; loaded?: boolean; short?: Record<string, number> }

const TRIP = '0b000000-0000-4000-8000-000000000038';

function stopOf({ seq, shop, lines, loaded = false, short = {} }: StopSpec): LoadingStop {
  const out = lines.map(([lineId, quantity, temp = 'dry']) => {
    const going = quantity - (short[lineId] ?? 0);
    return { lineId, orderId: `order-${lineId}`, temp, productId: `fresh-${temp}-carton`, name: temp === 'chilled' ? 'Chilled carton' : 'Dry carton', unit: 'carton', quantity, going, short: quantity - going };
  });
  const sum = (key: 'quantity' | 'going' | 'short') => out.reduce((total, line) => total + line[key], 0);
  return { id: `stop-${seq}`, seq, outletId: `OUT00${seq}`, shopName: shop, loaded, units: sum('quantity'), going: sum('going'), short: sum('short'), lines: out };
}

// VEH038, the dry van of Q-16: Fresh Wellawatte's 46 and 2 dry cartons on stop 3, Fresh Kotahena's 57 on stop 2 and
// Fresh Nugegoda's 3 on stop 1, 108 in all, listed last stop first. `loaded` names the stops on the truck.
function veh038(loaded: number[], changes: Partial<LoadingTruck> = {}, short: Record<string, number> = {}): LoadingTruck {
  const stops = [
    stopOf({ seq: 3, shop: 'Fresh Wellawatte', lines: [['w-46', 46], ['w-2', 2]], loaded: loaded.includes(3), short }),
    stopOf({ seq: 2, shop: 'Fresh Kotahena', lines: [['k-57', 57]], loaded: loaded.includes(2), short }),
    stopOf({ seq: 1, shop: 'Fresh Nugegoda', lines: [['n-3', 3]], loaded: loaded.includes(1), short }),
  ];
  const on = stops.filter((stop) => stop.loaded).reduce((total, stop) => total + stop.going, 0);
  return {
    tripId: TRIP, revision: 4, vehicleId: 'VEH038', vehicleType: 'van', vehicleTemp: 'ambient', tripNo: 1, brand: 'Fresh', district: 'Colombo',
    status: 'loading', leavesAt: '2026-06-24T23:06:00.000Z', readyAt: null, driver: 'Dilshan', weightCapKg: 1200, volumeCapM3: 9,
    units: 108, on: { units: on, kg: on * 7, m3: on * 0.04 }, short: stops.reduce((total, stop) => total + stop.short, 0), stops, issues: [], ...changes,
  };
}

const dayOf = (...trucks: LoadingTruck[]): LoadingDay => ({
  depot: 'Peliyagoda', demoDay: 1, day: '2026-06-25', plan: { id: '0c000000-0000-4000-8000-000000000001', revision: 3, publishedAt: '2026-06-24T10:36:00.000Z', publishedBy: 'Ruwan' }, trucks,
});

// Thu 25 Jun 02:35 at the depot.
const CLOCK: ClockState = { demo: true, now: '2026-06-24T21:05:00.000Z', part: 'loading', holdsAt: null, next: null, revision: 1, day: 1 };

// A loader page at an address, drawn with the day in the query.
function page(path: string, day: LoadingDay): string {
  const qc = new QueryClient();
  qc.setQueryData(loadingKey, day);
  qc.setQueryData(clockKey, { ...CLOCK, heldAt: 0 });
  const router = createMemoryRouter([
    { path: '/loader/trucks/:tripId', element: <TruckPage /> },
    { path: '/loader/trucks/:tripId/flag', element: <FlagPage /> },
  ], { initialEntries: [path] });
  return renderToStaticMarkup(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
}
const truckPage = (truck: LoadingTruck) => page(`/loader/trucks/${truck.tripId}`, dayOf(truck));

// The labels of the stop rows that open a menu.
const menus = (html: string) => [...html.matchAll(/<button[^>]*aria-haspopup="menu"[^>]*>/g)].map(([tag]) => tag.match(/aria-label="([^"]*)"/)?.[1]);

describe('Q-16 a stop marked loaded by mistake, and a flag on a loaded stop', () => {
  it('can take off only the stop loaded last, the loaded one with the lowest number', () => {
    expect(lastLoaded(veh038([3, 2]))?.seq).toBe(2);
    expect(lastLoaded(veh038([3]))?.seq).toBe(3);
    expect(lastLoaded(veh038([3, 2, 1]))?.seq).toBe(1);
    expect(lastLoaded(veh038([]))).toBeNull();
  });

  it('opens a menu from each loaded stop while the truck loads, and from no stop still to load', () => {
    expect(menus(truckPage(veh038([3, 2])))).toEqual(['More for stop 3, Fresh Wellawatte', 'More for stop 2, Fresh Kotahena']);
    expect(menus(truckPage(veh038([3, 2, 1])))).toEqual(['More for stop 3, Fresh Wellawatte', 'More for stop 2, Fresh Kotahena', 'More for stop 1, Fresh Nugegoda']);
    expect(menus(truckPage(veh038([])))).toEqual([]);
  });

  it('opens no menu before the truck is started', () => {
    expect(menus(truckPage(veh038([], { status: 'planned' })))).toEqual([]);
  });

  it('names the undo after the stop button, and the stop to undo first on an earlier one', () => {
    expect(undoStopWords({ seq: 3 })).toBe('Undo stop 3 loaded');
    expect(undoFirstWords({ seq: 2 })).toBe('undo stop 2 first');
  });

  it('opens the flag form on a loaded stop, with its lines', () => {
    const html = page(`/loader/trucks/${TRIP}/flag?stop=stop-3`, dayOf(veh038([3, 2])));
    expect(html).toContain('Stop 3 · Fresh Wellawatte');
    expect(html).toContain('46 cartons dry');
    expect(html).toContain('Send to dispatcher');
  });
});
