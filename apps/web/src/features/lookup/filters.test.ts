import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { LookupOrders, type Brand, type Me } from '@wayfinder/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { groupOrders, ordersPage, shownOrders } from './filters';
import { ordersOptions } from './queries';

// AC-6 (spec 017, rule 3): Orders reads one complete delivery-day list. Search and the All / Carried over / Deferred /
// Split filter work on those returned rows in the browser, keep their stable order, leave the summary as the server
// sent it, and the selected detail is that row itself. No second request is made for any of it.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const THU = '2026-06-25';
const WED = '2026-06-24';
const sent = { id: id(900), date: THU, revision: 1, publishedAt: '2026-06-24T11:00:00.000Z' };
const shop = (shopId: string, name: string, brand: Brand, district: string) =>
  ({ id: shopId, name, brand, district, windowOpen: '05:00', windowClose: '07:30', mallWindow: null });
const NUGEGODA = shop('OUT001', 'Fresh Nugegoda', 'Fresh', 'Colombo');
const WELLAWATTE = shop('OUT002', 'Fresh Wellawatte', 'Fresh', 'Colombo');
const DICKWELLA = shop('OUT060', 'Fresh Dickwella', 'Fresh', 'Matara');
const LIBERTY = shop('OUT017', 'Style Liberty Plaza', 'Style', 'Colombo');
const KURUNEGALA = shop('OUT080', 'Tech Kurunegala', 'Tech', 'Kurunegala');

type Shop = typeof NUGEGODA;
const load = (units: number) => ({ kg: units * 7, m3: units / 20, units, needsReefer: false, needsTailLift: false, keepUpright: false });
const planned = (seq: number) => ({ tripId: id(800), vehicleId: 'VEH035', tripNo: 1, stopId: id(700 + seq), seq, plannedArrival: '2026-06-24T23:22:00.000Z' });
const deferral = { code: 'no_reefer' as const, reason: 'No fridge truck was left for Matara.' };

// One order of Thursday's list, with its own inline detail.
function row(n: number, outlet: Shop, { temp = 'dry', wanted = THU, status = 'planned', day = 'planned', splitFrom = null, times = 0 }: {
  temp?: 'chilled' | 'dry'; wanted?: string; status?: string; day?: 'planned' | 'deferred'; splitFrom?: string | null; times?: number;
} = {}) {
  return {
    id: id(n), wantedDate: wanted, placedAt: '2026-06-24T03:00:00.000Z', temp, status,
    lines: [{ lineId: id(1000 + n), productId: `P-${temp}`, name: temp === 'chilled' ? 'Chilled cartons' : 'Dry cartons', unit: 'carton', quantity: 4 }],
    note: null, load: load(4), outlet, splitFrom,
    original: splitFrom ? { id: splitFrom, wantedDate: wanted, placedAt: null, temp, status: 'split', lines: [], note: null, load: load(8) } : null,
    parts: [],
    days: [{ date: THU, carriedOver: wanted < THU, publication: sent, assignment: day === 'planned' ? planned(n % 9 + 1) : null, deferral: day === 'deferred' ? deferral : null }],
    deferralHistory: day === 'deferred' ? [{ ...deferral, planId: sent.id, date: THU }] : [],
    timesDeferred: times,
  };
}

// The read as the server sends it, in an order the page must not rely on.
const read = LookupOrders.parse({
  depot: { id: 'Peliyagoda', name: 'Peliyagoda' }, readAt: '2026-06-24T22:00:00.000Z', demoDay: 1,
  date: THU, from: THU, range: 'day',
  summary: { orders: 7, planned: 5, deferred: 2, carriedOver: 2, split: 1 },
  rows: [
    row(1, KURUNEGALA, { wanted: WED, status: 'deferred', day: 'deferred', times: 2 }),
    row(2, NUGEGODA, { temp: 'dry' }),
    row(3, LIBERTY, { splitFrom: id(99) }),
    row(4, DICKWELLA, { temp: 'chilled', status: 'deferred', day: 'deferred', times: 1 }),
    row(5, NUGEGODA, { temp: 'chilled' }),
    row(6, WELLAWATTE, { temp: 'chilled' }),
    row(7, NUGEGODA, { temp: 'chilled', wanted: WED }),
  ],
  skippedLately: { from: '2026-05-29', to: THU, rows: [] },
});

const shopsOf = (rows: { id: string; outlet: { name: string } }[]) => rows.map((r) => `${r.outlet.name} ${r.id.slice(-2)}`);

it('AC-6 Orders filters its returned rows without a new request', async () => {
  // Fresh, Style, Tech; then district, shop, wanted date, chilled before dry and the id.
  const all = shownOrders(read.rows, { search: '', filter: 'all' });
  expect(shopsOf(all)).toEqual([
    'Fresh Nugegoda 07', 'Fresh Nugegoda 05', 'Fresh Nugegoda 02', 'Fresh Wellawatte 06', 'Fresh Dickwella 04', 'Style Liberty Plaza 03', 'Tech Kurunegala 01',
  ]);
  expect(groupOrders(all).map((g) => [g.brand, g.districts.map((d) => d.district)])).toEqual([
    ['Fresh', ['Colombo', 'Matara']], ['Style', ['Colombo']], ['Tech', ['Kurunegala']],
  ]);

  // Search is a case-insensitive part of the shop's name or outlet id, in the same stable order.
  expect(shopsOf(shownOrders(read.rows, { search: 'NUGEGODA', filter: 'all' }))).toEqual(['Fresh Nugegoda 07', 'Fresh Nugegoda 05', 'Fresh Nugegoda 02']);
  expect(shopsOf(shownOrders(read.rows, { search: ' out060 ', filter: 'all' }))).toEqual(['Fresh Dickwella 04']);
  expect(shopsOf(shownOrders(read.rows, { search: 'wella', filter: 'all' }))).toEqual(['Fresh Wellawatte 06', 'Fresh Dickwella 04']);
  expect(shopsOf(shownOrders(read.rows, { search: 'Watte', filter: 'all' }))).toEqual(['Fresh Wellawatte 06']);
  // Carried over is any listed day's mark, Deferred a listed day's own deferral, and Split a part with split_from.
  expect(shopsOf(shownOrders(read.rows, { search: '', filter: 'carried_over' }))).toEqual(['Fresh Nugegoda 07', 'Tech Kurunegala 01']);
  expect(shopsOf(shownOrders(read.rows, { search: '', filter: 'deferred' }))).toEqual(['Fresh Dickwella 04', 'Tech Kurunegala 01']);
  expect(shopsOf(shownOrders(read.rows, { search: '', filter: 'split' }))).toEqual(['Style Liberty Plaza 03']);
  expect(shopsOf(shownOrders(read.rows, { search: 'fresh', filter: 'deferred' }))).toEqual(['Fresh Dickwella 04']);

  // The page's view: the summary is the server's own object, "Showing N of M" is the shown array and the returned
  // rows, and the detail is the selected row itself, whatever filter hides it.
  const none = ordersPage(read, { search: 'zzz', filter: 'all' }, null);
  expect(none.summary).toBe(read.summary);
  expect([none.shown, none.total, none.groups]).toEqual([0, 7, []]);
  const picked = ordersPage(read, { search: '', filter: 'split' }, id(4));
  expect(picked.summary).toBe(read.summary);
  expect([picked.shown, picked.total]).toEqual([1, 7]);
  expect(picked.selected).toBe(read.rows[3]);
  expect(ordersPage(read, { search: '', filter: 'all' }, id(42)).selected).toBeNull();

  // One read answers the whole page: filtering, searching and opening a row ask nothing more of the server.
  const observer = new QueryObserver(client, ordersOptions(ruwan, 'Peliyagoda', { range: 'day' }));
  stop = observer.subscribe(() => {});
  await settle();
  respond(0, read);
  await settle();
  const shown = observer.getCurrentResult().data!;
  for (const filter of ['all', 'carried_over', 'deferred', 'split'] as const) {
    for (const search of ['', 'nugegoda', 'OUT080']) {
      const view = ordersPage(shown, { search, filter }, id(2));
      expect(view.summary).toEqual(read.summary);
      expect(view.selected?.id).toBe(id(2));
    }
  }
  await settle();
  expect(requests).toEqual(['/api/v1/lookup/orders?range=day&depot=Peliyagoda']);
});

const ruwan: Me = { id: 'dispatcher-ruwan', username: 'ruwan', staffId: 'P-001', displayName: 'Ruwan', role: 'dispatcher', depotId: 'Peliyagoda', outletId: null };
const answers: ((body: unknown) => void)[] = [];
const requests: string[] = [];
const respond = (n: number, body: unknown) => answers[n]!(body);
const settle = () => new Promise<void>((done) => setTimeout(done, 0));
let client: QueryClient;
let stop = () => {};
beforeEach(() => {
  answers.length = 0;
  requests.length = 0;
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    requests.push(url);
    return new Promise<Response>((done) => {
      answers.push((body) => done(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    });
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.mount();
});
afterEach(() => {
  stop();
  client.unmount();
  client.clear();
  vi.unstubAllGlobals();
});
