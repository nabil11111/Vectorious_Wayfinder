// VEH004 runs two trips on Thursday, Gampaha first and Colombo after, with Anura driving. The loader's day while the
// truck is out on trip 1 and trip 2 waits at the dock (Q-26), and the trucks that have left it (Q-34).
import { LoadingDay, PlanBoard, PlanCheck, type DraftPlan, type DraftTrip, type LoadingTruck } from '@wayfinder/contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { demoDay, trips, users } from '../src/db/schema';
import { depotClock, depotInstant, depotMinutes, initClock, setClockForTests } from '../src/lib/clock';
import { loaderScreen, resetDay, signIn, THU, WED } from './loading-plan';
import { serve, stop } from './serve';

const clock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const actual = await original<typeof import('../src/lib/clock')>();
  return { ...actual, demoClockAt: (...args: Parameters<typeof actual.demoClockAt>) => ({ ...actual.demoClockAt(...args), now: clock.at || actual.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async (original) => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const freeze = (date: string, minute: number) => { const at = depotInstant(date, minute); clock.at = at.toISOString(); setClockForTests(at); };

const server = await serve(createApp());
const ruwan = request.agent(server);
const kasun = request.agent(server);
const anura = request.agent(server);
const loader = loaderScreen(kasun);
let originalClock: typeof demoDay.$inferSelect;

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, username] of [[ruwan, 'ruwan'], [kasun, 'kasun'], [anura, 'anura']] as const) await signIn(agent, username);
});
beforeEach(async () => {
  await resetDay();
  await initClock();
  freeze(WED, 16 * 60);
});
afterAll(async () => {
  await resetDay();
  await db.update(demoDay).set(originalClock);
  clock.at = '';
  setClockForTests(null);
  await stop(server);
  await pool.end();
});

// One of VEH004's trips on the loader's day.
function tripOf(day: LoadingDay, tripNo: number): LoadingTruck {
  const truck = day.trucks.find((t) => t.vehicleId === 'VEH004' && t.tripNo === tripNo);
  if (!truck) throw new Error(`VEH004 trip ${tripNo} is not on the loading day.`);
  return truck;
}
const vehicleTrips = (day: LoadingDay) => day.trucks.filter((t) => t.vehicleId === 'VEH004');

// Ruwan sends Thursday's plan at Wed 16:00 with VEH004 on two trips, every other order deferred, and the clock moves
// to Thu 02:30. It answers when trip 1 is due back at the depot.
async function twoTrips(): Promise<string> {
  const board = PlanBoard.parse((await ruwan.get('/api/v1/plans')).body);
  const [driver] = await db.select({ id: users.id }).from(users).where(eq(users.username, 'anura'));
  const stopAt = (outletId: string) => ({ outletId, orderIds: board.orders.filter((o) => o.outletId === outletId).map((o) => o.id) });
  const planned: DraftTrip[] = [
    { vehicleId: 'VEH004', tripNo: 1, leaveAt: null, driverId: driver!.id, stops: [stopAt('OUT026'), stopAt('OUT028')] },
    { vehicleId: 'VEH004', tripNo: 2, leaveAt: null, driverId: driver!.id, stops: [stopAt('OUT006')] },
  ];
  const on = new Set(planned.flatMap((t) => t.stops.flatMap((s) => s.orderIds)));
  const draft: DraftPlan = { mixBrands: false, trips: planned, deferrals: board.orders.filter((o) => !on.has(o.id)).map((o) => ({ orderId: o.id, code: 'dispatcher_choice', reason: 'Later.' })) };
  const saved = PlanBoard.parse((await ruwan.put(`/api/v1/plans/${THU}/draft`).send({ planId: null, demoDay: board.demoDay, plan: draft })).body);
  expect(saved.check!.problems.filter((p) => p.level === 'block')).toEqual([]);
  expect((await ruwan.post(`/api/v1/plans/${THU}/send`).send({ planId: saved.plan.id, revision: saved.plan.revision })).status).toBe(200);
  freeze(THU, 2 * 60 + 30);
  const times = PlanCheck.parse(saved.check).trips.find((t) => t.vehicleId === 'VEH004' && t.tripNo === 1)!.times!;
  return depotInstant(THU, times.backAt).toISOString();
}

// Kasun loads trip 1 last stop first and marks it ready, and Anura starts it from his phone at Thu 03:30. It answers
// trip 1's id.
async function tripOneOut(): Promise<string> {
  const day = await loader.read();
  const first = tripOf(day, 1);
  expect((await loader.start(first, day.plan!)).status).toBe(200);
  for (const seq of [2, 1]) {
    const truck = tripOf(await loader.read(), 1);
    expect((await loader.stopLoaded(truck, seq)).status).toBe(200);
  }
  expect((await loader.ready(tripOf(await loader.read(), 1))).status).toBe(200);
  freeze(THU, 3 * 60 + 30);
  const phone = (await anura.get('/api/v1/driver')).body as { trips: { tripId: string; revision: number }[] };
  const mine = phone.trips.find((t) => t.tripId === first.tripId)!;
  const started = await anura.post('/api/v1/driver/writes').send({ writeId: crypto.randomUUID(), tripId: first.tripId, kind: 'start', at: depotInstant(THU, 3 * 60 + 30).toISOString(), revision: mine.revision });
  expect(started.status).toBe(200);
  return first.tripId;
}

it('Q-26 names the trip a vehicle is still out on, and when it is back, on its next trip, which can still be started', async () => {
  const backBy = await twoTrips();
  expect(vehicleTrips(await loader.read()).map((t) => [t.tripNo, t.outOn])).toEqual([[1, null], [2, null]]);

  await tripOneOut();
  const day = await loader.read();
  const words = `out on trip 1 · back by ${depotClock(new Date(backBy))}`;
  expect(vehicleTrips(day).map((t) => [t.tripNo, t.status, t.outOn])).toEqual([[2, 'planned', { tripNo: 1, backBy, words }]]);
  // Rule 2: trip 2's cartons go ready on the dock while the truck is away.
  const started = await loader.start(tripOf(day, 2), day.plan!);
  expect(started.status).toBe(200);
  expect(tripOf(LoadingDay.parse(started.body), 2)).toMatchObject({ status: 'loading', outOn: { tripNo: 1, backBy, words } });
  // Once the app clock passes trip 1's planned return, the row says when it was due, not when it will be (spec 012).
  freeze(THU, depotMinutes(new Date(backBy)) + 1);
  expect(tripOf(await loader.read(), 2).outOn).toEqual({ tripNo: 1, backBy, words: `out on trip 1 · was due back ${depotClock(new Date(backBy))}` });
});

it('Q-26 drops it once trip 1 is checked in at the depot', async () => {
  await twoTrips();
  const first = await tripOneOut();
  await db.update(trips).set({ status: 'done', backAt: depotInstant(THU, 6 * 60) }).where(eq(trips.id, first));
  expect(tripOf(await loader.read(), 2).outOn).toBeNull();
});

// Q-34: a truck the driver has driven away leaves the list of trucks to load, and the loading day says it left, with
// whom and when, so the loader's page can tell it apart from a truck the plan took away.
it('Q-34 lists a truck that has left, with its driver and when it left, apart from the trucks to load', async () => {
  await twoTrips();
  expect((await loader.read()).left).toEqual([]);
  const first = await tripOneOut();
  const day = await loader.read();
  expect(day.trucks.map((t) => t.tripId)).not.toContain(first);
  expect(day.left).toEqual([{ tripId: first, vehicleId: 'VEH004', tripNo: 1, driver: 'Anura', leftAt: depotInstant(THU, 3 * 60 + 30).toISOString() }]);
  // Back at the depot, it has still left the dock.
  await db.update(trips).set({ status: 'done', backAt: depotInstant(THU, 6 * 60) }).where(eq(trips.id, first));
  expect((await loader.read()).left.map((t) => t.tripId)).toEqual([first]);
});

it('Q-34 lists nothing as left once the plan goes back to edit, as its trucks left the plan and not the dock', async () => {
  await twoTrips();
  const board = PlanBoard.parse((await ruwan.get(`/api/v1/plans/${THU}`)).body);
  expect((await ruwan.post(`/api/v1/plans/${THU}/unsend`).send({ planId: board.plan.id, revision: board.plan.revision })).status).toBe(200);
  expect(await loader.read()).toMatchObject({ plan: null, trucks: [], left: [] });
});
