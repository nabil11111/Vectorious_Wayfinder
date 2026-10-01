import { QueryClient } from '@tanstack/react-query';
import { PlanBoard, type DraftPlan, type Me } from '@wayfinder/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { meKey } from '@/features/auth/api';
import { DEPOT_HEADER, nameDepot } from '@/lib/api';
import { boardKey, dayKey, planWriteOnItsWay, retireBoard, sendPlan, useBoardScreen, writeOutsideBoard } from './board';
import { landDrop } from './parts/dragging';
import { driverChange } from './parts/drivers';

// The board's saver across a dispatcher's depot switch (spec 020, AC-6). It keeps the board and its draft outside the
// cache, so it belongs to the account and the depot: a switch starts it afresh, and an answer for the depot before
// never lands. A change still on its way holds the switch until it lands. The board's hooks are drawn by hand here: an
// effect runs as it is drawn, and the store hands over its snapshot.

const held = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: (effect: () => void) => { effect(); },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('@tanstack/react-query', async (original) => ({ ...await original<typeof import('@tanstack/react-query')>(), useQueryClient: () => held.client }));
vi.mock('sonner', () => ({ toast: vi.fn() }));

const RUWAN: Me = { id: '1f0c2c55-6a39-4d55-9d1e-0c8f3f6c0a01', username: 'ruwan', staffId: 'P-001', displayName: 'Ruwan', role: 'dispatcher', depotId: 'Peliyagoda', outletId: null };
const IN_KANDY: Me = { ...RUWAN, depotId: 'Kandy' };
const PLAN = '9a000000-0000-4000-8000-000000000001';
const MIXED: DraftPlan = { mixBrands: true, trips: [], deferrals: [] };

// A board open for planning with no trip on it yet, for a depot, and its plan once saved.
const boardOf = (depot: string, planId: string | null = null, revision = 0) => PlanBoard.parse({
  depot, demoDay: 1, day: { date: '2026-06-25', cutoffAt: '2026-06-24T10:30:00.000Z', open: true },
  plan: { mixBrands: planId !== null, trips: [], deferrals: [], id: planId, revision, status: 'draft', savedAt: null, sentAt: null, canUnsend: false },
  dropped: [], check: null, orders: [], shops: [], vehicles: [], drivers: [], figures: null, counts: null, suggestion: null,
});

// Each request waits for its answer, which the test gives.
let answer: (response: Response | Error) => void;
beforeEach(() => {
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve, reject) => {
    answer = (response) => (response instanceof Error ? reject(response) : resolve(response));
  })));
});
afterEach(() => vi.unstubAllGlobals());

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
function signedIn(me: Me) {
  const qc = new QueryClient();
  held.client = qc;
  qc.setQueryData(meKey, me);
  return qc;
}

it('AC-6 a depot switch starts the board afresh, so the board held for the depot before is not drawn under the new one', () => {
  const qc = signedIn(RUWAN);
  const peliyagoda = boardOf('Peliyagoda');
  expect(useBoardScreen(peliyagoda).screen?.board).toBe(peliyagoda);

  qc.setQueryData(meKey, IN_KANDY);
  // The switch dropped the board's read, so the page has nothing to draw until Kandy's board arrives.
  expect(useBoardScreen(undefined).screen).toBeNull();
  const kandy = boardOf('Kandy');
  expect(useBoardScreen(kandy).screen?.board).toBe(kandy);
});

it('AC-6 a save for the depot before that answers after the switch is dropped, and lands on no board', async () => {
  const qc = signedIn(RUWAN);
  const { saver } = useBoardScreen(boardOf('Peliyagoda'));
  saver.change(MIXED, { line: 'A change', tripKey: null });
  await settled();
  expect(fetch).toHaveBeenCalledTimes(1);

  qc.setQueryData(meKey, IN_KANDY);
  answer(Response.json(boardOf('Peliyagoda', PLAN, 1)));
  await settled();
  expect(qc.getQueryData(boardKey)).toBeUndefined();
  expect(useBoardScreen(undefined).screen).toBeNull();
});

it('AC-6 a change on its way holds a depot switch until it lands, and one the server turned down does not', async () => {
  const qc = signedIn(RUWAN);
  // No board opened, or one with nothing changed: nothing is on its way.
  expect(planWriteOnItsWay(qc)).toBe(false);
  const { saver } = useBoardScreen(boardOf('Peliyagoda'));
  expect(planWriteOnItsWay(qc)).toBe(false);

  saver.change(MIXED, { line: 'A change', tripKey: null });
  expect(planWriteOnItsWay(qc)).toBe(true);
  await settled();
  answer(Response.json(boardOf('Peliyagoda', PLAN, 1)));
  await settled();
  expect(saver.snapshot()?.saving).toBe('saved');
  expect(planWriteOnItsWay(qc)).toBe(false);

  // A save that got no answer is tried again later, so it is still on its way.
  saver.change({ ...MIXED, mixBrands: false }, { line: 'A change', tripKey: null });
  await settled();
  answer(new TypeError('Failed to fetch'));
  await settled();
  expect(saver.snapshot()?.saving).toBe('retrying');
  expect(planWriteOnItsWay(qc)).toBe(true);

  // Try again, and the server turns it down: the board says why, and a switch drops nothing the server would keep.
  saver.retry();
  await settled();
  answer(Response.json({ error: { code: 'unknown_record', message: 'That record does not belong to this depot and planning day.' } }, { status: 400 }));
  await settled();
  expect(saver.snapshot()?.saving).toBe('refused');
  expect(planWriteOnItsWay(qc)).toBe(false);
  saver.stop();
});

it('AC-6 only the board of the account and depot on show can hold a switch', async () => {
  const qc = signedIn(RUWAN);
  const { saver } = useBoardScreen(boardOf('Peliyagoda'));
  saver.change(MIXED, { line: 'A change', tripKey: null });
  expect(planWriteOnItsWay(qc)).toBe(true);
  // Once the session is on Kandy, Peliyagoda's board is not the one on show, and Kandy's has nothing on its way.
  qc.setQueryData(meKey, IN_KANDY);
  expect(planWriteOnItsWay(qc)).toBe(false);
  await settled();
  answer(Response.json(boardOf('Peliyagoda', PLAN, 1)));
  await settled();
  saver.stop();
});

it('AC-6 a send from View plan outside the board\'s queue, as after a reload, holds a depot switch until it answers', async () => {
  const qc = signedIn(RUWAN);
  const board = boardOf('Peliyagoda', PLAN, 1);
  expect(planWriteOnItsWay(qc)).toBe(false);
  const sending = writeOutsideBoard(qc, '2026-06-25', board, sendPlan);
  await settled();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(planWriteOnItsWay(qc)).toBe(true);

  answer(Response.json({ ...board, plan: { ...board.plan, revision: 2, status: 'published' } }));
  expect(await sending).toMatchObject({ plan: { status: 'published' } });
  expect(planWriteOnItsWay(qc)).toBe(false);
  expect(qc.getQueryData(dayKey('2026-06-25'))).toMatchObject({ depot: 'Peliyagoda', plan: { status: 'published' } });
});

it('AC-6 View plan\'s answer that lands after the depot changed is not written into the day\'s read', async () => {
  const qc = signedIn(RUWAN);
  const board = boardOf('Peliyagoda', PLAN, 1);
  const sending = writeOutsideBoard(qc, '2026-06-25', board, sendPlan);
  await settled();
  // Another tab switched the session to Kandy while the send was out, and this tab followed.
  qc.setQueryData(meKey, IN_KANDY);
  answer(Response.json({ ...board, plan: { ...board.plan, revision: 2, status: 'published' } }));
  expect(await sending).toBeNull();
  expect(qc.getQueryData(dayKey('2026-06-25'))).toBeUndefined();
});

// The board's retries wait on the browser's timers, which these two move on by hand.
async function withRetries(test: () => Promise<void>) {
  vi.useFakeTimers();
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  try {
    await test();
  } finally {
    vi.useRealTimers();
  }
}

it('AC-6 a switch retires the board\'s queue whatever page is on show, so a save waiting to try again is never sent', () => withRetries(async () => {
  const qc = signedIn(RUWAN);
  const { saver } = useBoardScreen(boardOf('Peliyagoda'));
  saver.change(MIXED, { line: 'A change', tripKey: null });
  await vi.advanceTimersByTimeAsync(0);
  answer(new TypeError('Failed to fetch'));
  await vi.advanceTimersByTimeAsync(0);
  expect(saver.snapshot()?.saving).toBe('retrying');
  expect(planWriteOnItsWay(qc)).toBe(true);

  // The dashboard is on show, so no plan page draws the board: the switch retires it.
  retireBoard(qc);
  expect(planWriteOnItsWay(qc)).toBe(false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetch).toHaveBeenCalledTimes(1);
}));

it('AC-6 the board\'s queue checks the account and depot before every save, split, join, send or build', () => withRetries(async () => {
  const qc = signedIn(RUWAN);
  const { saver } = useBoardScreen(boardOf('Peliyagoda'));
  saver.change(MIXED, { line: 'A change', tripKey: null });
  await vi.advanceTimersByTimeAsync(0);
  answer(new TypeError('Failed to fetch'));
  await vi.advanceTimersByTimeAsync(0);
  expect(saver.snapshot()?.saving).toBe('retrying');

  // Another tab switched the session to Kandy and this tab followed before anything retired the queue.
  qc.setQueryData(meKey, IN_KANDY);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetch).toHaveBeenCalledTimes(1);

  // Nor does a send, with changes waiting or without.
  expect(await saver.act(sendPlan)).toBeNull();
  // A queue with nothing waiting sends nothing either.
  const fresh = signedIn(RUWAN);
  const kept = useBoardScreen(boardOf('Peliyagoda')).saver;
  fresh.setQueryData(meKey, IN_KANDY);
  expect(await kept.act(sendPlan)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
}));

it('D-95 retiring the board\'s queue says whether it held plan changes not yet saved, and a save still out may have been kept', async () => {
  const qc = signedIn(RUWAN);
  expect(retireBoard(qc)).toBeNull();
  useBoardScreen(boardOf('Peliyagoda'));
  expect(retireBoard(qc)).toBeNull();

  const { saver } = useBoardScreen(boardOf('Peliyagoda'));
  saver.change(MIXED, { line: 'A change', tripKey: null });
  await settled();
  expect(retireBoard(qc)).toBe('unsure');
  answer(Response.json(boardOf('Peliyagoda', PLAN, 1)));
  await settled();
});

it('D-95 a change the server turned down was not kept: retiring the queue says it is dropped', async () => {
  const qc = signedIn(RUWAN);
  const { saver } = useBoardScreen(boardOf('Peliyagoda'));
  saver.change(MIXED, { line: 'A change', tripKey: null });
  await settled();
  answer(Response.json({ error: { code: 'depot_changed', message: 'The depot was switched in another tab.' } }, { status: 409 }));
  await settled();
  expect(saver.snapshot()?.saving).toBe('refused');
  expect(retireBoard(qc)).toBe('dropped');
});

it('D-95 a save that got no answer may have been kept, even once its retry is turned down: retiring the queue says it is unsure', async () => {
  const qc = signedIn(RUWAN);
  const { saver } = useBoardScreen(boardOf('Peliyagoda'));
  saver.change(MIXED, { line: 'A change', tripKey: null });
  await settled();
  // The server saved it, but its answer was lost on the way back.
  answer(new TypeError('Failed to fetch'));
  await settled();
  expect(saver.snapshot()?.saving).toBe('retrying');
  // Another tab switched the session meanwhile, so the retry is turned down.
  saver.retry();
  await settled();
  answer(Response.json({ error: { code: 'depot_changed', message: 'The depot was switched in another tab.' } }, { status: 409 }));
  await settled();
  expect(saver.snapshot()?.saving).toBe('refused');
  expect(retireBoard(qc)).toBe('unsure');
});

it('D-95 a retired queue stays retired: switching back to the same account and depot neither revives it nor lets its late answers land, and it sends nothing more', async () => {
  const qc = signedIn(RUWAN);
  const { saver } = useBoardScreen(boardOf('Peliyagoda'));
  saver.change(MIXED, { line: 'A change', tripKey: null });
  await settled();
  expect(fetch).toHaveBeenCalledTimes(1);

  // A switch to Kandy retired the queue while its save was out, and a switch back to Peliyagoda followed.
  retireBoard(qc);
  qc.setQueryData(meKey, IN_KANDY);
  qc.setQueryData(meKey, RUWAN);
  answer(Response.json(boardOf('Peliyagoda', PLAN, 1)));
  await settled();
  expect(qc.getQueryData(boardKey)).toBeUndefined();
  expect(qc.getQueryData(dayKey('2026-06-25'))).toBeUndefined();

  // The board drawn now has a queue of its own, and the old one sends nothing more.
  expect(useBoardScreen(undefined).saver).not.toBe(saver);
  saver.change({ ...MIXED, mixBrands: false }, { line: 'A change', tripKey: null });
  await settled();
  expect(await saver.act(sendPlan)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('D-95 a queue that finds itself no longer the screen\'s drops its waiting changes, so it holds no switch after the same dispatcher signs in again', () => withRetries(async () => {
  const qc = signedIn(RUWAN);
  const { saver } = useBoardScreen(boardOf('Peliyagoda'));
  saver.change(MIXED, { line: 'A change', tripKey: null });
  await vi.advanceTimersByTimeAsync(0);
  answer(new TypeError('Failed to fetch'));
  await vi.advanceTimersByTimeAsync(0);
  expect(saver.snapshot()?.saving).toBe('retrying');

  // Ruwan signs out while the save waits to try again, and its next try finds the board is no longer on show.
  qc.setQueryData(meKey, null);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(saver.snapshot()?.saving).toBe('saved');

  // He signs in again, on Peliyagoda as before: nothing of the queue before holds a switch.
  qc.setQueryData(meKey, RUWAN);
  expect(planWriteOnItsWay(qc)).toBe(false);
}));

// The depot each request named, in order.
const namedOn = () => vi.mocked(fetch).mock.calls.map(([, init]) => ((init as RequestInit).headers as Record<string, string>)[DEPOT_HEADER]);

it('D-95 a save waiting its turn behind another write does not go once a switch retired its queue, even after switching back', async () => {
  const qc = signedIn(RUWAN);
  const board = boardOf('Peliyagoda', PLAN, 1);
  // View plan's send after a reload goes first and is slow to answer, and the board's save waits behind it.
  const sending = writeOutsideBoard(qc, '2026-06-25', board, sendPlan);
  await settled();
  const { saver } = useBoardScreen(boardOf('Peliyagoda'));
  saver.change(MIXED, { line: 'A change', tripKey: null });
  await settled();
  expect(fetch).toHaveBeenCalledTimes(1);

  // Another tab switched to Kandy and back while the save waited, and this tab followed both, retiring the queue.
  retireBoard(qc);
  qc.setQueryData(meKey, IN_KANDY);
  qc.setQueryData(meKey, RUWAN);
  answer(Response.json({ ...board, plan: { ...board.plan, revision: 2 } }));
  await sending;
  await settled();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('D-95 a write waiting its turn names the depot it was made for, not the one the tab names when it goes', async () => {
  const qc = signedIn(RUWAN);
  nameDepot('Peliyagoda');
  try {
    const sending = writeOutsideBoard(qc, '2026-06-25', boardOf('Peliyagoda', PLAN, 1), sendPlan);
    await settled();
    const { saver } = useBoardScreen(boardOf('Peliyagoda'));
    saver.change(MIXED, { line: 'A change', tripKey: null });
    await settled();
    // The tab names Kandy by the time the save's turn comes, as it does the moment it takes a switch.
    nameDepot('Kandy');
    answer(Response.json(boardOf('Peliyagoda', PLAN, 2)));
    await sending;
    await settled();
    expect(namedOn()).toEqual(['Peliyagoda', 'Peliyagoda']);
    answer(Response.json(boardOf('Peliyagoda', PLAN, 3)));
    await settled();
    saver.stop();
  } finally {
    nameDepot(null);
  }
});

it('spec 026 rule 2 a driver moved in the menu goes out as one save of the draft, and Undo puts him back with one more', async () => {
  signedIn(RUWAN);
  const [dilshan, sanjeewa] = ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'];
  const day: DraftPlan = { mixBrands: false, deferrals: [], trips: [
    { vehicleId: 'VEH001', tripNo: 1, leaveAt: null, driverId: dilshan, stops: [] },
    { vehicleId: 'VEH035', tripNo: 1, leaveAt: null, driverId: sanjeewa, stops: [] },
  ] };
  const saved = boardOf('Peliyagoda', PLAN, 1);
  const board = PlanBoard.parse({ ...saved, plan: { ...saved.plan, ...day } });
  const { saver } = useBoardScreen(board);
  // The trips each save sent, with their drivers.
  const sent = () => vi.mocked(fetch).mock.calls.map(([, init]) => (JSON.parse(String((init as RequestInit).body)) as { plan: DraftPlan }).plan.trips.map((t) => [t.vehicleId, t.driverId]));

  const { plan, undo } = driverChange(day, 'VEH035-1', 'VEH035', { id: dilshan, name: 'Dilshan' });
  saver.change(plan, undo);
  await settled();
  expect(sent()).toEqual([[['VEH001', null], ['VEH035', dilshan]]]);
  answer(Response.json({ ...board, plan: { ...board.plan, ...plan, revision: 2 } }));
  await settled();
  expect(saver.snapshot()).toMatchObject({ saving: 'saved', undo: { line: 'Dilshan moved from VEH001, which has no driver now', tripKey: 'VEH035-1', revision: 2 } });

  // Undo, as the trip's green line does it: the draft before, Dilshan back on VEH001, in one more save.
  saver.undo();
  await settled();
  expect(sent()).toEqual([[['VEH001', null], ['VEH035', dilshan]], [['VEH001', dilshan], ['VEH035', sanjeewa]]]);
  answer(Response.json({ ...board, plan: { ...board.plan, revision: 3 } }));
  await settled();
  expect(saver.snapshot()).toMatchObject({ saving: 'saved', undo: null });
  saver.stop();
});

it('spec 023 AC-5 a drop goes out as one save of the draft, checked as a button\'s change is, and its Undo as one more', async () => {
  signedIn(RUWAN);
  const [nugegoda, kotahena, wellawatte] = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002'];
  const day: DraftPlan = { mixBrands: false, deferrals: [], trips: [{ vehicleId: 'VEH035', tripNo: 1, leaveAt: null, driverId: null, stops: [
    { outletId: 'OUT001', orderIds: [nugegoda] }, { outletId: 'OUT003', orderIds: [kotahena] }, { outletId: 'OUT002', orderIds: [wellawatte] },
  ] }] };
  const saved = boardOf('Peliyagoda', PLAN, 1);
  const board = PlanBoard.parse({ ...saved, plan: { ...saved.plan, ...day } });
  const { saver } = useBoardScreen(board);
  // The stops each save sent, in order.
  const sent = () => vi.mocked(fetch).mock.calls.map(([, init]) => (JSON.parse(String((init as RequestInit).body)) as { plan: DraftPlan }).plan.trips[0]!.stops.map((s) => s.outletId));

  // Fresh Nugegoda dragged from first to last place.
  landDrop(day, { kind: 'stop', tripKey: 'VEH035-1', index: 0, label: 'Fresh Nugegoda', brand: 'Fresh' }, { kind: 'stops', tripKey: 'VEH035-1', at: 2 }, { change: saver.change, start: () => undefined, called: (trip) => trip.vehicleId });
  await settled();
  expect(sent()).toEqual([['OUT003', 'OUT002', 'OUT001']]);
  answer(Response.json({ ...board, plan: { ...board.plan, ...saver.snapshot()!.draft, revision: 2 } }));
  await settled();
  expect(saver.snapshot()).toMatchObject({ saving: 'saved', undo: { line: 'Stops 1 and 3 moved', tripKey: 'VEH035-1', revision: 2 } });

  saver.undo();
  await settled();
  expect(sent()).toEqual([['OUT003', 'OUT002', 'OUT001'], ['OUT001', 'OUT003', 'OUT002']]);
  answer(Response.json({ ...board, plan: { ...board.plan, revision: 3 } }));
  await settled();
  saver.stop();
});

it('spec 023 a write the queue runs hands its answer on once taken, and nothing when refused or loaded again', async () => {
  signedIn(RUWAN);
  const { saver } = useBoardScreen(boardOf('Peliyagoda'));
  const done = vi.fn();
  // Taken: done gets the board the build answered.
  const built = saver.act(sendPlan, done);
  await settled();
  const answered = boardOf('Peliyagoda', PLAN, 1);
  answer(Response.json(answered));
  expect(await built).toBeNull();
  expect(done).toHaveBeenCalledExactlyOnceWith(answered);

  // Refused with a sentence: nothing handed on.
  const refused = saver.act(sendPlan, done);
  await settled();
  answer(Response.json({ error: { code: 'not_ready', message: 'The plan has blocks.' } }, { status: 409 }));
  expect(await refused).toBe('The plan has blocks.');
  // Stale: the board is read again, and nothing is handed on either.
  const stale = saver.act(sendPlan, done);
  await settled();
  answer(Response.json({ error: { code: 'stale', message: 'The plan was changed in another tab, so it was loaded again.' } }, { status: 409 }));
  await settled();
  answer(Response.json(boardOf('Peliyagoda', PLAN, 2)));
  expect(await stale).toBeNull();
  expect(done).toHaveBeenCalledOnce();
  saver.stop();
});
