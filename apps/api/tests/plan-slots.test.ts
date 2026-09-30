import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PlanBoard, SlotSearch, type DraftPlan } from '@wayfinder/contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { clearDemoDay, seedDemoDay } from '../src/db/demo-day';
import { demoDay, orderLines, orders, plans } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { serve, stop } from './serve';

const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => {
    const state = clock.demoClockAt(...args);
    return { ...state, now: testClock.at || state.now };
  } };
});
vi.mock('../src/lib/live', async (original) => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));

const DATE = '2026-06-25';
const URL = `/api/v1/plans/${DATE}`;
const server = await serve(createApp());
const as = request.agent(server);
const reset = () => db.transaction(async (tx) => { await clearDemoDay(tx); await seedDemoDay(tx); });
const empty = (): DraftPlan => ({ mixBrands: false, trips: [], deferrals: [] });
let originalClock: typeof demoDay.$inferSelect;
let board: PlanBoard;
const carried = (outletId: string) => board.orders.find((o) => o.outletId === outletId && o.carriedOver)!;
const trip = (shops: string[], vehicleId = 'VEH004', tripNo: 1 | 2 = 1): DraftPlan['trips'][number] => ({
  vehicleId, tripNo, driverId: null, leaveAt: null,
  stops: shops.map((outletId) => ({ outletId, orderIds: board.orders.filter((o) => o.outletId === outletId && !o.carriedOver).map((o) => o.id) })),
});
const save = async (plan: DraftPlan) => {
  const res = await as.put(`${URL}/draft`).send({ planId: null, demoDay: board.demoDay, plan });
  expect(res.status).toBe(200);
  return PlanBoard.parse(res.body);
};
const search = (orderId: string) => as.get(`${URL}/slots`).query({ orderId });
const code = (res: request.Response) => [res.status, res.body.error?.code];

// All tables a slot search could change, with stable row order. A read cannot alter the draft, order,
// fuel, clock or audit trail, and cannot announce a change.
async function held() {
  const tables = ['plans', 'trips', 'stops', 'stop_orders', 'deferrals', 'orders', 'order_lines', 'fuel_log', 'demo_day', 'audit_log'];
  return Promise.all(tables.map(async (table) => {
    const result = await pool.query(`select coalesce(jsonb_agg(r order by r::text), '[]'::jsonb) as rows from (select * from ${table}) r`);
    return { table, rows: result.rows[0].rows };
  }));
}

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  expect((await as.post('/api/v1/auth/login').send({ username: 'ruwan', password: process.env.SEED_PASSWORD ?? 'wayfinder-demo' })).status).toBe(200);
});
beforeEach(async () => {
  await reset(); await initClock();
  const instant = depotInstant('2026-06-24', 960);
  testClock.at = instant.toISOString(); setClockForTests(instant);
  board = PlanBoard.parse((await as.get('/api/v1/plans')).body);
  vi.mocked(announce).mockClear();
});
afterAll(async () => {
  await reset(); await db.update(demoDay).set(originalClock);
  testClock.at = ''; setClockForTests(null);
  await stop(server); await pool.end();
});

it('AC-24 finds OUT030 at stop 3 at 04:56 and refuses OUT060 with the first vehicle block without writing', async () => {
  const saved = await save({ ...empty(), trips: [trip(['OUT026', 'OUT028'])] });
  const before = await held(); vi.mocked(announce).mockClear();
  const response = await search(carried('OUT030').id);
  expect(response.status).toBe(200);
  expect(SlotSearch.parse(response.body)).toEqual({
    orderId: carried('OUT030').id, revision: saved.plan.revision,
    slots: [{ vehicleId: 'VEH004', tripNo: 1, stopSeq: 3, newStop: true, arriveAt: 296 }], refused: [],
  });
  const noSlot = await search(carried('OUT060').id);
  expect(noSlot.status).toBe(200);
  expect(SlotSearch.parse(noSlot.body)).toEqual({
    orderId: carried('OUT060').id, revision: saved.plan.revision, slots: [],
    refused: [{ vehicleId: 'VEH004', tripNo: 1, problem: {
      code: 'cross_district', level: 'block', vehicleId: 'VEH004', tripNo: 1,
      message: 'VEH004 trip 1 has stops in 2 districts, Gampaha and Matara, and a trip stays inside one district.',
    } }],
  });
  expect(await held()).toEqual(before);
  expect(announce).not.toHaveBeenCalled();
});

it('merges an order into the trip\'s existing stop for that shop', async () => {
  await save({ ...empty(), trips: [trip(['OUT026', 'OUT030', 'OUT028'])] });
  const response = await search(carried('OUT030').id);
  expect(response.status).toBe(200);
  expect(SlotSearch.parse(response.body).slots).toEqual([{ vehicleId: 'VEH004', tripNo: 1, stopSeq: 2, newStop: false, arriveAt: 271 }]);
});

it('tries a deferred order on each trip after removing its draft deferral in the copy', async () => {
  const orderId = carried('OUT030').id;
  await save({ ...empty(), trips: [trip(['OUT026', 'OUT028'])], deferrals: [{ orderId, code: 'no_reefer', reason: 'No truck was left.' }] });
  const before = await held();
  const response = await search(orderId);
  expect(response.status).toBe(200);
  expect(SlotSearch.parse(response.body).slots).toHaveLength(1);
  expect(await held()).toEqual(before);
});

it('rejects a slot when the same vehicle\'s other trip is blocked', async () => {
  await save({ ...empty(), trips: [trip(['OUT026', 'OUT028']), { ...trip(['OUT006'], 'VEH004', 2), leaveAt: 1439 }] });
  const response = await search(carried('OUT030').id);
  expect(response.status).toBe(200);
  const result = SlotSearch.parse(response.body);
  expect(result.slots).toEqual([]);
  expect(result.refused).toHaveLength(2);
  expect(result.refused.find((r) => r.tripNo === 1)).toMatchObject({ vehicleId: 'VEH004', problem: { code: 'window_missed', tripNo: 2 } });
});

it('rejects missing, invalid, unknown and other-depot orders without writing', async () => {
  const foreignId = randomUUID();
  await db.insert(orders).values({ id: foreignId, outletId: 'OUT084', deliveryDate: '2026-06-24', temp: 'chilled', status: 'placed' });
  await db.insert(orderLines).values({ orderId: foreignId, productId: 'fresh-chilled-carton', quantity: 1 });
  const before = await held();
  expect(code(await as.get(`${URL}/slots`))).toEqual([400, 'invalid_input']);
  expect(code(await search('not-an-id'))).toEqual([400, 'invalid_input']);
  expect(code(await as.get('/api/v1/plans/not-a-date/slots').query({ orderId: carried('OUT030').id }))).toEqual([400, 'invalid_input']);
  for (const id of [randomUUID(), foreignId]) {
    const response = await search(id);
    expect(code(response)).toEqual([400, 'unknown_record']);
    expect(response.body.error.details).toEqual({ id });
  }
  expect(await held()).toEqual(before);
});

it('only searches unassigned carried-over orders of a draft', async () => {
  expect(code(await search(board.orders.find((o) => !o.carriedOver)!.id))).toEqual([400, 'invalid_input']);
  const order = carried('OUT030');
  const saved = await save({ ...empty(), trips: [{ ...trip([]), stops: [{ outletId: order.outletId, orderIds: [order.id] }] }] });
  expect(code(await search(order.id))).toEqual([400, 'invalid_input']);
  await db.update(plans).set({ status: 'published' }).where(eq(plans.id, saved.plan.id!));
  expect(code(await search(order.id))).toEqual([409, 'plan_sent']);
});

it('returns no slots for a board with no trips', async () => {
  const response = await search(carried('OUT030').id);
  expect(response.status).toBe(200);
  expect(SlotSearch.parse(response.body)).toEqual({ orderId: carried('OUT030').id, revision: 0, slots: [], refused: [] });
});

it('checks all 25 trips in under a second', async () => {
  await save({ ...empty(), trips: board.vehicles.slice(0, 25).map((v) => trip([], v.id)) });
  const started = performance.now();
  const response = await search(carried('OUT030').id);
  const elapsed = performance.now() - started;
  expect(response.status).toBe(200);
  const result = SlotSearch.parse(response.body);
  expect(result.slots.length + result.refused.length).toBe(25);
  expect(elapsed).toBeLessThan(1000);
});

it('every offered slot can be saved when its shop already has ten small orders on the stop', async () => {
  const orderId = carried('OUT030').id;
  const smallOrders = await db.insert(orders).values(Array.from({ length: 10 }, () => ({
    outletId: 'OUT030', deliveryDate: DATE, temp: 'dry' as const, status: 'placed' as const,
  }))).returning();
  await db.insert(orderLines).values(smallOrders.map((o) => ({ orderId: o.id, productId: 'fresh-dry-carton', quantity: 1 })));
  const saved = await save({ ...empty(), trips: [{ ...trip([]), stops: [{ outletId: 'OUT030', orderIds: smallOrders.map((o) => o.id) }] }] });
  const response = await search(orderId);
  expect(response.status).toBe(200);
  const result = SlotSearch.parse(response.body);
  // Every advertised position must be usable by the ordinary save path that "Put it here" calls.
  for (const slot of result.slots) {
    const changed = structuredClone(saved.plan);
    const target = changed.trips.find((t) => t.vehicleId === slot.vehicleId && t.tripNo === slot.tripNo)!;
    if (slot.newStop) target.stops.push({ outletId: 'OUT030', orderIds: [orderId] });
    else target.stops[slot.stopSeq - 1]!.orderIds.push(orderId);
    const applied = await as.put(`${URL}/draft`).send({ planId: saved.plan.id, revision: saved.plan.revision, plan: changed });
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
  }
  expect(result.slots.length + result.refused.length).toBe(1);
});
