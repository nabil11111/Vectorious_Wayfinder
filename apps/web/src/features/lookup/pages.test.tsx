import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LookupFleet, LookupHistory, LookupOrders } from '@wayfinder/contracts';
import { expect, it, vi } from 'vitest';
import { FleetPage } from './FleetPage';
import { HistoryPage } from './HistoryPage';
import { OrdersPage } from './OrdersPage';
import { lookupKey } from './queries';
import { NOT_A_DATE } from './words';

// The three pages as they first draw from what the query cache already holds (spec 017, rule 12; AC-29 and AC-34). A
// read answered for another reset than the clock shows is never drawn, so none of its rows can be chosen; a date in the
// address that is not a calendar date shows that sentence and nothing a cached read holds. The account, the app clock
// and the online state are stubbed; the rest is the pages as built.

const held = vi.hoisted(() => ({
  me: { id: 'dispatcher-ruwan', username: 'ruwan', staffId: 'P-001', displayName: 'Ruwan', role: 'dispatcher' as const, depotId: 'Peliyagoda', outletId: null },
  clockDay: 1,
}));
vi.mock('@/features/auth/api', () => ({ useMe: () => ({ data: held.me }) }));
vi.mock('@/lib/clock', async (original) => ({
  ...await original<typeof import('@/lib/clock')>(),
  useAppClock: () => ({ state: { day: held.clockDay }, at: Date.parse('2026-06-24T22:00:00.000Z'), time: '03:30', waiting: false, failed: false, retry: () => {} }),
}));
vi.mock('@/features/live/operations', async (original) => ({ ...await original<typeof import('@/features/live/operations')>(), useOnline: () => true }));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const THU = '2026-06-25';
const at = (hhmm: string) => new Date(`2026-06-25T${hhmm}:00+05:30`).toISOString();
const scope = (demoDay: number) => ({ depot: { id: 'Peliyagoda', name: 'Peliyagoda' }, readAt: '2026-06-24T22:00:00.000Z', demoDay });
const nugegoda = { id: 'OUT001', name: 'Fresh Nugegoda', brand: 'Fresh' as const, district: 'Colombo', windowOpen: '05:00:00', windowClose: '07:30:00', mallWindow: null };
const sent = { id: id(900), date: THU, revision: 1, publishedAt: '2026-06-24T11:00:00.000Z' };
const load = { kg: 55, m3: 0.3, units: 8, needsReefer: true, needsTailLift: false, keepUpright: false };

const ordersRead = (demoDay: number) => LookupOrders.parse({
  ...scope(demoDay), date: THU, from: THU, range: 'day', summary: { orders: 1, planned: 1, deferred: 0, carriedOver: 0, split: 0 },
  rows: [{
    id: id(1), wantedDate: THU, placedAt: '2026-06-24T03:00:00.000Z', temp: 'chilled', status: 'loaded', note: null, load,
    lines: [{ lineId: id(2), productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', quantity: 8 }],
    outlet: nugegoda, splitFrom: null, original: null, parts: [], deferralHistory: [], timesDeferred: 0,
    days: [{ date: THU, carriedOver: false, publication: sent, deferral: null,
      assignment: { tripId: id(800), vehicleId: 'VEH035', tripNo: 1, stopId: id(700), seq: 1, plannedArrival: at('05:00') } }],
  }],
  skippedLately: { from: '2026-05-29', to: THU, rows: [{ outlet: { id: 'OUT060', name: 'Fresh Dickwella', brand: 'Fresh' }, count: 2, latestDate: '2026-06-24',
    reasons: [{ code: 'no_reefer', reason: 'No fridge truck was left for Matara.' }] }] },
});

const known = (units: number) => ({ units, known: 1, total: 1 });
const stages = { ordered: 8, loaded: known(8), handedOver: known(8), received: known(8), depotShort: known(0), refused: known(0), receiptShort: known(0), notDelivered: known(0) };
const historyRead = (demoDay: number) => LookupHistory.parse({
  ...scope(demoDay), date: THU, publishedDates: [THU, '2026-06-24'], publication: sent,
  counts: { trips: 1, stops: 1, orders: 1, delivered: 1, finished: 1, partial: 0, late: 0, short: 0, returned: 0, deferred: 0, confirmations: 1, receivedOrders: 1, stages },
  groups: [{ brand: 'Fresh', district: 'Colombo', tripIds: [id(800)] }],
  trips: [{
    tripId: id(800), planId: id(900), date: THU, vehicleId: 'VEH035', vehicleType: 'van', vehicleTemp: 'reefer', archived: false, tripNo: 1,
    driver: { id: id(5), name: 'Dilshan' }, brand: 'Fresh', brands: ['Fresh'], district: 'Colombo', status: 'done',
    schedule: { leavesAt: at('04:36'), backAt: at('06:10'), load, km: 28 }, readyAt: at('02:35'), leftAt: at('04:40'), backAt: at('06:30'),
    flags: { late: false, short: false, returned: false }, stages,
    stops: [{
      id: id(700), seq: 1, outlet: nugegoda, orderIds: [id(1)], plannedArrival: at('05:00'), plannedDeparture: at('05:12'), windowOpen: at('05:00'),
      windowClose: at('07:30'), loadedAt: at('02:31'), arrivedAt: at('05:02'), doneAt: at('05:10'), outcome: 'delivered', stages,
      lines: [{ lineId: id(2), orderId: id(1), temp: 'chilled', productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', quantity: 8,
        loaded: 8, delivered: 8, received: 8, depotShort: 0, refused: 0, receiptShort: 0, notDelivered: 0 }],
      flags: { late: false, short: false, returned: false }, proof: null, problems: [], attempts: [],
      receipt: { stopId: id(700), confirmedAt: at('08:31'), sentAt: at('08:33'), cold: true, orderCount: 1, lines: [{ lineId: id(2), orderId: id(1), received: 8 }],
        received: 8, short: 0, report: null },
    }],
  }],
  deferrals: [],
});

const fleetRead = (demoDay: number) => LookupFleet.parse({
  ...scope(demoDay), today: THU,
  summary: { active: 1, reefers: 1, vans: 1, recordedOut: 0, notRecordedOut: 1, activeOffToday: 0, activeWithoutOffToday: 1, fuel: null },
  vehicles: [{ id: 'VEH035', type: 'van', temp: 'reefer', group: 'vans', weightCapKg: 1040, volumeCapM3: 7, fuelType: 'diesel', kmPerL: 10.3,
    weeklyFuelQuotaL: 480, archivedAt: null, offReason: null, recordedOut: false, selectedTrip: null, outTrips: [], todayTrips: [], recentTrips: [], fuel: null }],
});

// A page drawn once at an address, from the reads the cache holds: its markup and its text.
function draw(page: ReactNode, path: string, cached: [readonly unknown[], unknown][]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const [key, read] of cached) client.setQueryData(key, read);
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>{page}</MemoryRouter></QueryClientProvider>);
  client.clear();
  return { html, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') };
}
const ordersDay = lookupKey('orders', held.me, 'Peliyagoda', { range: 'day' });

it('AC-34 a date that is not a calendar date shows nothing a cached read holds', () => {
  held.clockDay = 1;
  const orders = draw(<OrdersPage />, '/dispatcher/orders?date=2026-02-31', [[ordersDay, ordersRead(1)]]);
  expect(orders.text).toContain(NOT_A_DATE);
  for (const cached of ['Thu 25 Jun', 'Fresh Nugegoda', 'Skipped lately', 'Fresh Dickwella', 'Live · updated']) expect(orders.text).not.toContain(cached);
  expect(orders.html).not.toContain('2026-06-25');
  const history = draw(<HistoryPage />, `/dispatcher/history?date=2026-02-31&trip=${id(800)}`, [[lookupKey('history', held.me, 'Peliyagoda', {}), historyRead(1)]]);
  expect(history.text).toContain(NOT_A_DATE);
  for (const cached of ['Thu 25 Jun', 'Wed 24 Jun', 'VEH035', 'Shop confirmation', 'Live · updated']) expect(history.text).not.toContain(cached);
  expect(history.html).not.toContain('2026-06-25');
});

it('AC-29 records read before a reset the clock already shows are never drawn, so none can be chosen', () => {
  const history = lookupKey('history', held.me, 'Peliyagoda', { date: THU });
  const fleet = lookupKey('fleet', held.me, 'Peliyagoda', {});
  // The same reads drawn while the clock is on their reset: the rows, the confirmation and the vehicle are there.
  held.clockDay = 1;
  expect(draw(<OrdersPage />, '/dispatcher/orders', [[ordersDay, ordersRead(1)]]).text).toContain('Fresh Nugegoda');
  expect(draw(<HistoryPage />, `/dispatcher/history?date=${THU}&trip=${id(800)}`, [[history, historyRead(1)]]).text).toContain('Shop confirmation · Fresh Nugegoda');
  expect(draw(<FleetPage />, '/dispatcher/fleet', [[fleet, fleetRead(1)]]).text).toContain('VEH035');
  // The demo day was reset: the clock is on generation 2 and every read held is of generation 1. Each page waits for
  // its new read instead, with no row to choose and no detail open.
  held.clockDay = 2;
  const orders = draw(<OrdersPage />, '/dispatcher/orders', [[ordersDay, ordersRead(1)]]);
  expect(orders.html).toContain('aria-label="Loading the orders"');
  for (const old of ['Fresh Nugegoda', 'Fresh Dickwella', 'Orders for Thu 25 Jun', 'Live · updated']) expect(orders.text).not.toContain(old);
  const sentPlan = draw(<HistoryPage />, `/dispatcher/history?date=${THU}&trip=${id(800)}`, [[history, historyRead(1)]]);
  expect(sentPlan.html).toContain('aria-label="Loading the sent plan"');
  for (const old of ['VEH035', 'Shop confirmation', 'Live · updated']) expect(sentPlan.text).not.toContain(old);
  const vehicles = draw(<FleetPage />, '/dispatcher/fleet', [[fleet, fleetRead(1)]]);
  expect(vehicles.html).toContain('aria-label="Loading the fleet"');
  for (const old of ['VEH035', 'Fleet · Peliyagoda', 'Live · updated']) expect(vehicles.text).not.toContain(old);
  held.clockDay = 1;
});
