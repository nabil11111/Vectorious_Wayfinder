import { randomUUID } from 'node:crypto';
import { DecideIssueResponse, IssueList } from '@wayfinder/contracts';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { auditLog, demoDay, issueLines, issues, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import {
  answeredTruck, code, dryLine, heldRows, kandyTrip, loaderScreen, resetDay, sendWalkthroughPlan, signIn, stopOf, THU, truckOf, WED, type Walkthrough,
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
let ruwanId: string;
let prasannaId: string;

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, username] of [[kasun, 'kasun'], [ruwan, 'ruwan'], [nadeesha, 'nadeesha']] as const) await signIn(agent, username);
  ruwanId = (await db.select().from(users).where(eq(users.username, 'ruwan')))[0]!.id;
  prasannaId = (await db.select().from(users).where(eq(users.username, 'prasanna')))[0]!.id;
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

// The walkthrough to step 4: Kasun starts VEH035, loads stop 2 and flags Nugegoda's dry line short at 3 of 4 at 02:33.
async function flagged({ withVeh004 = false } = {}) {
  await sendWalkthroughPlan(walk, { withVeh004 });
  const day = await loader.read();
  let truck = answeredTruck(await loader.start(truckOf(day, 'VEH035'), day.plan!), 'VEH035');
  truck = answeredTruck(await loader.stopLoaded(truck, 2), 'VEH035');
  freeze(THU, 2 * 60 + 33);
  truck = answeredTruck(await loader.flag(truck, 1, [{ lineId: dryLine(truck).lineId, counted: 3 }], { note: 'Only 3 dry cartons in the store' }), 'VEH035');
  return { plan: day.plan!, truck };
}
// An open problem of the Kandy depot, raised before any of Peliyagoda's.
async function kandyProblem() {
  const kandy = await kandyTrip();
  const [problem] = await db.insert(issues).values({ kind: 'loading', reason: 'short', stopId: kandy.stop.id, raisedBy: prasannaId, raisedAt: depotInstant(THU, 2 * 60) }).returning();
  await db.insert(issueLines).values({ issueId: problem!.id, orderLineId: kandy.line.id, counted: 5 });
  return problem!;
}
const needsRuwan = async () => {
  const res = await ruwan.get('/api/v1/issues');
  expect(res.status).toBe(200);
  return IssueList.parse(res.body);
};
const decide = (issueId: string, revision: number, decision: string) => ruwan.post(`/api/v1/issues/${issueId}/decide`).send({ revision, decision });

it("AC-18 lists the depot's open problems oldest first, each with its truck and leaving time, stop, shop, lines, note, raiser and time", async () => {
  const { plan, truck } = await flagged({ withVeh004: true });
  // A second flag a minute later on VEH004, and a Kandy problem older than both, which is not Ruwan's.
  let veh004 = answeredTruck(await loader.start(truckOf(await loader.read(), 'VEH004'), plan), 'VEH004');
  freeze(THU, 2 * 60 + 34);
  const kandana = stopOf(veh004, 2).lines[0]!;
  veh004 = answeredTruck(await loader.flag(veh004, 2, [{ lineId: kandana.lineId, counted: 38 }], { reason: 'damaged' }), 'VEH004');
  await kandyProblem();

  const list = await needsRuwan();
  expect(list.day).toBe(THU);
  expect(list.issues.map((problem) => problem.trip.vehicleId)).toEqual(['VEH035', 'VEH004']);
  const dry = dryLine(truck);
  expect(list.issues[0]).toEqual({
    id: truck.issues[0]!.id, revision: 0, kind: 'loading', reason: 'short', status: 'open', raisedBy: 'Kasun', raisedAt: depotInstant(THU, 2 * 60 + 33).toISOString(),
    note: 'Only 3 dry cartons in the store', hasPhoto: false, decision: null, decidedBy: null, decidedAt: null, short: 1,
    trip: { id: truck.tripId, vehicleId: 'VEH035', tripNo: 1, status: 'loading', driver: 'Dilshan', stopsLeft: 2, leavesAt: depotInstant(THU, 4 * 60 + 36).toISOString() },
    stop: { id: stopOf(truck, 1).id, seq: 1, outletId: 'OUT001', shopName: 'Fresh Nugegoda', arrivedAt: null, doneAt: null, loadedAt: null, flaggedAtDock: true },
    lines: [{ lineId: dry.lineId, orderId: dry.orderId, temp: 'dry', productId: 'fresh-dry-carton', name: 'Dry carton', unit: 'carton', quantity: 4, counted: 3, loaded: null, delivered: null }],
  });
  expect(list.issues[1]).toMatchObject({
    reason: 'damaged', status: 'open', raisedBy: 'Kasun', raisedAt: depotInstant(THU, 2 * 60 + 34).toISOString(), note: null, short: 2,
    trip: { id: veh004.tripId, vehicleId: 'VEH004', tripNo: 1, leavesAt: depotInstant(THU, 3 * 60 + 30).toISOString() },
    stop: { seq: 2, outletId: 'OUT028', shopName: 'Fresh Kandana' },
    lines: [{ lineId: kandana.lineId, temp: 'chilled', quantity: 40, counted: 38 }],
  });
});

it('AC-19 answers "Go short": decided by Ruwan at the clock, its revision up, the open list without it and the decided problem, told after the commit, and the loader sees it', async () => {
  const { truck } = await flagged();
  const [open] = (await needsRuwan()).issues;
  freeze(THU, 2 * 60 + 35);
  vi.mocked(announce).mockClear();
  let committed = false;
  const transaction = db.transaction.bind(db);
  const spy = vi.spyOn(db, 'transaction').mockImplementation((async (...args: Parameters<typeof db.transaction>) => {
    const answer = await transaction(...args); committed = true; return answer;
  }) as typeof db.transaction);
  vi.mocked(announce).mockImplementation(() => { expect(committed).toBe(true); });
  let res: request.Response;
  try { res = await decide(open!.id, open!.revision, 'go_short'); } finally { spy.mockRestore(); }

  expect(res!.status).toBe(200);
  const answer = DecideIssueResponse.parse(res!.body);
  const decidedAt = depotInstant(THU, 2 * 60 + 35);
  expect(answer).toEqual({ day: THU, issues: [], decided: { ...open, status: 'decided', revision: 1, decision: 'go_short', decidedBy: 'Ruwan', decidedAt: decidedAt.toISOString() } });
  expect((await db.select().from(issues).where(eq(issues.id, open!.id)))[0]).toMatchObject({ status: 'decided', revision: 1, decision: 'go_short', decidedBy: ruwanId, decidedAt });
  const audits = await db.select().from(auditLog).where(and(eq(auditLog.entityId, open!.id), eq(auditLog.action, 'issue.decided')));
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ actorId: ruwanId, entity: 'issue', before: { status: 'open', revision: 0 }, after: { status: 'decided', decision: 'go_short', revision: 1 } });
  expect(vi.mocked(announce).mock.calls.map(([change]) => change)).toEqual([{ topic: 'issues', depotId: 'Peliyagoda' }, { topic: 'loading', depotId: 'Peliyagoda' }]);

  const seen = truckOf(await loader.read(), 'VEH035');
  expect(seen.revision).toBe(truck.revision);
  expect(seen.issues).toEqual([answer.decided]);
  expect(dryLine(seen)).toMatchObject({ quantity: 4, going: 3, short: 1 });
  expect(seen.short).toBe(1);
});

it('AC-20 answers "Load it all": the dry line goes out at 4, the truck has nothing short and leaves with all 118 cartons', async () => {
  const { truck } = await flagged();
  const [open] = (await needsRuwan()).issues;
  expect((await decide(open!.id, open!.revision, 'load_all')).status).toBe(200);
  let seen = truckOf(await loader.read(), 'VEH035');
  expect(dryLine(seen)).toMatchObject({ quantity: 4, going: 4, short: 0 });
  expect(stopOf(seen, 1)).toMatchObject({ units: 24, going: 24, short: 0 });
  expect(seen.short).toBe(0);
  // What the flag found stays on the answered problem.
  expect(seen.issues).toEqual([expect.objectContaining({ id: truck.issues[0]!.id, status: 'decided', decision: 'load_all', short: 1 })]);
  seen = answeredTruck(await loader.stopLoaded(seen, 1), 'VEH035');
  const ready = answeredTruck(await loader.ready(seen), 'VEH035');
  expect(ready).toMatchObject({ status: 'ready', short: 0, on: { units: 118, kg: 814.2, m3: 4.366 } });
});

it("AC-21 refuses an old revision or a problem already answered as stale, another depot's problem as unknown_record and an answer not in the list as invalid_input, changing nothing", async () => {
  await flagged();
  const [open] = (await needsRuwan()).issues;
  const kandy = await kandyProblem();
  let before = await heldRows();
  const old = await decide(open!.id, open!.revision + 1, 'go_short');
  expect(code(old)).toEqual([409, 'stale']);
  expect(old.body.error.message).toBe('This problem was already answered.');
  const other = await decide(kandy.id, kandy.revision, 'go_short');
  expect(code(other)).toEqual([400, 'unknown_record']);
  expect(other.body.error.details).toEqual({ id: kandy.id });
  const nobody = randomUUID();
  expect((await decide(nobody, 0, 'go_short')).body.error).toMatchObject({ code: 'unknown_record', details: { id: nobody } });
  expect(code(await decide(open!.id, open!.revision, 'call_the_shop'))).toEqual([400, 'invalid_input']);
  expect(code(await ruwan.post('/api/v1/issues/not-a-problem/decide').send({ revision: 0, decision: 'go_short' }))).toEqual([400, 'invalid_input']);
  expect(await heldRows()).toEqual(before);

  expect((await decide(open!.id, open!.revision, 'go_short')).status).toBe(200);
  before = await heldRows();
  expect(code(await decide(open!.id, open!.revision, 'load_all'))).toEqual([409, 'stale']);
  expect(code(await decide(open!.id, open!.revision + 1, 'load_all'))).toEqual([409, 'stale']);
  expect(await heldRows()).toEqual(before);
});

it('AC-21 answers only one of two tabs that answer at once, and refuses the other as stale', async () => {
  await flagged();
  const [open] = (await needsRuwan()).issues;
  const answers = await Promise.all([decide(open!.id, open!.revision, 'go_short'), decide(open!.id, open!.revision, 'load_all')]);
  expect(answers.map((res) => res.status).sort()).toEqual([200, 409]);
  expect(answers.find((res) => res.status === 409)!.body.error.code).toBe('stale');
  const decided = (await db.select().from(issues).where(eq(issues.id, open!.id)))[0]!;
  expect(decided).toMatchObject({ status: 'decided', revision: 1 });
  expect(decided.decision).toBe(DecideIssueResponse.parse(answers.find((res) => res.status === 200)!.body).decided.decision);
});
