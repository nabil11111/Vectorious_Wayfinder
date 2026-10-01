import { randomUUID } from 'node:crypto';
import { DecideIssueResponse, IssueList, PlanBoard, nextStop, type DraftPlan, type DriverTrip, type DriverWrite, type IssueDecision } from '@wayfinder/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { auditLog, demoDay, issueLines, issues, orderLines, orders, stops, trips, users } from '../src/db/schema';
import { issuesOf } from '../src/issues/read';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { snapshot } from '../src/orders/store-orders';
import { answeredTrip, driverScreen, driverStop, driverTrip, driverWrite, heldDriverRows, readyWalkthrough } from './driver-plan';
import { answeredTruck, answerFlag, code, dryLine, kandyTrip, loaderScreen, resetDay, signIn, THU, truckOf, WED, type Walkthrough } from './loading-plan';
import { serve, stop } from './serve';

const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at || clock.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async (original) => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const freeze = (date: string, minute: number) => { const at = depotInstant(date, minute); testClock.at = at.toISOString(); setClockForTests(at); };
const at = (minute: number, date = THU) => depotInstant(date, minute);
const FRI = '2026-06-26';
// Independent phones keep separate request allowances while the real limiter and authentication stay active.
const app = createApp();
app.set('trust proxy', 'loopback');
const server = await serve(app);
const kasun = request.agent(server).set('X-Forwarded-For', '192.0.2.21');
const ruwan = request.agent(server).set('X-Forwarded-For', '192.0.2.22');
const nadeesha = request.agent(server).set('X-Forwarded-For', '192.0.2.23');
const dilshan = request.agent(server).set('X-Forwarded-For', '192.0.2.24');
const admin = request.agent(server).set('X-Forwarded-For', '192.0.2.25');
const walk: Walkthrough & { kasun: typeof kasun } = { nadeesha, ruwan, kasun, freeze };
const driver = driverScreen(dilshan);
const loader = loaderScreen(kasun);
let originalClock: typeof demoDay.$inferSelect;
let dilshanId: string;
let ruwanId: string;

// Complete SOF and scan headers. The server checks the JPEG structure without decoding its pixels.
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0,
  0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0, 0xff, 0xd9]);
const photo = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
const told = () => vi.mocked(announce).mock.calls.map(([change]) => change);
const decide = (id: string, revision: number, decision: string) => ruwan.post(`/api/v1/issues/${id}/decide`).send({ revision, decision });
const auditsOf = (id: string) => db.select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'issue.decided')));

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, username] of [[kasun, 'kasun'], [ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [dilshan, 'dilshan'], [admin, 'admin']] as const) await signIn(agent, username);
  dilshanId = (await db.select().from(users).where(eq(users.username, 'dilshan')))[0]!.id;
  ruwanId = (await db.select().from(users).where(eq(users.username, 'ruwan')))[0]!.id;
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

async function write(trip: DriverTrip, kind: DriverWrite['kind'], minute: number, seq?: number, more: object = {}, date = THU): Promise<DriverTrip> {
  freeze(date, minute);
  return answeredTrip(await driver.send(driverWrite(trip, kind, at(minute, date).toISOString(), seq, more)));
}
async function started(): Promise<DriverTrip> {
  await readyWalkthrough(walk);
  return write(driverTrip(await driver.read()), 'start', 3 * 60 + 31);
}
async function atWellawatte(): Promise<DriverTrip> {
  let trip = await started();
  trip = await write(trip, 'arrive', 3 * 60 + 34, 1);
  trip = await write(trip, 'deliver', 3 * 60 + 38, 1, { photo });
  return write(trip, 'arrive', 3 * 60 + 45, 2);
}
async function refusal(withPhoto = true): Promise<DriverTrip> {
  const trip = await atWellawatte();
  return write(trip, 'refuse', 3 * 60 + 48, 2, { reason: 'damaged', note: '2 chilled cartons crushed',
    lines: [{ lineId: driverStop(trip, 2).lines.find(line => line.temp === 'chilled')!.lineId, refused: 2 }], ...(withPhoto ? { photo } : {}) });
}
async function needsRuwan() {
  const res = await ruwan.get('/api/v1/issues');
  expect(res.status).toBe(200);
  return IssueList.parse(res.body);
}
async function openProblem(seq: number) {
  const problem = (await needsRuwan()).issues.find(problem => problem.kind !== 'loading' && problem.stop.seq === seq);
  if (!problem) throw new Error(`No open driver problem at stop ${seq}.`);
  return problem;
}
async function answer(seq: number, decision: IssueDecision, minute: number) {
  const problem = await openProblem(seq);
  freeze(THU, minute);
  const res = await decide(problem.id, problem.revision, decision);
  expect(res.status).toBe(200);
  return DecideIssueResponse.parse(res.body);
}
async function refusedAnswer(id: string, revision: number, decision: string, status: number, error: string) {
  const before = await heldDriverRows();
  vi.mocked(announce).mockClear();
  const res = await decide(id, revision, decision);
  expect(code(res)).toEqual([status, error]);
  expect(await heldDriverRows()).toEqual(before);
  expect(told()).toEqual([]);
  return res;
}
async function afterCommit(id: string, revision: number, decision: string) {
  let committed = false;
  const transaction = db.transaction.bind(db);
  const spy = vi.spyOn(db, 'transaction').mockImplementation((async (...args: Parameters<typeof db.transaction>) => {
    const result = await transaction(...args); committed = true; return result;
  }) as typeof db.transaction);
  vi.mocked(announce).mockClear();
  vi.mocked(announce).mockImplementation(() => { expect(committed).toBe(true); });
  try { return await decide(id, revision, decision); }
  finally { spy.mockRestore(); vi.mocked(announce).mockImplementation(() => undefined); }
}
async function foreignProblem(kind: 'refused' | 'closed') {
  const other = await kandyTrip();
  const [problem] = await db.insert(issues).values({ kind, reason: kind === 'closed' ? 'nobody_there' : 'damaged',
    stopId: other.stop.id, raisedBy: dilshanId, raisedAt: at(3 * 60 + 40) }).returning();
  await db.insert(issueLines).values({ issueId: problem!.id, orderLineId: other.line.id, counted: kind === 'closed' ? 10 : 2 });
  return problem!;
}

it('AC-30 lists the refusal with its photo, people, stop times and the loaded, delivered and refused cartons', async () => {
  const trip = await refusal();
  const before = await heldDriverRows();
  const list = await needsRuwan();
  const chilled = driverStop(trip, 2).lines.find(line => line.temp === 'chilled')!;
  expect(list.day).toBe(THU);
  expect(list.issues).toEqual([{
    id: trip.problems[0]!.id, revision: 0, kind: 'refused', reason: 'damaged', status: 'open',
    raisedBy: 'Dilshan', raisedAt: at(3 * 60 + 48).toISOString(), note: '2 chilled cartons crushed', hasPhoto: true,
    decision: null, decidedBy: null, decidedAt: null, short: 2,
    trip: { id: trip.tripId, vehicleId: 'VEH035', tripNo: 1, status: 'out', driver: 'Dilshan', stopsLeft: 0, leavesAt: at(4 * 60 + 36).toISOString() },
    stop: { id: driverStop(trip, 2).id, seq: 2, outletId: 'OUT002', shopName: 'Fresh Wellawatte', arrivedAt: at(3 * 60 + 45).toISOString(),
      doneAt: at(3 * 60 + 48).toISOString(), loadedAt: at(2 * 60 + 31).toISOString(), flaggedAtDock: false },
    lines: [{ lineId: chilled.lineId, orderId: chilled.orderId, temp: 'chilled', productId: 'fresh-chilled-carton', name: 'Chilled carton',
      unit: 'carton', quantity: 48, counted: 2, loaded: 48, delivered: 46 }],
  }]);
  expect(await heldDriverRows()).toEqual(before);
});

it('AC-31 brings refused goods back without changing the completed delivery and announces the answer after commit', async () => {
  const trip = await refusal();
  const open = await openProblem(2);
  for (const decision of ['try_again', 'go_short', 'load_all']) await refusedAnswer(open.id, open.revision, decision, 400, 'invalid_input');
  const before = await heldDriverRows();
  freeze(THU, 3 * 60 + 52);
  const res = await afterCommit(open.id, open.revision, 'bring_back');
  expect(res.status).toBe(200);
  const result = DecideIssueResponse.parse(res.body);
  expect(result).toEqual({ day: THU, issues: [], decided: { ...open, revision: 1, status: 'decided', decision: 'bring_back',
    decidedBy: 'Ruwan', decidedAt: at(3 * 60 + 52).toISOString() } });
  expect((await db.select().from(issues).where(eq(issues.id, open.id)))[0]).toMatchObject({ status: 'decided', revision: 1, decision: 'bring_back', decidedBy: ruwanId, decidedAt: at(3 * 60 + 52) });
  const audit = await auditsOf(open.id);
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({ actorId: ruwanId, entity: 'issue', before: { status: 'open', revision: 0 }, after: { status: 'decided', revision: 1, decision: 'bring_back' } });
  expect(told()).toEqual([{ topic: 'issues', depotId: 'Peliyagoda' }, { topic: 'driver', depotId: 'Peliyagoda' }]);
  const after = await heldDriverRows();
  for (const key of ['trips', 'stops', 'orders', 'lines', 'writes', 'photos'] as const) expect(after[key]).toEqual(before[key]);
  const seen = driverTrip(await driver.read());
  expect(seen.problems).toEqual([{ ...trip.problems[0], decision: 'bring_back', decidedBy: 'Ruwan', decidedAt: at(3 * 60 + 52).toISOString() }]);
  expect(driverStop(seen, 2)).toEqual(driverStop(trip, 2));
});

it('AC-26/32 reopens a closed stop, preserves last event and loaded orders, and refuses finishing with that stop left', async () => {
  const closed = await write(await atWellawatte(), 'closed', 3 * 60 + 48, 2);
  const oldStop = driverStop(closed, 2);
  const before = await heldDriverRows();
  const problem = await openProblem(2);
  freeze(THU, 3 * 60 + 52);
  const res = await afterCommit(problem.id, problem.revision, 'try_again');
  expect(res.status).toBe(200);
  const result = DecideIssueResponse.parse(res.body);
  expect(result.decided).toMatchObject({ status: 'decided', revision: 1, decision: 'try_again', decidedBy: 'Ruwan', decidedAt: at(3 * 60 + 52).toISOString() });
  expect(told()).toEqual([{ topic: 'issues', depotId: 'Peliyagoda' }, { topic: 'driver', depotId: 'Peliyagoda' }]);
  const seen = driverTrip(await driver.read());
  expect(driverStop(seen, 2)).toEqual({ ...oldStop, revision: oldStop.revision + 1, arrivedAt: null, doneAt: null, outcome: null, retriedAt: at(3 * 60 + 52).toISOString() });
  expect((await db.select().from(trips).where(eq(trips.id, closed.tripId)))[0]).toMatchObject({ lastEventAt: at(3 * 60 + 48) });
  const after = await heldDriverRows();
  expect(after.orders).toEqual(before.orders);
  expect(after.lines).toEqual(before.lines);
  expect(after.orders.filter(order => oldStop.lines.some(line => line.orderId === order.id)).map(order => order.status)).toEqual(['loaded', 'loaded']);
  const held = await heldDriverRows();
  vi.mocked(announce).mockClear();
  const finish = await driver.send(driverWrite(seen, 'finish', at(3 * 60 + 53).toISOString()));
  expect(code(finish)).toEqual([409, 'stops_left']);
  expect(finish.body.error.details).toEqual({ stopSeqs: [2] });
  expect(await heldDriverRows()).toEqual(held);
  expect(told()).toEqual([]);
  freeze(THU, 3 * 60 + 53);
  const arrived = answeredTrip(await driver.send(driverWrite(seen, 'arrive', at(3 * 60 + 40).toISOString(), 2)));
  expect(driverStop(arrived, 2).arrivedAt).toBe(at(3 * 60 + 48).toISOString());
});

it('AC-32 refuses trying a closed shop again once its trip is done without changing any rows', async () => {
  const closed = await write(await atWellawatte(), 'closed', 3 * 60 + 48, 2);
  await write(closed, 'finish', 3 * 60 + 50);
  const problem = await openProblem(2);
  await refusedAnswer(problem.id, problem.revision, 'try_again', 409, 'trip_not_out');
});

it('AC-33 retries closed shops after untouched stops and then in the order each was sent back', async () => {
  let trip = await write(await started(), 'arrive', 3 * 60 + 34, 1);
  trip = await write(trip, 'closed', 3 * 60 + 38, 1);
  await answer(1, 'try_again', 3 * 60 + 39);
  trip = driverTrip(await driver.read());
  expect(nextStop(trip)?.seq).toBe(2);
  const before = await heldDriverRows();
  vi.mocked(announce).mockClear();
  const early = await driver.send(driverWrite(trip, 'arrive', at(3 * 60 + 40).toISOString(), 1));
  expect(code(early)).toEqual([409, 'not_next']);
  expect(early.body.error.details).toEqual({ stopSeq: 2 });
  expect(await heldDriverRows()).toEqual(before);
  expect(told()).toEqual([]);
  trip = await write(trip, 'arrive', 3 * 60 + 41, 2);
  trip = await write(trip, 'closed', 3 * 60 + 42, 2);
  await answer(2, 'try_again', 3 * 60 + 43);
  trip = driverTrip(await driver.read());
  expect(nextStop(trip)?.seq).toBe(1);
  trip = await write(trip, 'arrive', 3 * 60 + 44, 1);
  trip = await write(trip, 'closed', 3 * 60 + 45, 1);
  await answer(1, 'try_again', 3 * 60 + 46);
  trip = driverTrip(await driver.read());
  expect(nextStop(trip)?.seq).toBe(2);
  trip = await write(trip, 'arrive', 3 * 60 + 47, 2);
  trip = await write(trip, 'deliver', 3 * 60 + 48, 2, { photo });
  expect(nextStop(trip)?.seq).toBe(1);
  trip = await write(trip, 'arrive', 3 * 60 + 49, 1);
  trip = await write(trip, 'deliver', 3 * 60 + 50, 1, { photo });
  expect(trip.stops.map(stop => stop.outcome)).toEqual(['delivered', 'delivered']);
  expect(nextStop(trip)).toBeNull();
});

it.each([
  { clock: 'waits', answerMinute: 3 * 60 + 41 },
  { clock: 'moves backward', answerMinute: 3 * 60 + 40 },
])('AC-33 keeps the order shops were sent back when the app clock $clock', async ({ answerMinute }) => {
  let trip = await write(await started(), 'arrive', 3 * 60 + 34, 1);
  trip = await write(trip, 'closed', 3 * 60 + 35, 1);
  await answer(1, 'try_again', 3 * 60 + 36);
  trip = driverTrip(await driver.read());
  trip = await write(trip, 'arrive', 3 * 60 + 37, 2);
  trip = await write(trip, 'closed', 3 * 60 + 38, 2);
  trip = await write(trip, 'arrive', 3 * 60 + 39, 1);
  trip = await write(trip, 'closed', 3 * 60 + 40, 1);
  const before = await heldDriverRows();
  // Wellawatte goes back before Nugegoda, so sequence cannot break a clock tie.
  const wellawatte = await answer(2, 'try_again', 3 * 60 + 41);
  const nugegoda = await answer(1, 'try_again', answerMinute);
  const seen = driverTrip(await driver.read());
  expect(driverStop(seen, 2)).toEqual({ ...driverStop(trip, 2), revision: driverStop(trip, 2).revision + 1,
    arrivedAt: null, doneAt: null, outcome: null, retriedAt: at(3 * 60 + 41).toISOString() });
  expect(driverStop(seen, 1)).toEqual({ ...driverStop(trip, 1), revision: driverStop(trip, 1).revision + 1,
    arrivedAt: null, doneAt: null, outcome: null, retriedAt: new Date(at(3 * 60 + 41).getTime() + 1).toISOString() });
  expect(nextStop(seen)?.seq).toBe(2);
  for (const [decided, minute] of [[wellawatte.decided, 3 * 60 + 41], [nugegoda.decided, answerMinute]] as const) {
    expect(decided.decidedAt).toBe(at(minute).toISOString());
    expect(await auditsOf(decided.id)).toEqual([expect.objectContaining({ after: expect.objectContaining({ decidedAt: at(minute).toISOString() }) })]);
  }
  const after = await heldDriverRows();
  for (const key of ['trips', 'orders', 'lines', 'writes', 'photos'] as const) expect(after[key]).toEqual(before[key]);
  expect(after.trips.find(row => row.id === trip.tripId)!.lastEventAt).toEqual(at(3 * 60 + 40));
  const arrived = await write(seen, 'arrive', 3 * 60 + 42, 2);
  expect(driverStop(arrived, 2).arrivedAt).toBe(at(3 * 60 + 42).toISOString());
});

it('AC-34 brings closed goods back as placed orders, keeps the attempt in the audit and driver day, and carries them to Friday', async () => {
  const closed = await write(await atWellawatte(), 'closed', 3 * 60 + 48, 2);
  const oldStop = driverStop(closed, 2);
  const open = await openProblem(2);
  const ids = oldStop.lines.map(line => line.orderId);
  const beforeOrders = await db.select().from(orders).where(inArray(orders.id, ids));
  const beforeStop = (await db.select().from(stops).where(eq(stops.id, oldStop.id)))[0]!;
  freeze(THU, 3 * 60 + 52);
  expect((await afterCommit(open.id, open.revision, 'bring_back')).status).toBe(200);
  const returned = await db.select().from(orders).where(inArray(orders.id, ids));
  expect(returned).toHaveLength(2);
  for (const order of returned) expect(order).toMatchObject({ status: 'placed', revision: beforeOrders.find(previous => previous.id === order.id)!.revision + 1 });
  const lines = await db.select().from(orderLines).where(inArray(orderLines.orderId, ids));
  expect(lines.map(line => [line.loadedQty, line.deliveredQty])).toEqual([[null, null], [null, null]]);
  expect((await db.select().from(stops).where(eq(stops.id, oldStop.id)))[0]).toEqual(beforeStop);
  const audit = await auditsOf(open.id);
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({ actorId: ruwanId, before: { lines: expect.arrayContaining(oldStop.lines.map(line => ({ lineId: line.lineId, loaded: line.loaded, delivered: null }))) } });
  expect(told()).toEqual([{ topic: 'issues', depotId: 'Peliyagoda' }, { topic: 'driver', depotId: 'Peliyagoda' }, { topic: 'orders', outletId: 'OUT002', depotId: 'Peliyagoda' }]);
  expect(driverStop(driverTrip(await driver.read()), 2)).toEqual(oldStop);
  freeze(THU, 16 * 60);
  const board = PlanBoard.parse((await ruwan.get('/api/v1/plans')).body);
  expect(board.day?.date).toBe(FRI);
  expect(board.orders.filter(order => ids.includes(order.id))).toHaveLength(2);
  expect(board.orders.filter(order => ids.includes(order.id)).every(order => order.carriedOver)).toBe(true);
});

it('AC-35 replans and reloads Nugegoda on Friday with a second dry flag, while Thursday keeps its own closed counts', async () => {
  let trip = await write(await started(), 'arrive', 3 * 60 + 34, 1);
  trip = await write(trip, 'closed', 3 * 60 + 38, 1);
  const oldStop = driverStop(trip, 1);
  const oldProblem = await openProblem(1);
  await answer(1, 'bring_back', 3 * 60 + 39);
  trip = driverTrip(await driver.read());
  trip = await write(trip, 'arrive', 3 * 60 + 45, 2);
  trip = await write(trip, 'deliver', 3 * 60 + 48, 2, { photo });
  await write(trip, 'finish', 3 * 60 + 55);

  freeze(THU, 16 * 60);
  const board = PlanBoard.parse((await ruwan.get('/api/v1/plans')).body);
  expect(board.day?.date).toBe(FRI);
  const ids = oldStop.lines.map(line => line.orderId);
  expect(board.orders.filter(order => ids.includes(order.id))).toHaveLength(3);
  const draft: DraftPlan = { mixBrands: false, trips: [{ vehicleId: 'VEH035', tripNo: 1, leaveAt: null, driverId: dilshanId,
    stops: [{ outletId: 'OUT001', orderIds: ids }] }], deferrals: board.orders.filter(order => !ids.includes(order.id))
    .map(order => ({ orderId: order.id, code: 'dispatcher_choice', reason: 'Scheduled for a later run.' })) };
  const saved = await ruwan.put(`/api/v1/plans/${FRI}/draft`).send({ planId: null, demoDay: board.demoDay, plan: draft });
  expect(saved.status).toBe(200);
  const ready = PlanBoard.parse(saved.body);
  expect(ready.check!.ok).toBe(true);
  expect((await ruwan.post(`/api/v1/plans/${FRI}/send`).send({ planId: ready.plan.id, revision: ready.plan.revision })).status).toBe(200);
  freeze(FRI, 2 * 60 + 30);
  const loading = await loader.read();
  let truck = answeredTruck(await loader.start(truckOf(loading, 'VEH035'), loading.plan!), 'VEH035');
  truck = answeredTruck(await loader.flag(truck, 1, [{ lineId: dryLine(truck).lineId, counted: 2 }]), 'VEH035');
  expect(truck.issues).toHaveLength(1);
  const secondFlag = truck.issues[0]!;
  expect(secondFlag).toMatchObject({ kind: 'loading', stop: { id: truck.stops[0]!.id }, lines: [expect.objectContaining({ lineId: oldStop.lines.find(line => line.temp === 'dry')!.lineId, counted: 2 })] });
  expect(secondFlag.stop.id).not.toBe(oldStop.id);
  await answerFlag(ruwan, secondFlag.id, 'go_short');
  truck = truckOf(await loader.read(), 'VEH035');
  truck = answeredTruck(await loader.stopLoaded(truck, 1), 'VEH035');
  truck = answeredTruck(await loader.ready(truck), 'VEH035');
  expect(truck.on.units).toBe(22);
  trip = driverTrip(await driver.read());
  trip = await write(trip, 'start', 3 * 60 + 31, undefined, {}, FRI);
  trip = await write(trip, 'arrive', 3 * 60 + 34, 1, {}, FRI);
  trip = await write(trip, 'deliver', 3 * 60 + 38, 1, { photo }, FRI);
  expect(driverStop(trip, 1).lines.map(line => line.delivered)).toEqual([12, 8, 2]);
  await write(trip, 'finish', 3 * 60 + 40, undefined, {}, FRI);

  freeze(THU, 3 * 60 + 55);
  const historical = driverStop(driverTrip(await driver.read()), 1);
  expect(historical).toEqual(oldStop);
  expect(historical.lines.map(line => [line.loaded, line.delivered])).toEqual([[12, null], [8, null], [3, null]]);
  const [problem] = await snapshot(tx => issuesOf(tx, eq(issues.id, oldProblem.id)));
  expect(problem).toMatchObject({ kind: 'closed', status: 'decided', decision: 'bring_back', stop: { id: oldStop.id, arrivedAt: oldStop.arrivedAt, doneAt: oldStop.doneAt } });
  expect(problem!.lines.map(line => [line.counted, line.loaded, line.delivered])).toEqual([[12, 12, null], [8, 8, null], [3, 3, null]]);
});

it.each(['refused', 'closed'] as const)('AC-36 keeps stale and unknown_record checks for a %s problem and rejects decisions of another kind without changes', async (kind) => {
  if (kind === 'refused') await refusal();
  else await write(await atWellawatte(), 'closed', 3 * 60 + 48, 2);
  const problem = await openProblem(2);
  const foreign = await foreignProblem(kind);
  for (const decision of ['go_short', 'load_all', ...(kind === 'refused' ? ['try_again'] : [])]) {
    const invalid = await refusedAnswer(problem.id, problem.revision, decision, 400, 'invalid_input');
    expect(invalid.body.error.message).toBe('That answer does not fit this problem.');
  }
  await refusedAnswer(problem.id, problem.revision + 1, 'bring_back', 409, 'stale');
  const elsewhere = await refusedAnswer(foreign.id, foreign.revision, 'bring_back', 400, 'unknown_record');
  expect(elsewhere.body.error.details).toEqual({ id: foreign.id });
  const missing = randomUUID();
  const unknown = await refusedAnswer(missing, 0, 'bring_back', 400, 'unknown_record');
  expect(unknown.body.error.details).toEqual({ id: missing });
  expect((await decide(problem.id, problem.revision, 'bring_back')).status).toBe(200);
  for (const revision of [problem.revision, problem.revision + 1]) await refusedAnswer(problem.id, revision, 'bring_back', 409, 'stale');
});

it('AC-5 protects the photo before parsing its id for signed-out, driver, loader, store and admin callers', async () => {
  const before = await heldDriverRows();
  const path = '/api/v1/issues/not-a-problem/photo';
  expect(code(await request(server).get(path))).toEqual([401, 'signed_out']);
  for (const agent of [dilshan, kasun, nadeesha]) expect(code(await agent.get(path))).toEqual([403, 'forbidden']);
  expect(code(await admin.get(path))).toEqual([403, 'no_depot']);
  expect(await heldDriverRows()).toEqual(before);
  expect(told()).toEqual([]);
});

it('AC-37 returns the exact refusal JPEG read-only, scopes it to the depot and validates the problem id', async () => {
  const trip = await refusal();
  const problem = trip.problems[0]!;
  const foreign = await foreignProblem('refused');
  const before = await heldDriverRows();
  vi.mocked(announce).mockClear();
  const res = await ruwan.get(`/api/v1/issues/${problem.id}/photo`).buffer(true);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/^image\/jpeg(?:;|$)/);
  expect(res.headers['cache-control']).toBe('private, no-store');
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
  expect(res.body).toEqual(jpeg);
  const other = await ruwan.get(`/api/v1/issues/${foreign.id}/photo`);
  expect(code(other)).toEqual([400, 'unknown_record']);
  expect(other.body.error.details).toEqual({ id: foreign.id });
  const missing = randomUUID();
  expect(code(await ruwan.get(`/api/v1/issues/${missing}/photo`))).toEqual([400, 'unknown_record']);
  expect(code(await ruwan.get('/api/v1/issues/not-a-problem/photo'))).toEqual([400, 'invalid_input']);
  expect(await heldDriverRows()).toEqual(before);
  expect(told()).toEqual([]);
});

it('AC-37 answers not_found for a driver problem saved without a photo and changes nothing', async () => {
  const trip = await refusal(false);
  const before = await heldDriverRows();
  vi.mocked(announce).mockClear();
  const res = await ruwan.get(`/api/v1/issues/${trip.problems[0]!.id}/photo`);
  expect(code(res)).toEqual([404, 'not_found']);
  expect(res.body.error.message).toBe('This problem has no photo.');
  expect(await heldDriverRows()).toEqual(before);
  expect(told()).toEqual([]);
});
