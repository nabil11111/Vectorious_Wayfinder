import { randomUUID } from 'node:crypto';
import { IssueList, phoneView, type DriverDay, type DriverWrite, type DriverWriteKind } from '@wayfinder/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool, type Tx } from '../src/db/client';
import { clearDemoDay, seedDemoDay } from '../src/db/demo-day';
import { auditLog, demoDay, phoneWrites, issueLines, issues, orderLines, orders, photos, plans, stopOrders, stops, trips, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { answeredDay, answeredTrip, driverScreen, driverStop, driverTrip, driverWrite, heldDriverRows, readyWalkthrough } from './driver-plan';
import { code, resetDay, signIn, THU, WED, type Walkthrough } from './loading-plan';
import { serve, stop } from './serve';

const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at || clock.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async (original) => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
// Pause the full answer after its stops were read, before its problems are read. The first call belongs
// to validation under the written trip's lock; the second belongs to the answer across all owned trips.
const answerRead = vi.hoisted(() => ({ countdown: -1, paused: false, release: Promise.resolve() }));
vi.mock('../src/issues/read', async (original) => {
  const read = await original<typeof import('../src/issues/read')>();
  return { ...read, issuesOf: async (...args: Parameters<typeof read.issuesOf>) => {
    if (answerRead.countdown >= 0 && answerRead.countdown-- === 0) {
      answerRead.paused = true;
      await answerRead.release;
    }
    return read.issuesOf(...args);
  } };
});
const at = (minute: number) => depotInstant(THU, minute).toISOString();
const setInstant = (instant: string) => { testClock.at = instant; setClockForTests(new Date(instant)); };
const freeze = (date: string, minute: number) => setInstant(depotInstant(date, minute).toISOString());
// These independent phones have separate addresses, so repeated walkthrough fixtures do not consume one
// shared 300/minute request allowance. The application’s limiter and authentication stay active.
const app = createApp();
app.set('trust proxy', 'loopback');
const server = await serve(app);
const kasun = request.agent(server).set('X-Forwarded-For', '192.0.2.11');
const ruwan = request.agent(server).set('X-Forwarded-For', '192.0.2.12');
const nadeesha = request.agent(server).set('X-Forwarded-For', '192.0.2.13');
const dilshan = request.agent(server).set('X-Forwarded-For', '192.0.2.14');
const chaminda = request.agent(server).set('X-Forwarded-For', '192.0.2.15');
const walk: Walkthrough & { kasun: typeof kasun } = { nadeesha, ruwan, kasun, freeze };
const driver = driverScreen(dilshan);
let originalClock: typeof demoDay.$inferSelect;
let chamindaId: string;
let ruwanId: string;
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 1, 0, 1, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0,
  0xff, 0xda, 0, 12, 3, 1, 0, 2, 17, 3, 17, 0, 63, 0, 0, 0xff, 0xd9]);
const photo = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
const auditsOf = (id: string, action: string) => db.select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, action)));
const actionOf = (kind: DriverWriteKind) => ({ start: 'trip.started', finish: 'trip.finished', arrive: 'stop.arrived', deliver: 'stop.delivered', refuse: 'stop.refused', closed: 'stop.closed' })[kind];
const entityOf = (write: DriverWrite) => 'stopId' in write ? write.stopId : write.tripId;

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, username] of [[kasun, 'kasun'], [ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [dilshan, 'dilshan'], [chaminda, 'chaminda']] as const) await signIn(agent, username);
  chamindaId = (await db.select().from(users).where(eq(users.username, 'chaminda')))[0]!.id;
  ruwanId = (await db.select().from(users).where(eq(users.username, 'ruwan')))[0]!.id;
});
beforeEach(async () => {
  await resetDay();
  await initClock();
  freeze(WED, 16 * 60);
  vi.mocked(announce).mockReset();
  answerRead.countdown = -1;
  answerRead.paused = false;
});
afterAll(async () => {
  await resetDay();
  await db.update(demoDay).set(originalClock);
  testClock.at = '';
  setClockForTests(null);
  await stop(server);
  await pool.end();
});

async function ready(options: { withVeh004?: boolean } = {}): Promise<DriverDay> {
  await readyWalkthrough(walk, options);
  return driver.read();
}
async function apply(day: DriverDay, kind: DriverWriteKind, minute: number, seq?: number, more: object = {}): Promise<DriverDay> {
  freeze(THU, minute);
  return answeredDay(await driver.send(driverWrite(driverTrip(day), kind, at(minute), seq, more)));
}
async function firstDelivered(): Promise<DriverDay> {
  let day = await apply(await ready(), 'start', 211);
  day = await apply(day, 'arrive', 214, 1);
  return apply(day, 'deliver', 218, 1, { photo });
}
async function pending(kind: DriverWriteKind): Promise<DriverWrite> {
  let day = await ready();
  if (kind === 'start') { freeze(THU, 211); return driverWrite(driverTrip(day), kind, at(211)); }
  day = await apply(day, 'start', 211);
  if (kind === 'arrive') { freeze(THU, 214); return driverWrite(driverTrip(day), kind, at(214), 1); }
  day = await apply(day, 'arrive', 214, 1);
  if (kind === 'finish') {
    day = await apply(day, 'deliver', 218, 1, { photo });
    day = await apply(day, 'arrive', 225, 2);
    day = await apply(day, 'closed', 228, 2);
    freeze(THU, 235);
    return driverWrite(driverTrip(day), kind, at(235));
  }
  freeze(THU, 218);
  const more = kind === 'deliver' ? { photo } : kind === 'refuse'
    ? { photo, reason: 'damaged', note: '', lines: [{ lineId: driverStop(driverTrip(day), 1).lines[0]!.lineId, refused: 1 }] }
    : { photo, note: 'Lights off, gate locked' };
  return driverWrite(driverTrip(day), kind, at(218), 1, more);
}
// The only row field a successful replay may change is its real answered time.
async function durableRows() {
  const held = await heldDriverRows();
  return { ...held, writes: held.writes.map(({ answeredAt: _answeredAt, ...write }) => write) };
}
async function rejected(body: object, error: string, agent = dilshan, details?: object) {
  const before = await heldDriverRows();
  vi.mocked(announce).mockClear();
  const res = await agent.post('/api/v1/driver/writes').send(body);
  expect(code(res)).toEqual([409, error]);
  if (details) expect(res.body.error.details).toEqual(details);
  expect(await heldDriverRows()).toEqual(before);
  expect(announce).not.toHaveBeenCalled();
  return res;
}

it.each(['start', 'arrive', 'deliver', 'refuse', 'closed', 'finish'] as const)('AC-22 applies concurrent copies of %s once, then answers the same record again', async kind => {
  const write = await pending(kind);
  vi.mocked(announce).mockClear();
  const responses = await Promise.all([driver.send(write), driver.send(write)]);
  expect(responses.map(res => res.status)).toEqual([200, 200]);
  const day = await driver.read();
  for (const res of responses) expect(answeredDay(res)).toEqual(day);
  expect(day.appliedWriteIds.filter(id => id === write.writeId)).toEqual([write.writeId]);
  expect(await auditsOf(entityOf(write), actionOf(kind))).toHaveLength(1);
  expect(vi.mocked(announce).mock.calls.filter(([change]) => change.topic === 'driver')).toHaveLength(1);
  const before = await durableRows();
  vi.mocked(announce).mockClear();
  // Reordering JSON keys changes no parsed content or identity.
  const reversed = Object.fromEntries(Object.entries(write).reverse());
  expect(answeredDay(await driver.send(reversed))).toEqual(day);
  expect(await durableRows()).toEqual(before);
  expect(announce).not.toHaveBeenCalled();
});

it('AC-22 answers a repeated start with the day as it is after a later arrival', async () => {
  const write = await pending('start');
  let day = answeredDay(await driver.send(write));
  day = await apply(day, 'arrive', 214, 1);
  const before = await durableRows();
  expect(answeredDay(await driver.send(write))).toEqual(day);
  expect(await durableRows()).toEqual(before);
});

it.each(['new', 'replayed'] as const)('AC-22 answers a %s write from one snapshot after commit while another trip is sent back', async mode => {
  await ready({ withVeh004: true });
  // Another owned trip is still out. Its seeded Gampaha and Kandana loads are kept whole.
  const dilshanId = (await db.select().from(users).where(eq(users.username, 'dilshan')))[0]!.id;
  const [thursdayTrip] = await db.select({ id: trips.id }).from(trips).innerJoin(plans, eq(plans.id, trips.planId)).where(and(eq(trips.vehicleId, 'VEH004'), eq(plans.date, THU)));
  const [second] = await db.update(trips).set({ driverId: dilshanId, status: 'ready', readyAt: new Date(at(150)) })
    .where(eq(trips.id, thursdayTrip!.id)).returning();
  const assigned = await db.select().from(stopOrders).innerJoin(stops, eq(stops.id, stopOrders.stopId)).where(eq(stops.tripId, second!.id));
  const ids = assigned.map(row => row.stop_orders.orderId);
  await db.update(orders).set({ status: 'loaded' }).where(inArray(orders.id, ids));
  await db.update(orderLines).set({ loadedQty: sql`${orderLines.quantity}` }).where(inArray(orderLines.orderId, ids));
  await db.update(stops).set({ loadedAt: new Date(at(149)) }).where(eq(stops.tripId, second!.id));
  let other = driverTrip(await driver.read(), 'VEH004');
  expect(other.stops.map(stop => stop.lines.reduce((sum, line) => sum + line.loaded!, 0))).toEqual([111, 99]);
  for (const [kind, minute, seq] of [['start', 205, undefined], ['arrive', 206, 1], ['closed', 207, 1]] as const) {
    freeze(THU, minute);
    other = answeredTrip(await driver.send(driverWrite(other, kind, at(minute), seq)), 'VEH004');
  }
  const day = await apply(await driver.read(), 'start', 211);
  const trip = driverTrip(day);
  const problem = IssueList.parse((await ruwan.get('/api/v1/issues')).body).issues
    .find(problem => problem.kind === 'closed' && problem.trip.id === other.tripId)!;
  freeze(THU, 214);
  const arrival = driverWrite(trip, 'arrive', at(214), 1);
  if (mode === 'replayed') answeredDay(await driver.send(arrival));
  vi.mocked(announce).mockClear();

  let release!: () => void;
  answerRead.release = new Promise<void>(resolve => { release = resolve; });
  answerRead.countdown = 1;
  const writing = driver.send(arrival).then(res => res);
  let committedStop: typeof stops.$inferSelect | undefined;
  let announcements: unknown[] = [];
  try {
    await vi.waitFor(() => expect(answerRead.paused).toBe(true));
    committedStop = (await db.select().from(stops).where(eq(stops.id, driverStop(trip, 1).id)))[0];
    announcements = vi.mocked(announce).mock.calls.map(([change]) => change);
    const answer = await ruwan.post(`/api/v1/issues/${problem.id}/decide`).send({ revision: problem.revision, decision: 'try_again' });
    expect(answer.status).toBe(200);
  } finally {
    release();
    await writing;
  }
  const result = answeredDay(await writing);
  expect(committedStop?.arrivedAt).toEqual(new Date(at(214)));
  // A new arrival is told once, to the depot's drivers and to the shop for its bell (spec 025); a replayed one to nobody.
  expect(announcements).toEqual(mode === 'new' ? [{ topic: 'driver', depotId: 'Peliyagoda' }, { topic: 'orders', outletId: driverStop(trip, 1).outletId }] : []);
  expect(driverStop(driverTrip(result), 1).arrivedAt).toBe(at(214));
  expect(result.appliedWriteIds.filter(id => id === arrival.writeId)).toEqual([arrival.writeId]);
  expect(await auditsOf(driverStop(trip, 1).id, 'stop.arrived')).toHaveLength(1);
  expect(await db.select().from(phoneWrites).where(eq(phoneWrites.id, arrival.writeId))).toHaveLength(1);
  // This answer consistently predates the concurrent retry; the next read sees it committed.
  const beforeRetry = driverTrip(result, 'VEH004');
  expect(driverStop(beforeRetry, 1).outcome).toBe('closed');
  expect(beforeRetry.problems.find(item => item.id === problem.id)?.decision).toBeNull();
  const afterRetry = driverTrip(await driver.read(), 'VEH004');
  expect(driverStop(afterRetry, 1).outcome).toBeNull();
  expect(afterRetry.problems.find(item => item.id === problem.id)?.decision).toBe('try_again');
});

it('AC-23 binds an id to its time, stop, kind and trip, without applying the changed records', async () => {
  const day = await ready({ withVeh004: true });
  const own = driverTrip(day);
  const dilshanId = (await db.select().from(users).where(eq(users.username, 'dilshan')))[0]!.id;
  const [thursdayTrip] = await db.select({ id: trips.id }).from(trips).innerJoin(plans, eq(plans.id, trips.planId)).where(and(eq(trips.vehicleId, 'VEH004'), eq(plans.date, THU)));
  const second = (await db.update(trips).set({ driverId: dilshanId, status: 'ready', readyAt: depotInstant(THU, 156) }).where(eq(trips.id, thursdayTrip!.id)).returning())[0]!;
  const foreignStop = (await db.select().from(stops).where(eq(stops.tripId, second.id)))[0]!;
  let current = await apply(day, 'start', 211);
  const write = driverWrite(driverTrip(current), 'arrive', at(214), 1);
  freeze(THU, 214);
  current = answeredDay(await driver.send(write));
  for (const changed of [
    { ...write, at: at(215) },
    { ...write, stopId: driverStop(own, 2).id },
    { ...write, kind: 'closed' },
    { ...write, tripId: second.id, stopId: foreignStop.id },
  ]) await rejected(changed, 'write_reused', dilshan, { writeId: write.writeId });
  // Ownership comes before id reuse, even when the id is already bound to an accepted arrival.
  for (const [changed, id] of [
    [{ ...write, stopId: foreignStop.id }, foreignStop.id],
    [{ ...write, kind: 'refuse', reason: 'damaged', note: '', lines: [{ lineId: driverStop(own, 2).lines[0]!.lineId, refused: 1 }] }, driverStop(own, 2).lines[0]!.lineId],
  ] as const) {
    const before = await heldDriverRows();
    vi.mocked(announce).mockClear();
    const res = await driver.send(changed);
    expect(code(res)).toEqual([400, 'unknown_record']);
    expect(res.body.error.details).toEqual({ id });
    expect(await heldDriverRows()).toEqual(before);
    expect(announce).not.toHaveBeenCalled();
  }
  expect(driverStop(driverTrip(current), 1).revision).toBe(1);
});

it('AC-23 binds a delivered proof to its exact photo and the account that applied it', async () => {
  const write = await pending('deliver');
  await driver.send(write).expect(200);
  const anotherJpeg = Buffer.from(jpeg);
  anotherJpeg[10] = 2;
  await rejected({ ...write, photo: `data:image/jpeg;base64,${anotherJpeg.toString('base64')}` }, 'write_reused', dilshan, { writeId: write.writeId });
  // Reassignment makes Chaminda authorized on this trip; the previously saved write still belongs to Dilshan.
  await db.update(trips).set({ driverId: chamindaId }).where(eq(trips.id, write.tripId));
  await rejected(write, 'write_reused', chaminda, { writeId: write.writeId });
});

it('AC-23 reserves an id once when different trips receive it concurrently', async () => {
  await ready({ withVeh004: true });
  const dilshanId = (await db.select().from(users).where(eq(users.username, 'dilshan')))[0]!.id;
  const [thursdayTrip] = await db.select({ id: trips.id }).from(trips).innerJoin(plans, eq(plans.id, trips.planId)).where(and(eq(trips.vehicleId, 'VEH004'), eq(plans.date, THU)));
  await db.update(trips).set({ driverId: dilshanId, status: 'ready', readyAt: depotInstant(THU, 156) }).where(eq(trips.id, thursdayTrip!.id));
  const day = await driver.read();
  const writeId = randomUUID();
  freeze(THU, 211);
  const named = [driverTrip(day), driverTrip(day, 'VEH004')];
  const responses = await Promise.all(named.map(trip => driver.send(driverWrite(trip, 'start', at(211), undefined, { writeId }))));
  expect(responses.map(res => res.status).sort()).toEqual([200, 409]);
  expect(responses.find(res => res.status === 409)!.body.error.code).toBe('write_reused');
  const stored = (await db.select().from(phoneWrites).where(eq(phoneWrites.id, writeId)))[0]!;
  const winner = named.find(trip => trip.tripId === stored.tripId)!;
  const loser = named.find(trip => trip.tripId !== stored.tripId)!;
  expect((await db.select().from(trips).where(eq(trips.id, winner.tripId)))[0]!.status).toBe('out');
  expect((await db.select().from(trips).where(eq(trips.id, loser.tripId)))[0]).toMatchObject({ status: 'ready', revision: loser.revision, leftAt: null, lastEventAt: null });
  expect(await auditsOf(loser.tripId, 'trip.started')).toEqual([]);
});

it('AC-24 checks trip revisions on start and finish and stop revisions on arrival', async () => {
  const write = await pending('start');
  await rejected({ ...write, revision: write.revision + 1 }, 'stale');
  let day = answeredDay(await driver.send(write));
  const arrival = driverWrite(driverTrip(day), 'arrive', at(214), 1);
  freeze(THU, 214);
  await rejected({ ...arrival, revision: arrival.revision + 1 }, 'stale');
  day = answeredDay(await driver.send(arrival));
  const old = await rejected({ ...arrival, writeId: randomUUID() }, 'stale');
  expect(old.body.error.message).toBe('Fresh Nugegoda was changed on another phone.');
  day = await apply(day, 'deliver', 218, 1, { photo });
  day = await apply(day, 'arrive', 225, 2);
  day = await apply(day, 'closed', 228, 2);
  const finish = driverWrite(driverTrip(day), 'finish', at(235));
  await rejected({ ...finish, revision: finish.revision - 1 }, 'stale');
});

it('AC-24 accepts one of two phones arriving with the same revision', async () => {
  const day = await apply(await ready(), 'start', 211);
  freeze(THU, 214);
  const writes = [driverWrite(driverTrip(day), 'arrive', at(214), 1), driverWrite(driverTrip(day), 'arrive', at(214), 1)];
  const responses = await Promise.all(writes.map(write => driver.send(write)));
  expect(responses.map(res => res.status).sort()).toEqual([200, 409]);
  expect(responses.find(res => res.status === 409)!.body.error.code).toBe('stale');
  expect(await auditsOf(driverStop(driverTrip(day), 1).id, 'stop.arrived')).toHaveLength(1);
  const refusedWrite = writes[responses.findIndex(res => res.status === 409)]!;
  expect(await db.select().from(phoneWrites).where(eq(phoneWrites.id, refusedWrite.writeId))).toEqual([]);
});

it('AC-25 drops a lost arrival from the phone queue before building the delivery revision', async () => {
  const day = await apply(await ready(), 'start', 211);
  const arrival = driverWrite(driverTrip(day), 'arrive', at(214), 1);
  freeze(THU, 214);
  await driver.send(arrival).expect(200); // The phone never receives this answer.
  const fetched = await driver.read();
  expect(fetched.appliedWriteIds).toContain(arrival.writeId);
  const view = phoneView(fetched, [arrival]);
  expect(view.writes).toEqual([]);
  expect(driverStop(driverTrip(view.day), 1).revision).toBe(1);
  const delivery = driverWrite(driverTrip(view.day), 'deliver', at(218), 1, { photo });
  freeze(THU, 218);
  await rejected({ ...delivery, revision: delivery.revision + 1 }, 'stale');
  expect(driverStop(driverTrip(answeredDay(await driver.send(delivery))), 1).outcome).toBe('delivered');
  expect(await auditsOf(arrival.kind === 'arrive' ? arrival.stopId : '', 'stop.arrived')).toHaveLength(1);
  expect(await auditsOf(entityOf(delivery), 'stop.delivered')).toHaveLength(1);
});

it('AC-25 lists the lost finish after 16:00 and refreshes a repeat last answered 49 hours ago', async () => {
  const finish = await pending('finish');
  await driver.send(finish).expect(200);
  freeze(THU, 16 * 60);
  const fetched = await driver.read();
  expect(fetched.day).toBe('2026-06-26');
  expect(fetched.trips).toEqual([]);
  expect(fetched.appliedWriteIds).toContain(finish.writeId);
  expect(phoneView(fetched, [finish]).writes).toEqual([]);
  await db.update(phoneWrites).set({ answeredAt: sql`now() - interval '49 hours'` }).where(eq(phoneWrites.id, finish.writeId));
  expect((await driver.read()).appliedWriteIds).not.toContain(finish.writeId);
  const before = await durableRows();
  vi.mocked(announce).mockClear();
  const replay = answeredDay(await driver.send(finish));
  expect(replay.trips).toEqual([]);
  expect(replay.appliedWriteIds).toContain(finish.writeId);
  expect((await driver.read()).appliedWriteIds).toContain(finish.writeId);
  expect(await durableRows()).toEqual(before);
  expect(announce).not.toHaveBeenCalled();
});

it.each([{ claimed: 225, kept: 225 }, { claimed: 232, kept: 230 }, { claimed: 210, kept: 218 }])('AC-26 keeps phone minute $claimed as $kept between last event and server clock', async ({ claimed, kept }) => {
  const day = await firstDelivered();
  freeze(THU, 230);
  const write = driverWrite(driverTrip(day), 'arrive', at(claimed), 2);
  const result = answeredDay(await driver.send(write));
  expect(driverStop(driverTrip(result), 2).arrivedAt).toBe(at(kept));
  expect((await auditsOf(entityOf(write), 'stop.arrived'))[0]!.after).toMatchObject({ writeId: write.writeId, claimedAt: at(claimed), keptAt: at(kept) });
});

it('AC-26 keeps the last event bound after a dispatcher reopens a closed stop', async () => {
  let day = await firstDelivered();
  day = await apply(day, 'arrive', 225, 2);
  day = await apply(day, 'closed', 228, 2);
  const trip = driverTrip(day);
  const stop = driverStop(trip, 2);
  const problem = trip.problems[0]!;
  // The answer task clears only these stop fields; it must leave the trip's event bound alone.
  await db.update(stops).set({ arrivedAt: null, doneAt: null, outcome: null, retriedAt: depotInstant(THU, 229), revision: stop.revision + 1 }).where(eq(stops.id, stop.id));
  await db.update(issues).set({ status: 'decided', decision: 'try_again', decidedBy: ruwanId, decidedAt: depotInstant(THU, 229), revision: 1 }).where(eq(issues.id, problem.id));
  day = await driver.read();
  freeze(THU, 230);
  const write = driverWrite(driverTrip(day), 'arrive', at(220), 2);
  const result = answeredDay(await driver.send(write));
  expect(driverStop(driverTrip(result), 2).arrivedAt).toBe(at(228));
  expect((await auditsOf(stop.id, 'stop.arrived')).find(row => (row.after as { writeId?: string }).writeId === write.writeId)!.after).toMatchObject({ claimedAt: at(220), keptAt: at(228) });
});

it('AC-27 reads the clock after the trip lock, preserving the event written while it waited', async () => {
  const day = await apply(await ready(), 'start', 211);
  const trip = driverTrip(day);
  freeze(THU, 214);
  const afterFirst = new Date(new Date(at(214)).getTime() + 1_000).toISOString();
  const afterLock = new Date(new Date(at(214)).getTime() + 2_000).toISOString();
  let release!: () => void;
  let locked!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const acquired = new Promise<void>(resolve => { locked = resolve; });
  const first = db.transaction(async tx => {
    await tx.select().from(trips).where(eq(trips.id, trip.tripId)).for('update');
    await tx.update(trips).set({ lastEventAt: new Date(afterFirst) }).where(eq(trips.id, trip.tripId));
    locked();
    await held;
  });
  await acquired;
  const write = driverWrite(trip, 'arrive', afterLock, 1);
  const waiting = driver.send(write).then(res => res);
  try {
    await vi.waitFor(async () => {
      const { rows } = await db.execute(sql`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%trips%' and query like '%for update%'`);
      expect(rows).toHaveLength(1);
    });
    setInstant(afterLock);
  } finally { release(); await first; }
  const result = answeredDay(await waiting);
  expect(driverStop(driverTrip(result), 1).arrivedAt).toBe(afterLock);
  expect((await auditsOf(entityOf(write), 'stop.arrived'))[0]!.after).toMatchObject({ claimedAt: afterLock, keptAt: afterLock });
});

it.each(['refuse', 'closed'] as const)('AC-28 keeps every walkthrough answer equal to phoneView, ending in %s', async outcome => {
  let day = await ready();
  const sendAndCompare = async (kind: DriverWriteKind, minute: number, seq?: number, more: object = {}) => {
    freeze(THU, minute);
    const write = driverWrite(driverTrip(day), kind, at(minute), seq, more);
    const expected = phoneView(day, [write]).day;
    day = answeredDay(await driver.send(write));
    expect(day).toEqual(expected);
  };
  await sendAndCompare('start', 211);
  await sendAndCompare('arrive', 214, 1);
  await sendAndCompare('deliver', 218, 1, { photo });
  await sendAndCompare('arrive', 225, 2);
  await sendAndCompare(outcome, 228, 2, outcome === 'refuse'
    ? { reason: 'damaged', note: '2 crushed at the bottom', lines: [{ lineId: driverStop(driverTrip(day), 2).lines[0]!.lineId, refused: 2 }] }
    : { note: 'Lights off, gate locked' });
  await sendAndCompare('finish', 235);
});

it('AC-28 normalizes ISO instants with zero or more than three fractional digits the same way on phone and server', async () => {
  let day = await ready();
  for (const [kind, minute, seq, claimed] of [
    ['start', 211, undefined, at(211).replace('.000Z', 'Z')],
    ['arrive', 214, 1, at(214).replace('.000Z', '.123456Z')],
  ] as const) {
    setInstant(new Date(new Date(at(minute)).getTime() + 1_000).toISOString());
    const write = driverWrite(driverTrip(day), kind, claimed, seq);
    const expected = phoneView(day, [write]).day;
    day = answeredDay(await driver.send(write));
    expect(day).toEqual(expected);
  }
});

it('AC-28 orders refusal lines and equal-time problems the same way with reverse UUID and input order', async () => {
  let day = await apply(await ready(), 'start', 211);
  day = await apply(day, 'arrive', 214, 1);
  const sendAndCompare = async (kind: DriverWriteKind, seq: number, more: object = {}) => {
    freeze(THU, 218);
    const write = driverWrite(driverTrip(day), kind, at(218), seq, more);
    const expected = phoneView(day, [write]).day;
    day = answeredDay(await driver.send(write));
    expect(day).toEqual(expected);
  };
  await sendAndCompare('refuse', 1, { writeId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', reason: 'damaged', note: '',
    lines: [...driverStop(driverTrip(day), 1).lines].reverse().map(line => ({ lineId: line.lineId, refused: 1 })) });
  await sendAndCompare('arrive', 2);
  await sendAndCompare('refuse', 2, { writeId: '00000000-0000-4000-8000-000000000002', reason: 'damaged', note: '',
    lines: [...driverStop(driverTrip(day), 2).lines].reverse().map(line => ({ lineId: line.lineId, refused: 1 })) });
});

async function rowsWithin(tx: Tx) {
  return {
    plans: await tx.select().from(plans).orderBy(plans.id), trips: await tx.select().from(trips).orderBy(trips.id),
    stops: await tx.select().from(stops).orderBy(stops.id), orders: await tx.select().from(orders).orderBy(orders.id),
    lines: await tx.select().from(orderLines).orderBy(orderLines.id), issues: await tx.select().from(issues).orderBy(issues.id),
    issueLines: await tx.select().from(issueLines).orderBy(issueLines.issueId, issueLines.orderLineId),
    audits: await tx.select().from(auditLog).orderBy(auditLog.id), writes: await tx.select().from(phoneWrites).orderBy(phoneWrites.id),
    photos: await tx.select().from(photos).orderBy(photos.id),
  };
}

it('AC-29 finishes concurrent reset and driver write without a deadlock', async () => {
  const write = await pending('start');
  const [reset, result] = await Promise.all([kasun.post('/api/v1/demo/reset').send({}), driver.send(write)]);
  expect(reset.status).toBe(200);
  expect([200, 400]).toContain(result.status);
  if (result.status === 400) expect(result.body.error).toMatchObject({ code: 'unknown_record', details: { id: write.tripId } });
});

it('AC-29 refuses the waiting write without changes when reset commits first', async () => {
  const write = await pending('start');
  let release!: () => void;
  let resetting!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const cleared = new Promise<void>(resolve => { resetting = resolve; });
  let expected!: Awaited<ReturnType<typeof rowsWithin>>;
  const reset = db.transaction(async tx => {
    await tx.select().from(demoDay).for('update');
    await clearDemoDay(tx);
    await seedDemoDay(tx);
    expected = await rowsWithin(tx);
    resetting();
    await held;
  });
  await cleared;
  const waiting = driver.send(write).then(res => res);
  try {
    await vi.waitFor(async () => {
      const { rows } = await db.execute(sql`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%demo_day%'`);
      expect(rows).toHaveLength(1);
    });
  } finally { release(); await reset; }
  expect(code(await waiting)).toEqual([400, 'unknown_record']);
  expect(await heldDriverRows()).toEqual(expected);
});

it('AC-29 lets a driver write commit before a waiting reset', async () => {
  const write = await pending('arrive');
  let release!: () => void;
  let applied!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const completed = new Promise<void>(resolve => { applied = resolve; });
  const transaction = db.transaction.bind(db);
  const spy = vi.spyOn(db, 'transaction').mockImplementationOnce((async (work: (tx: Tx) => Promise<unknown>, options?: Parameters<typeof db.transaction>[1]) =>
    transaction(async tx => { const answer = await work(tx); applied(); await held; return answer; }, options)) as typeof db.transaction);
  const writing = driver.send(write).then(res => res);
  await completed;
  spy.mockRestore();
  const resetting = kasun.post('/api/v1/demo/reset').send({}).then(res => res);
  try {
    await vi.waitFor(async () => {
      const { rows } = await db.execute(sql`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%demo_day%'`);
      expect(rows).toHaveLength(1);
    });
  } finally { release(); }
  const [written, reset] = await Promise.all([writing, resetting]);
  expect(written.status).toBe(200);
  expect(reset.status).toBe(200);
  expect(await auditsOf(entityOf(write), 'stop.arrived')).toHaveLength(1);
  expect(await db.select().from(trips).where(eq(trips.id, write.tripId))).toEqual([]);
  expect(await db.select().from(phoneWrites).where(eq(phoneWrites.id, write.writeId))).toEqual([]);
});
