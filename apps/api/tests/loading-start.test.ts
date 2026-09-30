import { randomUUID } from 'node:crypto';
import { LoadingDay, PlanBoard } from '@wayfinder/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { auditLog, demoDay, depots, issues, plans, trips, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import {
  answeredTruck, answerFlag, code, dryLine, heldRows, kandyTrip, loaderScreen, resetDay, sendWalkthroughPlan, signIn, stopOf, THU, truckOf, WED,
  type Walkthrough,
} from './loading-plan';
import { serve, stop } from './serve';

const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at || clock.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async (original) => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const freeze = (date: string, minute: number) => { const at = depotInstant(date, minute); testClock.at = at.toISOString(); setClockForTests(at); };

const server = await serve(createApp());
const kasun = request.agent(server);
const ruwan = request.agent(server);
const nadeesha = request.agent(server);
const walk: Walkthrough = { nadeesha, ruwan, freeze };
const loader = loaderScreen(kasun);
let originalClock: typeof demoDay.$inferSelect;
let kasunId: string;

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, username] of [[kasun, 'kasun'], [ruwan, 'ruwan'], [nadeesha, 'nadeesha']] as const) await signIn(agent, username);
  kasunId = (await db.select().from(users).where(eq(users.username, 'kasun')))[0]!.id;
});
beforeEach(async () => {
  await resetDay();
  await initClock();
  freeze(WED, 16 * 60);
  vi.mocked(announce).mockReset();
});
afterAll(async () => {
  await resetDay();
  await db.update(demoDay).set(originalClock);
  testClock.at = '';
  setClockForTests(null);
  await stop(server);
  await pool.end();
});

// Thursday's plan sent, and Kasun's list read at Thu 02:30.
async function sent() {
  await sendWalkthroughPlan(walk);
  const day = await loader.read();
  return { day, truck: truckOf(day, 'VEH035'), plan: day.plan! };
}
const board = async () => PlanBoard.parse((await ruwan.get(`/api/v1/plans/${THU}`)).body);
const unsend = (b: PlanBoard) => ruwan.post(`/api/v1/plans/${THU}/unsend`).send({ planId: b.plan.id, revision: b.plan.revision });

it('AC-7 refuses a truck, stop or line of another depot with unknown_record and its id, and changes nothing', async () => {
  const { truck, plan } = await sent();
  const kandy = await kandyTrip();
  const everything = { plan, stopId: kandy.stop.id, reason: 'short', note: '', lines: [{ lineId: kandy.line.id, counted: 1 }] };
  let before = await heldRows();
  for (const action of ['start', 'stop-loaded', 'flags', 'ready']) {
    const res = await loader.post({ ...truck, tripId: kandy.trip.id }, action, everything);
    expect(code(res)).toEqual([400, 'unknown_record']);
    expect(res.body.error.details).toEqual({ id: kandy.trip.id });
  }
  expect(await heldRows()).toEqual(before);

  const loading = answeredTruck(await loader.start(truck, plan), 'VEH035');
  before = await heldRows();
  const kandyStop = await loader.post(loading, 'stop-loaded', { stopId: kandy.stop.id });
  expect(code(kandyStop)).toEqual([400, 'unknown_record']);
  expect(kandyStop.body.error.details).toEqual({ id: kandy.stop.id });
  const flagOnKandyStop = await loader.flag(loading, 1, [{ lineId: dryLine(loading).lineId, counted: 3 }], { stopId: kandy.stop.id });
  expect(code(flagOnKandyStop)).toEqual([400, 'unknown_record']);
  expect(flagOnKandyStop.body.error.details).toEqual({ id: kandy.stop.id });
  const kandyLine = await loader.flag(loading, 1, [{ lineId: kandy.line.id, counted: 3 }]);
  expect(code(kandyLine)).toEqual([400, 'unknown_record']);
  expect(kandyLine.body.error.details).toEqual({ id: kandy.line.id });
  expect(await heldRows()).toEqual(before);
});

it("AC-9 starts VEH035: loading, its revision up, the audit row and the loading day, told after the commit, and the plan can no longer go back to edit", async () => {
  const { truck, plan } = await sent();
  expect((await board()).plan.canUnsend).toBe(true);
  let committed = false;
  const transaction = db.transaction.bind(db);
  const spy = vi.spyOn(db, 'transaction').mockImplementation((async (...args: Parameters<typeof db.transaction>) => {
    const answer = await transaction(...args); committed = true; return answer;
  }) as typeof db.transaction);
  vi.mocked(announce).mockImplementation(() => { expect(committed).toBe(true); });
  const writeId = randomUUID();
  let res: request.Response;
  try { res = await loader.start(truck, plan, writeId); } finally { spy.mockRestore(); }
  const started = answeredTruck(res!, 'VEH035');
  expect(started).toMatchObject({ status: 'loading', revision: 1, readyAt: null });
  expect(LoadingDay.parse(res!.body)).toEqual(await loader.read());
  expect((await db.select().from(trips).where(eq(trips.id, truck.tripId)))[0]).toMatchObject({ status: 'loading', revision: 1, lastWriteId: writeId });
  const audits = await db.select().from(auditLog).where(and(eq(auditLog.entityId, truck.tripId), eq(auditLog.action, 'trip.loading_started')));
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ actorId: kasunId, entity: 'trip', before: { status: 'planned', revision: 0 }, after: { status: 'loading', revision: 1 } });
  expect(vi.mocked(announce).mock.calls.map(([change]) => change)).toEqual([{ topic: 'loading', depotId: 'Peliyagoda' }, { topic: 'plans', depotId: 'Peliyagoda' }]);

  const sentBoard = await board();
  expect(sentBoard.plan.canUnsend).toBe(false);
  const before = await heldRows();
  const refused = await unsend(sentBoard);
  expect(code(refused)).toEqual([409, 'loading_started']);
  expect(refused.body.error.details).toEqual({ vehicleId: 'VEH035', tripNo: 1 });
  expect(await heldRows()).toEqual(before);
});

// Holds the depot's row as a plan write does, so requests sent meanwhile queue behind it in the order they came.
async function holdDepot() {
  let release!: () => void;
  let locked!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { locked = resolve; });
  const holder = db.transaction(async (tx) => {
    await tx.select().from(depots).where(eq(depots.id, 'Peliyagoda')).for('no key update');
    locked();
    await held;
  });
  await ready;
  return async () => { release(); await holder; };
}
const queued = (waiting: number) => vi.waitFor(async () => {
  const { rows } = await db.execute(sql`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%depots%'`);
  expect(rows).toHaveLength(waiting);
});

it.each(['start', 'unsend'] as const)('AC-10 lets a start and an unsend that arrive at once both finish, and only the first, the %s, changes anything', async (first) => {
  const { truck, plan } = await sent();
  const sentBoard = await board();
  const send = { start: () => loader.start(truck, plan).then((r) => r), unsend: () => unsend(sentBoard).then((r) => r) };
  const release = await holdDepot();
  let answers: Promise<request.Response>[];
  try {
    const earlier = send[first]();
    await queued(1);
    const later = send[first === 'start' ? 'unsend' : 'start']();
    await queued(2);
    answers = first === 'start' ? [earlier, later] : [later, earlier];
  } finally { await release(); }
  const [started, unsent] = await Promise.all(answers!);
  const [trip] = await db.select().from(trips).where(eq(trips.id, truck.tripId));
  const [stored] = await db.select().from(plans).where(eq(plans.id, plan.id));
  if (first === 'start') {
    expect(started!.status).toBe(200);
    expect(code(unsent!)).toEqual([409, 'loading_started']);
    expect([trip!.status, stored!.status]).toEqual(['loading', 'published']);
  } else {
    expect(unsent!.status).toBe(200);
    expect(code(started!)).toEqual([409, 'plan_changed']);
    expect([trip!.status, trip!.revision, stored!.status]).toEqual(['planned', 0, 'draft']);
  }
});

it('AC-11 refuses a start naming a plan revision that is not the plan\'s with plan_changed, and changes nothing', async () => {
  const { truck, plan } = await sent();
  await db.update(plans).set({ revision: sql`${plans.revision} + 1` }).where(eq(plans.id, plan.id));
  const before = await heldRows();
  const res = await loader.start(truck, plan);
  expect(code(res)).toEqual([409, 'plan_changed']);
  expect(res.body.error.message).toBe('The plan for Thu 25 Jun changed after this screen loaded it.');
  expect(await heldRows()).toEqual(before);
});

it('AC-11 refuses a start on a plan taken back to edit with plan_changed, and changes nothing', async () => {
  const { truck, plan } = await sent();
  expect((await unsend(await board())).status).toBe(200);
  const before = await heldRows();
  const res = await loader.start(truck, plan);
  expect(code(res)).toEqual([409, 'plan_changed']);
  expect(await heldRows()).toEqual(before);
});

it("AC-11 refuses a start once the truck's day is not the loader's with day_moved, and with none left with no_plan_day", async () => {
  const { truck, plan } = await sent();
  const before = await heldRows();
  freeze(THU, 16 * 60);
  const moved = await loader.start(truck, plan);
  expect(code(moved)).toEqual([409, 'day_moved']);
  expect(moved.body.error).toMatchObject({ message: 'Loading has moved on to Fri 26 Jun.', details: { date: '2026-06-26' } });
  freeze('2026-06-27', 16 * 60);
  const none = await loader.start(truck, plan);
  expect(code(none)).toEqual([409, 'no_plan_day']);
  expect(none.body.error.message).toBe('No delivery day is left.');
  expect(await heldRows()).toEqual(before);
});

it('AC-12 refuses as stale a write naming a revision that is not the trip\'s, and changes nothing: two tablets start VEH035', async () => {
  const { truck, plan } = await sent();
  expect((await loader.start(truck, plan)).status).toBe(200);
  const before = await heldRows();
  const second = await loader.start(truck, plan);
  expect(code(second)).toEqual([409, 'stale']);
  expect(second.body.error.message).toBe('VEH035 changed on another screen.');
  // The second tablet's other writes, from the loading truck at a revision that has moved on.
  const behind = { ...truckOf(await loader.read(), 'VEH035'), revision: 0 };
  expect(code(await loader.stopLoaded(behind, 2))).toEqual([409, 'stale']);
  expect(code(await loader.flag(behind, 1, [{ lineId: dryLine(behind).lineId, counted: 3 }]))).toEqual([409, 'stale']);
  expect(code(await loader.ready(behind))).toEqual([409, 'stale']);
  expect(await heldRows()).toEqual(before);
});

it('AC-13 answers each of the four writes sent twice in a row with the day as it is, and writes one audit row for it', async () => {
  const { truck, plan } = await sent();
  const twice = async (write: (writeId: string) => request.Test) => {
    const writeId = randomUUID();
    const first = await write(writeId);
    expect(first.status).toBe(200);
    const again = await write(writeId);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(LoadingDay.parse(again.body)).toEqual(await loader.read());
    return truckOf(LoadingDay.parse(again.body), 'VEH035');
  };
  let loading = await twice((id) => loader.start(truck, plan, id));
  loading = await twice((id) => loader.stopLoaded(loading, 2, id));
  loading = await twice((id) => loader.flag(loading, 1, [{ lineId: dryLine(loading).lineId, counted: 3 }], { note: 'Only 3 dry cartons in the store' }, id));
  loading = answeredTruck(await loader.stopLoaded(loading, 1), 'VEH035');
  await answerFlag(loading.issues[0]!.id, 'go_short', depotInstant(THU, 2 * 60 + 35));
  const answered = truckOf(await loader.read(), 'VEH035');
  loading = await twice((id) => loader.ready(answered, id));
  expect(loading.status).toBe('ready');

  const problems = await db.select().from(issues);
  expect(problems).toHaveLength(1);
  const written = await db.select({ action: auditLog.action }).from(auditLog)
    .where(inArray(auditLog.entityId, [truck.tripId, stopOf(truck, 1).id, stopOf(truck, 2).id, problems[0]!.id]));
  expect(written.map((row) => row.action).sort()).toEqual(['issue.raised', 'stop.loaded', 'stop.loaded', 'trip.loading_started', 'trip.ready']);
});
