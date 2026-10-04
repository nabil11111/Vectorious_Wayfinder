import { PlanBoard, type DraftPlan } from '@wayfinder/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { clearDemoDay, seedDemoDay } from '../src/db/demo-day';
import { auditLog, demoDay, fuelLog, orderLines, orders, plans, stops, trips, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { serve, stop } from './serve';
import { signInAs } from './sign-in';

const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at }) };
});
vi.mock('../src/lib/live', async (original) => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const freeze = (date = '2026-06-24', minute = 960) => { const at = depotInstant(date, minute); testClock.at = at.toISOString(); setClockForTests(at); };
const DATE = '2026-06-25'; const URL = `/api/v1/plans/${DATE}`;
const server = await serve(createApp()); const as = request.agent(server); const shop = request.agent(server); const ishara = request.agent(server);
let originalClock: typeof demoDay.$inferSelect; let board: PlanBoard; let driver: string;
const reset = () => db.transaction(async (tx) => { await clearDemoDay(tx); await seedDemoDay(tx); });
const ref = (b: PlanBoard) => ({ planId: b.plan.id!, revision: b.plan.revision });
const code = (r: request.Response) => [r.status, r.body.error?.code];
const trip = (outlets: string[], vehicleId = 'VEH004', tripNo: 1 | 2 = 1) => ({ vehicleId, tripNo, driverId: driver, leaveAt: null, stops: outlets.map((outletId) => ({ outletId, orderIds: board.orders.filter((o) => o.outletId === outletId).map((o) => o.id) })) });
const ready = (draftTrips: DraftPlan['trips'] = [trip(['OUT026', 'OUT028', 'OUT030'])]): DraftPlan => {
  const on = new Set(draftTrips.flatMap((t) => t.stops.flatMap((s) => s.orderIds)));
  return { mixBrands: false, trips: draftTrips, deferrals: board.orders.filter((o) => !on.has(o.id)).map((o) => ({ orderId: o.id, code: 'dispatcher_choice', reason: 'Scheduled for a later run.' })) };
};
const save = async (draft = ready(), b = board) => {
  const r = await as.put(`${URL}/draft`).send({ ...(b.plan.id ? ref(b) : { planId: null, demoDay: b.demoDay }), plan: draft });
  expect(r.status).toBe(200); return PlanBoard.parse(r.body);
};
const send = (b: PlanBoard) => as.post(`${URL}/send`).send(ref(b));
const unsend = (b: PlanBoard) => as.post(`${URL}/unsend`).send(ref(b));
const held = async () => ({ plans: await db.select().from(plans).orderBy(plans.id), orders: await db.select().from(orders).orderBy(orders.id),
  trips: await db.select().from(trips).orderBy(trips.id), stops: await db.select().from(stops).orderBy(stops.id), fuel: await db.select().from(fuelLog).orderBy(fuelLog.id), audits: await db.select().from(auditLog).orderBy(auditLog.id) });
beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, username] of [[as, 'ruwan'], [shop, 'nadeesha'], [ishara, 'ishara']] as const) expect((await signInAs(agent, username)).status).toBe(200);
  driver = (await db.select().from(users).where(eq(users.username, 'dilshan')))[0]!.id;
});
beforeEach(async () => { await reset(); await initClock(); freeze(); board = PlanBoard.parse((await as.get('/api/v1/plans')).body); vi.mocked(announce).mockReset(); });
afterAll(async () => { await reset(); await db.update(demoDay).set(originalClock); setClockForTests(null); await stop(server); await pool.end(); });

it('AC-25 refuses blocked and already-departed plans without writing', async () => {
  let b = await save({ mixBrands: false, trips: [], deferrals: [] });
  let before = await held();
  const refused = await send(b); expect(code(refused)).toEqual([409, 'not_ready']);
  expect(refused.body.error.details.blocks).toHaveLength(102); expect(await held()).toEqual(before);
  b = await save(ready([{ ...trip(['OUT068', 'OUT065', 'OUT069', 'OUT066', 'OUT067'], 'VEH002'), leaveAt: 187 }]), b);
  freeze(DATE, 209); before = await held();
  const departed = await send(b); expect(code(departed)).toEqual([409, 'departed_already']);
  expect(departed.body.error.details).toEqual({ vehicleId: 'VEH002', tripNo: 1 }); expect(await held()).toEqual(before);
});

// Q-47: View plan's rows read "Charith · reefer truck" while the kept warning beside them said "VEH041's Fresh trips take
// 277 minutes". The check a plan is sent with, and View plan reads back, names a truck by its driver as the rows do, and
// by its kind and number only when it has none.
it('Q-47 names driverless draft trucks by kind and number, then requires a driver before Send', async () => {
  const early = { ...trip(['OUT026', 'OUT028', 'OUT030']), leaveAt: 120 }, driverless = { ...trip(['OUT006'], 'VEH002'), driverId: null, leaveAt: 120 };
  const saved = await save(ready([early, driverless]));
  expect(code(await send(saved))).toEqual([409, 'driver_required']);
  const reread = PlanBoard.parse((await as.get(URL)).body);
  expect(reread.check).toEqual(saved.check);
  const said = (vehicleId: string) => reread.check!.problems.filter((p) => p.vehicleId === vehicleId).map((p) => p.message);
  expect(said('VEH004')).toContain('Dilshan\'s reefer truck leaves at 02:00, and a trip with a Fresh shop normally leaves at 03:30 or later.');
  expect(said('VEH004').some((message) => message.includes('VEH004'))).toBe(false);
  expect(said('VEH002').length).toBeGreaterThan(0);
  expect(said('VEH002').every((message) => message.includes('the reefer truck VEH002') || message.includes('The reefer truck VEH002'))).toBe(true);
  const [anura] = await db.select().from(users).where(eq(users.username, 'anura'));
  const assigned = await save(ready([early, { ...driverless, driverId: anura!.id }]), saved);
  const sent = PlanBoard.parse((await send(assigned)).body);
  expect(PlanBoard.parse((await as.get(URL)).body).check).toEqual(sent.check);
  expect(sent.check!.problems.filter(problem => problem.vehicleId === 'VEH002').every(problem => problem.message.includes('Anura'))).toBe(true);
});

it('AC-26 sends atomically, saves the check and times, revises orders and announces after commit', async () => {
  const b = await save(); const before = await db.select().from(orders); vi.mocked(announce).mockClear();
  let committed = false; const original = db.transaction.bind(db);
  const spy = vi.spyOn(db, 'transaction').mockImplementation((async (...args: Parameters<typeof db.transaction>) => { const result = await original(...args); committed = true; return result; }) as typeof db.transaction);
  vi.mocked(announce).mockImplementation(() => expect(committed).toBe(true));
  let response: request.Response;
  try { response = await send(b); } finally { spy.mockRestore(); }
  expect(response!.status).toBe(200); const sent = PlanBoard.parse(response!.body);
  expect(sent.plan).toMatchObject({ status: 'published', revision: 2, sentAt: testClock.at, canUnsend: true }); expect(sent.check).toEqual(b.check);
  const after = await db.select().from(orders);
  const on = new Set(b.plan.trips.flatMap((t) => t.stops.flatMap((s) => s.orderIds)));
  for (const o of b.orders) { const row = after.find((r) => r.id === o.id)!; expect(row.status).toBe(on.has(o.id) ? 'planned' : 'deferred'); expect(row.revision).toBe(before.find((r) => r.id === o.id)!.revision + 1); }
  const sentTripIds = (await db.select({ id: trips.id }).from(trips).where(eq(trips.planId, sent.plan.id!))).map((t) => t.id);
  const timed = await db.select().from(stops).where(inArray(stops.tripId, sentTripIds)).orderBy(stops.seq);
  expect(timed.map((s) => [s.plannedArrival, s.plannedDepart])).toEqual(b.check!.trips[0]!.times!.stops.map((s) => [s.arriveAt, s.leaveAt].map((n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00`)));
  expect(await db.select().from(auditLog).where(and(eq(auditLog.entityId, sent.plan.id!), eq(auditLog.action, 'plan.sent')))).toHaveLength(1);
  expect(announce).toHaveBeenCalledWith({ topic: 'plans', depotId: 'Peliyagoda' }); expect(announce).toHaveBeenCalledWith({ topic: 'orders', depotId: 'Peliyagoda' });
  const heard = vi.mocked(announce).mock.calls.map(([event]) => event.outletId).filter(Boolean);
  expect(heard.sort()).toEqual([...new Set(b.orders.map((o) => o.outletId))].sort());
});

it('AC-27 assigns exact vehicle litres across both trips', async () => {
  const dryTrips = [trip(['OUT027', 'OUT034'], 'VEH010'), trip(['OUT025', 'OUT029'], 'VEH010', 2)].map((t) => ({ ...t, stops: t.stops.map((s) => ({ ...s, orderIds: s.orderIds.filter((id) => board.orders.find((o) => o.id === id)!.temp === 'dry') })) }));
  const b = await save(ready(dryTrips));
  expect(b.check!.ok).toBe(true); expect((await send(b)).status).toBe(200);
  const fuel = await db.select({ litres: fuelLog.litres, tripNo: trips.tripNo }).from(fuelLog).innerJoin(trips, eq(trips.id, fuelLog.tripId)).where(eq(trips.planId, b.plan.id!)).orderBy(trips.tripNo);
  expect(fuel).toEqual([{ litres: '11.3', tripNo: 1 }, { litres: '11.2', tripNo: 2 }]);
});

it('AC-28 publishes concurrent sends exactly once and refuses retries', async () => {
  const b = await save(); const responses = await Promise.all([send(b), send(b)]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(['plan_sent', 'stale']).toContain(responses.find((r) => r.status === 409)!.body.error.code);
  expect(code(await send(b))).toEqual([409, 'plan_sent']);
  expect(await db.select().from(fuelLog).where(eq(fuelLog.date, DATE))).toHaveLength(1);
});

it('AC-4 and AC-29 keep the sent board by date and carry its fuel into Friday', async () => {
  const b = await save(); const sent = PlanBoard.parse((await send(b)).body);
  expect((await db.select().from(fuelLog).where(eq(fuelLog.date, DATE)))[0]!.litres).toBe('15.9');
  freeze(DATE, 510);
  const historical = PlanBoard.parse((await as.get(URL)).body); expect(historical.check).toEqual(sent.check); expect(historical.plan.canUnsend).toBe(false);
  // Q-19: it says why, though no truck was loaded: its day has left the board.
  expect(historical.plan.lockedReason).toBe('Trucks for Thu 25 Jun leave from 03:30, so its plan can no longer go back to edit.');
  expect(sent.plan.lockedReason).toBeNull();
  const next = PlanBoard.parse((await as.get('/api/v1/plans')).body); expect(next.day!.date).toBe('2026-06-26');
  expect(next.check!.vehicles.find((v) => v.vehicleId === 'VEH004')!.litresBefore).toBe(180.9);
  const seed = PlanBoard.parse((await as.get('/api/v1/plans/2026-06-24')).body);
  expect(seed.check?.ok).toBe(true);
  expect(seed.counts).toMatchObject({ trips: 2, stops: 7, ordersOnTrips: 7, ordersDeferred: 4 });
  expect(seed.figures).not.toBeNull();
});

it('AC-30 takes back a sent plan, restores earlier deferrals, and sends again without duplicate fuel', async () => {
  const b = await save(); const sent = PlanBoard.parse((await send(b)).body);
  vi.mocked(announce).mockClear();
  const res = await unsend(sent); expect(res.status).toBe(200); const draft = PlanBoard.parse(res.body);
  expect(vi.mocked(announce).mock.calls.map(([event]) => event)).toEqual(expect.arrayContaining([
    { topic: 'plans', depotId: 'Peliyagoda' }, { topic: 'orders', depotId: 'Peliyagoda' }, { topic: 'orders', outletId: 'OUT026' }, { topic: 'orders', outletId: 'OUT060' },
  ]));
  expect(draft.plan).toMatchObject({ status: 'draft', revision: 3, sentAt: null, canUnsend: false });
  expect((await db.select().from(plans).where(eq(plans.id, b.plan.id!)))[0]!.sentCheck).toBeNull();
  expect(await db.select().from(fuelLog).where(eq(fuelLog.date, DATE))).toHaveLength(0);
  const restored = await db.select().from(orders).where(inArray(orders.id, b.orders.map((o) => o.id)));
  expect(restored.filter((o) => o.status === 'deferred')).toHaveLength(4); expect(restored.filter((o) => o.status === 'placed')).toHaveLength(98);
  expect(draft.plan.deferrals).toEqual(b.plan.deferrals);
  expect((await send(draft)).status).toBe(200); expect(await db.select().from(fuelLog).where(eq(fuelLog.date, DATE))).toHaveLength(1);
  expect(await db.select().from(auditLog).where(and(eq(auditLog.entityId, b.plan.id!), eq(auditLog.action, 'plan.unsent')))).toHaveLength(1);
});

it('AC-30 gives the parts of a split carried-over order back as placed, so they can still be joined', async () => {
  const waited = board.orders.find((o) => o.outletId === 'OUT060')!;
  let b = await save({ mixBrands: false, trips: [trip(['OUT026', 'OUT028', 'OUT030'])], deferrals: [] });
  const line = waited.lines[0]!;
  const split = await as.post(`${URL}/split`).send({ ...ref(b), orderId: waited.id, keep: [{ productId: line.productId, quantity: line.quantity - 1 }] });
  expect(split.status).toBe(200); b = PlanBoard.parse(split.body); board = b;
  const sent = PlanBoard.parse((await send(await save(ready(), b))).body);
  const res = await unsend(sent); expect(res.status).toBe(200);
  const parts = await db.select().from(orders).where(eq(orders.splitFrom, waited.id));
  expect(parts.map((o) => o.status)).toEqual(['placed', 'placed']);
  const join = await as.post(`${URL}/join`).send({ ...ref(PlanBoard.parse(res.body)), orderId: waited.id });
  expect(join.status).toBe(200);
});

it('AC-30 refuses loading and later trips without changing the published plan', async () => {
  const sent = PlanBoard.parse((await send(await save())).body);
  for (const status of ['loading', 'ready', 'out', 'done'] as const) {
    await db.update(trips).set({ status }).where(eq(trips.planId, sent.plan.id!)); const before = await held();
    expect(PlanBoard.parse((await as.get(URL)).body).plan.canUnsend).toBe(false);
    const response = await unsend(sent); expect(code(response)).toEqual([409, 'loading_started']); expect(response.body.error.details).toEqual({ vehicleId: 'VEH004', tripNo: 1 }); expect(await held()).toEqual(before);
  }
});

it('AC-3 refuses send and unsend once the board day moves', async () => {
  const b = await save(); freeze(DATE, 210); const moved = await send(b); expect(code(moved)).toEqual([409, 'day_moved']);
  expect(moved.body.error.message).toBe('Trucks for Thu 25 Jun leave from 03:30, so its plan can no longer be sent.');
  freeze(); const sent = PlanBoard.parse((await send(b)).body); freeze(DATE, 210); const late = await unsend(sent); expect(code(late)).toEqual([409, 'day_moved']);
  // Q-19: Back to edit is refused in the words the board shows where the button was.
  expect(late.body.error.message).toBe(PlanBoard.parse((await as.get(URL)).body).plan.lockedReason);
});

it('AC-10 sends the cleaned draft with dropped orders removed', async () => {
  const b = await save(); const id = b.plan.trips[0]!.stops[0]!.orderIds[0]!;
  await db.update(orders).set({ status: 'planned' }).where(eq(orders.id, id));
  const res = await send(b); expect(res.status).toBe(200); const sent = PlanBoard.parse(res.body);
  expect(sent.orders.some((o) => o.id === id)).toBe(false); expect(sent.dropped).toEqual([]); expect(sent.check!.ok).toBe(true);
});

it('AC-22 rejects a corrupt split and AC-23 shows both parts after a valid send', async () => {
  let b = await save(ready([trip(['OUT016', 'OUT017', 'OUT018', 'OUT019'], 'VEH023')]));
  const original = board.orders.find((o) => o.outletId === 'OUT017')!;
  const split = await as.post(`${URL}/split`).send({ ...ref(b), orderId: original.id, keep: [{ productId: 'style-folded', quantity: 50 }, { productId: 'style-shoes', quantity: 25 }] });
  expect(split.status).toBe(200); b = PlanBoard.parse(split.body); board = b;
  const assigned = new Set(b.plan.trips.flatMap((t) => t.stops.flatMap((s) => s.orderIds)));
  const extra = b.orders.find((o) => o.splitFrom === original.id && !assigned.has(o.id))!;
  b = await save({ ...b.plan, deferrals: [...b.plan.deferrals, { orderId: extra.id, code: 'over_capacity', reason: 'The truck was full.' }] }, b);
  const child = b.orders.find((o) => o.splitFrom === original.id && assigned.has(o.id))!;
  await db.update(orderLines).set({ quantity: 49 }).where(and(eq(orderLines.orderId, child.id), eq(orderLines.productId, 'style-folded')));
  const before = await held(); const response = await send(b); expect(code(response)).toEqual([409, 'split_mismatch']); expect(response.body.error.details.orderId).toBe(original.id); expect(await held()).toEqual(before);
  await db.update(orderLines).set({ quantity: 50 }).where(and(eq(orderLines.orderId, child.id), eq(orderLines.productId, 'style-folded')));
  expect((await send(b)).status).toBe(200);
  const list = (await ishara.get('/api/v1/store/orders?list=open')).body;
  expect(JSON.stringify(list)).not.toContain(original.id);
  const rows = await db.select().from(orders).where(eq(orders.splitFrom, original.id));
  expect(rows.map((o) => o.status).sort()).toEqual(['deferred', 'planned']);
  expect(JSON.stringify(list)).toContain('The truck was full.');
});

it('AC-25 waits for a shop place to commit and then checks its newly placed orders', async () => {
  const b = await save(); freeze('2026-06-24', 959);
  const next = (await shop.get('/api/v1/store/next-order')).body;
  let release!: () => void; let placed!: () => void;
  const heldPlace = new Promise<void>((r) => { release = r; }); const reached = new Promise<void>((r) => { placed = r; });
  const transaction = db.transaction.bind(db);
  const spy = vi.spyOn(db, 'transaction').mockImplementation(((work, options) => transaction(async (tx) => {
    const result = await work(tx);
    if (result && typeof result === 'object' && 'placedNow' in result && result.placedNow) { placed(); await heldPlace; }
    return result;
  }, options)) as typeof db.transaction);
  const placing = shop.post('/api/v1/store/next-order/place').send({ deliveryDate: next.deliveryDate, refs: next.draft.refs }).then((r) => r);
  await reached; freeze(); const sending = send(b).then((r) => r);
  try {
    await vi.waitFor(async () => {
      const result = await db.execute(sql`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%depots%'`);
      expect(result.rows.length).toBeGreaterThan(0);
    });
  } finally { release(); spy.mockRestore(); }
  expect((await placing).status).toBe(200);
  const refused = await sending; expect(code(refused)).toEqual([409, 'not_ready']);
  expect(refused.body.error.details.blocks.filter((p: { code: string }) => p.code === 'order_not_planned')).toHaveLength(2);
});
