import { randomUUID } from 'node:crypto';
import { LoadingDay, PlanCheck, StoreOrderList, type DriverTrip, type DriverWrite } from '@wayfinder/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { auditLog, demoDay, issueLines, issues, orderLines, orders, photos, plans, stopOrders, stops, trips, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { answeredTrip, driverScreen, driverStop, driverTrip, driverWrite, heldDriverRows, readyWalkthrough } from './driver-plan';
import { code, resetDay, signIn, THU, WED, type Walkthrough } from './loading-plan';
import { serve, stop } from './serve';

const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at || clock.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async (original) => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const at = (minute: number) => depotInstant(THU, minute);
const freeze = (date: string, minute: number) => { const moment = depotInstant(date, minute); testClock.at = moment.toISOString(); setClockForTests(moment); };
const server = await serve(createApp());
const kasun = request.agent(server);
const ruwan = request.agent(server);
const nadeesha = request.agent(server);
const dilshan = request.agent(server);
const chaminda = request.agent(server);
const walk: Walkthrough & { kasun: typeof kasun } = { nadeesha, ruwan, kasun, freeze };
const driver = driverScreen(dilshan);
let originalClock: typeof demoDay.$inferSelect;
let dilshanId: string;

// A complete one-pixel JPEG marker stream. Structural validation intentionally does not decode image pixels.
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 1, 0, 1, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0,
  0xff, 0xda, 0, 12, 3, 1, 0, 2, 17, 3, 17, 0, 63, 0, 0, 0xff, 0xd9]);
const photo = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
const auditsOf = (entityId: string, action: string) => db.select().from(auditLog).where(and(eq(auditLog.entityId, entityId), eq(auditLog.action, action)));
const told = () => vi.mocked(announce).mock.calls.map(([change]) => change);

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, username] of [[kasun, 'kasun'], [ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [dilshan, 'dilshan'], [chaminda, 'chaminda']] as const) await signIn(agent, username);
  dilshanId = (await db.select().from(users).where(eq(users.username, 'dilshan')))[0]!.id;
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

async function ready(options: { withVeh004?: boolean } = {}): Promise<DriverTrip> {
  await readyWalkthrough(walk, options);
  return driverTrip(await driver.read());
}
async function write(trip: DriverTrip, kind: DriverWrite['kind'], minute: number, seq?: number, more: object = {}): Promise<DriverTrip> {
  freeze(THU, minute);
  return answeredTrip(await driver.send(driverWrite(trip, kind, at(minute).toISOString(), seq, more)), trip.vehicleId, trip.tripNo);
}
const started = async () => write(await ready(), 'start', 3 * 60 + 31);
async function atWellawatte(): Promise<DriverTrip> {
  let trip = await started();
  trip = await write(trip, 'arrive', 3 * 60 + 34, 1);
  trip = await write(trip, 'deliver', 3 * 60 + 38, 1, { photo });
  return write(trip, 'arrive', 3 * 60 + 45, 2);
}
async function refused(body: object, status: number, error: string, details?: object, agent = dilshan): Promise<request.Response> {
  const before = await heldDriverRows();
  vi.mocked(announce).mockClear();
  const res = await agent.post('/api/v1/driver/writes').send(body);
  expect(code(res)).toEqual([status, error]);
  if (details) expect(res.body.error.details).toEqual(details);
  expect(await heldDriverRows()).toEqual(before);
  expect(told()).toEqual([]);
  return res;
}
async function afterCommit(body: DriverWrite): Promise<request.Response> {
  let committed = false;
  const transaction = db.transaction.bind(db);
  const spy = vi.spyOn(db, 'transaction').mockImplementation((async (...args: Parameters<typeof db.transaction>) => {
    const result = await transaction(...args); committed = true; return result;
  }) as typeof db.transaction);
  vi.mocked(announce).mockClear();
  vi.mocked(announce).mockImplementation(() => { expect(committed).toBe(true); });
  try { return await driver.send(body); } finally { spy.mockRestore(); vi.mocked(announce).mockImplementation(() => undefined); }
}
async function expectAudit(id: string, action: string) {
  const rows = await auditsOf(id, action);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ actorId: dilshanId, entityId: id, action });
}

it('AC-6 refuses Chaminda on Dilshan’s trip and foreign stops and lines with the named id and no changes', async () => {
  let trip = await ready({ withVeh004: true });
  await refused(driverWrite(trip, 'start', at(3 * 60 + 31).toISOString()), 400, 'unknown_record', { id: trip.tripId }, chaminda);
  const foreign = (await db.select({ stop: stops }).from(stops).innerJoin(trips, eq(trips.id, stops.tripId)).where(eq(trips.vehicleId, 'VEH004')))[0]!.stop;
  await refused({ ...driverWrite(trip, 'arrive', at(3 * 60 + 34).toISOString(), 1), stopId: foreign.id }, 400, 'unknown_record', { id: foreign.id });
  const missing = randomUUID();
  await refused({ ...driverWrite(trip, 'start', at(3 * 60 + 31).toISOString()), tripId: missing }, 400, 'unknown_record', { id: missing });
  trip = await write(trip, 'start', 3 * 60 + 31);
  trip = await write(trip, 'arrive', 3 * 60 + 34, 1);
  const otherLine = driverStop(trip, 2).lines[0]!.lineId;
  await refused(driverWrite(trip, 'refuse', at(3 * 60 + 38).toISOString(), 1, { reason: 'damaged', note: '', lines: [{ lineId: otherLine, refused: 1 }] }),
    400, 'unknown_record', { id: otherLine });
});

it('AC-11 starts VEH035 early, advances the trip and audits, then announces driver and loading after commit', async () => {
  const trip = await ready();
  freeze(THU, 3 * 60 + 31);
  const result = answeredTrip(await afterCommit(driverWrite(trip, 'start', at(3 * 60 + 31).toISOString())));
  expect(result).toMatchObject({ status: 'out', revision: trip.revision + 1, leftAt: at(3 * 60 + 31).toISOString() });
  expect((await db.select().from(trips).where(eq(trips.id, trip.tripId)))[0]).toMatchObject({ status: 'out', revision: trip.revision + 1,
    leftAt: at(3 * 60 + 31), lastEventAt: at(3 * 60 + 31) });
  await expectAudit(trip.tripId, 'trip.started');
  expect(told()).toEqual([{ topic: 'driver', depotId: 'Peliyagoda' }, { topic: 'loading', depotId: 'Peliyagoda' }]);
  expect(LoadingDay.parse((await kasun.get('/api/v1/loading')).body).trucks.map(truck => truck.vehicleId)).not.toContain('VEH035');
});

it('AC-12 refuses a start before loading or while loading without changing anything', async () => {
  const trip = await ready();
  for (const status of ['planned', 'loading'] as const) {
    await db.update(trips).set({ status, readyAt: null }).where(eq(trips.id, trip.tripId));
    const res = await refused(driverWrite(trip, 'start', at(3 * 60 + 31).toISOString()), 409, 'trip_not_ready', { vehicleId: 'VEH035', tripNo: 1 });
    expect(res.body.error.message).toBe('VEH035 is not loaded yet.');
  }
});

// AC-12/13 explicitly set the two trips' rows. Both use the seeded VEH004 stops and the plan's checked timings.
async function twoReadyTrips(): Promise<[DriverTrip, DriverTrip]> {
  await ready({ withVeh004: true });
  const first = (await db.select().from(trips).where(eq(trips.vehicleId, 'VEH004')))[0]!;
  const plan = (await db.select().from(plans).where(eq(plans.id, first.planId)))[0]!;
  const check = PlanCheck.parse(plan.sentCheck);
  const checked = check.trips.find(trip => trip.vehicleId === 'VEH004')!;
  check.trips.push({ ...checked, tripNo: 2 });
  await db.update(plans).set({ sentCheck: check }).where(eq(plans.id, plan.id));
  await db.update(trips).set({ driverId: dilshanId, status: 'ready', readyAt: at(2 * 60 + 36) }).where(eq(trips.id, first.id));
  const second = (await db.insert(trips).values({ planId: first.planId, vehicleId: 'VEH004', tripNo: 2, driverId: dilshanId, status: 'ready', readyAt: at(2 * 60 + 36) }).returning())[0]!;
  for (const original of await db.select().from(stops).where(eq(stops.tripId, first.id))) {
    await db.update(stops).set({ loadedAt: at(2 * 60 + 35) }).where(eq(stops.id, original.id));
    const copy = (await db.insert(stops).values({ tripId: second.id, seq: original.seq, outletId: original.outletId, loadedAt: at(2 * 60 + 35) }).returning())[0]!;
    const joined = await db.select().from(stopOrders).where(eq(stopOrders.stopId, original.id));
    const ids = joined.map(row => row.orderId);
    await db.update(orders).set({ status: 'loaded' }).where(inArray(orders.id, ids));
    await db.update(orderLines).set({ loadedQty: sql`${orderLines.quantity}` }).where(inArray(orderLines.orderId, ids));
    await db.insert(stopOrders).values(joined.map(row => ({ stopId: copy.id, orderId: row.orderId })));
  }
  const day = await driver.read();
  return [driverTrip(day, 'VEH004', 1), driverTrip(day, 'VEH004', 2)];
}

it('AC-12 refuses starting the second VEH004 trip while its first is out', async () => {
  const [first, second] = await twoReadyTrips();
  await write(first, 'start', 3 * 60 + 31);
  const res = await refused(driverWrite(second, 'start', at(3 * 60 + 31).toISOString()), 409, 'other_trip_out', { vehicleId: 'VEH004', tripNo: 1 });
  expect(res.body.error.message).toBe('VEH004 is still out on trip 1.');
});

it('AC-13 permits exactly one of two simultaneous starts for VEH004', async () => {
  const pair = await twoReadyTrips();
  freeze(THU, 3 * 60 + 31);
  const responses = await Promise.all(pair.map(trip => driver.send(driverWrite(trip, 'start', at(3 * 60 + 31).toISOString()))));
  expect(responses.map(res => res.status).sort()).toEqual([200, 409]);
  expect(responses.find(res => res.status === 409)!.body.error.code).toBe('other_trip_out');
  const stored = await db.select().from(trips).where(inArray(trips.id, pair.map(trip => trip.tripId)));
  expect(stored.filter(trip => trip.status === 'out')).toHaveLength(1);
  expect(stored.filter(trip => trip.status === 'ready')).toHaveLength(1);
  expect((await db.select().from(auditLog).where(and(eq(auditLog.action, 'trip.started'), inArray(auditLog.entityId, pair.map(trip => trip.tripId)))))).toHaveLength(1);
});

it('AC-14 refuses an arrival until out, then records Nugegoda’s arrival and its revision after commit', async () => {
  let trip = await ready();
  await refused(driverWrite(trip, 'arrive', at(3 * 60 + 34).toISOString(), 1), 409, 'trip_not_out', { vehicleId: 'VEH035', tripNo: 1 });
  trip = await write(trip, 'start', 3 * 60 + 31);
  const before = driverStop(trip, 1);
  freeze(THU, 3 * 60 + 34);
  const arrived = answeredTrip(await afterCommit(driverWrite(trip, 'arrive', at(3 * 60 + 34).toISOString(), 1)));
  expect(driverStop(arrived, 1)).toMatchObject({ revision: before.revision + 1, arrivedAt: at(3 * 60 + 34).toISOString(), outcome: null, doneAt: null });
  expect((await db.select().from(stops).where(eq(stops.id, before.id)))[0]).toMatchObject({ revision: before.revision + 1, arrivedAt: at(3 * 60 + 34) });
  await expectAudit(before.id, 'stop.arrived');
  expect(told()).toEqual([{ topic: 'driver', depotId: 'Peliyagoda' }]);
});

it('AC-15 refuses arrival and every save at Wellawatte before Nugegoda is done', async () => {
  const trip = await started();
  const moment = at(3 * 60 + 34).toISOString();
  for (const body of [driverWrite(trip, 'arrive', moment, 2), driverWrite(trip, 'deliver', moment, 2, { photo }),
    driverWrite(trip, 'closed', moment, 2), driverWrite(trip, 'refuse', moment, 2, { reason: 'damaged', note: '', lines: [{ lineId: driverStop(trip, 2).lines[0]!.lineId, refused: 1 }] })]) {
    const res = await refused(body, 409, 'not_next', { stopSeq: 1 });
    expect(res.body.error.message).toBe('Fresh Nugegoda comes first.');
  }
});

it('AC-16 delivers 12, 8 and 3 at Nugegoda with its proof and updated orders, then tells driver and shop', async () => {
  let trip = await started();
  trip = await write(trip, 'arrive', 3 * 60 + 34, 1);
  const previous = driverStop(trip, 1);
  const ids = previous.lines.map(line => line.orderId);
  const beforeOrders = await db.select().from(orders).where(inArray(orders.id, ids));
  freeze(THU, 3 * 60 + 38);
  const body = driverWrite(trip, 'deliver', at(3 * 60 + 38).toISOString(), 1, { photo });
  const delivered = driverStop(answeredTrip(await afterCommit(body)), 1);
  expect(delivered).toMatchObject({ outcome: 'delivered', doneAt: body.at, revision: previous.revision + 1 });
  expect(delivered.lines.map(line => line.delivered)).toEqual([12, 8, 3]);
  const storedLines = await db.select().from(orderLines).where(inArray(orderLines.id, previous.lines.map(line => line.lineId)));
  expect(previous.lines.map(line => storedLines.find(row => row.id === line.lineId)!.deliveredQty)).toEqual([12, 8, 3]);
  for (const row of await db.select().from(orders).where(inArray(orders.id, ids))) expect(row).toMatchObject({ status: 'delivered', revision: beforeOrders.find(old => old.id === row.id)!.revision + 1 });
  expect(await db.select().from(photos)).toEqual([{ id: body.writeId, stopId: previous.id, issueId: null, jpeg, takenBy: dilshanId, takenAt: at(3 * 60 + 38) }]);
  await expectAudit(previous.id, 'stop.delivered');
  expect(told()).toEqual([{ topic: 'driver', depotId: 'Peliyagoda' }, { topic: 'orders', outletId: 'OUT001', depotId: 'Peliyagoda' }]);
  const list = StoreOrderList.parse((await nadeesha.get('/api/v1/store/orders?list=open')).body);
  expect(list.orders.filter(order => ids.includes(order.id)).map(order => [order.temp, order.units, order.status])).toEqual([
    ['chilled', 12, 'delivered'], ['chilled', 8, 'delivered'], ['dry', 4, 'delivered'],
  ]);
});

it('AC-17 rejects saves without arrival, a second arrival, missing or broken photos, then done stops before not_next', async () => {
  let trip = await started();
  let moment = at(3 * 60 + 34).toISOString();
  for (const body of [driverWrite(trip, 'deliver', moment, 1, { photo }), driverWrite(trip, 'closed', moment, 1),
    driverWrite(trip, 'refuse', moment, 1, { reason: 'damaged', note: '', lines: [{ lineId: driverStop(trip, 1).lines[0]!.lineId, refused: 1 }] })]) {
    await refused(body, 409, 'not_arrived', { stopSeq: 1 });
  }
  trip = await write(trip, 'arrive', 3 * 60 + 34, 1);
  await refused(driverWrite(trip, 'arrive', moment, 1), 409, 'stop_done', { stopSeq: 1 });
  const base = driverWrite(trip, 'deliver', moment, 1, { photo });
  const { photo: _photo, ...withoutPhoto } = base as Extract<DriverWrite, { kind: 'deliver' }>;
  await refused(withoutPhoto, 400, 'invalid_input');
  for (const bytes of [jpeg.subarray(0, -2), Buffer.from([0xff, 0xd8, 0, 0, 0xff, 0xd9]), Buffer.concat([jpeg.subarray(0, -2), Buffer.alloc(512_000), jpeg.subarray(-2)])]) {
    const res = await refused({ ...base, photo: `data:image/jpeg;base64,${bytes.toString('base64')}` }, 400, 'invalid_input');
    expect(res.body.error.message).toBe('The photo must be a whole JPEG of at most 500 KB.');
  }
  for (const invalid of ['data:image/png;base64,AAAA', 'data:image/jpeg;base64,%%%%', `data:image/jpeg;base64,${'A'.repeat(700_000)}`]) {
    const res = await refused({ ...base, photo: invalid }, 400, 'invalid_input');
    expect(res.body.error.message).toBe('The photo must be a whole JPEG of at most 500 KB.');
  }
  trip = await write(trip, 'deliver', 3 * 60 + 38, 1, { photo });
  moment = at(3 * 60 + 39).toISOString();
  for (const body of [driverWrite(trip, 'arrive', moment, 1), driverWrite(trip, 'deliver', moment, 1, { photo }), driverWrite(trip, 'closed', moment, 1),
    driverWrite(trip, 'refuse', moment, 1, { reason: 'damaged', note: '', lines: [{ lineId: driverStop(trip, 1).lines[0]!.lineId, refused: 1 }] })]) {
    await refused(body, 409, 'stop_done', { stopSeq: 1 });
  }
});

it('AC-18 records Wellawatte’s two refused chilled cartons with the optional photo and delivers 46 and 46', async () => {
  const trip = await atWellawatte();
  const previous = driverStop(trip, 2);
  const chilled = previous.lines.find(line => line.temp === 'chilled')!;
  const beforeOrders = await db.select().from(orders).where(inArray(orders.id, previous.lines.map(line => line.orderId)));
  freeze(THU, 3 * 60 + 48);
  const body = driverWrite(trip, 'refuse', at(3 * 60 + 48).toISOString(), 2, { reason: 'damaged', note: '2 crushed at the bottom', lines: [{ lineId: chilled.lineId, refused: 2 }], photo });
  const result = answeredTrip(await afterCommit(body));
  const delivered = driverStop(result, 2);
  expect(delivered).toMatchObject({ outcome: 'refused', doneAt: body.at, revision: previous.revision + 1 });
  expect(delivered.lines.map(line => line.delivered)).toEqual([46, 46]);
  const storedLines = await db.select().from(orderLines).where(inArray(orderLines.id, previous.lines.map(line => line.lineId)));
  expect(previous.lines.map(line => storedLines.find(row => row.id === line.lineId)!.deliveredQty)).toEqual([46, 46]);
  for (const row of await db.select().from(orders).where(inArray(orders.id, previous.lines.map(line => line.orderId)))) {
    expect(row).toMatchObject({ status: 'delivered', revision: beforeOrders.find(old => old.id === row.id)!.revision + 1 });
  }
  expect((await db.select().from(issues).where(eq(issues.id, body.writeId)))[0]).toMatchObject({ id: body.writeId, kind: 'refused', reason: 'damaged', status: 'open', revision: 0,
    stopId: previous.id, raisedBy: dilshanId, raisedAt: at(3 * 60 + 48), note: '2 crushed at the bottom', decision: null, decidedBy: null, decidedAt: null });
  expect(await db.select().from(issueLines).where(eq(issueLines.issueId, body.writeId))).toEqual([{ issueId: body.writeId, orderLineId: chilled.lineId, counted: 2, reason: null }]);
  expect((await db.select().from(photos).where(eq(photos.id, body.writeId)))[0]).toEqual({ id: body.writeId, stopId: previous.id, issueId: body.writeId, jpeg, takenBy: dilshanId, takenAt: at(3 * 60 + 48) });
  expect(result.problems).toEqual([{ id: body.writeId, kind: 'refused', stopId: previous.id, reason: 'damaged', note: '2 crushed at the bottom', raisedAt: body.at, hasPhoto: true,
    lines: [{ lineId: chilled.lineId, counted: 2 }], decision: null, decidedBy: null, decidedAt: null }]);
  await expectAudit(previous.id, 'stop.refused');
  expect(told()).toEqual([{ topic: 'driver', depotId: 'Peliyagoda' }, { topic: 'issues', depotId: 'Peliyagoda' }, { topic: 'orders', outletId: 'OUT002', depotId: 'Peliyagoda' }]);
});

it('AC-19 refuses invalid counts, another stop’s line, duplicate lines, reason or long note without changes', async () => {
  const trip = await atWellawatte();
  const line = driverStop(trip, 2).lines[0]!;
  const otherLine = driverStop(trip, 1).lines[0]!;
  const body = driverWrite(trip, 'refuse', at(3 * 60 + 48).toISOString(), 2, { reason: 'damaged', note: '', lines: [{ lineId: line.lineId, refused: 2 }] });
  const cases: [object, string][] = [
    [{ lines: [] }, 'invalid_input'], ...[0, -1, 49, 1.5].map((count): [object, string] => [{ lines: [{ lineId: line.lineId, refused: count }] }, 'invalid_input']),
    [{ lines: [{ lineId: otherLine.lineId, refused: 1 }] }, 'unknown_record'],
    [{ lines: [{ lineId: line.lineId, refused: 1 }, { lineId: line.lineId, refused: 2 }] }, 'invalid_input'],
    [{ reason: 'missing' }, 'invalid_input'], [{ note: 'x'.repeat(201) }, 'invalid_input'],
  ];
  for (const [change, error] of cases) await refused({ ...body, ...change }, 400, error);
});

it('AC-20 records a closed Wellawatte at 48 and 46 still on the truck with its orders unchanged', async () => {
  const trip = await atWellawatte();
  const previous = driverStop(trip, 2);
  const beforeOrders = await db.select().from(orders).where(inArray(orders.id, previous.lines.map(line => line.orderId))).orderBy(orders.id);
  freeze(THU, 3 * 60 + 48);
  const body = driverWrite(trip, 'closed', at(3 * 60 + 48).toISOString(), 2, { note: 'Lights off, gate locked' });
  const result = answeredTrip(await afterCommit(body));
  expect(driverStop(result, 2)).toMatchObject({ outcome: 'closed', revision: previous.revision + 1, doneAt: body.at });
  expect(driverStop(result, 2).lines.map(line => [line.loaded, line.delivered])).toEqual([[48, null], [46, null]]);
  const storedLines = await db.select().from(orderLines).where(inArray(orderLines.id, previous.lines.map(line => line.lineId)));
  expect(previous.lines.map(line => storedLines.find(row => row.id === line.lineId)!.deliveredQty)).toEqual([null, null]);
  expect(await db.select().from(orders).where(inArray(orders.id, previous.lines.map(line => line.orderId))).orderBy(orders.id)).toEqual(beforeOrders);
  expect(beforeOrders.every(order => order.status === 'loaded')).toBe(true);
  expect((await db.select().from(issues).where(eq(issues.id, body.writeId)))[0]).toMatchObject({ kind: 'closed', reason: 'nobody_there', status: 'open', raisedBy: dilshanId,
    raisedAt: at(3 * 60 + 48), stopId: previous.id, note: 'Lights off, gate locked' });
  expect((await db.select().from(issueLines).where(eq(issueLines.issueId, body.writeId))).sort((a, b) => a.counted - b.counted)).toEqual(
    previous.lines.map(line => ({ issueId: body.writeId, orderLineId: line.lineId, counted: line.loaded, reason: null })).sort((a, b) => a.counted! - b.counted!));
  expect(await db.select().from(photos).where(eq(photos.id, body.writeId))).toEqual([]);
  await expectAudit(previous.id, 'stop.closed');
  expect(told()).toEqual([{ topic: 'driver', depotId: 'Peliyagoda' }, { topic: 'issues', depotId: 'Peliyagoda' }]);
});

it('AC-21 names unfinished stops and closes the trip only after every stop is done', async () => {
  let trip = await started();
  await refused(driverWrite(trip, 'finish', at(3 * 60 + 32).toISOString()), 409, 'stops_left', { stopSeqs: [1, 2] });
  trip = await write(trip, 'arrive', 3 * 60 + 34, 1);
  trip = await write(trip, 'deliver', 3 * 60 + 38, 1, { photo });
  const refusal = await refused(driverWrite(trip, 'finish', at(3 * 60 + 39).toISOString()), 409, 'stops_left', { stopSeqs: [2] });
  expect(refusal.body.error.message).toBe('Stop 2 is not done yet.');
  trip = await write(trip, 'arrive', 3 * 60 + 45, 2);
  trip = await write(trip, 'closed', 3 * 60 + 48, 2);
  freeze(THU, 3 * 60 + 55);
  const result = answeredTrip(await afterCommit(driverWrite(trip, 'finish', at(3 * 60 + 55).toISOString())));
  expect(result).toMatchObject({ status: 'done', backAt: at(3 * 60 + 55).toISOString(), revision: trip.revision + 1 });
  expect((await db.select().from(trips).where(eq(trips.id, trip.tripId)))[0]).toMatchObject({ status: 'done', revision: trip.revision + 1, backAt: at(3 * 60 + 55), lastEventAt: at(3 * 60 + 55) });
  await expectAudit(trip.tripId, 'trip.finished');
  expect(told()).toEqual([{ topic: 'driver', depotId: 'Peliyagoda' }]);
});
