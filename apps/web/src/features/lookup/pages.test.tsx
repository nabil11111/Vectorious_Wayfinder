import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LookupFleet, LookupHistory, LookupOrders } from '@wayfinder/contracts';
import { expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api';
import { FleetPage } from './FleetPage';
import { HistoryPage } from './HistoryPage';
import { OrderDetail } from './OrderDetail';
import { OrdersPage } from './OrdersPage';
import { lookupKey } from './queries';
import { NOT_A_DATE, NO_SENT_PLANS_YET, TRIP_NOT_ON_PLAN } from './words';

// The three pages as they first draw from what the query cache already holds (spec 017, rule 12; AC-29 and AC-34). A
// read answered for another reset than the clock shows is never drawn, so none of its rows can be chosen; a date in the
// address that is not a calendar date shows that sentence and nothing a cached read holds. The account, the app clock
// and the online state are stubbed; the rest is the pages as built.

const held = vi.hoisted(() => ({
  me: { id: 'dispatcher-ruwan', username: 'ruwan', staffId: 'P-001', displayName: 'Ruwan', role: 'dispatcher' as const, depotId: 'Peliyagoda' as string, outletId: null },
  clockDay: 1,
}));
vi.mock('@/features/auth/api', () => ({ useMe: () => ({ data: held.me }) }));
vi.mock('@/lib/clock', async (original) => ({
  ...await original<typeof import('@/lib/clock')>(),
  useAppClock: () => ({ state: { day: held.clockDay }, at: Date.parse('2026-06-24T22:00:00.000Z'), time: '03:30', waiting: false, failed: false, retry: () => {} }),
}));
vi.mock('@/features/live/operations', async (original) => ({ ...await original<typeof import('@/features/live/operations')>(), useOnline: () => true }));
// A server render has no portal target. Include portal content so reset/depot isolation assertions
// keep checking the real selected detail, now presented as a dialog.
vi.mock('@base-ui/react/dialog', async () => {
  const react = await import('react');
  const Open = react.createContext(false);
  return { Dialog: {
    Root: ({ open, children }: { open: boolean; children: ReactNode }) => <Open.Provider value={open}>{children}</Open.Provider>,
    Portal: ({ children }: { children: ReactNode }) => react.useContext(Open) ? children : null,
    Backdrop: () => null,
    Popup: ({ children, 'aria-label': label }: { children: ReactNode; 'aria-label': string }) => <div role="dialog" aria-label={label}>{children}</div>,
  } };
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const THU = '2026-06-25';
const at = (hhmm: string) => new Date(`2026-06-25T${hhmm}:00+05:30`).toISOString();
// Each depot's records differ: Kandy's shop, truck, driver and ids are its own.
type Depot = 'Peliyagoda' | 'Kandy';
const scope = (demoDay: number, depot: Depot = 'Peliyagoda') => ({ depot: { id: depot, name: depot }, readAt: '2026-06-24T22:00:00.000Z', demoDay });
const nugegoda = { id: 'OUT001', name: 'Fresh Nugegoda', brand: 'Fresh' as const, district: 'Colombo', windowOpen: '05:00:00', windowClose: '07:30:00', mallWindow: null };
const peradeniya = { ...nugegoda, id: 'OUT076', name: 'Fresh Peradeniya', district: 'Kandy' };
const OWN = {
  Peliyagoda: { shop: nugegoda, vehicle: 'VEH035', driver: 'Dilshan', base: 0 },
  Kandy: { shop: peradeniya, vehicle: 'VEH045', driver: 'Sunil', base: 1000 },
} as const;
const sent = { id: id(900), date: THU, revision: 1, publishedAt: '2026-06-24T11:00:00.000Z' };
const load = { kg: 55, m3: 0.3, units: 8, needsReefer: true, needsTailLift: false, keepUpright: false };

// Peliyagoda's order is on a truck; Kandy's was carried over and deferred on its sent plan.
const ordersRead = (demoDay: number, depot: Depot = 'Peliyagoda') => {
  const { shop, vehicle, base } = OWN[depot];
  const kandy = depot === 'Kandy';
  return LookupOrders.parse({
    ...scope(demoDay, depot), date: THU, from: THU, range: 'day',
    summary: kandy ? { orders: 1, planned: 0, deferred: 1, carriedOver: 1, split: 0 } : { orders: 1, planned: 1, deferred: 0, carriedOver: 0, split: 0 },
    rows: [{
      id: id(base + 1), wantedDate: THU, placedAt: '2026-06-24T03:00:00.000Z', temp: 'chilled', status: kandy ? 'deferred' : 'loaded', note: null, load,
      lines: [{ lineId: id(base + 2), productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', quantity: 8 }],
      outlet: shop, splitFrom: null, broughtBack: false, deferredEarlier: false, original: null, parts: [], deferralHistory: [], timesDeferred: kandy ? 1 : 0,
      days: [kandy
        ? { date: THU, carriedOver: true, publication: { ...sent, id: id(base + 900) }, deferral: { code: 'no_reefer', reason: 'No fridge truck was left for Kandy.' }, assignment: null }
        : { date: THU, carriedOver: false, publication: sent, deferral: null,
          assignment: { tripId: id(base + 800), vehicleId: vehicle, tripNo: 1, stopId: id(base + 700), seq: 1, plannedArrival: at('05:00'), closed: [] } }],
    }],
    skippedLately: { from: '2026-05-29', to: THU, rows: kandy ? [] : [{ outlet: { id: 'OUT060', name: 'Fresh Dickwella', brand: 'Fresh' }, count: 2, latestDate: '2026-06-24',
      reasons: [{ code: 'no_reefer', reason: 'No fridge truck was left for Matara.' }] }] },
  });
};

const known = (units: number) => ({ units, known: 1, total: 1, missing: 0, soFar: units });
const stages = { ordered: 8, loaded: known(8), handedOver: known(8), received: known(8), depotShort: known(0), wontFit: known(0), refused: known(0), receiptShort: known(0), notDelivered: known(0) };
const historyRead = (demoDay: number, depot: Depot = 'Peliyagoda') => {
  const { shop, vehicle, driver, base } = OWN[depot];
  return LookupHistory.parse({
    ...scope(demoDay, depot), date: THU, publishedDates: [THU, '2026-06-24'], publication: { ...sent, id: id(base + 900) },
    counts: { trips: 1, stops: 1, orders: 1, delivered: 1, finished: 1, partial: 0, noGoods: 0, closed: 0, late: 0, short: 0, returned: 0, deferred: 0, confirmations: 1, receivedOrders: 1, stages },
    groups: [{ brand: 'Fresh', district: shop.district, tripIds: [id(base + 800)] }],
    trips: [{
      tripId: id(base + 800), planId: id(base + 900), date: THU, vehicleId: vehicle, vehicleType: 'van', vehicleTemp: 'reefer', archived: false, tripNo: 1,
      driver: { id: id(base + 5), name: driver }, brand: 'Fresh', brands: ['Fresh'], district: shop.district, status: 'done',
      schedule: { leavesAt: at('04:36'), backAt: at('06:10'), load, km: 28 }, readyAt: at('02:35'), leftAt: at('04:40'), backAt: at('06:30'),
      flags: { late: false, short: false, returned: false }, stages,
      stops: [{
        id: id(base + 700), seq: 1, outlet: shop, orderIds: [id(base + 1)], plannedArrival: at('05:00'), plannedDeparture: at('05:12'), windowOpen: at('05:00'),
        windowClose: at('07:30'), loadedAt: at('02:31'), arrivedAt: at('05:02'), doneAt: at('05:10'), outcome: 'delivered', stages,
        lines: [{ lineId: id(base + 2), orderId: id(base + 1), temp: 'chilled', productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', quantity: 8,
          loaded: 8, delivered: 8, received: 8, depotShort: 0, refused: 0, receiptShort: 0, notDelivered: 0 }],
        flags: { late: false, short: false, returned: false }, proof: null, problems: [], attempts: [],
        receipt: { stopId: id(base + 700), confirmedAt: at('08:31'), sentAt: at('08:33'), cold: true, orderCount: 1, lines: [{ lineId: id(base + 2), orderId: id(base + 1), received: 8 }],
          received: 8, short: 0, report: null },
      }],
    }],
    deferrals: [],
  });
};

// A week's ledger for the fleet's quota: Peliyagoda's 6,945 of 18,600 L used, Kandy's none of 10,660 L.
const fuelOf = (used: number, quota: number) => ({ isoYear: 2026, isoWeek: 26, recordedCommitted: used, quota, remaining: quota - used,
  recordedCommittedPct: Math.round((100 * used) / quota), remainingPct: Math.round((100 * (quota - used)) / quota), sentTrips: 0, plannedKm: 0, days: [] });
const fleetRead = (demoDay: number, depot: Depot = 'Peliyagoda', fuel: ReturnType<typeof fuelOf> | null = null) => LookupFleet.parse({
  ...scope(demoDay, depot), today: THU,
  summary: { active: 1, reefers: 1, vans: depot === 'Kandy' ? 0 : 1, recordedOut: 0, notRecordedOut: 1, activeOffToday: 0, activeWithoutOffToday: 1, fuel },
  vehicles: [{ id: OWN[depot].vehicle, type: depot === 'Kandy' ? 'truck' : 'van', temp: 'reefer', group: depot === 'Kandy' ? 'reefer_trucks' : 'vans', weightCapKg: 1040,
    volumeCapM3: 7, fuelType: 'diesel', kmPerL: 10.3, weeklyFuelQuotaL: 480, archivedAt: null, offReason: null, recordedOut: false, notRecordedOut: false, selectedTrip: null,
    outTrips: [], todayTrips: [], recentTrips: [], fuel: null }],
});

const textOfMarkup = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
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

// ── Both depots together (spec 021) ─────────────────────────────────────────────────────────────────────────────

const ON_BOTH = { ...held.me, depotId: 'Both' };
const failure = () => Promise.reject(new ApiRequestError(500, 'server_error', 'Something went wrong on our side.'));
// A page drawn on both depots, from the reads the cache holds and the ones that failed.
async function drawBoth(page: ReactNode, path: string, cached: [readonly unknown[], unknown][], failed: readonly (readonly unknown[])[] = []) {
  const me = held.me;
  held.me = ON_BOTH;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  for (const [key, read] of cached) client.setQueryData(key, read);
  for (const key of failed) await client.prefetchQuery({ queryKey: key, queryFn: failure });
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>{page}</MemoryRouter></QueryClientProvider>);
  client.clear();
  held.me = me;
  return html;
}
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/\s+/g, ' ').trim();
// Each depot's part, in the page's order: the depot its heading names, and its text.
const partsOf = (html: string) => html.split('<section aria-labelledby="part-').slice(1).map((part) => ({ depot: part.slice(0, part.indexOf('"')), text: textOf(part.slice(part.indexOf('>') + 1)) }));
// The page's header and its figures: everything before the first part.
const headerOf = (html: string) => textOf(html.slice(0, html.indexOf('<section aria-labelledby="part-')));
const both = (page: 'orders' | 'history' | 'fleet', params: object) => (['Peliyagoda', 'Kandy'] as const).map((depot) => lookupKey(page, ON_BOTH, depot, params));

it('AC-6 Orders on both depots shows Peliyagoda\'s part then Kandy\'s, and the header adds their figures up', async () => {
  const [peliyagoda, kandy] = both('orders', { range: 'day' });
  const html = await drawBoth(<OrdersPage />, '/dispatcher/orders', [[peliyagoda!, ordersRead(1)], [kandy!, ordersRead(1, 'Kandy')]]);
  const parts = partsOf(html);
  expect(parts.map((part) => part.depot)).toEqual(['Peliyagoda', 'Kandy']);
  expect(parts[0]!.text).toMatch(/^Peliyagoda Live · updated 03:30 /);
  expect(parts[0]!.text).toContain('Fresh Nugegoda');
  expect(parts[0]!.text).not.toContain('Fresh Peradeniya');
  expect(parts[1]!.text).toContain('Fresh Peradeniya');
  expect(parts[1]!.text).not.toContain('Fresh Nugegoda');
  expect(headerOf(html)).toContain('Orders for Thu 25 Jun');
  expect(headerOf(html)).toContain('2 orders 1 planned 1 deferred 1 carried over from earlier days 0 split parts');
});

it('AC-6 History on both depots finds the trip in the part that holds it, adds the figures up, and says a trip neither holds', async () => {
  const [peliyagoda, kandy] = both('history', { date: THU });
  const reads: [readonly unknown[], unknown][] = [[peliyagoda!, historyRead(1)], [kandy!, historyRead(1, 'Kandy')]];
  const html = await drawBoth(<HistoryPage />, `/dispatcher/history?date=${THU}&trip=${id(1800)}`, reads);
  const [atPeliyagoda, atKandy] = partsOf(html);
  expect([atPeliyagoda!.depot, atKandy!.depot]).toEqual(['Peliyagoda', 'Kandy']);
  // Kandy's trip is open in Kandy's part; Peliyagoda's part asks for a trip.
  expect(atKandy!.text).toContain('Close VEH045 · Sunil');
  expect(atPeliyagoda!.text).not.toContain('Close VEH035');
  expect(textOf(html)).not.toContain(TRIP_NOT_ON_PLAN);
  expect(headerOf(html)).toContain('History · Thu 25 Jun');
  expect(headerOf(html)).toContain('2 trips 2 / 2 stops delivered 2 orders on trips');
  expect(headerOf(html)).toContain('2 shop confirmations');
  // A trip neither depot's sent plan holds is said once.
  const gone = await drawBoth(<HistoryPage />, `/dispatcher/history?date=${THU}&trip=${id(4242)}`, reads);
  expect(textOf(gone).split(TRIP_NOT_ON_PLAN)).toHaveLength(2);
});

it('AC-6 Fleet on both depots shows each depot\'s vehicles under its name, and the header adds the fleets up', async () => {
  const [peliyagoda, kandy] = both('fleet', {});
  const html = await drawBoth(<FleetPage />, '/dispatcher/fleet', [[peliyagoda!, fleetRead(1, 'Peliyagoda', fuelOf(6945, 18600))], [kandy!, fleetRead(1, 'Kandy', fuelOf(0, 10660))]]);
  const [atPeliyagoda, atKandy] = partsOf(html);
  expect([atPeliyagoda!.depot, atKandy!.depot]).toEqual(['Peliyagoda', 'Kandy']);
  expect(atPeliyagoda!.text).toContain('VEH035');
  expect(atPeliyagoda!.text).not.toContain('VEH045');
  expect(atKandy!.text).toContain('VEH045');
  expect(atKandy!.text).not.toContain('VEH035');
  expect(headerOf(html)).toMatch(/^Fleet · Both depots Today · Thu 25 Jun /);
  expect(headerOf(html)).toContain('2 vehicles 2 reefers 1 van 0 out now 2 not recorded out 0 in the workshop today 2 without a day off');
  expect(headerOf(html)).toContain('24% of this week\'s fuel recorded and committed · 6,945 / 29,260 L');
});

it('AC-7 one depot\'s failed read shows only its part failed with Try again, and the header adds nothing up', async () => {
  const [peliyagoda, kandy] = both('orders', { range: 'day' });
  const html = await drawBoth(<OrdersPage />, '/dispatcher/orders', [[peliyagoda!, ordersRead(1)]], [kandy!]);
  const [atPeliyagoda, atKandy] = partsOf(html);
  expect(atKandy!.depot).toBe('Kandy');
  expect(atKandy!.text).toContain('Could not load orders. Something went wrong on our side. Try again');
  expect(atPeliyagoda!.text).toContain('Fresh Nugegoda');
  expect(atPeliyagoda!.text).not.toContain('Could not load');
  expect(headerOf(html)).not.toMatch(/\d+ orders?\b/);
  // History and Fleet likewise.
  const [history] = both('history', {});
  const fleet = both('fleet', {});
  expect(partsOf(await drawBoth(<HistoryPage />, '/dispatcher/history', [[history!, historyRead(1)]], [both('history', {})[1]!]))[1]!.text).toContain('Could not load history.');
  expect(partsOf(await drawBoth(<FleetPage />, '/dispatcher/fleet', [[fleet[0]!, fleetRead(1)]], [fleet[1]!]))[1]!.text).toContain('Could not load fleet.');
});

// ── History when every sent plan is still to come (Q-14) ────────────────────────────────────────────────────────

// The read History gets with no date asked when the depot's sent plans are all after today: none is opened, but the
// latest sent dates are listed for the chips.
const sentLaterRead = (depot: Depot, publishedDates: string[]) => LookupHistory.parse({
  ...scope(1, depot), date: null, publishedDates, publication: null, counts: null, groups: [], trips: [], deferrals: [],
});

it('Q-44 History\'s header gives loaded and handed over so far, and counts the lines not recorded yet', () => {
  held.clockDay = 1;
  const read = historyRead(1);
  const partial = { units: null, known: 33, total: 163, missing: 130 };
  read.counts!.stages = { ...read.counts!.stages, loaded: { ...partial, soFar: 4031 }, handedOver: { ...partial, soFar: 3990 },
    received: { units: null, known: 9, total: 163, missing: 154, soFar: 310 } };
  const { text } = draw(<HistoryPage />, `/dispatcher/history?date=${THU}`, [[lookupKey('history', held.me, 'Peliyagoda', { date: THU }), read]]);
  expect(text).toContain('8 ordered 4,031 loaded so far 3,990 handed over so far 0 short from the depot');
  expect(text).toContain('Not recorded yet: loaded and handed over (130 of 163 lines); received (154 of 163 lines)');
  expect(text).not.toContain('33 of 163');
});

it('L-21 History\'s header says the cartons that did not fit on the truck apart from those the depot was short of', () => {
  held.clockDay = 1;
  const read = historyRead(1);
  read.counts!.stages = { ...read.counts!.stages, loaded: known(4), depotShort: known(0), wontFit: known(4) };
  const { text } = draw(<HistoryPage />, `/dispatcher/history?date=${THU}`, [[lookupKey('history', held.me, 'Peliyagoda', { date: THU }), read]]);
  expect(text.replaceAll('&#x27;', '\'')).toContain('0 short from the depot 4 didn\'t fit on the truck 0 refused');
});

it('Q-45 History\'s header says the partial, none delivered and closed stops beside the delivered ones, as Live day does', () => {
  held.clockDay = 1;
  const read = historyRead(1);
  read.counts = { ...read.counts!, stops: 64, delivered: 8, finished: 11, partial: 1, noGoods: 1, closed: 1 };
  const { text } = draw(<HistoryPage />, `/dispatcher/history?date=${THU}`, [[lookupKey('history', held.me, 'Peliyagoda', { date: THU }), read]]);
  expect(text).toContain('8 / 64 stops delivered · 1 partial · 1 with none delivered · 1 closed');
});

// Q-48: Friday's Orders read "0 deferred" above six rows whose Status read "Deferred".
it('Q-48 a day with no sent plan says its deferred orders were deferred on earlier plans, as the rows read', () => {
  held.clockDay = 1;
  const read = ordersRead(1, 'Kandy');
  const row = read.rows[0]!;
  read.date = '2026-06-26'; read.from = '2026-06-26';
  read.summary = { orders: 1, planned: 0, deferred: 1, carriedOver: 1, split: 0 };
  read.rows = [{ ...row, deferredEarlier: true, days: [{ date: '2026-06-26', carriedOver: true, publication: null, assignment: null, deferral: null }] }];
  const { text } = draw(<OrdersPage />, '/dispatcher/orders?date=2026-06-26', [[lookupKey('orders', held.me, 'Peliyagoda', { date: '2026-06-26', range: 'day' }), read]]);
  expect(text).toContain('1 order 0 planned No sent plan 1 deferred on earlier plans 1 carried over from earlier days');
  expect(text).toContain('no planned arrival Deferred deferred 1×');
});

// Q-46: Mulgampola's order, brought back from the closed shop, read "Placed" with no closed shop or return in its history.
it('Q-46 an order brought back from a closed shop reads as brought back, and its history shows the closed shop and the return', () => {
  held.clockDay = 1;
  const read = ordersRead(1);
  const row = read.rows[0]!, day = row.days[0]!;
  read.rows = [{ ...row, status: 'placed', broughtBack: true, days: [{ ...day, assignment: { ...day.assignment!, vehicleId: 'VEH057', seq: 3,
    closed: [{ issueId: id(650), at: at('03:50'), decision: 'bring_back', decidedAt: at('03:52') }] } }] }];
  const { text } = draw(<OrdersPage />, `/dispatcher/orders?date=${THU}`, [[lookupKey('orders', held.me, 'Peliyagoda', { date: THU, range: 'day' }), read]]);
  expect(text).toContain('VEH057 · 3 05:00 Brought back · waiting for the next plan');
  expect(text).not.toContain('Placed');
  const detail = textOfMarkup(renderToStaticMarkup(<MemoryRouter><OrderDetail row={read.rows[0]!} anchor="order-detail" onClose={() => {}} /></MemoryRouter>));
  expect(detail).toContain('Brought back · waiting for the next plan');
  expect(detail).toContain('Thu 25 planned · VEH057 · 3 · arrives 05:00');
  expect(detail).toContain('Thu 25 nobody at the shop 03:50 · VEH057 · 3');
  expect(detail).toContain('Thu 25 brought back to the depot 03:52');
});

it('Q-14 a depot whose sent plans are all still to come says so beside their chip, offers to open the soonest, and never says none was sent', () => {
  held.clockDay = 1;
  const later = draw(<HistoryPage />, '/dispatcher/history', [[lookupKey('history', held.me, 'Peliyagoda', {}), sentLaterRead('Peliyagoda', ['2026-06-26', THU])]]);
  expect(later.text).not.toContain(NO_SENT_PLANS_YET);
  expect(later.text).toContain('No plan is sent for today or earlier yet. The plan for Thu 25 Jun is sent.');
  expect(later.html).toMatch(/<button[^>]*>Open Thu 25 Jun<\/button>/);
  // The chips and the page agree: the chips list the same sent days.
  expect(later.html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Thu 25 Jun<\/button>/);
  // A depot with no sent plan at all still says so.
  const none = draw(<HistoryPage />, '/dispatcher/history', [[lookupKey('history', held.me, 'Peliyagoda', {}), sentLaterRead('Peliyagoda', [])]]);
  expect(none.text).toContain(NO_SENT_PLANS_YET);
});

it('Q-14 on both depots, Kandy\'s part says the same while Peliyagoda\'s shows its sent plan', async () => {
  const [peliyagoda, kandy] = both('history', {});
  const html = await drawBoth(<HistoryPage />, '/dispatcher/history', [[peliyagoda!, historyRead(1)], [kandy!, sentLaterRead('Kandy', [THU])]]);
  const [, atKandy] = partsOf(html);
  expect(atKandy!.text).toContain('No plan is sent for today or earlier yet. The plan for Thu 25 Jun is sent. Open Thu 25 Jun');
  expect(atKandy!.text).not.toContain(NO_SENT_PLANS_YET);
});
