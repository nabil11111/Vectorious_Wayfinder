import { QueryClient } from '@tanstack/react-query';
import { PlanBoard, type DraftPlan, type Me } from '@wayfinder/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { meKey } from '@/features/auth/api';
import { boardKey, dayKey, planWriteOnItsWay, retireBoard, sendPlan, useBoardScreen, writeOutsideBoard } from './board';

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
  saver.change(MIXED);
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

  saver.change(MIXED);
  expect(planWriteOnItsWay(qc)).toBe(true);
  await settled();
  answer(Response.json(boardOf('Peliyagoda', PLAN, 1)));
  await settled();
  expect(saver.snapshot()?.saving).toBe('saved');
  expect(planWriteOnItsWay(qc)).toBe(false);

  // A save that got no answer is tried again later, so it is still on its way.
  saver.change({ ...MIXED, mixBrands: false });
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
  saver.change(MIXED);
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
  saver.change(MIXED);
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
  saver.change(MIXED);
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
