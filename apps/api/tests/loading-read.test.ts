import { randomUUID } from 'node:crypto';
import { LoadingDay } from '@wayfinder/contracts';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { demoId } from '../src/db/demo-day';
import { demoDay, issueLines, issues, orderLines, plans, trips, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { code, heldRows, resetDay, sendWalkthroughPlan, signIn, THU, WED, type Walkthrough } from './loading-plan';
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
const walk: Walkthrough = { nadeesha, ruwan, freeze };
let originalClock: typeof demoDay.$inferSelect;

const loadingDay = async () => {
  const res = await kasun.get('/api/v1/loading');
  expect(res.status).toBe(200);
  return LoadingDay.parse(res.body);
};
const thursdayPlan = async () => (await db.select().from(plans).where(and(eq(plans.depotId, 'Peliyagoda'), eq(plans.date, THU))))[0]!;

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, username] of [[kasun, 'kasun'], [ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [dilshan, 'dilshan'], [admin, 'admin']] as const) await signIn(agent, username);
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

it("AC-2 answers the loader's day before any send, the day before until 16:00 and no day after the calendar, and writes nothing", async () => {
  const before = await heldRows();
  expect(await loadingDay()).toEqual({ depot: 'Peliyagoda', demoDay: originalClock.day, day: THU, plan: null, trucks: [], left: [] });
  freeze(WED, 15 * 60 + 59);
  expect(await loadingDay()).toEqual({ depot: 'Peliyagoda', demoDay: originalClock.day, day: WED, plan: { id: demoId('plan', `${WED}:Peliyagoda`), revision: 0, publishedAt: depotInstant('2026-06-23', 17 * 60).toISOString(), publishedBy: null }, trucks: [], left: [] });
  freeze('2026-06-27', 16 * 60);
  expect(await loadingDay()).toEqual({ depot: 'Peliyagoda', demoDay: originalClock.day, day: null, plan: null, trucks: [], left: [] });
  expect(await heldRows()).toEqual(before);
});

it("AC-3 holds the walkthrough's truck with its last stop first and nothing on yet", async () => {
  await sendWalkthroughPlan(walk);
  const day = await loadingDay();
  const plan = await thursdayPlan();
  const [trip] = await db.select().from(trips).where(eq(trips.planId, plan.id));
  expect(day).toMatchObject({ depot: 'Peliyagoda', day: THU, plan: { id: plan.id, revision: plan.revision } });
  expect(day.trucks).toHaveLength(1);
  const { stops, ...truck } = day.trucks[0]!;
  expect(truck).toEqual({
    tripId: trip!.id, revision: 0, vehicleId: 'VEH035', vehicleType: 'van', vehicleTemp: 'reefer', tripNo: 1, brand: 'Fresh', district: 'Colombo',
    status: 'planned', loadingBlocked: null, reloadRequired: false, leavesAt: depotInstant(THU, 4 * 60 + 36).toISOString(), readyAt: null, driver: 'Dilshan', weightCapKg: 1040, volumeCapM3: 7,
    units: 118, on: { units: 0, kg: 0, m3: 0 }, short: 0, wontFit: 0, issues: [], outOn: null,
  });
  expect(stops.map(({ lines: _lines, id: _id, ...stop }) => stop)).toEqual([
    { seq: 2, outletId: 'OUT002', shopName: 'Fresh Wellawatte', loaded: false, units: 94, going: 94, short: 0, wontFit: 0 },
    { seq: 1, outletId: 'OUT001', shopName: 'Fresh Nugegoda', loaded: false, units: 24, going: 24, short: 0, wontFit: 0 },
  ]);
  // Chilled before dry, then the order placed first: Nugegoda's 12 carried-over cartons were placed on Tuesday.
  const order = (key: string) => demoId('order', key);
  const line = (key: string, temp: 'chilled' | 'dry', quantity: number) => ({
    lineId: demoId('line', `${key}:fresh-${temp}-carton`), orderId: order(key), temp, productId: `fresh-${temp}-carton`,
    name: temp === 'chilled' ? 'Chilled carton' : 'Dry carton', unit: 'carton', quantity, going: quantity, short: 0, wontFit: 0,
  });
  expect(stops.map((s) => s.lines)).toEqual([
    [line(`${THU}:OUT002:chilled`, 'chilled', 48), line(`${THU}:OUT002:dry`, 'dry', 46)],
    [line(`${WED}:OUT001:chilled`, 'chilled', 12), line(`${THU}:OUT001:chilled`, 'chilled', 8), line(`${THU}:OUT001:dry`, 'dry', 4)],
  ]);
  const stored = await db.select().from(orderLines);
  for (const shown of stops.flatMap((s) => s.lines)) expect(stored.find((l) => l.id === shown.lineId)).toMatchObject({ orderId: shown.orderId, quantity: shown.quantity });
});

it("AC-4 lists VEH004 first, leaving 03:30, and loads its Kandana stop before Gampaha", async () => {
  await sendWalkthroughPlan(walk, { withVeh004: true });
  const day = await loadingDay();
  expect(day.trucks.map((t) => [t.vehicleId, t.tripNo, t.leavesAt, t.units])).toEqual([
    ['VEH004', 1, depotInstant(THU, 3 * 60 + 30).toISOString(), 210],
    ['VEH035', 1, depotInstant(THU, 4 * 60 + 36).toISOString(), 118],
  ]);
  expect(day.trucks[0]).toMatchObject({ vehicleType: 'truck', vehicleTemp: 'reefer', brand: 'Fresh', district: 'Gampaha', driver: 'Anura', weightCapKg: 6840, volumeCapM3: 33.4 });
  expect(day.trucks[0]!.stops.map((s) => [s.seq, s.shopName, s.units])).toEqual([[2, 'Fresh Kandana', 99], [1, 'Fresh Gampaha', 111]]);
});

it('AC-5 announces loading on send and on back to edit, and then has no plan and no trucks', async () => {
  const sent = await sendWalkthroughPlan(walk);
  expect(announce).toHaveBeenCalledWith({ topic: 'loading', depotId: 'Peliyagoda' });
  expect((await loadingDay()).trucks).toHaveLength(1);
  vi.mocked(announce).mockClear();
  expect((await ruwan.post(`/api/v1/plans/${THU}/unsend`).send({ planId: sent.plan.id, revision: sent.plan.revision })).status).toBe(200);
  expect(announce).toHaveBeenCalledWith({ topic: 'loading', depotId: 'Peliyagoda' });
  expect(await loadingDay()).toEqual({ depot: 'Peliyagoda', demoDay: originalClock.day, day: THU, plan: null, trucks: [], left: [] });
});

it('AC-5 leaves a truck that is out or done off the list', async () => {
  await sendWalkthroughPlan(walk, { withVeh004: true });
  const plan = await thursdayPlan();
  for (const status of ['out', 'done'] as const) {
    await db.update(trips).set({ status }).where(and(eq(trips.planId, plan.id), eq(trips.vehicleId, 'VEH004')));
    const day = await loadingDay();
    expect(day.plan).toEqual({ id: plan.id, revision: plan.revision, publishedAt: plan.publishedAt!.toISOString(), publishedBy: 'Ruwan' });
    expect(day.trucks.map((t) => t.vehicleId)).toEqual(['VEH035']);
  }
});

it('AC-6 turns away no session, the other roles and an admin on all eight endpoints, Q-16 taking a stop off again among them', async () => {
  type Endpoint = [method: 'get' | 'post', url: string];
  const id = randomUUID();
  const loaders: Endpoint[] = [['get', '/api/v1/loading'], ...['start', 'stop-loaded', 'undo-stop', 'flags', 'ready'].map((write): Endpoint => ['post', `/api/v1/loading/trips/${id}/${write}`])];
  const dispatchers: Endpoint[] = [['get', '/api/v1/issues'], ['post', `/api/v1/issues/${id}/decide`]];
  const call = (agent: ReturnType<typeof request.agent>, [method, url]: Endpoint) => method === 'get' ? agent.get(url) : agent.post(url).send({});
  for (const path of [...loaders, ...dispatchers]) {
    expect(code(await call(request.agent(server), path))).toEqual([401, 'signed_out']);
    for (const agent of [nadeesha, dilshan]) expect(code(await call(agent, path))).toEqual([403, 'forbidden']);
    expect(code(await call(admin, path))).toEqual([403, 'no_depot']);
  }
  for (const path of loaders) expect(code(await call(ruwan, path))).toEqual([403, 'forbidden']);
  for (const path of dispatchers) expect(code(await call(kasun, path))).toEqual([403, 'forbidden']);
});

// Spec 013 AC-7: a driver's problem never changes the loader's going counts or flags.
it('driver AC-7 keeps a refused problem out of loading flags', async () => {
  await sendWalkthroughPlan(walk);
  const initial = await loadingDay();
  const truck = initial.trucks[0]!;
  const stop = truck.stops[0]!;
  const [driver] = await db.select().from(users).where(eq(users.username, 'dilshan'));
  const [problem] = await db.insert(issues).values({ kind: 'refused', reason: 'damaged', stopId: stop.id, raisedBy: driver!.id, raisedAt: depotInstant(THU, 3 * 60) }).returning();
  await db.insert(issueLines).values({ issueId: problem!.id, orderLineId: stop.lines[0]!.lineId, counted: 2 });
  expect(await loadingDay()).toEqual(initial);
});
