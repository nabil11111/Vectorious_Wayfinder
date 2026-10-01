import { PlanCheck } from '@wayfinder/contracts';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { clearDemoDay, seedDemoDay } from '../src/db/demo-day';
import { demoDay, fuelLog, issueLines, issues, orders, plans, stops, trips, users, vehicles } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import * as board from '../src/plans/board';
import { driverStop, heldDriverRows } from './driver-plan';
import { answeredTruck, code, kandyTrip, loaderScreen, resetDay, sendWalkthroughPlan, signIn, THU, truckOf, WED } from './loading-plan';
import { journey, operations, shownTrip, FRI } from './operations-plan';
import { serve, stop } from './serve';
const clock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async original => {
  const actual = await original<typeof import('../src/lib/clock')>();
  return { ...actual, demoClockAt: (...args: Parameters<typeof actual.demoClockAt>) => ({ ...actual.demoClockAt(...args), now: clock.at || actual.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async original => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const freeze = (date: string, min: number) => { const at = depotInstant(date, min); clock.at = at.toISOString(); setClockForTests(at); };
const server = await serve(createApp());
const ruwan = request.agent(server), nadeesha = request.agent(server), kasun = request.agent(server), dilshan = request.agent(server), admin = request.agent(server);
const walk = { ruwan, nadeesha, kasun, dilshan, freeze }, road = journey(walk);
const read = () => operations(ruwan);
let originalClock: typeof demoDay.$inferSelect;
beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, name] of [[ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [kasun, 'kasun'], [dilshan, 'dilshan'], [admin, 'admin']] as const) await signIn(agent, name);
});
beforeEach(async () => { await resetDay(); await initClock(); freeze(WED, 960); vi.mocked(announce).mockClear(); });
afterAll(async () => { await resetDay(); await db.update(demoDay).set(originalClock); clock.at = ''; setClockForTests(null); await stop(server); await pool.end(); });

it('AC-1 operations requires a dispatcher with a depot and reads without writes', async () => {
  expect(code(await request(server).get('/api/v1/operations'))).toEqual([401, 'signed_out']);
  for (const agent of [nadeesha, kasun, dilshan]) expect(code(await agent.get('/api/v1/operations'))).toEqual([403, 'forbidden']);
  expect(code(await admin.get('/api/v1/operations'))).toEqual([403, 'no_depot']);
  const before = await heldDriverRows();
  expect((await read()).depot.id).toBe('Peliyagoda');
  expect(await heldDriverRows()).toEqual(before);
  expect(announce).not.toHaveBeenCalled();
});
it('AC-2 unpublished Thursday excludes its workload from Fridays demand', async () => {
  const before = await read();
  expect(before).toMatchObject({ day: THU, plan: null, groups: [], nextRun: { date: FRI, orders: 0, cutoffAt: depotInstant(THU, 960).toISOString() }, counts: { stopsTotal: 0, stopsDelivered: 0, vehiclesOut: 0, vehiclesTotal: 38 }, fuel: { litres: 6945, quotaLitres: 18600, percent: 37 } });
  freeze(WED, 930);
  const next = (await nadeesha.get('/api/v1/store/next-order')).body;
  expect((await nadeesha.post('/api/v1/store/next-order/place').send({ deliveryDate: next.deliveryDate, refs: next.draft.refs })).status).toBe(200);
  freeze(WED, 960);
  expect((await read()).nextRun!.orders).toBe(0);
  await db.insert(orders).values({ outletId: 'OUT001', deliveryDate: FRI, temp: 'dry', status: 'placed', placedAt: depotInstant(WED, 930) });
  expect((await read()).nextRun!.orders).toBe(1);
});
it('AC-37 Thursday publication gives Friday demand zero then ninety nine then zero', async () => {
  expect((await read()).nextRun!.orders).toBe(0);
  const sent = await sendWalkthroughPlan(walk);
  expect((await read()).nextRun).toEqual({ date: FRI, orders: 99, cutoffAt: depotInstant(THU, 960).toISOString() });
  expect((await ruwan.post(`/api/v1/plans/${THU}/unsend`).send({ planId: sent.plan.id, revision: sent.plan.revision })).status).toBe(200);
  expect((await read()).nextRun!.orders).toBe(0);
});
it('AC-3 sent walkthrough counts orders and fuel once', async () => {
  const sent = await sendWalkthroughPlan(walk);
  const day = await read();
  expect(day).toMatchObject({ plan: { id: sent.plan.id, revision: sent.plan.revision, detailRecorded: true }, counts: { stopsTotal: 2, stopsDelivered: 0, stopsDone: 0, tripsTotal: 1, deferredOrders: 99, vehiclesTotal: 38 }, fuel: { litres: 6947.7, quotaLitres: 18600, percent: 37 } });
  expect(shownTrip(day)).toMatchObject({ figures: { ordered: 118, loaded: null, short: null }, schedule: { leavesAt: depotInstant(THU, 276).toISOString(), backAt: depotInstant(THU, 370).toISOString() }, onSoFar: { units: 0 } });
  expect(shownTrip(day).stopDetails.map(stop => stop.plannedArrival)).toEqual([depotInstant(THU, 300).toISOString(), depotInstant(THU, 324).toISOString()]);
  expect((await read()).fuel).toEqual(day.fuel);
});
it('AC-4 ready truck separates dock load from delivery', async () => {
  await road.ready();
  const day = await read();
  expect(shownTrip(day)).toMatchObject({ status: 'ready', figures: { ordered: 118, loaded: 117, short: 1, delivered: 0 }, onSoFar: { units: 117 }, lastReportAt: null, action: 'decided' });
  expect(day.counts).toMatchObject({ stopsDelivered: 0, vehiclesOut: 0 });
});
it('Q-24 a truck past its leaving time says what the dock recorded: not loaded, still loading, or departure not reported', async () => {
  const leaves = depotInstant(THU, 276).toISOString();
  await sendWalkthroughPlan(walk);
  freeze(THU, 277);
  expect(shownTrip(await read()).attention).toEqual({ kind: 'not_loaded', plannedAt: leaves, sentence: 'Not loaded · planned 04:36', word: 'still at the dock' });
  // Kasun starts VEH035 and loads Wellawatte's 94 cartons, then the clock passes 04:36 again.
  freeze(THU, 150);
  const loader = loaderScreen(kasun);
  const loading = await loader.read();
  const truck = answeredTruck(await loader.start(truckOf(loading, 'VEH035'), loading.plan!), 'VEH035');
  answeredTruck(await loader.stopLoaded(truck, 2), 'VEH035');
  freeze(THU, 277);
  expect(shownTrip(await read()).attention).toEqual({
    kind: 'still_loading', plannedAt: leaves, on: 94, units: 118, sentence: 'Still loading · 94 of 118 on · planned 04:36', word: 'still at the dock' });
});
it('Q-24 a ready truck not reported out past its leaving time keeps "Departure not reported", watching', async () => {
  await road.ready();
  freeze(THU, 277);
  const day = await read();
  expect(shownTrip(day).attention).toEqual({ kind: 'departure_unreported', plannedAt: depotInstant(THU, 276).toISOString(), sentence: 'Departure not reported · planned 04:36', word: 'watching' });
  expect(day.counts.vehiclesOut).toBe(0);
});
it('AC-5 recorded departure and delivery leave schedule unchanged', async () => {
  let trip = await road.started();
  const before = shownTrip(await read());
  trip = await road.write(trip, 'arrive', 214, 1);
  const { photo } = await import('./operations-plan');
  await road.write(trip, 'deliver', 218, 1, { photo });
  const day = await read(), result = shownTrip(day);
  expect(result.schedule).toEqual(before.schedule);
  expect(result).toMatchObject({ figures: { delivered: 23 }, onSoFar: null, lastReportAt: depotInstant(THU, 218).toISOString(), outRow: { nextStop: { outletId: 'OUT002' }, plannedArrival: depotInstant(THU, 324).toISOString(), progress: { numerator: 1, denominator: 2, percent: 50 } } });
  expect(day.counts).toMatchObject({ stopsDelivered: 1, stopsDone: 1, vehiclesOut: 1, deliveryProgress: { percent: 50 } });
});
it('AC-6 refusal is one partial delivered stop', async () => {
  const trip = await road.wellawatte();
  await road.write(trip, 'refuse', 228, 2, { reason: 'damaged', note: '', lines: [{ lineId: driverStop(trip, 2).lines.find(line => line.temp === 'chilled')!.lineId, refused: 2 }] });
  const day = await read();
  expect(day.counts).toMatchObject({ stopsDelivered: 2, stopsDone: 2, partialStops: 1, closedStops: 0, deliveryProgress: { percent: 100 } });
  expect(shownTrip(day)).toMatchObject({ figures: { delivered: 115, refused: 2, short: 1 }, action: 'decide', outRow: { status: { kind: 'open_problem', issueKind: 'refused' } } });
});
it('AC-7 closed stop is finished but not delivered', async () => {
  await road.write(await road.wellawatte(), 'closed', 228, 2);
  const day = await read();
  expect(day.counts).toMatchObject({ stopsDelivered: 1, stopsDone: 2, closedStops: 1, deliveryProgress: { percent: 50 } });
  expect(shownTrip(day)).toMatchObject({ figures: { delivered: 23, notDelivered: 94, short: 1 }, outRow: { progress: { percent: 100 } } });
});
it('AC-36 a complete refusal finishes a stop without delivering it', async () => {
  const trip = await road.wellawatte();
  await road.write(trip, 'refuse', 228, 2, { reason: 'damaged', note: '', lines: driverStop(trip, 2).lines.map(line => ({ lineId: line.lineId, refused: line.loaded })) });
  const day = await read();
  expect(day.counts).toMatchObject({ stopsDelivered: 1, stopsDone: 2, partialStops: 0, noGoodsStops: 1 });
  expect(shownTrip(day).figures).toMatchObject({ delivered: 23, refused: 94, short: 1 });
});
it('AC-10 sixteen hundred keeps earlier out trips separately', async () => {
  const trip = await road.started();
  freeze(THU, 960);
  const day = await read();
  expect(day).toMatchObject({ day: FRI, plan: null, groups: [], counts: { stopsTotal: 0, stopsDone: 0, vehiclesOut: 1 }, outTripIds: [trip.tripId], earlierOut: [{ date: THU, brandTotals: [{ stopsTotal: 2 }], timeline: { now: clock.at } }] });
  expect(day.nextRun!.cutoffAt > day.readAt).toBe(true);
  freeze(FRI, 180);
  expect((await read()).earlierOut[0]!.timeline.now).toBeNull();
});
it('AC-11 no remaining day keeps out trips and open issues', async () => {
  const trip = await road.write(await road.wellawatte(), 'closed', 228, 2);
  freeze('2026-06-29', 600);
  const day = await read();
  expect(day).toMatchObject({ day: null, plan: null, nextRun: null, fuel: null, groups: [], outTripIds: [trip.tripId] });
  expect(day.earlierOut[0]!.groups[0]!.trips[0]!.openIssueIds).toHaveLength(1);
  expect((await ruwan.get('/api/v1/issues')).body.issues).toHaveLength(1);
});
it('AC-12 legacy seeded plan explicitly lacks movement detail', async () => {
  freeze(WED, 900);
  const day = await read();
  expect(day).toMatchObject({ day: WED, plan: { detailRecorded: false }, groups: [], counts: { tripsTotal: 0, stopsTotal: 0, stopsDone: 0, deferredOrders: 4 } });
  const [trip] = await db.insert(trips).values({ planId: day.plan!.id, vehicleId: 'VEH035', tripNo: 1 }).returning();
  await db.insert(stops).values({ tripId: trip!.id, seq: 1, outletId: 'OUT001' });
  const legacy = await read();
  expect(legacy.groups[0]!.trips[0]).toMatchObject({ detailRecorded: false, reason: 'legacy_plan', stopsTotal: 1 });
  expect(legacy.counts).toMatchObject({ stopsTotal: 1, stopsDone: null, stopsDelivered: null, deliveryProgress: { percent: null } });
});
it('AC-12 malformed or missing newly sent movement detail fails visibly', async () => {
  const sent = await sendWalkthroughPlan(walk);
  for (const sentCheck of [null, {}, { ...sent.check, trips: [] }]) {
    await db.update(plans).set({ sentCheck }).where(eq(plans.id, sent.plan.id!));
    expect((await ruwan.get('/api/v1/operations')).status).toBe(500);
  }
});
it('AC-14 snapshot and reset return one generation without deadlock', async () => {
  await sendWalkthroughPlan(walk);
  const before = await read();
  let entered!: () => void, release!: () => void;
  const enteredRead = new Promise<void>(resolve => { entered = resolve; });
  const mayFinish = new Promise<void>(resolve => { release = resolve; });
  const original = board.readMoment;
  const spy = vi.spyOn(board, 'readMoment').mockImplementationOnce(async tx => { const moment = await original(tx); entered(); await mayFinish; return moment; });
  const pending = read();
  await enteredRead;
  const reset = db.transaction(async tx => {
    await tx.select().from(demoDay).for('update');
    await clearDemoDay(tx); await seedDemoDay(tx); await tx.update(demoDay).set({ day: sql`${demoDay.day} + 1` });
  });
  try {
    let waiting = false;
    for (let n = 0; n < 250; n++) {
      const result = await pool.query('select 1 from pg_locks where not granted and database = (select oid from pg_database where datname = current_database())');
      if (result.rowCount) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(waiting).toBe(true);
  } finally { release(); spy.mockRestore(); }
  const [during] = await Promise.all([pending, reset]);
  expect(during).toEqual(before);
  expect(await read()).toMatchObject({ demoDay: before.demoDay + 1, plan: null, counts: { stopsTotal: 0 } });
});
it('AC-25 return removes out row but retains days finished trip', async () => {
  let trip = await road.write(await road.wellawatte(), 'closed', 228, 2);
  trip = await road.write(trip, 'finish', 235);
  const day = await read();
  expect(day).toMatchObject({ outTripIds: [], counts: { vehiclesOut: 0, stopsDone: 2 } });
  expect(shownTrip(day)).toMatchObject({ status: 'done', trip: { backAt: depotInstant(THU, 235).toISOString() }, outRow: null });
});
it('AC-16 kept minutes after midnight stay on their actual date and recorded lateness uses the shop window', async () => {
  await road.ready();
  const [plan] = await db.select().from(plans).where(and(eq(plans.date, THU), eq(plans.depotId, 'Peliyagoda')));
  const check = PlanCheck.parse(plan!.sentCheck);
  check.trips[0]!.times!.backAt = 1500;
  check.trips[0]!.times!.stops[1]!.arriveAt = 1445;
  check.trips[0]!.times!.stops[1]!.leaveAt = 1460;
  await db.update(plans).set({ sentCheck: check }).where(eq(plans.id, plan!.id));
  await db.update(stops).set({ plannedArrival: '00:05:00', plannedDepart: '00:20:00' }).where(eq(stops.seq, 2));
  const first = shownTrip(await read()).stopDetails[0]!;
  await db.update(stops).set({ arrivedAt: new Date(new Date(first.windowClose).getTime() + 1) }).where(eq(stops.id, first.id));
  const day = await read();
  expect(shownTrip(day).stopDetails[0]!.arrivedAfterWindow).toBe(true);
  expect(shownTrip(day).stopDetails[1]!.plannedArrival).toBe(depotInstant(FRI, 5).toISOString());
  expect(day.timeline!.end).toBe(depotInstant(FRI, 120).toISOString());
});
it('AC-3 zero fleet quota has no invented fuel percentage', async () => {
  const fleet = await db.select().from(vehicles).where(eq(vehicles.depotId, 'Peliyagoda'));
  try {
    await db.update(vehicles).set({ weeklyFuelQuotaL: 0 }).where(eq(vehicles.depotId, 'Peliyagoda'));
    expect((await read()).fuel!.percent).toBeNull();
  } finally { for (const row of fleet) await db.update(vehicles).set({ weeklyFuelQuotaL: row.weeklyFuelQuotaL }).where(eq(vehicles.id, row.id)); }
});

it('AC-5 planned stop clocks come from the sent stops', async () => {
  await sendWalkthroughPlan(walk);
  const first = shownTrip(await read()).stopDetails[0]!;
  await db.update(stops).set({ plannedArrival: '05:01:00', plannedDepart: '05:16:00' }).where(eq(stops.id, first.id));
  expect(shownTrip(await read()).stopDetails[0]).toMatchObject({ plannedArrival: depotInstant(THU, 301).toISOString(), plannedDeparture: depotInstant(THU, 316).toISOString() });
});

it('AC-13 another depots records stay private', async () => {
  await road.write(await road.wellawatte(), 'closed', 228, 2);
  const before = await read();
  expect(before.events.length).toBeGreaterThan(0);
  const foreign = await kandyTrip();
  const [person] = await db.select().from(users).where(eq(users.username, 'kasun'));
  const [issue] = await db.insert(issues).values({ kind: 'loading', reason: 'short', stopId: foreign.stop.id, raisedBy: person!.id, raisedAt: depotInstant(THU, 228), note: 'Private Kandy issue' }).returning();
  await db.insert(issueLines).values({ issueId: issue!.id, orderLineId: foreign.line.id, counted: 7 });
  await db.update(trips).set({ status: 'out', leftAt: depotInstant(THU, 210) }).where(eq(trips.id, foreign.trip.id));
  await db.insert(fuelLog).values({ vehicleId: 'VEH044', date: FRI, litres: '100', tripId: foreign.trip.id });
  const after = await read();
  expect(after).toEqual(before);
  const attemptedSelector = await ruwan.get('/api/v1/operations?depotId=Kandy');
  expect(attemptedSelector.status).toBe(200);
  expect(attemptedSelector.body).toEqual(before);
});
