import { randomUUID } from 'node:crypto';
import { DriverDay, StoreDeliveries, type StoreDelivery } from '@wayfinder/contracts';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { auditLog, demoDay, issueLines, issues, orderLines, orders, phoneWrites, photos, stopOrders, stops, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { answeredTrip, driverScreen, driverStop, driverTrip, driverWrite, heldDriverRows, readyWalkthrough } from './driver-plan';
import { code, resetDay, signIn, THU, WED } from './loading-plan';
import { at, deliveredWalkthrough, jpeg, MORNING_DONE, photo, receiptOf, shopScreen, type ReceiptWalk } from './receipt-plan';
import { serve, stop } from './serve';

// Spec 015, AC-6 to AC-11: the shop confirms a delivery, with what is short, damaged or not cold, and every check.

const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at || clock.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async (original) => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const freeze = (date: string, minute: number) => { const instant = depotInstant(date, minute); testClock.at = instant.toISOString(); setClockForTests(instant); };
const app = createApp();
app.set('trust proxy', 'loopback');
const server = await serve(app);
const agentAt = (address: string) => request.agent(server).set('X-Forwarded-For', address);
const kasun = agentAt('192.0.2.51');
const ruwan = agentAt('192.0.2.52');
const nadeesha = agentAt('192.0.2.53');
const dilshan = agentAt('192.0.2.54');
const walk: ReceiptWalk = { nadeesha, ruwan, kasun, dilshan, freeze };
const shop = shopScreen(nadeesha);
const driver = driverScreen(dilshan);
let originalClock: typeof demoDay.$inferSelect;
let nadeeshaId: string;

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, username] of [[kasun, 'kasun'], [ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [dilshan, 'dilshan']] as const) await signIn(agent, username);
  nadeeshaId = (await db.select().from(users).where(eq(users.username, 'nadeesha')))[0]!.id;
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
const told = () => vi.mocked(announce).mock.calls.map(([change]) => change);
const auditsOf = (id: string) => db.select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'stop.received')));

// Nugegoda handed over at 03:38, the clock at Thu 08:30, and her delivery as her phone reads it.
async function toConfirm(options: Parameters<typeof deliveredWalkthrough>[1] = {}) {
  const trip = await deliveredWalkthrough(walk, options);
  const delivery = (await shop.read()).deliveries.find((each) => each.stopId === driverStop(trip, 1).id)!;
  return { trip, delivery };
}
// Sends a receipt with the server's clock at 08:33, announcing only once the transaction has committed.
async function sent(write: object) {
  freeze(THU, SENT);
  let committed = false;
  const transaction = db.transaction.bind(db);
  const spy = vi.spyOn(db, 'transaction').mockImplementation((async (...args: Parameters<typeof db.transaction>) => {
    const result = await transaction(...args); committed = true; return result;
  }) as typeof db.transaction);
  vi.mocked(announce).mockClear();
  vi.mocked(announce).mockImplementation(() => { expect(committed).toBe(true); });
  try { return await shop.send(write); }
  finally { spy.mockRestore(); vi.mocked(announce).mockImplementation(() => undefined); }
}
async function ordersAt(stopId: string) {
  const ids = (await db.select({ id: stopOrders.orderId }).from(stopOrders).where(eq(stopOrders.stopId, stopId))).map((row) => row.id);
  const rows = await db.select().from(orders);
  const lines = await db.select().from(orderLines);
  return { rows: rows.filter((order) => ids.includes(order.id)), lines: lines.filter((line) => ids.includes(line.orderId)) };
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

it('AC-6 confirms Nugegoda with 12, 8 and 3 and Yes: received at the time kept, sent at the server\'s clock, the chilled orders cold, its id kept, audited and announced after the commit', async () => {
  const { trip, delivery } = await toConfirm();
  const write = receiptOf(delivery, [12, 8, 3]);
  const before = await ordersAt(delivery.stopId);
  const res = await sent(write);
  expect(res.status).toBe(200);
  const answer = StoreDeliveries.parse(res.body);
  expect(answer.appliedWriteIds).toEqual([write.writeId]);
  expect(answer.deliveries).toEqual([{ ...delivery, revision: 3, lines: delivery.lines.map((line) => ({ ...line, received: line.delivered })),
    receipt: { at: at(8 * 60 + 31).toISOString(), sentAt: at(SENT).toISOString(), cold: true, report: null } }]);
  const after = await ordersAt(delivery.stopId);
  expect(after.rows.map((order) => [order.temp, order.status, order.receivedAt, order.receiptSentAt, order.arrivedCold, order.revision])).toEqual(before.rows.map((order) =>
    [order.temp, 'received', at(8 * 60 + 31), at(SENT), order.temp === 'chilled' ? true : null, order.revision + 1]));
  expect(after.lines.map((line) => [line.id, line.receivedQty]).sort()).toEqual(delivery.lines.map((line) => [line.lineId, line.delivered]).sort());
  expect((await db.select().from(stops).where(eq(stops.id, delivery.stopId)))[0]!.revision).toBe(3);
  expect(await db.select().from(phoneWrites).where(eq(phoneWrites.id, write.writeId))).toEqual([expect.objectContaining({ userId: nadeeshaId, tripId: trip.tripId, kind: 'receipt' })]);
  const audit = await auditsOf(delivery.stopId);
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({ actorId: nadeeshaId, entity: 'stop', before: { revision: 2 },
    after: { writeId: write.writeId, revision: 3, claimedAt: write.at, keptAt: at(8 * 60 + 31).toISOString(), cold: true, reason: null,
      counts: delivery.lines.map((line) => ({ lineId: line.lineId, received: line.delivered })) } });
  expect(await db.select().from(issues).where(eq(issues.kind, 'receipt'))).toEqual([]);
  expect(told()).toEqual([{ topic: 'orders', outletId: 'OUT001', depotId: 'Peliyagoda' }]);
});

it('AC-7 confirms 11, 8 and 3, Missing and Yes with a photo: the report with the write\'s id counting the 12-carton line at 1, its photo, and issues announced too', async () => {
  const { delivery } = await toConfirm();
  const write = receiptOf(delivery, [11, 8, 3], { reason: 'missing', photo });
  const res = await sent(write);
  expect(res.status).toBe(200);
  const [twelve] = delivery.lines;
  expect(StoreDeliveries.parse(res.body).deliveries[0]!.receipt).toEqual({ at: at(8 * 60 + 31).toISOString(), sentAt: at(SENT).toISOString(), cold: true,
    report: { id: write.writeId, reason: 'missing', lines: [{ lineId: twelve!.lineId, counted: 1, reason: 'missing' }], note: null, decision: null, decidedAt: null, replacement: null } });
  expect(await db.select().from(issues).where(eq(issues.id, write.writeId))).toEqual([expect.objectContaining({
    kind: 'receipt', reason: 'missing', status: 'open', revision: 0, stopId: delivery.stopId, raisedBy: nadeeshaId, raisedAt: at(8 * 60 + 31), note: null, decision: null })]);
  expect(await db.select().from(issueLines).where(eq(issueLines.issueId, write.writeId))).toEqual([{ issueId: write.writeId, orderLineId: twelve!.lineId, counted: 1, reason: 'missing' }]);
  expect(await db.select().from(photos).where(eq(photos.id, write.writeId))).toEqual([{ id: write.writeId, stopId: delivery.stopId, issueId: write.writeId, jpeg, takenBy: nadeeshaId, takenAt: at(8 * 60 + 31) }]);
  expect((await ordersAt(delivery.stopId)).rows.every((order) => order.status === 'received')).toBe(true);
  expect(told()).toEqual([{ topic: 'orders', outletId: 'OUT001', depotId: 'Peliyagoda' }, { topic: 'issues', depotId: 'Peliyagoda' }]);
  // The report is the dispatcher's: the driver's day still reads, with no shop's report among its problems.
  const day = DriverDay.parse((await dilshan.get('/api/v1/driver')).body);
  expect(day.trips.flatMap((trip) => trip.problems)).toEqual([]);
});

it('AC-8 makes No to the cold check, with every count full, a not_cold report counting the 12 and 8 chilled lines at 0, and the chilled orders not cold', async () => {
  const { delivery } = await toConfirm();
  const write = receiptOf(delivery, [12, 8, 3], { cold: false });
  expect((await sent(write)).status).toBe(200);
  const [twelve, eight] = delivery.lines;
  expect(await db.select().from(issues).where(eq(issues.id, write.writeId))).toEqual([expect.objectContaining({ kind: 'receipt', reason: 'not_cold', status: 'open' })]);
  expect((await db.select().from(issueLines).where(eq(issueLines.issueId, write.writeId))).map((line) => [line.orderLineId, line.counted]).sort())
    .toEqual([[twelve!.lineId, 0], [eight!.lineId, 0]].sort());
  expect((await ordersAt(delivery.stopId)).rows.map((order) => [order.temp, order.arrivedCold]).sort()).toEqual([['chilled', false], ['chilled', false], ['dry', null]]);
  expect(told()).toEqual([{ topic: 'orders', outletId: 'OUT001', depotId: 'Peliyagoda' }, { topic: 'issues', depotId: 'Peliyagoda' }]);
});

// A stop of 41 orders of one dry carton each at Fresh Nugegoda, handed over at 03:40, on VEH035's trip: a shop may
// place many orders for one day (spec 009), and a stop holds up to 300.
async function manyOrders(trip: { tripId: string }) {
  const made = await db.insert(orders).values(Array.from({ length: 41 }, (_, i) => ({ outletId: 'OUT001', deliveryDate: THU, temp: 'dry' as const, status: 'delivered' as const,
    placedAt: depotInstant(WED, 9 * 60 + i) }))).returning();
  await db.insert(orderLines).values(made.map((order) => ({ orderId: order.id, productId: 'fresh-dry-carton', quantity: 1, loadedQty: 1, deliveredQty: 1 })));
  const [made41] = await db.insert(stops).values({ tripId: trip.tripId, seq: 3, outletId: 'OUT001', loadedAt: at(2 * 60 + 30), arrivedAt: at(3 * 60 + 39), doneAt: at(3 * 60 + 40), outcome: 'delivered', revision: 2 }).returning();
  await db.insert(stopOrders).values(made.map((order) => ({ stopId: made41!.id, orderId: order.id })));
  return (await shop.read()).deliveries.find((delivery) => delivery.stopId === made41!.id)!;
}

it('AC-9 refuses every receipt that does not fit, with its sentence, and writes nothing', async () => {
  const { trip, delivery } = await toConfirm({ wellawatte: 'refused' });
  const dryOnly = await manyOrders(trip);
  const fine = receiptOf(delivery, [11, 8, 3], { reason: 'missing' });
  const lineOf = (i: number) => delivery.lines[i]!.lineId;
  const someFields = 'Some fields are missing or wrong.';
  await refused({ ...fine, lines: Array.from({ length: 6001 }, () => ({ lineId: randomUUID(), received: 1 })) }, 400, 'invalid_input', someFields);
  await refused({ ...fine, lines: [{ lineId: lineOf(0), received: 11 }, { lineId: lineOf(0), received: 11 }, { lineId: lineOf(2), received: 3 }] }, 400, 'invalid_input', someFields);
  await refused({ ...fine, lines: fine.lines.slice(0, 2) }, 400, 'invalid_input', 'Count every line of the delivery once.');
  await refused(receiptOf(delivery, [12, 8, 4]), 400, 'invalid_input', 'Count no more than was handed over on each line.');
  await refused(receiptOf(delivery, [12, 8, 3], { cold: null }), 400, 'invalid_input', 'Say whether the chilled goods were still cold.');
  await refused(receiptOf(dryOnly, dryOnly.lines.map(() => 1), { cold: true }), 400, 'invalid_input', 'Answer the cold check only when chilled goods came.');
  await refused(receiptOf(delivery, [11, 8, 3]), 400, 'invalid_input', 'Say what is wrong with the cartons that are short.');
  await refused(receiptOf(delivery, [12, 8, 3], { reason: 'damaged' }), 400, 'invalid_input', 'Say what is wrong only when a line is short.');
  await refused(receiptOf(delivery, [12, 8, 3], { photo }), 400, 'invalid_input', 'Add a photo only to a report.');
  const cut = `data:image/jpeg;base64,${jpeg.subarray(0, jpeg.length - 2).toString('base64')}`;
  await refused({ ...fine, photo: cut }, 400, 'invalid_input', 'The photo must be a whole JPEG of at most 500 KB.');
  await refused({ ...fine, photo: 'data:image/png;base64,iVBORw0KGgo=' }, 400, 'invalid_input', 'The photo must be a whole JPEG of at most 500 KB.');
  const elsewhere = driverStop(trip, 2).lines[0]!.lineId;
  const notHere = await refused({ ...fine, lines: [...fine.lines.slice(0, 2), { lineId: elsewhere, received: 3 }] }, 400, 'unknown_record', 'That line is not on this delivery.');
  expect(notHere.body.error.details).toEqual({ id: elsewhere });
});

it('takes a receipt of up to 2 MB on its route and refuses a bigger one as too large', async () => {
  const { delivery } = await toConfirm();
  // The largest legal receipt: 6,000 lines and a photo of 700,000 characters, about 1.1 MB. Its lines are not this
  // delivery's, so it is read whole and then refused for them, not for its size.
  const largest = { ...receiptOf(delivery, [11, 8, 3], { reason: 'missing' }), lines: Array.from({ length: 6000 }, () => ({ lineId: randomUUID(), received: 999 })),
    photo: `data:image/jpeg;base64,${'A'.repeat(700_000 - 23)}` };
  expect(JSON.stringify(largest).length).toBeGreaterThan(1_000_000);
  expect(code(await shop.send(largest))).toEqual([400, 'unknown_record']);
  const tooBig = { ...largest, padding: 'x'.repeat(2_100_000) };
  expect(code(await shop.send(tooBig))).toEqual([413, 'too_large']);
  // Every other route keeps its 1 MB.
  expect(code(await nadeesha.put('/api/v1/store/next-order/draft').send({ padding: 'x'.repeat(1_100_000) }))).toEqual([413, 'too_large']);
});

it('AC-10 refuses a receipt for a stop not handed over, or a closed one, with not_delivered, and changes nothing', async () => {
  await readyWalkthrough(walk);
  let trip = driverTrip(await driver.read());
  for (const [kind, minute, seq] of [['start', 3 * 60 + 31, undefined], ['arrive', 3 * 60 + 34, 1]] as const) {
    freeze(THU, minute);
    trip = answeredTrip(await driver.send(driverWrite(trip, kind, at(minute).toISOString(), seq)));
  }
  freeze(THU, MORNING_DONE);
  const asDelivery = (tripNow: typeof trip): StoreDelivery => {
    const stop1 = driverStop(tripNow, 1);
    return { stopId: stop1.id, revision: stop1.revision, day: THU, vehicleId: 'VEH035', driver: 'Dilshan', arrivedAt: stop1.arrivedAt!, doneAt: stop1.arrivedAt!, outcome: 'delivered', late: false,
      refusalReason: null, receipt: null, lines: stop1.lines.map((line) => ({ lineId: line.lineId, orderId: line.orderId, temp: line.temp, productId: line.productId, name: line.name,
        unit: line.unit, ordered: line.quantity, loaded: line.loaded!, delivered: line.loaded!, received: null })) };
  };
  const arrived = await refused(receiptOf(asDelivery(trip), [12, 8, 3]), 409, 'not_delivered', 'This delivery has not been handed over.');
  expect(arrived.body.error.details).toBeUndefined();
  freeze(THU, 3 * 60 + 38);
  trip = answeredTrip(await driver.send(driverWrite(trip, 'closed', at(3 * 60 + 38).toISOString(), 1)));
  freeze(THU, MORNING_DONE);
  await refused(receiptOf(asDelivery(trip), [12, 8, 3]), 409, 'not_delivered', 'This delivery has not been handed over.');
});

it('AC-11 takes a receipt that names all 41 lines of a stop of 41 orders and writes each line\'s count', async () => {
  const { trip } = await toConfirm();
  const many = await manyOrders(trip);
  expect(many.lines).toHaveLength(41);
  const counts = many.lines.map((_, i) => (i % 2 === 0 ? 1 : 0));
  const res = await sent(receiptOf(many, counts, { reason: 'damaged' }));
  expect(res.status).toBe(200);
  const lines = await db.select().from(orderLines);
  expect(many.lines.map((line) => lines.find((row) => row.id === line.lineId)!.receivedQty)).toEqual(counts);
  expect(StoreDeliveries.parse(res.body).deliveries.find((delivery) => delivery.stopId === many.stopId)!.receipt!.report!.lines).toHaveLength(20);
});
