import { randomUUID } from 'node:crypto';
import { PlanBoard, type DraftPlan } from '@wayfinder/contracts';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { clearDemoDay, seedDemoDay } from '../src/db/demo-day';
import { demoDay, depots, orders, plans, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { serve, stop } from './serve';

const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at || clock.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async (original) => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const freeze = (date = '2026-06-24', minute = 960) => { const at = depotInstant(date, minute); testClock.at = at.toISOString(); setClockForTests(at); };
const server = await serve(createApp());
const as = request.agent(server);
const DATE = '2026-06-25';
const URL = `/api/v1/plans/${DATE}/draft`;
const empty = (): DraftPlan => ({ mixBrands: false, trips: [], deferrals: [] });
const reset = () => db.transaction(async (tx) => { await clearDemoDay(tx); await seedDemoDay(tx); });
let originalClock: typeof demoDay.$inferSelect;
let board: PlanBoard;
let dilshan: string;
let prasanna: string;
const ref = (b = board) => b.plan.id ? { planId: b.plan.id, revision: b.plan.revision } : { planId: null, demoDay: b.demoDay };
const trip = (shops: string[], vehicleId = 'VEH004', tripNo: 1 | 2 = 1) => ({ vehicleId, tripNo, driverId: null, leaveAt: null, stops: shops.map((outletId) => ({ outletId, orderIds: board.orders.filter((o) => o.outletId === outletId).map((o) => o.id) })) });
const save = (plan: DraftPlan, reference = ref()) => as.put(URL).send({ ...reference, plan });
const code = (res: request.Response) => [res.status, res.body.error?.code];

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  expect((await as.post('/api/v1/auth/login').send({ username: 'ruwan', password: process.env.SEED_PASSWORD ?? 'wayfinder-demo' })).status).toBe(200);
  dilshan = (await db.select().from(users).where(eq(users.username, 'dilshan')))[0]!.id;
  prasanna = (await db.select().from(users).where(eq(users.username, 'prasanna')))[0]!.id;
});
beforeEach(async () => {
  await reset(); await initClock(); freeze();
  board = PlanBoard.parse((await as.get('/api/v1/plans')).body);
  vi.mocked(announce).mockClear();
});
afterAll(async () => { await reset(); await db.update(demoDay).set(originalClock); setClockForTests(null); await stop(server); await pool.end(); });

it('AC-2 and AC-3 refuse open orders, a moved day and the calendar end without writing', async () => {
  freeze('2026-06-24', 959);
  const open = await save(empty());
  expect(code(open)).toEqual([409, 'orders_open']);
  expect(open.body.error.details).toEqual({ date: DATE, cutoffAt: depotInstant('2026-06-24', 960).toISOString() });
  freeze(DATE, 210);
  expect(code(await save(empty()))).toEqual([409, 'day_moved']);
  freeze('2026-06-27', 960);
  expect(PlanBoard.parse((await as.get('/api/v1/plans')).body).day).toBeNull();
  expect(code(await save(empty()))).toEqual([409, 'no_plan_day']);
  expect(await db.select().from(plans).where(eq(plans.date, DATE))).toHaveLength(0);
});

it('AC-11 saves and replaces the draft with seeded timings, figures and a revision', async () => {
  const plan = { ...empty(), trips: [trip(['OUT026', 'OUT028'])] };
  const res = await save(plan); expect(res.status).toBe(200);
  const b = PlanBoard.parse(res.body);
  expect(b.plan).toMatchObject({ revision: 1, savedAt: depotInstant('2026-06-24', 960).toISOString() });
  expect(b.check!.trips[0]!.times).toMatchObject({ backAt: 324, km: 63, litres: 14.3 });
  expect(b.check!.trips[0]!.times!.stops.map((s) => s.arriveAt)).toEqual([247, 271]);
  expect(b.figures).toEqual([{ vehicleId: 'VEH004', tripNo: 1, kgPct: 21, m3Pct: 23, timePct: 29 }]);
  expect(b.counts).toMatchObject({ vehiclesUsed: 1, vehiclesWorking: 35, trips: 1, ordersOnTrips: 4, ordersDue: 102, fuelWeekPct: 37, fridgeM3Used: 7.77, fridgeM3Working: 140.7 });
  expect(PlanBoard.parse((await as.get('/api/v1/plans')).body)).toEqual(b);
  expect(PlanBoard.parse((await save(empty(), ref(b))).body).plan).toMatchObject({ revision: 2, trips: [] });
});

it('AC-12 stores blocked drafts and reports the exact volume problem', async () => {
  const res = await save({ ...empty(), trips: [trip(['OUT016', 'OUT017', 'OUT018', 'OUT019'], 'VEH023')] });
  expect(res.status).toBe(200);
  const b = PlanBoard.parse(res.body);
  expect(b.check!.problems).toContainEqual(expect.objectContaining({ code: 'over_volume', message: 'VEH023 trip 1 carries 53.1 m³ and its limit is 38 m³.', fix: 'Take 15.1 m³ off this trip.' }));
  expect(b.figures![0]!.m3Pct).toBe(140);
});

it('AC-13 serializes simultaneous first saves and refuses references from before reset', async () => {
  const responses = await Promise.all([save(empty()), save(empty())]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(responses.find((r) => r.status === 409)!.body.error.code).toBe('stale');
  expect((await as.post('/api/v1/demo/reset').send({})).status).toBe(200);
  expect(code(await save(empty()))).toEqual([409, 'stale']);
});

it('AC-14 refuses wrong ids, revisions and sent plans without changing them', async () => {
  const b = PlanBoard.parse((await save(empty())).body);
  expect(code(await save(empty(), { planId: randomUUID(), revision: 1 }))).toEqual([409, 'stale']);
  expect(code(await save(empty(), { planId: b.plan.id!, revision: 0 }))).toEqual([409, 'stale']);
  await db.update(plans).set({ status: 'published' }).where(eq(plans.id, b.plan.id!));
  expect(code(await save(empty(), ref(b)))).toEqual([409, 'plan_sent']);
  expect((await db.select().from(plans).where(eq(plans.id, b.plan.id!)))[0]!.revision).toBe(1);
});

it('AC-6 scopes vehicles, shops, drivers and eligible orders to this depot and day', async () => {
  const cases: [DraftPlan, string][] = [
    [{ ...empty(), trips: [trip(['OUT026'], 'VEH039')] }, 'VEH039'],
    [{ ...empty(), trips: [{ ...trip(['OUT026']), stops: [{ outletId: 'OUT084', orderIds: [board.orders[0]!.id] }] }] }, 'OUT084'],
    [{ ...empty(), trips: [{ ...trip(['OUT026']), driverId: prasanna }] }, prasanna],
    [{ ...empty(), deferrals: [{ orderId: randomUUID(), code: 'window', reason: 'No window.' }] }, ''],
  ];
  for (const [plan, id] of cases) {
    const response = await save(plan); expect(code(response)).toEqual([400, 'unknown_record']);
    expect(response.body.error.details.id).toBe(id || plan.deferrals[0]!.orderId);
  }
});

const invalidCases = ['same trip number', 'empty stop', 'order twice on stop', 'order on two stops', 'deferral twice', 'assigned and deferred', 'different drivers', 'bad code', 'empty reason', 'long reason', 'driver on two vehicles'] as const;
it.each(invalidCases)('AC-15 refuses %s and writes nothing', async (kind) => {
  const t = trip(['OUT026']); const id = t.stops[0]!.orderIds[0]!;
  const plan: DraftPlan = { ...empty(), trips: [t] };
  const d = { orderId: id, code: 'window' as const, reason: 'No window.' };
  if (kind === 'same trip number') plan.trips.push(structuredClone(t));
  if (kind === 'empty stop') t.stops[0]!.orderIds = [];
  if (kind === 'order twice on stop') t.stops[0]!.orderIds.push(id);
  if (kind === 'order on two stops') t.stops.push(structuredClone(t.stops[0]!));
  if (kind === 'deferral twice') { plan.trips = []; plan.deferrals = [d, d]; }
  if (kind === 'assigned and deferred') plan.deferrals = [d];
  if (kind === 'different drivers') plan.trips = [{ ...t, driverId: dilshan }, { ...t, tripNo: 2, stops: [], driverId: null }];
  if (kind === 'bad code') { plan.trips = []; plan.deferrals = [{ ...d, code: 'other' as 'window' }]; }
  if (kind === 'empty reason' || kind === 'long reason') { plan.trips = []; plan.deferrals = [{ ...d, reason: kind === 'empty reason' ? '  ' : 'x'.repeat(201) }]; }
  if (kind === 'driver on two vehicles') plan.trips = [{ ...t, driverId: dilshan }, { ...t, vehicleId: 'VEH002', stops: [], driverId: dilshan }];
  expect(code(await save(plan))).toEqual([400, kind === 'driver on two vehicles' ? 'driver_taken' : 'invalid_input']);
  expect(await db.select().from(plans).where(eq(plans.date, DATE))).toHaveLength(0);
  expect(announce).not.toHaveBeenCalled();
});

it('AC-10 cleans orders no longer eligible, removes their empty stops, and persists on next save', async () => {
  const b = PlanBoard.parse((await save({ ...empty(), trips: [trip(['OUT017'], 'VEH023')] })).body);
  const id = b.plan.trips[0]!.stops[0]!.orderIds[0]!;
  await db.update(orders).set({ status: 'planned' }).where(eq(orders.id, id));
  const cleaned = PlanBoard.parse((await as.get('/api/v1/plans')).body);
  expect(cleaned.dropped).toEqual([id]); expect(cleaned.plan.trips[0]!.stops).toEqual([]);
  const saved = PlanBoard.parse((await save(cleaned.plan, ref(cleaned))).body);
  expect(saved.dropped).toEqual([]);
});

it('AC-16 announces only the depot after commit and queues with reset in both orders', async () => {
  let committed = false;
  vi.mocked(announce).mockImplementation(() => { expect(committed).toBe(true); });
  const transaction = db.transaction.bind(db);
  const spy = vi.spyOn(db, 'transaction').mockImplementation((async (...args: Parameters<typeof db.transaction>) => {
    const answer = await transaction(...args); committed = true; return answer;
  }) as typeof db.transaction);
  try { expect((await save(empty())).status).toBe(200); } finally { spy.mockRestore(); }
  expect(announce).toHaveBeenCalledExactlyOnceWith({ topic: 'plans', depotId: 'Peliyagoda' });
  vi.mocked(announce).mockReset();
  const b = PlanBoard.parse((await as.get('/api/v1/plans')).body);
  const responses = await Promise.all([as.post('/api/v1/demo/reset').send({}), save(empty(), ref(b))]);
  expect(responses[0]!.status).toBe(200);
  expect([200, 409]).toContain(responses[1]!.status);
  if (responses[1]!.status === 409) expect(responses[1]!.body.error.code).toBe('stale');
});

it('takes its clock instant after waiting for the depot lock', async () => {
  let release!: () => void; let locked!: () => void;
  const ready = new Promise<void>((r) => { locked = r; });
  const held = new Promise<void>((r) => { release = r; });
  const holder = db.transaction(async (tx) => { await tx.select().from(depots).where(eq(depots.id, 'Peliyagoda')).for('no key update'); locked(); await held; });
  await ready;
  const saving = save(empty()).then((r) => r);
  try {
    await vi.waitFor(async () => {
      const result = await db.execute(sql`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%depots%'`);
      expect(result.rows.length).toBeGreaterThan(0);
    });
    freeze(DATE, 210);
  } finally { release(); await holder; }
  expect(code(await saving)).toEqual([409, 'day_moved']);
});

it('AC-18 applies and clears a custom departure and normalizes a lone second trip', async () => {
  const t = trip(['OUT068', 'OUT065', 'OUT069', 'OUT066', 'OUT067'], 'VEH002', 2);
  const res = await save({ ...empty(), trips: [{ ...t, leaveAt: 187 }] });
  expect(res.status).toBe(200); const b = PlanBoard.parse(res.body);
  expect(b.plan.trips[0]!.tripNo).toBe(1);
  expect(b.check!.trips[0]!.times!.stops.at(-1)!.arriveAt).toBe(450);
  expect(b.check!.problems.filter((p) => p.vehicleId === 'VEH002').map((p) => p.code)).toEqual(expect.arrayContaining(['leaves_early', 'over_time_budget']));
  const regular = PlanBoard.parse((await save({ ...empty(), trips: [{ ...t, tripNo: 1 }] }, ref(b))).body);
  expect(regular.check!.trips[0]!.times!.stops.at(-1)!.arriveAt).toBe(473);
});

it('refuses pre-reset references as stale even though resetting opens orders again', async () => {
  const initial = ref();
  const saved = PlanBoard.parse((await save(empty())).body);
  testClock.at = '';
  setClockForTests(null);
  expect((await as.post('/api/v1/demo/reset').send({})).status).toBe(200);
  expect(PlanBoard.parse((await as.get('/api/v1/plans')).body).day!.open).toBe(false);
  expect(code(await save(empty(), initial))).toEqual([409, 'stale']);
  expect(code(await save(empty(), ref(saved)))).toEqual([409, 'stale']);
});
