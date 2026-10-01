import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { demoId } from '../src/db/demo-day';
import { demoDay, plans, stopOrders, stops, trips, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { driverScreen, heldDriverRows, readyWalkthrough } from './driver-plan';
import { code, resetDay, sendWalkthroughPlan, signIn, THU, WED, type Walkthrough } from './loading-plan';
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
const dilshan = request.agent(server);
const admin = request.agent(server);
const walk: Walkthrough & { kasun: typeof kasun } = { nadeesha, ruwan, kasun, freeze };
const driver = driverScreen(dilshan);
let originalClock: typeof demoDay.$inferSelect;
let dilshanId: string;
let chamindaId: string;

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, username] of [[kasun, 'kasun'], [ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [dilshan, 'dilshan'], [admin, 'admin']] as const) await signIn(agent, username);
  dilshanId = (await db.select().from(users).where(eq(users.username, 'dilshan')))[0]!.id;
  chamindaId = (await db.select().from(users).where(eq(users.username, 'chaminda')))[0]!.id;
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

it('AC-1 reads the depot day before any send, before the cutoff and after the calendar without writing', async () => {
  const before = await heldDriverRows();
  const [dilshan] = await db.select({ id: users.id }).from(users).where(eq(users.username, 'dilshan'));
  const driverId = dilshan!.id;
  expect(await driver.read()).toEqual({ depot: 'Peliyagoda', driver: 'Dilshan', driverId, day: THU, planSent: false, appliedWriteIds: [], trips: [] });
  freeze(WED, 15 * 60 + 59);
  expect(await driver.read()).toEqual({ depot: 'Peliyagoda', driver: 'Dilshan', driverId, day: WED, planSent: true, appliedWriteIds: [], trips: [] });
  freeze('2026-06-27', 16 * 60);
  expect(await driver.read()).toEqual({ depot: 'Peliyagoda', driver: 'Dilshan', driverId, day: null, planSent: false, appliedWriteIds: [], trips: [] });
  expect(await heldDriverRows()).toEqual(before);
});

it('AC-2 reads VEH035 ready with the saved times, plan stop order, windows, note and loaded counts', async () => {
  const loaded = await readyWalkthrough(walk);
  const before = await heldDriverRows();
  const day = await driver.read();
  expect(day).toMatchObject({ depot: 'Peliyagoda', driver: 'Dilshan', day: THU, planSent: true, appliedWriteIds: [] });
  expect(day.trips).toHaveLength(1);
  const { stops: shownStops, ...trip } = day.trips[0]!;
  expect(trip).toEqual({ tripId: loaded.tripId, revision: loaded.revision, vehicleId: 'VEH035', vehicleType: 'van', vehicleTemp: 'reefer', tripNo: 1,
    brand: 'Fresh', district: 'Colombo', status: 'ready', leavesAt: depotInstant(THU, 4 * 60 + 36).toISOString(), backBy: depotInstant(THU, 6 * 60 + 10).toISOString(),
    readyAt: depotInstant(THU, 2 * 60 + 36).toISOString(), leftAt: null, backAt: null, problems: [] });
  expect(shownStops.map(({ id: _id, lines: _lines, ...shown }) => shown)).toEqual([
    { seq: 1, revision: 0, retriedAt: null, outletId: 'OUT001', shopName: 'Fresh Nugegoda', district: 'Colombo', dockType: 'street', windowOpen: '05:00', windowClose: '07:30',
      note: 'Ring the bell at the side door.', arrivedAt: null, doneAt: null, outcome: null },
    { seq: 2, revision: 0, retriedAt: null, outletId: 'OUT002', shopName: 'Fresh Wellawatte', district: 'Colombo', dockType: 'street', windowOpen: '05:30', windowClose: '08:00',
      note: null, arrivedAt: null, doneAt: null, outcome: null },
  ]);
  const line = (key: string, temp: 'chilled' | 'dry', quantity: number, loaded: number) => ({
    lineId: demoId('line', `${key}:fresh-${temp}-carton`), orderId: demoId('order', key), temp, productId: `fresh-${temp}-carton`,
    name: temp === 'chilled' ? 'Chilled carton' : 'Dry carton', unit: 'carton', quantity, loaded, wontFit: 0, delivered: null,
  });
  expect(shownStops.map(shown => shown.lines)).toEqual([
    [line(`${WED}:OUT001:chilled`, 'chilled', 12, 12), line(`${THU}:OUT001:chilled`, 'chilled', 8, 8), line(`${THU}:OUT001:dry`, 'dry', 4, 3)],
    [line(`${THU}:OUT002:chilled`, 'chilled', 48, 48), line(`${THU}:OUT002:dry`, 'dry', 46, 46)],
  ]);
  expect(await heldDriverRows()).toEqual(before);
});

it('L-09 tells the driver which cartons the loader found would not fit, apart from those short from the depot', async () => {
  await readyWalkthrough(walk, { reason: 'wont_fit' });
  const lines = (await driver.read()).trips[0]!.stops[0]!.lines;
  expect(lines.map((line) => [line.temp, line.quantity, line.loaded, line.wontFit])).toEqual([['chilled', 12, 12, 0], ['chilled', 8, 8, 0], ['dry', 4, 3, 1]]);
});

it('AC-3 keeps an earlier out trip first, the current trips in leaving order including done, and hides another driver', async () => {
  await readyWalkthrough(walk, { withVeh004: true });
  const current = (await db.select().from(plans).where(and(eq(plans.depotId, 'Peliyagoda'), eq(plans.date, THU))))[0]!;
  const currentTrips = await db.select().from(trips).where(eq(trips.planId, current.id));
  const today = currentTrips.find(trip => trip.vehicleId === 'VEH035')!;
  const other = currentTrips.find(trip => trip.vehicleId === 'VEH004')!;
  await db.update(trips).set({ status: 'done', backAt: depotInstant(THU, 3 * 60 + 20) }).where(eq(trips.id, today.id));
  await db.update(trips).set({ driverId: chamindaId }).where(eq(trips.id, other.id));
  const earlierPlan = (await db.update(plans).set({ sentCheck: current.sentCheck }).where(and(eq(plans.depotId, 'Peliyagoda'), eq(plans.date, WED))).returning())[0]!;
  const { id: _id, ...earlierValues } = today;
  const earlier = (await db.insert(trips).values({ ...earlierValues, planId: earlierPlan.id, status: 'out', leftAt: depotInstant(WED, 4 * 60) }).returning())[0]!;
  for (const row of await db.select().from(stops).where(eq(stops.tripId, today.id))) {
    const { id: previousId, ...values } = row;
    const copied = (await db.insert(stops).values({ ...values, tripId: earlier.id }).returning())[0]!;
    for (const joined of await db.select().from(stopOrders).where(eq(stopOrders.stopId, previousId))) await db.insert(stopOrders).values({ stopId: copied.id, orderId: joined.orderId });
  }
  expect((await driver.read()).trips.map(trip => [trip.tripId, trip.status])).toEqual([[earlier.id, 'out'], [today.id, 'done']]);
  await db.update(trips).set({ driverId: dilshanId }).where(eq(trips.id, other.id));
  expect((await driver.read()).trips.map(trip => trip.tripId)).toEqual([earlier.id, other.id, today.id]);
  await db.update(trips).set({ status: 'done' }).where(eq(trips.id, earlier.id));
  expect((await driver.read()).trips.map(trip => trip.tripId)).toEqual([other.id, today.id]);
});

// Announcements must observe the database transaction already completed, including when a later transaction begins.
function observeDriverCommit() {
  let committed = false;
  const transaction = db.transaction.bind(db);
  const spy = vi.spyOn(db, 'transaction').mockImplementation((async (...args: Parameters<typeof db.transaction>) => {
    committed = false;
    const answer = await transaction(...args);
    committed = true;
    return answer;
  }) as typeof db.transaction);
  vi.mocked(announce).mockImplementation(change => { if (change.topic === 'driver') expect(committed).toBe(true); });
  return spy;
}

it('AC-4 announces driver after send and unsend commit and updates whether the plan is sent', async () => {
  const spy = observeDriverCommit();
  try {
    const sent = await sendWalkthroughPlan(walk);
    expect(announce).toHaveBeenCalledWith({ topic: 'driver', depotId: 'Peliyagoda' });
    expect((await driver.read()).planSent).toBe(true);
    vi.mocked(announce).mockClear();
    expect((await ruwan.post(`/api/v1/plans/${THU}/unsend`).send({ planId: sent.plan.id, revision: sent.plan.revision })).status).toBe(200);
    expect(announce).toHaveBeenCalledWith({ topic: 'driver', depotId: 'Peliyagoda' });
    expect(await driver.read()).toMatchObject({ planSent: false, trips: [] });
  } finally { spy.mockRestore(); }
});

it('AC-4 announces driver after the loader marks VEH035 ready', async () => {
  const spy = observeDriverCommit();
  try {
    await readyWalkthrough(walk);
    expect(vi.mocked(announce).mock.calls.filter(([change]) => change.topic === 'driver')).toEqual([
      [{ topic: 'driver', depotId: 'Peliyagoda' }], [{ topic: 'driver', depotId: 'Peliyagoda' }],
    ]);
  } finally { spy.mockRestore(); }
});

it('AC-5 turns away signed-out callers, the other roles and an admin on both driver endpoints', async () => {
  for (const method of ['get', 'post'] as const) {
    const call = (agent: ReturnType<typeof request.agent>) => method === 'get' ? agent.get('/api/v1/driver') : agent.post('/api/v1/driver/writes').send({});
    expect(code(await call(request.agent(server)))).toEqual([401, 'signed_out']);
    for (const agent of [nadeesha, kasun, ruwan]) expect(code(await call(agent))).toEqual([403, 'forbidden']);
    expect(code(await call(admin))).toEqual([403, 'no_depot']);
  }
});
