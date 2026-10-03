import { randomUUID } from 'node:crypto';
import { DriverDay, LoadingDay, PlanBoard, type DraftPlan, type DraftTrip, type LoadingTruck } from '@wayfinder/contracts';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { auditLog, demoDay, fuelLog, orderLines, outlets, stops, trips, users, vehicles } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { applyWrite } from '../src/driver/writes';
import { startLoading } from '../src/loading/writes';
import { DEFAULT_SETTINGS, toClock } from '../src/planning';
import { sendPlan } from '../src/plans/send';
import { driverTrip, driverWrite, heldDriverRows } from './driver-plan';
import { code, loaderScreen, resetDay, signIn, THU, WED } from './loading-plan';
import { serve, stop } from './serve';

const clock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async original => {
  const actual = await original<typeof import('../src/lib/clock')>();
  return { ...actual, demoClockAt: (...args: Parameters<typeof actual.demoClockAt>) => ({ ...actual.demoClockAt(...args), now: clock.at || actual.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async original => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const freeze = (minute: number, date = THU) => { const at = depotInstant(date, minute); clock.at = at.toISOString(); setClockForTests(at); };
const server = await serve(createApp());
const ruwan = request.agent(server), kasun = request.agent(server), anura = request.agent(server);
const loader = loaderScreen(kasun);
let originalClock: typeof demoDay.$inferSelect;
let originalVehicle: typeof vehicles.$inferSelect;
let originalOutlet: typeof outlets.$inferSelect;
let dispatcherId: string, loaderId: string, driverId: string;

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  originalVehicle = (await db.select().from(vehicles).where(eq(vehicles.id, 'VEH004')))[0]!;
  originalOutlet = (await db.select().from(outlets).where(eq(outlets.id, 'OUT026')))[0]!;
  for (const [agent, name] of [[ruwan, 'ruwan'], [kasun, 'kasun'], [anura, 'anura']] as const) await signIn(agent, name);
  const people = await db.select().from(users);
  dispatcherId = people.find(person => person.username === 'ruwan')!.id;
  loaderId = people.find(person => person.username === 'kasun')!.id;
  driverId = people.find(person => person.username === 'anura')!.id;
});
beforeEach(async () => { await resetDay(); await initClock(); freeze(960, WED); vi.mocked(announce).mockClear(); });
afterEach(async () => {
  await db.update(vehicles).set(originalVehicle).where(eq(vehicles.id, originalVehicle.id));
  await db.update(outlets).set(originalOutlet).where(eq(outlets.id, originalOutlet.id));
  DEFAULT_SETTINGS.reloadMin = 30;
});
afterAll(async () => { await resetDay(); await db.update(demoDay).set(originalClock); clock.at = ''; setClockForTests(null); await stop(server); await pool.end(); });

async function saveTwo({ noDriver = false, secondVehicle = 'VEH004' } = {}): Promise<PlanBoard> {
  const board = PlanBoard.parse((await ruwan.get('/api/v1/plans')).body);
  const stopAt = (outletId: string) => ({ outletId, orderIds: board.orders.filter(order => order.outletId === outletId).map(order => order.id) });
  const planned: DraftTrip[] = [
    { vehicleId: 'VEH004', tripNo: 1, driverId: noDriver ? null : driverId, leaveAt: null, stops: [stopAt('OUT026'), stopAt('OUT028')] },
    { vehicleId: secondVehicle, tripNo: secondVehicle === 'VEH004' ? 2 : 1, driverId: noDriver ? null : driverId, leaveAt: null, stops: [stopAt('OUT006')] },
  ];
  const on = new Set(planned.flatMap(trip => trip.stops.flatMap(stop => stop.orderIds)));
  const plan: DraftPlan = { mixBrands: false, trips: planned, deferrals: board.orders.filter(order => !on.has(order.id)).map(order => ({ orderId: order.id, code: 'dispatcher_choice', reason: 'Later.' })) };
  const saved = await ruwan.put(`/api/v1/plans/${THU}/draft`).send({ planId: null, demoDay: board.demoDay, plan });
  expect(saved.status).toBe(200);
  const result = PlanBoard.parse(saved.body);
  expect(result.check!.ok).toBe(true);
  return result;
}
async function published(): Promise<void> {
  const board = await saveTwo();
  expect((await ruwan.post(`/api/v1/plans/${THU}/send`).send({ planId: board.plan.id, revision: board.plan.revision })).status).toBe(200);
  freeze(150);
}
const own = (day: LoadingDay, tripNo: number): LoadingTruck => day.trucks.find(trip => trip.vehicleId === 'VEH004' && trip.tripNo === tripNo)!;
async function load(tripNo: number): Promise<LoadingTruck> {
  let day = await loader.read();
  expect((await loader.start(own(day, tripNo), day.plan!)).status).toBe(200);
  for (const seq of own(day, tripNo).stops.map(stop => stop.seq)) {
    expect((await loader.stopLoaded(own(await loader.read(), tripNo), seq)).status).toBe(200);
  }
  const result = await loader.ready(own(await loader.read(), tripNo));
  expect(result.status).toBe(200);
  return own(LoadingDay.parse(result.body), tripNo);
}
const phone = async () => DriverDay.parse((await anura.get('/api/v1/driver')).body);
const departure = async (tripNo = 2, at = clock.at) => anura.post('/api/v1/driver/writes').send(driverWrite(driverTrip(await phone(), 'VEH004', tripNo), 'start', at));
async function returnFirst(minute = 211): Promise<void> {
  // Fast actual demo events stay legal: start, visit both stops and check in in the same app minute.
  freeze(minute);
  expect((await departure(1)).status).toBe(200);
  for (const seq of [1, 2]) for (const kind of ['arrive', 'closed'] as const) {
    const current = driverTrip(await phone(), 'VEH004', 1);
    expect((await anura.post('/api/v1/driver/writes').send(driverWrite(current, kind, clock.at, seq))).status).toBe(200);
  }
  const current = driverTrip(await phone(), 'VEH004', 1);
  expect((await anura.post('/api/v1/driver/writes').send(driverWrite(current, 'finish', clock.at))).status).toBe(200);
}

it('B1 keeps driverless drafts legal but direct Send rejects every missing driver atomically', async () => {
  const board = await saveTwo({ noDriver: true, secondVehicle: 'VEH002' });
  const before = await heldDriverRows();
  await expect(sendPlan({ userId: dispatcherId, depotId: 'Peliyagoda' }, THU, { planId: board.plan.id!, revision: board.plan.revision }))
    .rejects.toMatchObject({ status: 409, code: 'driver_required', details: { trips: [{ vehicleId: 'VEH002', tripNo: 1 }, { vehicleId: 'VEH004', tripNo: 1 }] } });
  expect(await heldDriverRows()).toEqual(before);
  expect(announce).not.toHaveBeenCalledWith({ topic: 'loading', depotId: 'Peliyagoda' });
});

it('B2 refuses second loading while first is planned, ready or out, including direct calls', async () => {
  await published();
  for (const status of ['planned', 'ready', 'out'] as const) {
    const day = await loader.read(), second = own(day, 2);
    const first = (await db.select().from(trips).where(and(eq(trips.planId, day.plan!.id), eq(trips.tripNo, 1))))[0]!;
    await db.update(trips).set({ status }).where(eq(trips.id, first.id));
    const before = await heldDriverRows();
    await expect(startLoading({ userId: loaderId, depotId: 'Peliyagoda' }, second.tripId, { writeId: randomUUID(), revision: second.revision, plan: day.plan! }))
      .rejects.toMatchObject({ status: 409, code: 'previous_trip_not_returned' });
    expect(await heldDriverRows()).toEqual(before);
  }
});

it.each(['count', 'flag', 'ready'] as const)('B2 refuses legacy second-trip %s before return with no partial writes', async action => {
  await published();
  const day = await loader.read(), second = own(day, 2);
  await db.update(trips).set({ status: 'loading' }).where(eq(trips.id, second.tripId));
  const current = own(await loader.read(), 2), stop = current.stops[0]!;
  const before = await heldDriverRows();
  const response = action === 'count' ? await loader.stopLoaded(current, stop.seq)
    : action === 'flag' ? await loader.flag(current, stop.seq, [{ lineId: stop.lines[0]!.lineId, counted: 0 }]) : await loader.ready(current);
  expect(code(response)).toEqual([409, 'previous_trip_not_returned']);
  expect(await heldDriverRows()).toEqual(before);
});

it('B2 allows loading after actual return and keeps simultaneous start retries idempotent', async () => {
  await published(); await load(1); await returnFirst();
  const day = await loader.read(), second = own(day, 2), writeId = randomUUID();
  const responses = await Promise.all([loader.start(second, day.plan!, writeId), loader.start(second, day.plan!, writeId)]);
  expect(responses.map(response => response.status)).toEqual([200, 200]);
  expect((await db.select().from(auditLog).where(and(eq(auditLog.entityId, second.tripId), eq(auditLog.action, 'trip.loading_started'))))).toHaveLength(1);
  const current = own(await loader.read(), 2);
  const countId = randomUUID();
  expect((await loader.stopLoaded(current, 1, countId)).status).toBe(200);
  expect((await loader.stopLoaded(current, 1, countId)).status).toBe(200);
  const ready = own(await loader.read(), 2), readyId = randomUUID();
  expect((await loader.ready(ready, readyId)).status).toBe(200);
  expect((await loader.ready(ready, readyId)).status).toBe(200);
});

it('B3 refuses a ready second trip while the first has never returned, even with another driver', async () => {
  await published();
  const day = await loader.read(), second = own(day, 2);
  await db.update(trips).set({ status: 'ready', readyAt: depotInstant(THU, 150) }).where(eq(trips.id, second.tripId));
  const [other] = await db.select().from(users).where(eq(users.username, 'dilshan'));
  await db.update(trips).set({ driverId: other!.id }).where(and(eq(trips.planId, day.plan!.id), eq(trips.tripNo, 1)));
  const before = await heldDriverRows();
  const write = driverWrite(driverTrip(await phone(), 'VEH004', 2), 'start', clock.at);
  await expect(applyWrite({ userId: driverId, depotId: 'Peliyagoda' }, write)).rejects.toMatchObject({ status: 409, code: 'previous_trip_not_returned' });
  expect(await heldDriverRows()).toEqual(before);
});

it('B3 waits for app-clock reload, accepts the exact boundary, and preserves departure retries', async () => {
  await published(); await load(1); await returnFirst(211); await load(2);
  freeze(240);
  const before = await heldDriverRows();
  const refused = await departure();
  expect(code(refused)).toEqual([409, 'reload_wait']);
  expect(refused.body.error.details.notBefore).toBe(depotInstant(THU, 241).toISOString());
  expect(await heldDriverRows()).toEqual(before);
  freeze(241);
  const write = driverWrite(driverTrip(await phone(), 'VEH004', 2), 'start', clock.at);
  expect((await anura.post('/api/v1/driver/writes').send(write)).status).toBe(200);
  expect((await anura.post('/api/v1/driver/writes').send(write)).status).toBe(200);
  expect((await db.select().from(trips).where(eq(trips.id, write.tripId)))[0]!.leftAt).toEqual(depotInstant(THU, 241));
  expect((await db.select().from(auditLog).where(and(eq(auditLog.entityId, write.tripId), eq(auditLog.action, 'trip.started'))))).toHaveLength(1);
});

it('B3 uses configured reload minutes and preserves actual queued departure times', async () => {
  DEFAULT_SETTINGS.reloadMin = 45;
  await published(); await load(1); await returnFirst(211); await load(2);
  freeze(255); expect(code(await departure())).toEqual([409, 'reload_wait']);
  freeze(256);
  const before = await heldDriverRows();
  expect(code(await departure(2, depotInstant(THU, 212).toISOString()))).toEqual([409, 'reload_wait']);
  expect(await heldDriverRows()).toEqual(before);
  freeze(270);
  expect((await departure(2, depotInstant(THU, 256).toISOString())).status).toBe(200);
  expect((await db.select().from(trips).where(eq(trips.tripNo, 2)))[0]!.leftAt).toEqual(depotInstant(THU, 256));
});

it('B3 requires its own ready state even once reload time has elapsed', async () => {
  await published(); await load(1); await returnFirst(); freeze(241);
  const before = await heldDriverRows();
  expect(code(await departure())).toEqual([409, 'trip_not_ready']);
  expect(await heldDriverRows()).toEqual(before);
});

it('B3 rejects old premature readiness and lets the loader physically reload it after return', async () => {
  await published(); await load(1);
  const day = await loader.read(), second = own(day, 2);
  await db.update(trips).set({ status: 'ready', readyAt: depotInstant(THU, 151) }).where(eq(trips.id, second.tripId));
  await db.update(stops).set({ loadedAt: depotInstant(THU, 151) }).where(eq(stops.tripId, second.tripId));
  await returnFirst(); freeze(241);
  const before = await heldDriverRows();
  expect(code(await departure())).toEqual([409, 'reload_required']);
  expect(await heldDriverRows()).toEqual(before);
  const shown = own(await loader.read(), 2);
  expect(shown.status).toBe('planned');
  expect(shown.on.units).toBe(0);
  expect(shown.stops.every(stop => !stop.loaded)).toBe(true);
  await load(2);
  expect((await departure()).status).toBe(200);
});

it('B3 serializes simultaneous second departure requests without counting twice', async () => {
  await published(); await load(1); await returnFirst(); await load(2); freeze(241);
  const current = driverTrip(await phone(), 'VEH004', 2);
  const responses = await Promise.all([1, 2].map(() => anura.post('/api/v1/driver/writes').send(driverWrite(current, 'start', clock.at))));
  expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  expect((await db.select().from(auditLog).where(and(eq(auditLog.entityId, current.tripId), eq(auditLog.action, 'trip.started'))))).toHaveLength(1);
});

it.each([
  ['over_weight', { weightCapKg: 1 }], ['over_volume', { volumeCapM3: '0.01' }],
  ['needs_reefer', { temp: 'ambient' }], ['fuel_over_quota', { weeklyFuelQuotaL: 1 }],
] as const)('B4 Send rechecks %s against current data and refuses atomically', async (block, changed) => {
  const board = await saveTwo();
  await db.update(vehicles).set(changed).where(eq(vehicles.id, 'VEH004'));
  const before = await heldDriverRows();
  const response = await ruwan.post(`/api/v1/plans/${THU}/send`).send({ planId: board.plan.id, revision: board.plan.revision });
  expect(code(response)).toEqual([409, 'not_ready']);
  expect(response.body.error.details.blocks.some((problem: { code: string }) => problem.code === block)).toBe(true);
  expect(await heldDriverRows()).toEqual(before);
  expect(await db.select().from(fuelLog).where(eq(fuelLog.date, THU))).toEqual([]);
});

it.each(['van_only', 'window_missed'] as const)('B4 Send refuses a newly invalid %s stop without publishing', async block => {
  const board = await saveTwo();
  await db.update(outlets).set(block === 'van_only' ? { parking: 'van_only' } : { windowClose: '03:00:00' }).where(eq(outlets.id, 'OUT026'));
  const before = await heldDriverRows();
  const response = await ruwan.post(`/api/v1/plans/${THU}/send`).send({ planId: board.plan.id, revision: board.plan.revision });
  expect(code(response)).toEqual([409, 'not_ready']);
  expect(response.body.error.details.blocks.some((problem: { code: string }) => problem.code === block)).toBe(true);
  expect(await heldDriverRows()).toEqual(before);
});

it('B4 allows exact weight, volume, window and fuel boundaries through Send', async () => {
  const board = PlanBoard.parse((await ruwan.get('/api/v1/plans')).body);
  const order = board.orders.find(order => order.outletId === 'OUT026' && order.temp === 'dry')!;
  await db.update(orderLines).set({ quantity: 100 }).where(eq(orderLines.orderId, order.id));
  const plan: DraftPlan = { mixBrands: false, trips: [{ vehicleId: 'VEH004', tripNo: 1, driverId, leaveAt: null, stops: [{ outletId: 'OUT026', orderIds: [order.id] }] }],
    deferrals: board.orders.filter(own => own.id !== order.id).map(order => ({ orderId: order.id, code: 'dispatcher_choice', reason: 'Later.' })) };
  const saved = PlanBoard.parse((await ruwan.put(`/api/v1/plans/${THU}/draft`).send({ planId: null, demoDay: board.demoDay, plan })).body);
  const checked = saved.check!.trips[0]!;
  expect(checked.load).toMatchObject({ kg: 690, m3: 3.7 });
  await db.delete(fuelLog).where(eq(fuelLog.vehicleId, 'VEH004'));
  await db.update(vehicles).set({ weightCapKg: 690, volumeCapM3: '3.70', kmPerL: checked.times!.km.toFixed(2), weeklyFuelQuotaL: 1 }).where(eq(vehicles.id, 'VEH004'));
  await db.update(outlets).set({ windowClose: toClock(checked.times!.stops[0]!.arriveAt) }).where(eq(outlets.id, 'OUT026'));
  expect((await ruwan.post(`/api/v1/plans/${THU}/send`).send({ planId: saved.plan.id, revision: saved.plan.revision })).status).toBe(200);
});
