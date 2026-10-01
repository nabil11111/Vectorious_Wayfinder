import { randomUUID } from 'node:crypto';
import { DecideIssueResponse, DriverDay, IssueList, StoreNextOrder, type IssueDecision } from '@wayfinder/contracts';
import { and, eq, isNotNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { demoId } from '../src/db/demo-day';
import { auditLog, demoDay, issueLines, issues, orderLines, orders, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { factsOf } from '../src/orders/order-facts';
import { driverStop, heldDriverRows } from './driver-plan';
import { code, kandyTrip, resetDay, signIn, THU, WED } from './loading-plan';
import { at, deliveredWalkthrough, photo, receiptOf, shopScreen, type ReceiptWalk } from './receipt-plan';
import { serve, stop } from './serve';

// Spec 015, AC-21 to AC-27: what needs the dispatcher after a shop's report, and his answers to it and to a driver's
// refusal: "Send N replacements", which places the shop's replacements (D-59), and "No replacement".

const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at || clock.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async (original) => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const freeze = (date: string, minute: number) => { const instant = depotInstant(date, minute); testClock.at = instant.toISOString(); setClockForTests(instant); };
const FRI = '2026-06-26';
const SAT = '2026-06-27';
const app = createApp();
app.set('trust proxy', 'loopback');
const server = await serve(app);
const agentAt = (address: string) => request.agent(server).set('X-Forwarded-For', address);
const kasun = agentAt('192.0.2.71');
const ruwan = agentAt('192.0.2.72');
const nadeesha = agentAt('192.0.2.73');
const dilshan = agentAt('192.0.2.74');
const walk: ReceiptWalk = { nadeesha, ruwan, kasun, dilshan, freeze };
const shop = shopScreen(nadeesha);
let originalClock: typeof demoDay.$inferSelect;
let ruwanId: string;
let nadeeshaId: string;

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, username] of [[kasun, 'kasun'], [ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [dilshan, 'dilshan']] as const) await signIn(agent, username);
  ruwanId = (await db.select().from(users).where(eq(users.username, 'ruwan')))[0]!.id;
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
const ANSWERED = 8 * 60 + 35;
const told = () => vi.mocked(announce).mock.calls.map(([change]) => change);
const WELLAWATTE_CHILLED = demoId('order', `${THU}:OUT002:chilled`);
const replacementsOf = (issueId: string) => db.select().from(orders).where(eq(orders.replacesIssueId, issueId)).orderBy(orders.temp);

// Nadeesha's receipt sent at 08:33, as her phone made it at 08:31.
async function reported(counts: number[], more: Parameters<typeof receiptOf>[2], options: Parameters<typeof deliveredWalkthrough>[1] = {}) {
  const trip = await deliveredWalkthrough(walk, options);
  const delivery = (await shop.read()).deliveries.find((each) => each.stopId === driverStop(trip, 1).id)!;
  const write = receiptOf(delivery, counts, more);
  freeze(THU, SENT);
  expect((await shop.send(write)).status).toBe(200);
  return { trip, delivery, write };
}
async function needsRuwan() {
  const res = await ruwan.get('/api/v1/issues');
  expect(res.status).toBe(200);
  return IssueList.parse(res.body);
}
async function openOne(id: string) {
  const open = (await needsRuwan()).issues.find((problem) => problem.id === id);
  if (!open) throw new Error(`Problem ${id} is not open.`);
  return open;
}
const decide = (id: string, revision: number, decision: string) => ruwan.post(`/api/v1/issues/${id}/decide`).send({ revision, decision });
// An answer at the clock's minute, announcing only once its transaction has committed.
async function answer(id: string, decision: IssueDecision, minute = ANSWERED, date = THU) {
  const open = await openOne(id);
  freeze(date, minute);
  let committed = false;
  const transaction = db.transaction.bind(db);
  const spy = vi.spyOn(db, 'transaction').mockImplementation((async (...args: Parameters<typeof db.transaction>) => {
    const result = await transaction(...args); committed = true; return result;
  }) as typeof db.transaction);
  vi.mocked(announce).mockClear();
  vi.mocked(announce).mockImplementation(() => { expect(committed).toBe(true); });
  try {
    const res = await decide(id, open.revision, decision);
    expect(res.status, JSON.stringify(res.body.error)).toBe(200);
    return { open, result: DecideIssueResponse.parse(res.body) };
  } finally { spy.mockRestore(); vi.mocked(announce).mockImplementation(() => undefined); }
}
async function refusedAnswer(id: string, revision: number, decision: string, status: number, error: string, message?: string) {
  const before = await heldDriverRows();
  vi.mocked(announce).mockClear();
  const res = await decide(id, revision, decision);
  expect(code(res)).toEqual([status, error]);
  // The sentence the screen shows as it is, when the test names it.
  if (message !== undefined) expect(res.body.error.message).toBe(message);
  expect(await heldDriverRows()).toEqual(before);
  expect(announce).not.toHaveBeenCalled();
}
const nextOrder = async () => StoreNextOrder.parse((await nadeesha.get('/api/v1/store/next-order')).body);

it('AC-21 lists Nadeesha\'s report for Ruwan with its people, time, photo and cold check, the truck and stop, the line received 11 of 12, and Fri 26 Jun to replace on', async () => {
  const { trip, delivery, write } = await reported([11, 8, 3], { reason: 'missing', photo });
  const twelve = delivery.lines[0]!;
  const before = await heldDriverRows();
  const list = await needsRuwan();
  expect(list).toEqual({ day: THU, replaceOn: FRI, issues: [{
    id: write.writeId, revision: 0, kind: 'receipt', reason: 'missing', status: 'open', raisedBy: 'Nadeesha', raisedAt: at(8 * 60 + 31).toISOString(), note: null,
    decision: null, decidedBy: null, decidedAt: null, hasPhoto: true, short: 1, cold: true, replacement: null,
    trip: { id: trip.tripId, vehicleId: 'VEH035', tripNo: 1, leavesAt: at(4 * 60 + 36).toISOString(), status: 'out', driver: 'Dilshan', stopsLeft: 1 },
    stop: { id: delivery.stopId, seq: 1, outletId: 'OUT001', shopName: 'Fresh Nugegoda', arrivedAt: at(3 * 60 + 34).toISOString(), doneAt: at(3 * 60 + 38).toISOString(),
      loadedAt: at(2 * 60 + 34).toISOString(), flaggedAtDock: true },
    lines: [{ lineId: twelve.lineId, orderId: twelve.orderId, temp: 'chilled', productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton',
      quantity: 12, counted: 1, loaded: 12, delivered: 12, received: 11 }],
  }] });
  expect(await heldDriverRows()).toEqual(before);
});

it('AC-21 reads a not-cold report as not cold, counting its chilled lines at 0, and short of nothing', async () => {
  const { write } = await reported([12, 8, 3], { cold: false });
  const report = await openOne(write.writeId);
  expect(report).toMatchObject({ reason: 'not_cold', cold: false, short: 0, hasPhoto: false });
  expect(report.lines.map((line) => [line.quantity, line.counted, line.received])).toEqual([[12, 0, 12], [8, 0, 8]]);
});

it('AC-22 answers the report "Send 1 replacement": a placed chilled order for OUT001 for Fri 26 Jun by Ruwan pointing at it, the problem decided with it, audited and announced', async () => {
  const { write } = await reported([11, 8, 3], { reason: 'missing', photo });
  const { open, result } = await answer(write.writeId, 'send_replacements');
  const made = await replacementsOf(write.writeId);
  expect(made).toEqual([expect.objectContaining({ outletId: 'OUT001', deliveryDate: FRI, temp: 'chilled', status: 'placed', placedAt: at(ANSWERED), placedBy: ruwanId,
    createdBy: ruwanId, replacesIssueId: write.writeId, splitFrom: null, driverNote: null, revision: 0 })]);
  expect((await db.select().from(orderLines).where(eq(orderLines.orderId, made[0]!.id))).map((line) => [line.productId, line.quantity])).toEqual([['fresh-chilled-carton', 1]]);
  expect(result).toEqual({ day: THU, replaceOn: FRI, issues: [], decided: { ...open, status: 'decided', revision: 1, decision: 'send_replacements', decidedBy: 'Ruwan',
    decidedAt: at(ANSWERED).toISOString(), replacement: { day: FRI, units: 1 } } });
  expect((await db.select().from(issues).where(eq(issues.id, write.writeId)))[0]).toMatchObject({ status: 'decided', decision: 'send_replacements', decidedBy: ruwanId, decidedAt: at(ANSWERED), revision: 1 });
  const audit = await db.select().from(auditLog).where(and(eq(auditLog.entityId, write.writeId), eq(auditLog.action, 'issue.decided')));
  expect(audit).toEqual([expect.objectContaining({ actorId: ruwanId, before: { status: 'open', revision: 0 },
    after: expect.objectContaining({ status: 'decided', decision: 'send_replacements', revision: 1, replacements: [made[0]!.id] }) })]);
  expect(told()).toEqual([{ topic: 'issues', depotId: 'Peliyagoda' }, { topic: 'orders', outletId: 'OUT001', depotId: 'Peliyagoda' }]);
  // Nadeesha's open list holds it, replacing Thursday's delivery, and her next order, for Friday, never counts it.
  const replacement = (await shop.list('open')).orders.find((order) => order.id === made[0]!.id);
  expect(replacement).toMatchObject({ deliveryDate: FRI, temp: 'chilled', status: 'placed', units: 1, replacementFor: THU, placedAt: at(ANSWERED).toISOString() });
  const next = await nextOrder();
  expect(next.deliveryDate).toBe(FRI);
  expect(next.placed).toBeNull();
});

it('AC-23 answers the report "No replacement": decided, no order placed, and issues and orders announced', async () => {
  const { write } = await reported([11, 8, 3], { reason: 'damaged' });
  const { result } = await answer(write.writeId, 'no_replacement');
  expect(result.decided).toMatchObject({ status: 'decided', decision: 'no_replacement', decidedBy: 'Ruwan', replacement: null });
  expect(await db.select().from(orders).where(isNotNull(orders.replacesIssueId))).toEqual([]);
  expect(told()).toEqual([{ topic: 'issues', depotId: 'Peliyagoda' }, { topic: 'orders', outletId: 'OUT001', depotId: 'Peliyagoda' }]);
});

it('AC-24 answers Wellawatte\'s refusal "Send 2 replacements": a chilled order of 2 for OUT002 for Fri 26 Jun, the trip as it was, the answer on Dilshan\'s day and on the order\'s card', async () => {
  const trip = await deliveredWalkthrough(walk, { wellawatte: 'refused' });
  const refusal = trip.problems[0]!;
  const before = await heldDriverRows();
  const { result } = await answer(refusal.id, 'send_replacements', 3 * 60 + 52);
  const made = await replacementsOf(refusal.id);
  expect(made).toEqual([expect.objectContaining({ outletId: 'OUT002', deliveryDate: FRI, temp: 'chilled', status: 'placed', placedAt: at(3 * 60 + 52), placedBy: ruwanId, replacesIssueId: refusal.id })]);
  expect((await db.select().from(orderLines).where(eq(orderLines.orderId, made[0]!.id))).map((line) => [line.productId, line.quantity])).toEqual([['fresh-chilled-carton', 2]]);
  expect(result.decided).toMatchObject({ id: refusal.id, kind: 'refused', status: 'decided', decision: 'send_replacements', replacement: { day: FRI, units: 2 } });
  const after = await heldDriverRows();
  for (const key of ['trips', 'stops', 'writes', 'photos'] as const) expect(after[key]).toEqual(before[key]);
  expect(after.orders.filter((order) => order.id !== made[0]!.id)).toEqual(before.orders);
  const seen = DriverDay.parse((await dilshan.get('/api/v1/driver')).body).trips[0]!.problems;
  expect(seen).toEqual([{ ...refusal, decision: 'send_replacements', decidedBy: 'Ruwan', decidedAt: at(3 * 60 + 52).toISOString() }]);
  freeze(THU, 9 * 60);
  const card = (await factsOf(db, 'OUT002', [WELLAWATTE_CHILLED])).get(WELLAWATTE_CHILLED)!;
  expect(card.problems).toEqual([{ id: refusal.id, kind: 'refused', units: 2, decision: 'send_replacements', replacementDay: FRI }]);
  expect(told()).toEqual([{ topic: 'issues', depotId: 'Peliyagoda' }, { topic: 'driver', depotId: 'Peliyagoda' }, { topic: 'orders', outletId: 'OUT002', depotId: 'Peliyagoda' }]);
});

it('AC-25 answers a report of 1 chilled and 1 dry carton short with two orders, one per temperature', async () => {
  const { delivery, write } = await reported([11, 8, 2], { reason: 'missing' });
  const { result } = await answer(write.writeId, 'send_replacements');
  const made = await replacementsOf(write.writeId);
  expect(made.map((order) => [order.temp, order.deliveryDate, order.outletId, order.status])).toEqual([['chilled', FRI, 'OUT001', 'placed'], ['dry', FRI, 'OUT001', 'placed']]);
  const lines = await db.select().from(orderLines);
  expect(made.map((order) => lines.filter((line) => line.orderId === order.id).map((line) => [line.productId, line.quantity]))).toEqual([[['fresh-chilled-carton', 1]], [['fresh-dry-carton', 1]]]);
  expect(result.decided.replacement).toEqual({ day: FRI, units: 2 });
  expect(delivery.lines.map((line) => line.temp)).toEqual(['chilled', 'chilled', 'dry']);
});

it('AC-26 refuses an answer that does not fit the report, a replacement of nothing, a replacement with no day open, a stale revision and another depot\'s problem, and changes nothing', async () => {
  const { write } = await reported([11, 8, 3], { reason: 'missing' });
  const open = await openOne(write.writeId);
  for (const decision of ['bring_back', 'try_again', 'go_short', 'load_all']) await refusedAnswer(open.id, open.revision, decision, 400, 'invalid_input', 'That answer does not fit this problem.');
  freeze('2026-06-26', 16 * 60 + 30);
  expect((await needsRuwan()).replaceOn).toBeNull();
  await refusedAnswer(open.id, open.revision, 'send_replacements', 409, 'no_delivery_day', 'No delivery day is open for a replacement.');
  await refusedAnswer(open.id, open.revision + 1, 'no_replacement', 409, 'stale', 'This problem was already answered.');
  const kandy = await kandyTrip();
  const [foreign] = await db.insert(issues).values({ kind: 'receipt', reason: 'missing', stopId: kandy.stop.id, raisedBy: nadeeshaId, raisedAt: at(8 * 60) }).returning();
  await db.insert(issueLines).values({ issueId: foreign!.id, orderLineId: kandy.line.id, counted: 1 });
  await refusedAnswer(foreign!.id, 0, 'send_replacements', 400, 'unknown_record', 'That problem is not on this depot\'s list.');
  await refusedAnswer(randomUUID(), 0, 'no_replacement', 400, 'unknown_record');
  expect((await decide(open.id, open.revision, 'no_replacement')).status).toBe(200);
  await refusedAnswer(open.id, open.revision + 1, 'send_replacements', 409, 'stale', 'This problem was already answered.');
});

it('AC-26 refuses "Send N replacements" for a report of warm chilled goods with nothing short, and changes nothing', async () => {
  const { write } = await reported([12, 8, 3], { cold: false });
  const open = await openOne(write.writeId);
  await refusedAnswer(open.id, open.revision, 'send_replacements', 400, 'invalid_input', 'Nothing is short, so there is nothing to replace.');
  expect((await decide(open.id, open.revision, 'no_replacement')).status).toBe(200);
});

it('AC-27 says Sat 27 Jun to Ruwan at Thu 16:05 before he answers, and the replacement is for Sat 27 Jun', async () => {
  const { write } = await reported([11, 8, 3], { reason: 'missing' });
  freeze(THU, 16 * 60 + 5);
  expect((await needsRuwan()).replaceOn).toBe(SAT);
  const { result } = await answer(write.writeId, 'send_replacements', 16 * 60 + 5);
  expect((await replacementsOf(write.writeId)).map((order) => [order.deliveryDate, order.placedAt])).toEqual([[SAT, at(16 * 60 + 5)]]);
  expect(result).toMatchObject({ replaceOn: SAT, decided: { replacement: { day: SAT, units: 1 } } });
});
