import { PlanBoard, PlanScenario, type PlanRef, type PlanCheck } from '@wayfinder/contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { clearDemoDay, demoId, seedDemoDay } from '../src/db/demo-day';
import { auditLog, deferrals, demoDay, fuelLog, orderLines, orders, plans, stopOrders, stops, trips } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import type { PlannerInput } from '../src/planning';
import { serve, stop } from './serve';
import { signInAs } from './sign-in';

const clock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const real = await original<typeof import('../src/lib/clock')>();
  return { ...real, demoClockAt: (...args: Parameters<typeof real.demoClockAt>) => ({ ...real.demoClockAt(...args), now: clock.at || real.demoClockAt(...args).now }) };
});
const engine = vi.hoisted(() => ({ calls: [] as PlannerInput[], unavailable: null as PlanCheck | null }));
vi.mock('../src/planning/planner/build', async (original) => {
  const real = await original<typeof import('../src/planning/planner/build')>();
  return { ...real, buildSuggestedPlan: (input: PlannerInput) => {
    engine.calls.push(structuredClone(input));
    return engine.unavailable ? { status: 'unavailable', check: engine.unavailable } : real.buildSuggestedPlan(input);
  } };
});
const DATE = '2026-06-25';
const URL = `/api/v1/plans/${DATE}`;
const server = await serve(createApp());
const dispatcher = request.agent(server);
const otherDepot = request.agent(server);
const driver = request.agent(server);
let originalClock: typeof demoDay.$inferSelect;
let board: PlanBoard;
const reset = () => db.transaction(async (tx) => { await clearDemoDay(tx); await seedDemoDay(tx); });
const freeze = (date = '2026-06-24', minutes = 960) => { const at = depotInstant(date, minutes); clock.at = at.toISOString(); setClockForTests(at); };
const ref = (b = board): PlanRef => b.plan.id ? { planId: b.plan.id, revision: b.plan.revision } : { planId: null, demoDay: b.demoDay };
const read = async () => { board = PlanBoard.parse((await dispatcher.get('/api/v1/plans')).body); };
const compare = (excludedVehicleId = 'VEH035', reference = ref()) => dispatcher.post(`${URL}/scenario`).send({ ref: reference, excludedVehicleId });
const held = async () => ({
  orders: await db.select().from(orders).orderBy(orders.id), lines: await db.select().from(orderLines).orderBy(orderLines.id),
  plans: await db.select().from(plans).orderBy(plans.id), trips: await db.select().from(trips).orderBy(trips.id),
  stops: await db.select().from(stops).orderBy(stops.id), assignments: await db.select().from(stopOrders).orderBy(stopOrders.stopId, stopOrders.orderId),
  deferrals: await db.select().from(deferrals).orderBy(deferrals.id), fuel: await db.select().from(fuelLog).orderBy(fuelLog.id),
  audits: await db.select().from(auditLog).orderBy(auditLog.id),
});
const result = async () => { const res = await compare(); expect(res.status, JSON.stringify(res.body)).toBe(200); return PlanScenario.parse(res.body); };
const refusal = async (code: string, run = compare) => { const before = await held(); const res = await run(); expect([res.status, res.body.error?.code]).toEqual([409, code]); expect(await held()).toEqual(before); };
beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, name] of [[dispatcher, 'ruwan'], [otherDepot, 'ruwan'], [driver, 'dilshan']] as const) expect((await signInAs(agent, name)).status).toBe(200);
});
beforeEach(async () => { engine.calls = []; engine.unavailable = null; await reset(); await initClock(); freeze(); await read(); });
afterAll(async () => { await reset(); await db.update(demoDay).set(originalClock); setClockForTests(null); await stop(server); await pool.end(); });

it('F1 runs two real checked plans from one snapshot without creating a draft or changing any saved data', async () => {
  const before = await held(); const preview = await result();
  expect(await held()).toEqual(before);
  expect(preview).toMatchObject({ date: DATE, depot: 'Peliyagoda', ref: ref(), excludedVehicleId: 'VEH035', comparedAt: clock.at });
  expect(preview.baseline.check.ok).toBe(true); expect(preview.scenario.check.ok).toBe(true);
  expect(preview.baseline.summary).toMatchObject({ totalOrders: 102, fullyPlanned: 96, partiallyPlanned: 0, deferred: 6, trips: 27 });
  expect(preview.scenario.summary).toMatchObject({ totalOrders: 102, fullyPlanned: 93, deferred: 9, trips: 26 });
  for (const outcome of [preview.baseline, preview.scenario]) expect(outcome.summary.shopsWithWaiting).toBe(new Set(outcome.orders.filter((o) => o.status !== 'planned').map((o) => o.outletId)).size);
  expect(engine.calls).toHaveLength(2);
  expect(engine.calls[1]).toEqual({ ...engine.calls[0], vehicles: engine.calls[0]!.vehicles.map((v) => v.id === 'VEH035' ? { ...v, available: false } : v) });
  expect(preview.scenario.orders.every((o) => !o.vehicleIds.includes('VEH035') && o.reasons.every((r) => r.length > 0))).toBe(true);
  expect(preview.baseline.summary.fuelLitres).toBeCloseTo(preview.baseline.check.trips.reduce((sum, t) => sum + (t.times?.litres ?? 0), 0), 1);
  expect(preview.scenario.summary.repeatedDeferrals).toBe(preview.scenario.orders.filter((o) => o.waitedBefore && o.status !== 'planned').length);
});

it('F2 aggregates persisted and generated splits into their original outstanding demand', async () => {
  const original = demoId('order', '2026-06-24:OUT001:chilled');
  await db.update(orderLines).set({ quantity: 180 }).where(eq(orderLines.orderId, original));
  const split = await dispatcher.post(`${URL}/split`).send({ ...ref(), orderId: original, keep: [{ productId: 'fresh-chilled-carton', quantity: 90 }] });
  expect(split.status, JSON.stringify(split.body)).toBe(200); board = PlanBoard.parse(split.body);
  const before = await held(); const preview = await result();
  expect(await held()).toEqual(before);
  expect(preview.baseline.summary.totalOrders).toBe(102);
  expect(preview.baseline.orders.filter((o) => o.orderId === original)).toHaveLength(1);
  expect(preview.baseline.orders.find((o) => o.orderId === original)?.status).toBe('planned');
  expect(preview.scenario.orders.find((o) => o.orderId === original)?.status).toBe('deferred');
  expect(preview.baseline.orders.some((o) => board.orders.some((b) => b.splitFrom === original && b.id === o.orderId))).toBe(false);
});

it('F2 reports generated partly served demand as partial rather than two original orders', async () => {
  const original = demoId('order', '2026-06-24:OUT001:chilled');
  await db.update(orderLines).set({ quantity: 350 }).where(eq(orderLines.orderId, original));
  const before = await held(); const preview = await result();
  expect(await held()).toEqual(before);
  expect(preview.baseline.summary.totalOrders).toBe(102);
  expect(preview.baseline.orders.find((o) => o.orderId === original)).toMatchObject({ status: 'partial', waitedBefore: true, vehicleIds: ['VEH035'] });
  expect(preview.baseline.summary.partiallyPlanned).toBeGreaterThan(0);
});

it('F3 hashes content changes even when the plan reference stays unchanged', async () => {
  const first = await result(); const same = await result(); expect(same.snapshotKey).toBe(first.snapshotKey);
  await db.update(orderLines).set({ quantity: 13 }).where(eq(orderLines.orderId, demoId('order', '2026-06-24:OUT001:chilled')));
  const changed = await result(); expect(changed.ref).toEqual(first.ref); expect(changed.snapshotKey).not.toBe(first.snapshotKey);
});
it('F1 preserves a manual saved draft and does not replace it with either generated plan', async () => {
  const saved = await dispatcher.put(`${URL}/draft`).send({ ...ref(), plan: { mixBrands: false, trips: [], deferrals: [] } });
  expect(saved.status).toBe(200); board = PlanBoard.parse(saved.body);
  const before = await held(); await result(); expect(await held()).toEqual(before);
});
it('F5 denies anonymous, driver, wrong depot and malformed requests', async () => {
  const body = { ref: ref(), excludedVehicleId: 'VEH035' }; const before = await held();
  expect((await request(server).post(`${URL}/scenario`).send(body)).status).toBe(401);
  expect((await driver.post(`${URL}/scenario`).send(body)).status).toBe(403);
  expect((await otherDepot.put('/api/v1/me/depot').send({ depotId: 'Kandy' })).status).toBe(200);
  expect((await otherDepot.post(`${URL}/scenario`).send(body)).status).toBe(409);
  expect((await dispatcher.post(`${URL}/scenario`).set('x-wayfinder-depot', 'Kandy').send(body)).status).toBe(409);
  expect((await dispatcher.post(`${URL}/scenario`).send({ ...body, apply: true })).status).toBe(400);
  expect(await held()).toEqual(before); expect(engine.calls).toHaveLength(0);
});
it('F5 rejects foreign and unavailable vehicles before invoking the planner', async () => {
  await refusal('scenario_vehicle', () => compare('VEH048'));
  await refusal('scenario_vehicle', () => compare('VEH003'));
  expect(engine.calls).toHaveLength(0);
});
it('F5 rejects reset, revision, cutoff, moved day and sent plan references without mutations', async () => {
  await refusal('stale', () => compare('VEH035', { planId: null, demoDay: board.demoDay + 1 }));
  freeze('2026-06-24', 959); await refusal('orders_open'); freeze();
  freeze(DATE, 211); await refusal('day_moved'); freeze();
  const saved = await dispatcher.put(`${URL}/draft`).send({ ...ref(), plan: { mixBrands: false, trips: [], deferrals: [] } });
  board = PlanBoard.parse(saved.body);
  await refusal('stale', () => compare('VEH035', { planId: board.plan.id!, revision: board.plan.revision - 1 }));
  await db.update(plans).set({ status: 'published' }).where(eq(plans.id, board.plan.id!));
  await refusal('plan_sent');
  expect(engine.calls).toHaveLength(0);
});
it('F5 bounds the raw eligible input and refuses an unavailable calculation honestly', async () => {
  const sample = (await db.select().from(orders).where(eq(orders.status, 'placed')))[0]!;
  await db.insert(orders).values(Array.from({ length: 199 }, () => ({ ...sample, id: undefined })));
  await refusal('scenario_unavailable'); expect(engine.calls).toHaveLength(0);
});
it('F3 returns an actionable failed calculation with no writes', async () => {
  engine.unavailable = { ok: false, problems: [], trips: [], vehicles: [] };
  await refusal('scenario_unavailable'); expect(engine.calls).toHaveLength(1);
});

it('F5 rejects old loading data even if its saved plan was incorrectly returned to draft', async () => {
  const saved = await dispatcher.put(`${URL}/draft`).send({ ...ref(), plan: { mixBrands: false, trips: [], deferrals: [] } });
  board = PlanBoard.parse(saved.body);
  await db.insert(trips).values({ planId: board.plan.id!, vehicleId: 'VEH001', tripNo: 1, status: 'loading' });
  await refusal('plan_locked'); expect(engine.calls).toHaveLength(0);
});
