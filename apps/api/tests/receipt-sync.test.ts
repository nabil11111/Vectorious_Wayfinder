import { receiptView, StoreDeliveries, type StoreDelivery } from '@wayfinder/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool, type Tx } from '../src/db/client';
import { clearDemoDay, seedDemoDay } from '../src/db/demo-day';
import { auditLog, demoDay, issueLines, issues, orderLines, orders, phoneWrites, photos, plans, stopOrders, stops, trips } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { driverStop, heldDriverRows } from './driver-plan';
import { code, resetDay, signIn, THU, WED } from './loading-plan';
import { at, deliveredWalkthrough, HANDED_OVER, photo, receiptOf, shopScreen, type ReceiptWalk } from './receipt-plan';
import { serve, stop } from './serve';

// Spec 015, AC-12 to AC-20: a receipt is applied once by its id, judged on what the trip's lock lets it read, kept in
// time, listed when its answer is lost, and takes turns with a reset.

const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at || clock.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async (original) => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const setInstant = (instant: string) => { testClock.at = instant; setClockForTests(new Date(instant)); };
const freeze = (date: string, minute: number) => setInstant(depotInstant(date, minute).toISOString());
const app = createApp();
app.set('trust proxy', 'loopback');
const server = await serve(app);
const agentAt = (address: string) => request.agent(server).set('X-Forwarded-For', address);
const kasun = agentAt('192.0.2.61');
const ruwan = agentAt('192.0.2.62');
const nadeesha = agentAt('192.0.2.63');
const dilshan = agentAt('192.0.2.64');
const walk: ReceiptWalk = { nadeesha, ruwan, kasun, dilshan, freeze };
const shop = shopScreen(nadeesha);
let originalClock: typeof demoDay.$inferSelect;

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, username] of [[kasun, 'kasun'], [ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [dilshan, 'dilshan']] as const) await signIn(agent, username);
});
beforeEach(async () => {
  await resetDay();
  await initClock();
  freeze(WED, 16 * 60);
  vi.mocked(announce).mockReset();
});
afterAll(async () => {
  await resetDay();
  await db.update(demoDay).set(originalClock);
  testClock.at = '';
  setClockForTests(null);
  await stop(server);
  await pool.end();
});

const SENT = 8 * 60 + 33;
const auditsOf = (id: string) => db.select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'stop.received')));
const answered = (res: request.Response) => {
  expect(res.status).toBe(200);
  return StoreDeliveries.parse(res.body);
};
async function toConfirm(options: Parameters<typeof deliveredWalkthrough>[1] = {}) {
  const trip = await deliveredWalkthrough(walk, options);
  const delivery = (await shop.read()).deliveries.find((each) => each.stopId === driverStop(trip, 1).id)!;
  return { trip, delivery };
}
// The only row field a repeat may change is its id's real answered time.
async function durableRows() {
  const held = await heldDriverRows();
  return { ...held, writes: held.writes.map(({ answeredAt: _answeredAt, ...write }) => write) };
}
async function refused(body: object, status: number, error: string, message?: string) {
  const before = await heldDriverRows();
  vi.mocked(announce).mockClear();
  const res = await shop.send(body);
  expect(code(res)).toEqual([status, error]);
  // The sentence the screen shows as it is, when the test names it.
  if (message !== undefined) expect(res.body.error.message).toBe(message);
  expect(await heldDriverRows()).toEqual(before);
  expect(announce).not.toHaveBeenCalled();
  return res;
}

it('AC-12 answers a receipt sent again with the deliveries as they are, and applies two copies sent at once once, with one audit row', async () => {
  const { delivery } = await toConfirm();
  const write = receiptOf(delivery, [11, 8, 3], { reason: 'missing', photo });
  freeze(THU, SENT);
  vi.mocked(announce).mockClear();
  const responses = await Promise.all([shop.send(write), shop.send(write)]);
  const now = await shop.read();
  for (const res of responses) expect(answered(res)).toEqual(now);
  expect(now.appliedWriteIds).toEqual([write.writeId]);
  expect(await auditsOf(delivery.stopId)).toHaveLength(1);
  expect(await db.select().from(issues).where(eq(issues.kind, 'receipt'))).toHaveLength(1);
  expect(vi.mocked(announce).mock.calls.filter(([change]) => change.topic === 'orders')).toHaveLength(1);
  const before = await durableRows();
  vi.mocked(announce).mockClear();
  // Its keys in another order are the same receipt.
  for (const again of [write, Object.fromEntries(Object.entries(write).reverse())]) expect(answered(await shop.send(again))).toEqual(now);
  expect(await durableRows()).toEqual(before);
  expect(announce).not.toHaveBeenCalled();
});

it('AC-13 refuses a receipt\'s id sent again with other counts, and a driver write\'s id, as write_reused, and changes nothing', async () => {
  const { delivery } = await toConfirm();
  const write = receiptOf(delivery, [11, 8, 3], { reason: 'missing' });
  freeze(THU, SENT);
  answered(await shop.send(write));
  const ten = await refused({ ...write, lines: [{ ...write.lines[0]!, received: 10 }, ...write.lines.slice(1)] }, 409, 'write_reused', 'This record was already sent with other details.');
  expect(ten.body.error.details).toEqual({ writeId: write.writeId });
  const [delivered] = await db.select().from(phoneWrites).where(eq(phoneWrites.kind, 'deliver'));
  const driverId = await refused({ ...write, writeId: delivered!.id }, 409, 'write_reused', 'This record was already sent with other details.');
  expect(driverId.body.error.details).toEqual({ writeId: delivered!.id });
});

it('AC-13 refuses a driver write\'s id on a delivery not confirmed yet, and changes nothing', async () => {
  const { delivery } = await toConfirm();
  const [arrival] = await db.select().from(phoneWrites).where(eq(phoneWrites.kind, 'arrive'));
  freeze(THU, SENT);
  await refused(receiptOf(delivery, [12, 8, 3], { writeId: arrival!.id }), 409, 'write_reused');
});

it('AC-14 refuses a new receipt for a delivery already confirmed as stale, whichever revision it names, and a receipt naming an old revision before that', async () => {
  const { delivery } = await toConfirm();
  freeze(THU, SENT);
  await refused(receiptOf({ ...delivery, revision: 1 }, [12, 8, 3]), 409, 'stale', 'This delivery changed after this phone read it.');
  answered(await shop.send(receiptOf(delivery, [12, 8, 3])));
  for (const revision of [3, 2]) await refused(receiptOf({ ...delivery, revision }, [11, 8, 3], { reason: 'missing' }), 409, 'stale', 'This delivery was already confirmed.');
});

it('AC-15 applies exactly one of two receipts for stop 1 sent at once and refuses the other as already confirmed', async () => {
  const { delivery } = await toConfirm();
  freeze(THU, SENT);
  const writes = [receiptOf(delivery, [11, 8, 3], { reason: 'missing' }), receiptOf(delivery, [12, 8, 3])];
  const responses = await Promise.all(writes.map((write) => shop.send(write)));
  expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
  const lost = responses.find((res) => res.status === 409)!;
  expect(lost.body.error).toMatchObject({ code: 'stale', message: 'This delivery was already confirmed.' });
  const winner = writes[responses.findIndex((res) => res.status === 200)]!;
  const lines = await db.select().from(orderLines).where(inArray(orderLines.id, delivery.lines.map((line) => line.lineId)));
  expect(delivery.lines.map((line) => lines.find((row) => row.id === line.lineId)!.receivedQty)).toEqual(winner.lines.map((line) => line.received));
  expect(await auditsOf(delivery.stopId)).toHaveLength(1);
  expect((await db.select().from(issues).where(eq(issues.kind, 'receipt'))).length).toBeLessThanOrEqual(1);
  expect((await db.select().from(phoneWrites).where(eq(phoneWrites.kind, 'receipt'))).map((row) => row.id)).toEqual([winner.writeId]);
});

it('AC-16 judges a receipt that waited behind a driver\'s write on the trip on the stop as that write left it, and takes its time sent from the clock read then', async () => {
  const trip = await deliveredWalkthrough(walk, { stopAt: 'arrived' });
  const stop1 = driverStop(trip, 1);
  freeze(THU, SENT);
  let release!: () => void;
  let locked!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const acquired = new Promise<void>((resolve) => { locked = resolve; });
  // The trip held in a transaction of its own while it writes stop 1 as Nugegoda's delivery leaves it.
  const first = db.transaction(async (tx) => {
    await tx.select().from(trips).where(eq(trips.id, trip.tripId)).for('update');
    await tx.update(stops).set({ outcome: 'delivered', doneAt: at(HANDED_OVER), revision: stop1.revision + 1 }).where(eq(stops.id, stop1.id));
    for (const line of stop1.lines) await tx.update(orderLines).set({ deliveredQty: line.loaded }).where(eq(orderLines.id, line.lineId));
    await tx.update(orders).set({ status: 'delivered' }).where(inArray(orders.id, [...new Set(stop1.lines.map((line) => line.orderId))]));
    locked();
    await held;
  });
  await acquired;
  const handedOver: StoreDelivery = { stopId: stop1.id, revision: stop1.revision + 1, day: THU, vehicleId: 'VEH035', driver: 'Dilshan', arrivedAt: stop1.arrivedAt!,
    doneAt: at(HANDED_OVER).toISOString(), outcome: 'delivered', late: false, refusalReason: null, receipt: null,
    lines: stop1.lines.map((line) => ({ lineId: line.lineId, orderId: line.orderId, temp: line.temp, productId: line.productId, name: line.name, unit: line.unit,
      ordered: line.quantity, loaded: line.loaded!, delivered: line.loaded!, received: null })) };
  const write = receiptOf(handedOver, [12, 8, 3]);
  const waiting = shop.send(write).then((res) => res);
  try {
    await vi.waitFor(async () => {
      const { rows } = await db.execute(sql`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%trips%' and query like '%for update%'`);
      expect(rows).toHaveLength(1);
    });
    freeze(THU, SENT + 1);
  } finally { release(); await first; }
  const confirmed = answered(await waiting).deliveries.find((delivery) => delivery.stopId === stop1.id)!;
  expect(confirmed.receipt).toEqual({ at: at(8 * 60 + 31).toISOString(), sentAt: at(SENT + 1).toISOString(), cold: true, report: null });
  expect(confirmed.lines.map((line) => [line.delivered, line.received])).toEqual([[12, 12], [8, 8], [3, 3]]);
  const rows = await db.select().from(orders).where(inArray(orders.id, [...new Set(stop1.lines.map((line) => line.orderId))]));
  expect(rows.map((order) => [order.status, order.receiptSentAt])).toEqual(rows.map(() => ['received', at(SENT + 1)]));
});

it('AC-17 lists a receipt whose answer was lost so the phone takes it off its queue, and lists one answered 49 hours ago again once it is sent again', async () => {
  const { delivery } = await toConfirm();
  const write = receiptOf(delivery, [11, 8, 3], { reason: 'missing' });
  freeze(THU, SENT);
  answered(await shop.send(write)); // The phone never receives this answer.
  const fetched = await shop.read();
  expect(fetched.appliedWriteIds).toEqual([write.writeId]);
  const view = receiptView(fetched, [write]);
  expect(view.writes).toEqual([]);
  expect(view.deliveries.deliveries[0]!.receipt).toMatchObject({ at: at(8 * 60 + 31).toISOString(), sentAt: at(SENT).toISOString(), report: { id: write.writeId } });
  await db.update(phoneWrites).set({ answeredAt: sql`now() - interval '49 hours'` }).where(eq(phoneWrites.id, write.writeId));
  expect((await shop.read()).appliedWriteIds).toEqual([]);
  const before = await durableRows();
  vi.mocked(announce).mockClear();
  const again = answered(await shop.send(write));
  expect(again.appliedWriteIds).toEqual([write.writeId]);
  expect((await shop.read()).appliedWriteIds).toEqual([write.writeId]);
  expect(await durableRows()).toEqual(before);
  expect(announce).not.toHaveBeenCalled();
});

it.each([
  { phone: 8 * 60 + 31, kept: 8 * 60 + 31 },
  { phone: 8 * 60 + 40, kept: SENT },
  { phone: 3 * 60 + 30, kept: HANDED_OVER },
])('AC-18 keeps the phone\'s minute $phone as $kept between the handover and the server\'s clock, leaves the trip\'s last event alone and audits both', async ({ phone, kept }) => {
  const { trip, delivery } = await toConfirm();
  const lastEvent = (await db.select().from(trips).where(eq(trips.id, trip.tripId)))[0]!.lastEventAt;
  const write = receiptOf(delivery, [12, 8, 3], { at: at(phone).toISOString() });
  freeze(THU, SENT);
  const receipt = answered(await shop.send(write)).deliveries[0]!.receipt;
  expect(receipt).toMatchObject({ at: at(kept).toISOString(), sentAt: at(SENT).toISOString() });
  expect((await db.select().from(orders).where(inArray(orders.id, delivery.lines.map((line) => line.orderId)))).map((order) => [order.receivedAt, order.receiptSentAt]))
    .toEqual(delivery.lines.map(() => [at(kept), at(SENT)]));
  expect((await db.select().from(trips).where(eq(trips.id, trip.tripId)))[0]!.lastEventAt).toEqual(lastEvent);
  expect(lastEvent).toEqual(at(HANDED_OVER));
  expect((await auditsOf(delivery.stopId))[0]!.after).toMatchObject({ writeId: write.writeId, claimedAt: at(phone).toISOString(), keptAt: at(kept).toISOString() });
});

it.each([
  { name: 'missing with a photo', counts: [11, 8, 3], more: { reason: 'missing' as const, photo } },
  { name: 'not cold, with an instant of no milliseconds', counts: [12, 8, 3], more: { cold: false, at: at(8 * 60 + 31).toISOString().replace('.000Z', 'Z') } },
  { name: 'damaged on two lines, with an instant of six fraction digits', counts: [10, 8, 2], more: { reason: 'damaged' as const, at: at(8 * 60 + 31).toISOString().replace('.000Z', '.123456Z') } },
])('AC-19 answers the walkthrough\'s receipt, $name, as receiptView of the deliveries before it and the receipt, apart from its time sent', async ({ counts, more }) => {
  const { delivery } = await toConfirm({ wellawatte: 'refused' });
  const before = await shop.read();
  const write = receiptOf(delivery, counts, more);
  freeze(THU, SENT);
  const answer = answered(await shop.send(write));
  const expected = receiptView(before, [write]).deliveries;
  expect(answer.deliveries.map((each) => each.receipt?.sentAt ?? null)).toEqual([at(SENT).toISOString()]);
  expect({ ...answer, deliveries: answer.deliveries.map((each) => ({ ...each, receipt: each.receipt && { ...each.receipt, sentAt: null } })) }).toEqual(expected);
});

async function rowsWithin(tx: Tx) {
  return {
    plans: await tx.select().from(plans).orderBy(plans.id), trips: await tx.select().from(trips).orderBy(trips.id),
    stops: await tx.select().from(stops).orderBy(stops.id), orders: await tx.select().from(orders).orderBy(orders.id),
    lines: await tx.select().from(orderLines).orderBy(orderLines.id), issues: await tx.select().from(issues).orderBy(issues.id),
    issueLines: await tx.select().from(issueLines).orderBy(issueLines.issueId, issueLines.orderLineId),
    audits: await tx.select().from(auditLog).orderBy(auditLog.id), writes: await tx.select().from(phoneWrites).orderBy(phoneWrites.id),
    photos: await tx.select().from(photos).orderBy(photos.id),
  };
}

it('AC-20 finishes a receipt and a demo reset sent at once without a deadlock', async () => {
  const { delivery } = await toConfirm();
  freeze(THU, SENT);
  const [reset, result] = await Promise.all([kasun.post('/api/v1/demo/reset').send({}), shop.send(receiptOf(delivery, [12, 8, 3]))]);
  expect(reset.status).toBe(200);
  expect([200, 400]).toContain(result.status);
  if (result.status === 400) expect(result.body.error).toMatchObject({ code: 'unknown_record', message: 'That delivery is not on your list.', details: { id: delivery.stopId } });
});

it('AC-20 refuses a receipt that waited for a reset which committed first with unknown_record, and changes nothing', async () => {
  const { delivery } = await toConfirm();
  freeze(THU, SENT);
  let release!: () => void;
  let resetting!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const cleared = new Promise<void>((resolve) => { resetting = resolve; });
  let expected!: Awaited<ReturnType<typeof rowsWithin>>;
  const reset = db.transaction(async (tx) => {
    await tx.select().from(demoDay).for('update');
    await clearDemoDay(tx);
    await seedDemoDay(tx);
    expected = await rowsWithin(tx);
    resetting();
    await held;
  });
  await cleared;
  const waiting = shop.send(receiptOf(delivery, [12, 8, 3])).then((res) => res);
  try {
    await vi.waitFor(async () => {
      const { rows } = await db.execute(sql`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%demo_day%'`);
      expect(rows).toHaveLength(1);
    });
  } finally { release(); await reset; }
  const res = await waiting;
  expect(code(res)).toEqual([400, 'unknown_record']);
  expect(res.body.error.details).toEqual({ id: delivery.stopId });
  expect(await heldDriverRows()).toEqual(expected);
});

it('AC-20 lets a receipt commit before a reset that waits for it', async () => {
  const { delivery } = await toConfirm();
  freeze(THU, SENT);
  const write = receiptOf(delivery, [11, 8, 3], { reason: 'missing' });
  let release!: () => void;
  let applied!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const completed = new Promise<void>((resolve) => { applied = resolve; });
  const transaction = db.transaction.bind(db);
  const spy = vi.spyOn(db, 'transaction').mockImplementationOnce((async (work: (tx: Tx) => Promise<unknown>, options?: Parameters<typeof db.transaction>[1]) =>
    transaction(async (tx) => { const answer = await work(tx); applied(); await held; return answer; }, options)) as typeof db.transaction);
  const writing = shop.send(write).then((res) => res);
  await completed;
  spy.mockRestore();
  const resetting = kasun.post('/api/v1/demo/reset').send({}).then((res) => res);
  try {
    await vi.waitFor(async () => {
      const { rows } = await db.execute(sql`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%demo_day%'`);
      expect(rows).toHaveLength(1);
    });
  } finally { release(); }
  const [written, reset] = await Promise.all([writing, resetting]);
  expect(written.status).toBe(200);
  expect(reset.status).toBe(200);
  expect(await auditsOf(delivery.stopId)).toHaveLength(1);
  expect(await db.select().from(stops).where(eq(stops.id, delivery.stopId))).toEqual([]);
  expect(await db.select().from(phoneWrites).where(eq(phoneWrites.id, write.writeId))).toEqual([]);
  expect(await db.select().from(stopOrders).where(eq(stopOrders.stopId, delivery.stopId))).toEqual([]);
});
