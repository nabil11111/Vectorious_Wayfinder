import { randomUUID } from 'node:crypto';
import { PlanBoard, StoreOrderList, type DraftPlan } from '@wayfinder/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { clearDemoDay, seedDemoDay } from '../src/db/demo-day';
import { auditLog, deferrals, demoDay, orderLines, orders, plans, stopOrders, stops, trips } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { serve, stop } from './serve';
import { signInAs } from './sign-in';

const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at || clock.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async (original) => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const server = await serve(createApp());
const as = request.agent(server);
const ishara = request.agent(server);
const DATE = '2026-06-25';
const URL = `/api/v1/plans/${DATE}`;
const KEEP = [{ productId: 'style-folded', quantity: 50 }, { productId: 'style-shoes', quantity: 25 }];
const empty = (): DraftPlan => ({ mixBrands: false, trips: [], deferrals: [] });
const reset = () => db.transaction(async (tx) => { await clearDemoDay(tx); await seedDemoDay(tx); });
let originalClock: typeof demoDay.$inferSelect;
let board: PlanBoard;
let originalId: string;
const ref = (b = board) => b.plan.id ? { planId: b.plan.id, revision: b.plan.revision } : { planId: null, demoDay: b.demoDay };
const trip = (shops: string[], vehicleId = 'VEH023') => ({ vehicleId, tripNo: 1 as const, driverId: null, leaveAt: null, stops: shops.map((outletId) => ({ outletId, orderIds: board.orders.filter((o) => o.outletId === outletId).map((o) => o.id) })) });
const save = async (plan: DraftPlan) => { const res = await as.put(`${URL}/draft`).send({ ...ref(), plan }); expect(res.status).toBe(200); board = PlanBoard.parse(res.body); return board; };
const split = (orderId = originalId, keep = KEEP) => as.post(`${URL}/split`).send({ ...ref(), orderId, keep });
const join = (orderId = originalId) => as.post(`${URL}/join`).send({ ...ref(), orderId });
const code = (res: request.Response) => [res.status, res.body.error?.code];
const parts = () => board.orders.filter((o) => o.splitFrom === originalId);
async function splitSaved(shops = ['OUT016', 'OUT017', 'OUT018', 'OUT019']) {
  await save({ ...empty(), trips: [trip(shops)] });
  const res = await split(); expect(res.status).toBe(200); board = PlanBoard.parse(res.body); return board;
}
async function held() {
  return {
    orders: await db.select().from(orders).orderBy(orders.id), lines: await db.select().from(orderLines).orderBy(orderLines.id),
    plans: await db.select().from(plans).orderBy(plans.id), trips: await db.select().from(trips).orderBy(trips.id),
    stops: await db.select().from(stops).orderBy(stops.id), assignments: await db.select().from(stopOrders).orderBy(stopOrders.stopId, stopOrders.orderId),
    deferrals: await db.select().from(deferrals).orderBy(deferrals.id), audits: await db.select().from(auditLog).orderBy(auditLog.id),
  };
}

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, username] of [[as, 'ruwan'], [ishara, 'ishara']] as const) {
    expect((await signInAs(agent, username)).status).toBe(200);
  }
});
beforeEach(async () => {
  await reset(); await initClock();
  const at = depotInstant('2026-06-24', 960); testClock.at = at.toISOString(); setClockForTests(at);
  board = PlanBoard.parse((await as.get('/api/v1/plans')).body);
  originalId = board.orders.find((o) => o.outletId === 'OUT017')!.id;
  vi.mocked(announce).mockReset();
});
afterAll(async () => { await reset(); await db.update(demoDay).set(originalClock); setClockForTests(null); await stop(server); await pool.end(); });

it('AC-19 keeps the original and its metadata, writes two exact parts and replaces its stop', async () => {
  await db.update(orders).set({ driverNote: 'Use the mall loading bay.' }).where(eq(orders.id, originalId));
  const original = (await db.select().from(orders).where(eq(orders.id, originalId)))[0]!;
  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, originalId)).orderBy(orderLines.productId);
  await splitSaved();
  expect(board.plan).toMatchObject({ revision: 2, savedAt: testClock.at });
  expect(parts()).toHaveLength(2);
  const first = parts().find((o) => o.load.units === 75)!;
  const second = parts().find((o) => o.load.units === 60)!;
  expect(first.load).toMatchObject({ kg: 1050, m3: 15.5 });
  expect(second.load).toMatchObject({ kg: 765, m3: 15.6 });
  expect(parts().map((o) => o.originalUnits)).toEqual([135, 135]);
  expect(board.plan.trips[0]!.stops[1]!.orderIds).toEqual([first.id]);
  expect(board.plan.trips.flatMap((t) => t.stops.flatMap((s) => s.orderIds))).not.toContain(second.id);
  expect(board.check!.trips[0]!.load.m3).toBe(37.5);
  expect(board.figures![0]!.m3Pct).toBe(99);
  expect(board.check!.problems.filter((p) => p.level === 'block' && p.vehicleId === 'VEH023')).toEqual([]);
  expect(board.check!.problems).toContainEqual(expect.objectContaining({ message: 'The 765 kg dry order for Style Liberty Plaza is on no trip and is not deferred.' }));
  expect((await db.select().from(orders).where(eq(orders.id, originalId)))[0]).toEqual({ ...original, status: 'split', revision: original.revision + 1 });
  expect(await db.select().from(orderLines).where(eq(orderLines.orderId, originalId)).orderBy(orderLines.productId)).toEqual(lines);
  const children = await db.select().from(orders).where(eq(orders.splitFrom, originalId));
  for (const child of children) expect(child).toMatchObject({ status: 'placed', outletId: original.outletId, temp: original.temp, deliveryDate: original.deliveryDate, driverNote: original.driverNote, placedAt: original.placedAt, placedBy: original.placedBy });
});

it('AC-19 can split an unplanned original on the first save, with zero quantities omitted', async () => {
  const res = await split(originalId, [...KEEP, { productId: 'style-hanging', quantity: 0 }]);
  expect(res.status).toBe(200); board = PlanBoard.parse(res.body);
  expect(board.plan).toMatchObject({ revision: 1, trips: [] });
  expect(parts()).toHaveLength(2);
  const lines = await db.select().from(orderLines).where(inArray(orderLines.orderId, parts().map((p) => p.id)));
  expect(lines.every((line) => line.quantity > 0)).toBe(true);
});

it.each(['part', 'draft deferral', 'two stops', 'unknown product', 'duplicate product', 'too many', 'empty first', 'empty second'] as const)('AC-20 refuses %s without any write or announcement', async (kind) => {
  let id = originalId; let keep = KEEP;
  if (kind === 'part') { await splitSaved(); id = parts()[0]!.id; }
  if (kind === 'draft deferral') await save({ ...empty(), deferrals: [{ orderId: id, code: 'over_capacity', reason: 'No room.' }] });
  if (kind === 'two stops') {
    await save({ ...empty(), trips: [trip(['OUT017'])] });
    const [savedTrip] = await db.select().from(trips).where(eq(trips.planId, board.plan.id!));
    const [duplicate] = await db.insert(stops).values({ tripId: savedTrip!.id, outletId: 'OUT017', seq: 2 }).returning();
    await db.insert(stopOrders).values({ stopId: duplicate!.id, orderId: id });
  }
  if (kind === 'unknown product') keep = [{ productId: 'fresh-dry-carton', quantity: 1 }];
  if (kind === 'duplicate product') keep = [KEEP[0]!, KEEP[0]!];
  if (kind === 'too many') keep = [{ productId: 'style-folded', quantity: 51 }];
  if (kind === 'empty first') keep = [{ productId: 'style-folded', quantity: 0 }];
  if (kind === 'empty second') keep = board.orders.find((o) => o.id === originalId)!.lines;
  vi.mocked(announce).mockClear(); const before = await held();
  expect(code(await split(id, keep))).toEqual(kind === 'part' || kind === 'draft deferral' ? [409, 'cannot_split'] : [400, 'invalid_input']);
  expect(await held()).toEqual(before); expect(announce).not.toHaveBeenCalled();
});

it('refuses split orders outside the depot or the board day', async () => {
  const [elsewhere] = await db.insert(orders).values({ outletId: 'OUT089', deliveryDate: DATE, temp: 'dry', status: 'placed' }).returning();
  const before = await held();
  try {
    expect(code(await split(elsewhere!.id))).toEqual([400, 'unknown_record']);
    expect(code(await split(randomUUID()))).toEqual([400, 'unknown_record']);
    expect(await held()).toEqual(before);
    await db.update(orders).set({ deliveryDate: '2026-06-26' }).where(eq(orders.id, originalId));
    const future = await held(); expect(code(await split())).toEqual([400, 'unknown_record']); expect(await held()).toEqual(future);
  } finally { await db.delete(orders).where(eq(orders.id, elsewhere!.id)); }
});

it.each(['both moved', 'first deferred', 'second deferred'] as const)('AC-21 joins with %s and only removes the parts from this draft', async (kind) => {
  await splitSaved(['OUT017']);
  const [a, b] = parts();
  const ordinary = board.orders.find((o) => o.outletId === 'OUT016')!;
  const changed: DraftPlan = { ...empty(), trips: [trip(['OUT016']), { ...trip([], 'VEH024'), stops: [{ outletId: 'OUT017', orderIds: [a!.id] }, { outletId: 'OUT017', orderIds: [b!.id] }] }] };
  if (kind !== 'both moved') {
    const chosen = kind === 'first deferred' ? a!.id : b!.id;
    changed.trips[1]!.stops = changed.trips[1]!.stops.filter((s) => !s.orderIds.includes(chosen));
    changed.deferrals = [{ orderId: chosen, code: 'dispatcher_choice', reason: 'Next run.' }];
  }
  await save(changed);
  const history = await db.select().from(deferrals).where(and(eq(deferrals.orderId, board.orders.find((o) => o.outletId === 'OUT060' && o.carriedOver)!.id)));
  const res = await join(); expect(res.status).toBe(200); board = PlanBoard.parse(res.body);
  expect(parts()).toEqual([]); expect(board.orders.find((o) => o.id === originalId)).toBeDefined();
  expect(board.plan.trips[0]!.stops[0]!.orderIds).toEqual([ordinary.id]);
  expect(board.plan.trips[1]!.stops).toEqual([]); expect(board.plan.deferrals).toEqual([]);
  expect(board.plan.trips.flatMap((t) => t.stops.flatMap((s) => s.orderIds))).not.toContain(originalId);
  expect((await db.select().from(orders).where(eq(orders.id, originalId)))[0]).toMatchObject({ status: 'placed', revision: 2 });
  expect(await db.select().from(orderLines).where(inArray(orderLines.orderId, [a!.id, b!.id]))).toEqual([]);
  expect(await db.select().from(deferrals).where(eq(deferrals.orderId, history[0]!.orderId))).toEqual(history);
});

it('AC-21 gives a carried original its deferred status and keeps the old published history', async () => {
  originalId = board.orders.find((o) => o.outletId === 'OUT060' && o.carriedOver)!.id;
  const history = await db.select().from(deferrals).where(eq(deferrals.orderId, originalId));
  const res = await split(originalId, [{ productId: 'fresh-chilled-carton', quantity: 20 }]); expect(res.status).toBe(200); board = PlanBoard.parse(res.body);
  expect(parts().map((o) => o.timesDeferred)).toEqual([2, 2]);
  const joined = await join(); expect(joined.status).toBe(200); board = PlanBoard.parse(joined.body);
  expect((await db.select().from(orders).where(eq(orders.id, originalId)))[0]).toMatchObject({ status: 'deferred', revision: 2 });
  expect(board.orders.find((o) => o.id === originalId)!.timesDeferred).toBe(2);
  expect(await db.select().from(deferrals).where(eq(deferrals.orderId, originalId))).toEqual(history);
});

it.each(['not split', 'planned part', 'deferred part', 'other stop', 'other deferral', 'missing part'] as const)('AC-21 refuses join with %s and changes nothing', async (kind) => {
  if (kind !== 'not split') {
    await splitSaved(); const child = parts()[0]!;
    if (kind === 'planned part' || kind === 'deferred part') await db.update(orders).set({ status: kind === 'planned part' ? 'planned' : 'deferred' }).where(eq(orders.id, child.id));
    if (kind === 'missing part') {
      await db.delete(stopOrders).where(eq(stopOrders.orderId, child.id)); await db.delete(orders).where(eq(orders.id, child.id));
    }
    if (kind === 'other stop' || kind === 'other deferral') {
      const [other] = await db.insert(plans).values({ depotId: 'Peliyagoda', date: '2026-06-26' }).returning();
      if (kind === 'other deferral') await db.insert(deferrals).values({ planId: other!.id, orderId: child.id, code: 'window', reason: 'Next run.' });
      else {
        const [t] = await db.insert(trips).values({ planId: other!.id, vehicleId: 'VEH023', tripNo: 1 }).returning();
        const [s] = await db.insert(stops).values({ tripId: t!.id, outletId: 'OUT017', seq: 1 }).returning();
        await db.insert(stopOrders).values({ stopId: s!.id, orderId: child.id });
      }
    }
  }
  vi.mocked(announce).mockClear(); const before = await held();
  expect(code(await join())).toEqual([409, 'cannot_join']); expect(await held()).toEqual(before); expect(announce).not.toHaveBeenCalled();
});

it('AC-22 checks exact product sums, child count and nonempty parts', async () => {
  const { partsAddUp } = await import('../src/plans/split');
  const addsUp = () => db.transaction((tx) => partsAddUp(tx, originalId));
  expect(await addsUp()).toBe(false);
  await splitSaved(); expect(await addsUp()).toBe(true);
  const child = parts().find((p) => p.load.units === 75)!;
  await db.update(orderLines).set({ quantity: 49 }).where(and(eq(orderLines.orderId, child.id), eq(orderLines.productId, 'style-folded')));
  expect(await addsUp()).toBe(false);
  await db.update(orderLines).set({ quantity: 50 }).where(and(eq(orderLines.orderId, child.id), eq(orderLines.productId, 'style-folded')));
  await db.insert(orderLines).values({ orderId: child.id, productId: 'fresh-dry-carton', quantity: 1 });
  expect(await addsUp()).toBe(false);
  await db.delete(orderLines).where(and(eq(orderLines.orderId, child.id), eq(orderLines.productId, 'fresh-dry-carton')));
  const [extra] = await db.insert(orders).values({ outletId: 'OUT017', temp: 'dry', deliveryDate: DATE, status: 'placed', splitFrom: originalId }).returning();
  expect(await addsUp()).toBe(false);
  await db.delete(orders).where(eq(orders.id, extra!.id));
  await db.update(orderLines).set({ orderId: parts().find((p) => p.id !== child.id)!.id }).where(eq(orderLines.orderId, child.id));
  expect(await addsUp()).toBe(false);
});

it('AC-23 returns only the two parts on the shop open list', async () => {
  await splitSaved();
  const response = await ishara.get('/api/v1/store/orders?list=open'); expect(response.status).toBe(200);
  const list = StoreOrderList.parse(response.body);
  expect(list.orders.map((o) => o.id).sort()).toEqual(parts().map((o) => o.id).sort());
  expect(list.orders.map((o) => o.units).sort((a, b) => a - b)).toEqual([60, 75]);
  expect(list.orders.every((o) => o.status === 'placed')).toBe(true);
});

it('audits split and join and announces the depot and shop only after commit', async () => {
  let committed = false;
  const transaction = db.transaction.bind(db);
  const spy = vi.spyOn(db, 'transaction').mockImplementation((async (...args: Parameters<typeof db.transaction>) => {
    const result = await transaction(...args); committed = true; return result;
  }) as typeof db.transaction);
  vi.mocked(announce).mockImplementation(() => { expect(committed).toBe(true); });
  try {
    const response = await split(); expect(response.status).toBe(200); board = PlanBoard.parse(response.body);
    expect(announce).toHaveBeenCalledWith({ topic: 'plans', depotId: 'Peliyagoda' });
    expect(announce).toHaveBeenCalledWith({ topic: 'orders', depotId: 'Peliyagoda', outletId: 'OUT017' });
    committed = false; vi.mocked(announce).mockClear(); expect((await join()).status).toBe(200);
    expect(announce).toHaveBeenCalledWith({ topic: 'plans', depotId: 'Peliyagoda' });
    expect(announce).toHaveBeenCalledWith({ topic: 'orders', depotId: 'Peliyagoda', outletId: 'OUT017' });
    const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, originalId));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['order.split', 'order.joined']));
  } finally { spy.mockRestore(); }
});
