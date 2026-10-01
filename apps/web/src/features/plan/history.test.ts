import { QueryClient } from '@tanstack/react-query';
import { PlanBoard, type DraftPlan, type Me } from '@wayfinder/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { meKey } from '@/features/auth/api';
import { sendPlan, useBoardScreen } from './board';

// Spec 027: the board's history of draft changes, kept in its save queue. Every change is one step Undo puts back and
// Redo makes again, each saved as any change is, and the history is this tab's own: it clears when the draft is
// replaced from elsewhere. The board's hooks are drawn by hand here, as board.test.ts draws them.

const held = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: (effect: () => void) => { effect(); },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('@tanstack/react-query', async (original) => ({ ...await original<typeof import('@tanstack/react-query')>(), useQueryClient: () => held.client }));
vi.mock('sonner', () => ({ toast: vi.fn() }));

const RUWAN: Me = { id: '1f0c2c55-6a39-4d55-9d1e-0c8f3f6c0a01', username: 'ruwan', staffId: 'P-001', displayName: 'Ruwan', role: 'dispatcher', depotId: 'Peliyagoda', outletId: null };
const PLAN = '9a000000-0000-4000-8000-000000000001';

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

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const trip = (vehicleId: string, orderId: string, tripNo: 1 | 2 = 1) => ({ vehicleId, tripNo, leaveAt: null, driverId: null, stops: [{ outletId: 'OUT005', orderIds: [orderId] }] });
// A saved draft with one trip, and the board that answers with it.
const START: DraftPlan = { mixBrands: false, trips: [trip('VEH035', uuid(1))], deferrals: [] };
const answered = (draft: DraftPlan, revision: number) => { const saved = boardOf('Peliyagoda', PLAN, revision); return PlanBoard.parse({ ...saved, plan: { ...saved.plan, ...draft } }); };
// What each save sent.
const sent = () => vi.mocked(fetch).mock.calls.map(([, init]) => (JSON.parse(String((init as RequestInit).body)) as { plan: DraftPlan }).plan);
const withTrip = (plan: DraftPlan, vehicleId: string, orderId: string): DraftPlan => ({ ...plan, trips: [...plan.trips, trip(vehicleId, orderId)] });
const deferred = (plan: DraftPlan, orderId: string): DraftPlan => ({ ...plan, deferrals: [...plan.deferrals, { orderId, code: 'dispatcher_choice', reason: 'Friday.' }] });

async function saved(saver: ReturnType<typeof useBoardScreen>['saver'], revision: number) {
  await settled();
  answer(Response.json(answered(saver.snapshot()!.draft, revision)));
  await settled();
}

it('AC-1 makes every change one step Undo puts back and Redo makes again, each named, each a save', async () => {
  signedIn(RUWAN);
  const { saver } = useBoardScreen(answered(START, 1));
  expect(saver.snapshot()!.history).toEqual({ undo: null, redo: null });
  const first = withTrip(START, 'VEH001', uuid(2));
  saver.change(first, { line: 'Fresh Dehiwala added to Wasantha\'s reefer van', tripKey: 'VEH035-1' });
  await saved(saver, 2);
  const second = deferred(first, uuid(3));
  saver.change(second, { line: 'Fresh Pannala deferred', tripKey: null });
  await saved(saver, 3);
  expect(saver.snapshot()!.history).toEqual({ undo: 'Fresh Pannala deferred', redo: null });

  saver.undo();
  expect(saver.snapshot()!.draft).toEqual(first);
  expect(saver.snapshot()!.history).toEqual({ undo: 'Fresh Dehiwala added to Wasantha\'s reefer van', redo: 'Fresh Pannala deferred' });
  await saved(saver, 4);
  saver.undo();
  expect(saver.snapshot()!.draft).toEqual(START);
  await saved(saver, 5);
  saver.redo();
  expect(saver.snapshot()!.draft).toEqual(first);
  await saved(saver, 6);
  // Each undo and redo went out as a save of the whole draft.
  expect(sent()).toEqual([first, second, first, START, first]);
  // A new change ends what Redo would have made.
  saver.change(withTrip(first, 'VEH002', uuid(4)), { line: 'Trip started on Chaminda\'s dry truck', tripKey: 'VEH002-1' });
  expect(saver.snapshot()!.history).toEqual({ undo: 'Trip started on Chaminda\'s dry truck', redo: null });
  await saved(saver, 7);
  saver.stop();
});

it('AC-1 keeps the last 50 steps', async () => {
  signedIn(RUWAN);
  const { saver } = useBoardScreen(answered(START, 1));
  let plan = START;
  for (let n = 1; n <= 52; n += 1) {
    plan = { ...plan, mixBrands: !plan.mixBrands };
    saver.change(plan, { line: `change ${n}`, tripKey: null });
  }
  for (let n = 52; n >= 3; n -= 1) {
    expect(saver.snapshot()!.history.undo).toBe(`change ${n}`);
    saver.undo();
  }
  expect(saver.snapshot()!.history.undo).toBeNull();
  saver.stop();
});

it('AC-2 the green Undo line undoes the same step as the header\'s Undo', async () => {
  signedIn(RUWAN);
  const { saver } = useBoardScreen(answered(START, 1));
  const next = withTrip(START, 'VEH001', uuid(2));
  saver.change(next, { line: 'Stops 1 and 2 swapped', tripKey: 'VEH035-1' });
  expect(saver.snapshot()!.undo).toMatchObject({ line: 'Stops 1 and 2 swapped', tripKey: 'VEH035-1' });
  saver.undo();
  expect(saver.snapshot()).toMatchObject({ draft: START, undo: null, history: { undo: null, redo: 'Stops 1 and 2 swapped' } });
  saver.stop();
});

it('AC-2 clears the history when the draft is replaced from elsewhere, and when the plan is sent', async () => {
  signedIn(RUWAN);
  const { saver } = useBoardScreen(answered(START, 1));
  const next = withTrip(START, 'VEH001', uuid(2));
  saver.change(next, { line: 'Trip started on Dilshan\'s reefer truck', tripKey: 'VEH001-1' });
  await saved(saver, 2);
  // A refetch with the same draft keeps it.
  saver.incoming(answered(next, 2));
  expect(saver.snapshot()!.history.undo).toBe('Trip started on Dilshan\'s reefer truck');
  // Another tab's change: the draft is not this tab's any more.
  saver.incoming(answered(deferred(next, uuid(9)), 3));
  expect(saver.snapshot()!.history).toEqual({ undo: null, redo: null });
  saver.undo();
  expect(saver.snapshot()!.draft).toEqual(deferred(next, uuid(9)));

  saver.change(START, { line: 'Plan started over', tripKey: null });
  await saved(saver, 4);
  const sending = saver.act((date, ref) => sendPlan(date, ref));
  await settled();
  const board = answered(START, 5);
  answer(Response.json({ ...board, plan: { ...board.plan, status: 'published' } }));
  expect(await sending).toBeNull();
  expect(saver.snapshot()!.history).toEqual({ undo: null, redo: null });
  saver.stop();
});

it('AC-1 makes a build one step, which Undo puts back as the draft before it', async () => {
  signedIn(RUWAN);
  const { saver } = useBoardScreen(answered(START, 1));
  const built = withTrip(START, 'VEH011', uuid(5));
  const building = saver.act((date, ref) => sendPlan(date, ref), undefined, { line: 'Suggested plan built', tripKey: null });
  await settled();
  answer(Response.json(answered(built, 2)));
  expect(await building).toBeNull();
  expect(saver.snapshot()!.history).toEqual({ undo: 'Suggested plan built', redo: null });
  saver.undo();
  expect(saver.snapshot()!.draft).toEqual(START);
  saver.stop();
});

it('L-10 answers a swap\'s old trip key on Undo, so the board opens the trip again where it was, and its new one on Redo', () => {
  signedIn(RUWAN);
  const { saver } = useBoardScreen(answered(START, 1));
  const swapped: DraftPlan = { ...START, trips: [{ ...START.trips[0]!, vehicleId: 'VEH001' }] };
  saver.change(swapped, { line: 'Trip moved to Dilshan\'s reefer truck', tripKey: 'VEH001-1', from: 'VEH035-1' });
  expect(saver.undo()).toEqual({ line: 'Trip moved to Dilshan\'s reefer truck', tripKey: 'VEH001-1', from: 'VEH035-1' });
  expect(saver.snapshot()!.draft).toEqual(START);
  expect(saver.redo()).toMatchObject({ tripKey: 'VEH001-1', from: 'VEH035-1' });
  expect(saver.snapshot()!.draft).toEqual(swapped);
  // A step that moved no trip opens nothing.
  saver.change(deferred(swapped, uuid(3)), { line: 'Fresh Pannala deferred', tripKey: null });
  expect(saver.undo()).toEqual({ line: 'Fresh Pannala deferred', tripKey: null });
  saver.stop();
});
