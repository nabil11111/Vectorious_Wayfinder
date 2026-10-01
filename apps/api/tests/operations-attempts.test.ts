import { PlanBoard, type DraftPlan } from '@wayfinder/contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { demoDay, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { driverStop, driverTrip } from './driver-plan';
import { answeredTruck, loaderScreen, resetDay, signIn, THU, truckOf, WED } from './loading-plan';
import { decide, FRI, journey, operations, photo, shownTrip } from './operations-plan';
import { serve, stop } from './serve';
const clock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async original => {
  const actual = await original<typeof import('../src/lib/clock')>();
  return { ...actual, demoClockAt: (...args: Parameters<typeof actual.demoClockAt>) => ({ ...actual.demoClockAt(...args), now: clock.at || actual.demoClockAt(...args).now }) };
});
const freeze = (date: string, min: number) => { const at = depotInstant(date, min); clock.at = at.toISOString(); setClockForTests(at); };
const server = await serve(createApp());
const ruwan = request.agent(server), nadeesha = request.agent(server), kasun = request.agent(server), dilshan = request.agent(server);
const walk = { ruwan, nadeesha, kasun, dilshan, freeze }, road = journey(walk), read = () => operations(ruwan);
let originalClock: typeof demoDay.$inferSelect;
beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, name] of [[ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [kasun, 'kasun'], [dilshan, 'dilshan']] as const) await signIn(agent, name);
});
beforeEach(async () => { await resetDay(); await initClock(); freeze(WED, 960); });
afterAll(async () => { await resetDay(); await db.update(demoDay).set(originalClock); clock.at = ''; setClockForTests(null); await stop(server); await pool.end(); });

it('AC-8 returned orders reenter demand without rewriting the old attempt', async () => {
  let trip = await road.write(await road.wellawatte(), 'closed', 228, 2, { photo });
  const closed = trip.problems.find(problem => problem.kind === 'closed')!, oldStop = driverStop(trip, 2);
  const old = await read();
  expect(old.nextRun!.orders).toBe(99);
  const attempt = old.events.find(event => event.kind === 'problem_raised' && event.issueId === closed.id);
  expect(attempt).toMatchObject({ at: depotInstant(THU, 228).toISOString(), hasPhoto: true, lines: expect.arrayContaining([expect.objectContaining({ counted: 48 }), expect.objectContaining({ counted: 46 })]) });
  freeze(THU, 232);
  await decide(ruwan, closed.id, 'bring_back');
  const returned = await read();
  expect(returned.nextRun!.orders).toBe(101);
  expect(shownTrip(returned).figures).toMatchObject({ delivered: 23, notDelivered: 94, short: 1 });
  expect(shownTrip(returned).lastReportAt).toBe(depotInstant(THU, 228).toISOString());
  trip = await road.write(driverTrip(await road.driver.read()), 'finish', 235);

  freeze(THU, 960);
  const board = PlanBoard.parse((await ruwan.get('/api/v1/plans')).body);
  const ids = [...new Set(oldStop.lines.map(line => line.orderId))];
  const [driver] = await db.select().from(users).where(eq(users.username, 'dilshan'));
  const draft: DraftPlan = { mixBrands: false, trips: [{ vehicleId: 'VEH035', tripNo: 1, leaveAt: null, driverId: driver!.id,
    stops: [{ outletId: 'OUT002', orderIds: ids }] }], deferrals: board.orders.filter(order => !ids.includes(order.id)).map(order => ({ orderId: order.id, code: 'dispatcher_choice', reason: 'Scheduled for a later run.' })) };
  const saved = await ruwan.put(`/api/v1/plans/${FRI}/draft`).send({ planId: null, demoDay: board.demoDay, plan: draft });
  expect(saved.status).toBe(200);
  const ready = PlanBoard.parse(saved.body);
  expect((await ruwan.post(`/api/v1/plans/${FRI}/send`).send({ planId: ready.plan.id, revision: ready.plan.revision })).status).toBe(200);
  freeze(FRI, 150);
  const loader = loaderScreen(kasun), loading = await loader.read();
  let truck = answeredTruck(await loader.start(truckOf(loading, 'VEH035'), loading.plan!), 'VEH035');
  truck = answeredTruck(await loader.stopLoaded(truck, 1), 'VEH035');
  truck = answeredTruck(await loader.ready(truck), 'VEH035');
  expect(truck.on.units).toBe(94);
  trip = driverTrip(await road.driver.read());
  trip = await road.write(trip, 'start', 211, undefined, {}, FRI);
  trip = await road.write(trip, 'arrive', 214, 1, {}, FRI);
  await road.write(trip, 'deliver', 218, 1, { photo }, FRI);

  // Thursday's explicit test clock must never pick up Friday's delivery on those same order lines.
  freeze(THU, 235);
  const historical = await read();
  expect(shownTrip(historical).figures).toMatchObject({ delivered: 23, notDelivered: 94, short: 1 });
  expect(historical.events.find(event => event.kind === 'problem_raised' && event.issueId === closed.id)).toEqual(attempt);
  expect(historical.events.find(event => event.kind === 'answer_sent' && event.issueId === closed.id)).toMatchObject({ actor: 'Ruwan', decision: 'bring_back', at: depotInstant(THU, 232).toISOString() });
  expect(historical.nextRun!.orders).toBe(101);
});

it('AC-9 retry reopens progress and keeps the closed event', async () => {
  const trip = await road.write(await road.wellawatte(), 'closed', 228, 2);
  const closed = trip.problems.find(problem => problem.kind === 'closed')!;
  const before = await read();
  const attempt = before.events.find(event => event.kind === 'problem_raised' && event.issueId === closed.id);
  expect(attempt).toBeDefined();
  expect(before.counts.stopsDone).toBe(2);
  freeze(THU, 232);
  await decide(ruwan, closed.id, 'try_again');
  const retried = await read();
  expect(retried.counts).toMatchObject({ stopsDone: 1, stopsDelivered: 1, closedStops: 0 });
  expect(shownTrip(retried)).toMatchObject({ action: 'decided', lastReportAt: depotInstant(THU, 228).toISOString(), attention: { kind: 'retry_requested' },
    outRow: { nextStop: { outletId: 'OUT002' }, plannedArrival: depotInstant(THU, 324).toISOString(), arrivalIsOriginal: true } });
  expect(retried.events.find(event => event.kind === 'problem_raised' && event.issueId === closed.id)).toEqual(attempt);
  expect(retried.events.find(event => event.kind === 'answer_sent' && event.issueId === closed.id)).toMatchObject({ actor: 'Ruwan', decision: 'try_again', at: depotInstant(THU, 232).toISOString() });
  expect(retried.events.filter(event => event.kind === 'arrived' && event.stopId === closed.stopId)).toEqual([]);
  const arrived = await road.write(driverTrip(await road.driver.read()), 'arrive', 233, 2);
  await road.write(arrived, 'deliver', 235, 2, { photo });
  expect((await read()).counts).toMatchObject({ stopsDone: 2, stopsDelivered: 2 });
});
