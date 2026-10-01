import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query';
import type { Me } from '@wayfinder/contracts';
import { toast } from 'sonner';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { meKey } from '@/features/auth/api';
import { clockKey } from '@/lib/clock';
import { useLive } from '@/lib/live';
import { SWITCH_FAILED, followSwitch, switchDepotMutation, switchTo, useFollowSwitches } from './depots';

// The depot switch away from its buttons (spec 020, AC-6): what a switch does to the reads on screen, the account and
// the live stream, in this tab and in another tab of the same session, and what a switch that fails does. A tab here is
// its query client and the two hooks a dispatcher's page keeps, the live stream and the switch's listener, drawn by
// hand: an effect runs when first drawn, and again after its cleanup whenever one of its dependencies changed.

interface Tab { qc: QueryClient; effects: { deps?: readonly unknown[]; cleanup: void | (() => void) }[]; streams: Stream[] }
const held = vi.hoisted(() => ({ tab: undefined as unknown, at: 0, planWriting: false, answering: false, retired: vi.fn() }));
const tabNow = () => held.tab as Tab;
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const { effects } = held.tab as Tab;
    const at = held.at++;
    const last = effects[at];
    if (last?.deps && deps && deps.length === last.deps.length && deps.every((dep, i) => Object.is(dep, last.deps![i]))) return;
    if (typeof last?.cleanup === 'function') last.cleanup();
    effects[at] = { deps, cleanup: effect() };
  },
}));
vi.mock('@tanstack/react-query', async (original) => ({ ...await original<typeof import('@tanstack/react-query')>(), useQueryClient: () => (held.tab as Tab).qc }));
vi.mock('@/features/auth/api', async (original) => {
  const actual = await original<typeof import('@/features/auth/api')>();
  return { ...actual, useMe: () => ({ data: (held.tab as Tab).qc.getQueryData(actual.meKey) }) };
});
vi.mock('@/features/plan/board', () => ({ planWriteOnItsWay: () => held.planWriting, retireBoard: held.retired }));
vi.mock('@/features/live/issues', () => ({ answerOnItsWay: () => held.answering }));
vi.mock('sonner', () => ({ toast: vi.fn() }));

// The browser's live stream: it opens on construction and is closed by the page.
class Stream {
  static OPEN = 1;
  static CLOSED = 2;
  readyState = 1;
  onopen = () => {};
  onerror = () => {};
  close = vi.fn(() => { this.readyState = Stream.CLOSED; });
  readonly url: string;
  constructor(url: string) { this.url = url; tabNow().streams.push(this); }
  addEventListener() {}
}

// Tabs of one browser: a message reaches every other channel of the same name, a turn of the event loop later.
class Channel extends EventTarget {
  static all: Channel[] = [];
  static sent: unknown[] = [];
  readonly name: string;
  constructor(name: string) { super(); this.name = name; Channel.all.push(this); }
  postMessage(data: unknown) {
    Channel.sent.push(data);
    for (const other of Channel.all) {
      if (other !== this && other.name === this.name) setTimeout(() => other.dispatchEvent(new MessageEvent('message', { data })), 0);
    }
  }
  close() { Channel.all = Channel.all.filter((channel) => channel !== this); }
}

// Where the browser keeps the signed-in account for the next load.
const stored = new Map<string, string>();

const RUWAN: Me = { id: 'u1', username: 'ruwan', staffId: 'P-001', displayName: 'Ruwan', role: 'dispatcher', depotId: 'Peliyagoda', outletId: null };
const IN_KANDY: Me = { ...RUWAN, depotId: 'Kandy' };
const CLOCK = { now: '2026-06-24T09:30:00.000Z', holdsAt: null, revision: 3, heldAt: 0 };
// What a dispatcher's pages hold for Peliyagoda. The plan board's and the problems' keys do not name the depot.
const READS = [
  [['operations', 'u1', 'Peliyagoda'], { depot: { id: 'Peliyagoda' } }],
  [['plans', 'board'], { depot: 'Peliyagoda' }],
  [['plans', '2026-06-25'], { depot: 'Peliyagoda' }],
  [['issues'], { issues: [] }],
  [['lookup', 'orders', 'u1', 'Peliyagoda', {}], { rows: [] }],
  [['orders', 'plans'], null],
] as const;

function tabOf(me: Me = RUWAN): Tab {
  const qc = new QueryClient();
  qc.setQueryData(meKey, me);
  qc.setQueryData(clockKey, CLOCK);
  for (const [key, data] of READS) qc.setQueryData(key, data);
  return { qc, effects: [], streams: [] };
}
// The tab the next drawing is in.
function inTab(tab: Tab) {
  held.tab = tab;
  held.at = 0;
}
// One drawing of a dispatcher's page: the shell's live stream, then the switch's listener.
function useDispatcherPage() {
  useLive();
  useFollowSwitches();
}
const cached = (qc: QueryClient) => qc.getQueryCache().getAll().map((query) => query.queryHash).sort();
const later = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
const switching = (tab: Tab, depotId: string) => new MutationObserver(tab.qc, switchDepotMutation(tab.qc)).mutate(depotId);
// The server as a switch meets it: what the switch gets back, and the account the session holds when the tab reads it
// afterwards. A Response is an answer and an Error no answer at all.
function serverWith(answers: { switched: Response | Error; session: Response | Error }) {
  const fetch = vi.fn(async (url: string) => {
    const answer = String(url).endsWith('/api/v1/me/depot') ? answers.switched : String(url).endsWith('/api/v1/auth/me') ? answers.session : new Error(`not asked for: ${url}`);
    if (answer instanceof Error) throw answer;
    return answer.clone();
  });
  vi.stubGlobal('fetch', fetch);
  return { reads: () => fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/auth/me')).length };
}
const lost = () => new TypeError('Failed to fetch');

beforeEach(() => {
  held.planWriting = false;
  held.answering = false;
  held.retired.mockClear();
  Channel.all = [];
  Channel.sent = [];
  stored.clear();
  vi.stubGlobal('EventSource', Stream);
  vi.stubGlobal('BroadcastChannel', Channel);
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(toast).mockClear();
  onlineManager.setOnline(true);
});

it('AC-6 a switch drops every read but the account and the clock, keeps the new account and opens the live stream again', async () => {
  const tab = tabOf();
  inTab(tab);
  useDispatcherPage();
  const [first] = tab.streams;
  const fetch = vi.fn(async () => Response.json(IN_KANDY));
  vi.stubGlobal('fetch', fetch);
  // Reads still on their way were asked for Peliyagoda, so neither may land after the switch: the board's, whose key
  // does not name the depot, or the account's, which would put Peliyagoda back.
  const late = { depot: 'Peliyagoda', answered: 'after the switch' };
  const onTheirWay = Promise.all([
    tab.qc.fetchQuery({ queryKey: ['plans', 'board'], queryFn: () => later(20, late) }),
    tab.qc.fetchQuery({ queryKey: meKey, queryFn: () => later(20, RUWAN) }),
  ]);

  await switching(tab, 'Kandy');

  expect(fetch).toHaveBeenCalledWith('/api/v1/me/depot', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ depotId: 'Kandy' }) }));
  expect(cached(tab.qc)).toEqual(['["clock"]', '["me"]']);
  expect(tab.qc.getQueryData(meKey)).toEqual(IN_KANDY);
  expect(tab.qc.getQueryData(clockKey)).toEqual(CLOCK);
  // The board's queue for Peliyagoda is retired whatever page is on show, so nothing of it is sent on Kandy.
  expect(held.retired).toHaveBeenCalledWith(tab.qc);
  // The account is kept for the next load as well, so a reload starts at Kandy.
  expect([...stored.values()].map((text) => JSON.parse(text))).toContainEqual(IN_KANDY);
  await onTheirWay;
  await later(30, null);
  expect(cached(tab.qc)).toEqual(['["clock"]', '["me"]']);
  expect(tab.qc.getQueryData(meKey)).toEqual(IN_KANDY);

  // The next drawing has the new account: Peliyagoda's stream closes and a new one opens, which carries Kandy.
  expect(first.close).not.toHaveBeenCalled();
  inTab(tab);
  useDispatcherPage();
  expect(first.close).toHaveBeenCalled();
  expect(tab.streams).toHaveLength(2);
  expect(tab.streams[1].url).toBe('/api/v1/events');
});

it('AC-6 another tab of the same session follows the switch as if it were its own, and tells nobody in turn', async () => {
  const here = tabOf();
  const there = tabOf();
  inTab(here);
  useDispatcherPage();
  inTab(there);
  useDispatcherPage();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(IN_KANDY)));

  await switching(here, 'Kandy');
  await later(10, null);

  // The message names the account only: the tab that hears it reads the session for the depot.
  expect(Channel.sent).toEqual([{ id: 'u1' }]);
  expect(cached(there.qc)).toEqual(['["clock"]', '["me"]']);
  expect(there.qc.getQueryData(meKey)).toEqual(IN_KANDY);
  expect(held.retired).toHaveBeenCalledWith(there.qc);
  inTab(there);
  useDispatcherPage();
  expect(there.streams[0].close).toHaveBeenCalled();
  expect(there.streams).toHaveLength(2);
  // Nothing came back to the tab that switched.
  expect(here.qc.getQueryData(meKey)).toEqual(IN_KANDY);
  expect(Channel.sent).toHaveLength(1);
});

it('AC-6 a tab that hears of a switch takes the depot the session is on, not one a message names', async () => {
  // The message is older than a newer choice: the session is back on Peliyagoda by the time the tab reads it.
  const there = tabOf();
  const before = cached(there.qc);
  const server = serverWith({ switched: lost(), session: Response.json(RUWAN) });
  await followSwitch(there.qc, { id: 'u1', depotId: 'Kandy' });
  expect(server.reads()).toBe(1);
  expect(cached(there.qc)).toEqual(before);
  expect(there.qc.getQueryData(meKey)).toEqual(RUWAN);

  // The session is on Kandy: the tab takes it as its own switch.
  const moved = serverWith({ switched: lost(), session: Response.json(IN_KANDY) });
  await followSwitch(there.qc, { id: 'u1' });
  expect(moved.reads()).toBe(1);
  expect(cached(there.qc)).toEqual(['["clock"]', '["me"]']);
  expect(there.qc.getQueryData(meKey)).toEqual(IN_KANDY);
  expect(held.retired).toHaveBeenCalledWith(there.qc);
});

it('AC-6 a message for another account or not an account at all reads nothing, and a session that cannot be read changes nothing', async () => {
  const there = tabOf();
  const before = cached(there.qc);
  const quiet = serverWith({ switched: lost(), session: Response.json(IN_KANDY) });
  for (const message of [{ id: 'u2' }, { depotId: 'Kandy' }, 'Kandy', null]) await followSwitch(there.qc, message);
  expect(quiet.reads()).toBe(0);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const unread = serverWith({ switched: lost(), session: lost() });
  await followSwitch(there.qc, { id: 'u1' });
  expect(unread.reads()).toBe(1);
  expect(cached(there.qc)).toEqual(before);
  expect(there.qc.getQueryData(meKey)).toEqual(RUWAN);
  // A tab signed out has no account to follow with.
  there.qc.setQueryData(meKey, null);
  await followSwitch(there.qc, { id: 'u1' });
  expect(there.qc.getQueryData(meKey)).toBeNull();
  vi.restoreAllMocks();
});

it('AC-6 an account read that finds the session on another depot switches the tab, as when the network comes back', async () => {
  const tab = tabOf();
  inTab(tab);
  useDispatcherPage();
  // The account's own read, such as its refetch once the network is back, finds the session on Kandy.
  await tab.qc.fetchQuery({ queryKey: meKey, queryFn: async () => IN_KANDY });
  await later(0, null);
  expect(cached(tab.qc)).toEqual(['["clock"]', '["me"]']);
  expect(tab.qc.getQueryData(meKey)).toEqual(IN_KANDY);
  expect(held.retired).toHaveBeenCalledWith(tab.qc);
  // A read that finds the depot on show changes nothing.
  tab.qc.setQueryData(['issues'], { issues: [] });
  await tab.qc.fetchQuery({ queryKey: meKey, queryFn: async () => IN_KANDY });
  await later(0, null);
  expect(cached(tab.qc)).toEqual(['["clock"]', '["issues"]', '["me"]']);
});

it('AC-6 a switch that fails changes nothing and says so, at once with no signal too', async () => {
  expect(SWITCH_FAILED).toBe('Could not switch depots. Try again.');
  const failures = [
    async () => Response.json({ error: { code: 'internal', message: 'Something went wrong on our side.' } }, { status: 500 }),
    async () => { throw new TypeError('Failed to fetch'); },
  ];
  for (const [i, failure] of failures.entries()) {
    vi.mocked(toast).mockClear();
    onlineManager.setOnline(i === 0);
    const tab = tabOf();
    inTab(tab);
    useDispatcherPage();
    vi.stubGlobal('fetch', vi.fn(failure));
    await expect(Promise.race([switching(tab, 'Kandy'), later(50, 'still switching')])).rejects.toBeDefined();
    expect(toast).toHaveBeenCalledWith(SWITCH_FAILED, expect.objectContaining({ id: 'depot-switch' }));
    expect(cached(tab.qc)).toEqual(cached(tabOf().qc));
    expect(tab.qc.getQueryData(meKey)).toEqual(RUWAN);
    expect(Channel.sent).toEqual([]);
    // The stream stays the one for Peliyagoda.
    inTab(tab);
    useDispatcherPage();
    expect(tab.streams).toHaveLength(1);
    expect(tab.streams[0].close).not.toHaveBeenCalled();
  }
});

it('AC-6 a switch whose answer was lost follows the session: Kandy when the session took it, with no line', async () => {
  const tab = tabOf();
  const server = serverWith({ switched: lost(), session: Response.json(IN_KANDY) });
  await expect(switching(tab, 'Kandy')).resolves.toEqual(IN_KANDY);
  expect(server.reads()).toBe(1);
  expect(cached(tab.qc)).toEqual(['["clock"]', '["me"]']);
  expect(tab.qc.getQueryData(meKey)).toEqual(IN_KANDY);
  expect(toast).not.toHaveBeenCalled();
});

it('AC-6 a switch whose answer was lost, on a session that stayed or could not be read, changes nothing and says so', async () => {
  for (const session of [Response.json(RUWAN), lost()]) {
    vi.mocked(toast).mockClear();
    const tab = tabOf();
    const server = serverWith({ switched: lost(), session });
    await expect(switching(tab, 'Kandy')).rejects.toBeInstanceOf(TypeError);
    expect(server.reads()).toBe(1);
    expect(toast).toHaveBeenCalledWith(SWITCH_FAILED, expect.objectContaining({ id: 'depot-switch' }));
    expect(cached(tab.qc)).toEqual(cached(tabOf().qc));
    expect(tab.qc.getQueryData(meKey)).toEqual(RUWAN);
  }
});

it('AC-6 a clear refusal needs no read of the session: the server did not switch', async () => {
  const tab = tabOf();
  const server = serverWith({ switched: Response.json({ error: { code: 'forbidden', message: 'Only a dispatcher can switch depots.' } }, { status: 403 }), session: Response.json(IN_KANDY) });
  await expect(switching(tab, 'Kandy')).rejects.toMatchObject({ status: 403 });
  expect(server.reads()).toBe(0);
  expect(toast).toHaveBeenCalledWith(SWITCH_FAILED, expect.objectContaining({ id: 'depot-switch' }));
  expect(tab.qc.getQueryData(meKey)).toEqual(RUWAN);
});

it('AC-6 a late answer does not undo a newer choice: when the session is back on the depot on show, nothing changes', async () => {
  const tab = tabOf();
  // This tab's switch to Kandy answered late, after another tab had switched the session back to Peliyagoda.
  const server = serverWith({ switched: Response.json(IN_KANDY), session: Response.json(RUWAN) });
  await switching(tab, 'Kandy');
  expect(server.reads()).toBe(1);
  expect(tab.qc.getQueryData(meKey)).toEqual(RUWAN);
  expect(cached(tab.qc)).toEqual(cached(tabOf().qc));
  expect(Channel.sent).toEqual([]);
  expect(toast).not.toHaveBeenCalled();
});

it('AC-6 a switch that answered, when the session cannot be read after it, takes the answer', async () => {
  const tab = tabOf();
  serverWith({ switched: Response.json(IN_KANDY), session: lost() });
  await switching(tab, 'Kandy');
  expect(tab.qc.getQueryData(meKey)).toEqual(IN_KANDY);
  expect(cached(tab.qc)).toEqual(['["clock"]', '["me"]']);
  expect(toast).not.toHaveBeenCalled();
});

it('AC-6 a switch while any dispatcher write is on its way is refused with its line, and sends nothing', async () => {
  // A plan change (the board's queue, or View plan's send, back to edit or accept), then a problem's answer.
  for (const writing of ['planWriting', 'answering'] as const) {
    vi.mocked(toast).mockClear();
    held.planWriting = writing === 'planWriting';
    held.answering = writing === 'answering';
    const tab = tabOf();
    const fetch = vi.fn(async () => Response.json(IN_KANDY));
    vi.stubGlobal('fetch', fetch);
    await expect(switching(tab, 'Kandy')).rejects.toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(SWITCH_FAILED, expect.objectContaining({ id: 'depot-switch' }));
    expect(tab.qc.getQueryData(meKey)).toEqual(RUWAN);
    expect(cached(tab.qc)).toEqual(cached(tabOf().qc));
  }
});

it('AC-6 a press switches to the other depot only, and not while a switch is on its way', () => {
  expect(switchTo('Kandy', 'Peliyagoda', false)).toBe('Kandy');
  expect(switchTo('Peliyagoda', 'Peliyagoda', false)).toBeNull();
  expect(switchTo('Peliyagoda', 'Kandy', true)).toBeNull();
});
