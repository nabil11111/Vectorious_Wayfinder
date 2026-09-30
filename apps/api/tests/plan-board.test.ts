import { PlanBoard } from '@wayfinder/contracts';
import request from 'supertest';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { clearDemoDay, seedDemoDay } from '../src/db/demo-day';
import { plans, orders, demoDay } from '../src/db/schema';
import { depotInstant, initClock, realNow, setClockForTests } from '../src/lib/clock';
import { serve, stop } from './serve';

const testClock = vi.hoisted(() => ({ at: null as string | null }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => {
    const state = clock.demoClockAt(...args);
    return testClock.at ? { ...state, now: testClock.at } : state;
  } };
});
const freeze = (at: Date | null) => { testClock.at = at?.toISOString() ?? null; setClockForTests(at); };

const server = await serve(createApp());
const actors = new Map<string, ReturnType<typeof request.agent>>();
let originalClock: typeof demoDay.$inferSelect;
const reset = () => db.transaction(async (tx) => { await clearDemoDay(tx); await seedDemoDay(tx); });
beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  await reset();
  await initClock();
  freeze(depotInstant('2026-06-24', 960));
  for (const username of ['ruwan', 'nadeesha', 'ishara', 'kasun', 'dilshan', 'admin']) {
    const agent = request.agent(server);
    const password = username === 'admin' ? process.env.SEED_ADMIN_PASSWORD ?? 'wayfinder-admin' : process.env.SEED_PASSWORD ?? 'wayfinder-demo';
    expect((await agent.post('/api/v1/auth/login').send({ username, password })).status).toBe(200);
    actors.set(username, agent);
  }
});
afterAll(async () => { await reset(); await db.update(demoDay).set(originalClock); freeze(null); await stop(server); await pool.end(); });

it('AC-5 protects every endpoint before reading its input', async () => {
  const paths = [['get', ''], ['get', '/2026-06-25'], ['put', '/2026-06-25/draft'],
    ...['split', 'join', 'send', 'unsend'].map((action) => ['post', `/2026-06-25/${action}`]), ['get', '/2026-06-25/slots']] as const;
  for (const [method, suffix] of paths) {
    const url = `/api/v1/plans${suffix}`;
    const call = (agent: ReturnType<typeof request.agent>) => method === 'get' ? agent.get(url) : method === 'put' ? agent.put(url).send({}) : agent.post(url).send({});
    expect((await call(request.agent(server))).body.error.code).toBe('signed_out');
    for (const name of ['nadeesha', 'kasun', 'dilshan']) {
      const res = await call(actors.get(name)!);
      expect([res.status, res.body.error.code]).toEqual([403, 'forbidden']);
    }
    const admin = await call(actors.get('admin')!);
    expect([admin.status, admin.body.error.code]).toEqual([403, 'no_depot']);
  }
});

it('AC-7 reads the seeded board and its exact counts without writing', async () => {
  const before = { plans: await db.select().from(plans), orders: await db.select().from(orders) };
  const res = await actors.get('ruwan')!.get('/api/v1/plans');
  expect(res.status).toBe(200);
  const board = PlanBoard.parse(res.body);
  expect(board.day).toEqual({ date: '2026-06-25', cutoffAt: depotInstant('2026-06-24', 960).toISOString(), open: true });
  expect(board.plan.id).toBeNull();
  expect(board.orders).toHaveLength(102);
  expect(board.counts).toMatchObject({ vehiclesUsed: 0, vehiclesWorking: 35, trips: 0, ordersDue: 102, ordersOnTrips: 0, ordersUnplanned: 102, fuelWeekPct: 37, fridgeM3Used: 0, fridgeM3Working: 140.7 });
  expect(board.check!.problems).toHaveLength(102);
  expect(board.check!.problems.every((p) => p.code === 'order_not_planned' && p.level === 'block')).toBe(true);
  expect({ plans: await db.select().from(plans), orders: await db.select().from(orders) }).toEqual(before);
});

it('AC-8 retains carried-over history and excludes the shop draft', async () => {
  const board = PlanBoard.parse((await actors.get('ruwan')!.get('/api/v1/plans')).body);
  expect(board.orders.filter((o) => o.carriedOver).map((o) => [o.outletId, o.deliveryDate, o.timesDeferred]).sort()).toEqual([
    ['OUT001', '2026-06-24', 1], ['OUT030', '2026-06-24', 1], ['OUT054', '2026-06-24', 1], ['OUT060', '2026-06-23', 2],
  ]);
  expect(board.orders.find((o) => o.outletId === 'OUT060' && o.carriedOver)!.lastDeferral!.reason).toBe('No fridge truck was left for Matara. Two were in the workshop.');
  expect(board.orders.filter((o) => o.outletId === 'OUT001')).toHaveLength(1);
  freeze(depotInstant('2026-06-24', 959));
  const next = (await actors.get('nadeesha')!.get('/api/v1/store/next-order')).body;
  expect((await actors.get('nadeesha')!.post('/api/v1/store/next-order/place').send({ deliveryDate: next.deliveryDate, refs: next.draft.refs })).status).toBe(200);
  freeze(depotInstant('2026-06-24', 960));
  expect(PlanBoard.parse((await actors.get('ruwan')!.get('/api/v1/plans')).body).orders).toHaveLength(104);
  await reset();
});

it('AC-9 returns all depot vehicles with workshop reasons and checker fuel', async () => {
  const board = PlanBoard.parse((await actors.get('ruwan')!.get('/api/v1/plans')).body);
  expect(board.vehicles).toHaveLength(38);
  expect(board.vehicles.filter((v) => !v.working).map((v) => [v.id, v.offReason])).toEqual([
    ['VEH003', 'Fridge unit repair'], ['VEH005', 'Brake service'], ['VEH036', 'Gearbox repair'],
  ]);
  expect(board.vehicles.find((v) => v.id === 'VEH001')!.fuelLeftPct).toBe(12);
  expect(board.drivers).toHaveLength(35);
});

it('reads dated historical plans and validates the path date', async () => {
  const agent = actors.get('ruwan')!;
  const board = PlanBoard.parse((await agent.get('/api/v1/plans/2026-06-24')).body);
  expect(board.plan.status).toBe('published');
  expect([board.check, board.figures, board.counts]).toEqual([null, null, null]);
  expect((await agent.get('/api/v1/plans/not-a-date')).status).toBe(400);
});

it('reads the snapshot clock row even when the process clock has not caught up', async () => {
  freeze(null);
  await db.update(demoDay).set({ clockBase: depotInstant('2026-06-24', 960), clockSetAt: realNow() }).where(eq(demoDay.id, 1));
  const board = PlanBoard.parse((await actors.get('ruwan')!.get('/api/v1/plans')).body);
  expect(board.day).toMatchObject({ date: '2026-06-25', open: true });
});
