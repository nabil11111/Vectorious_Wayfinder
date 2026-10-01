import { hash } from '@node-rs/argon2';
import { DecideIssueResponse, IssueList, PHONE_ACCOUNT_HEADER, PlaceOrdersResponse, PlanBoard, StoreNextOrder, StoreOrderList, type DraftPlan, type DraftTrip, type PlanRef } from '@wayfinder/contracts';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { auditLog, demoDay, issues, orderLines, orders, users } from '../src/db/schema';
import { issuesOf } from '../src/issues/read';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { snapshot } from '../src/orders/store-orders';
import { answeredTrip, driverScreen, driverStop, driverTrip, driverWrite } from './driver-plan';
import { answeredTruck, loaderScreen, resetDay, signIn, THU, truckOf, WED } from './loading-plan';
import { at, deliveredWalkthrough, photo, receiptOf, shopScreen, type ReceiptWalk } from './receipt-plan';
import { serve, stop } from './serve';
import { PIN, signInAs } from './sign-in';

// Spec 015, AC-28 to AC-30: a replacement in the plan. Split on Friday's board by hand (spec 010) or by the planner
// (spec 014), and joined back, it stays a replacement of Thursday's delivery, out of the shop's next order, and the
// problem's replacement reads the whole.

const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at || clock.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async (original) => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const freeze = (date: string, minute: number) => { const instant = depotInstant(date, minute); testClock.at = instant.toISOString(); setClockForTests(instant); };
const FRI = '2026-06-26';
const URL = `/api/v1/plans/${FRI}`;
const app = createApp();
app.set('trust proxy', 'loopback');
const server = await serve(app);
const agentAt = (address: string) => request.agent(server).set('X-Forwarded-For', address);
const kasun = agentAt('192.0.2.81');
const ruwan = agentAt('192.0.2.82');
const nadeesha = agentAt('192.0.2.83');
const dilshan = agentAt('192.0.2.84');
const wellawatte = agentAt('192.0.2.85');
const mountLavinia = agentAt('192.0.2.86');
const walk: ReceiptWalk = { nadeesha, ruwan, kasun, dilshan, freeze };
let originalClock: typeof demoDay.$inferSelect;

// Store managers at Fresh Wellawatte and at Fresh Mount Lavinia, a shop a truck can reach, made here as spec 009's
// tests make theirs, and removed at the end.
const MANAGER = { username: 'replacements-test-wellawatte', staffId: 'S-931' };
const TRUCK_SHOP = { username: 'replacements-test-mount-lavinia', staffId: 'S-932', outletId: 'OUT006' };
// The audit rows they wrote go with them, as the clock's and the reset's tests take theirs back. Run after a reset, so no
// order of the day names them.
async function removeManager() {
  const made = await db.select({ id: users.id }).from(users).where(inArray(users.username, [MANAGER.username, TRUCK_SHOP.username]));
  if (!made.length) return;
  await db.delete(auditLog).where(inArray(auditLog.actorId, made.map((user) => user.id)));
  await db.delete(users).where(inArray(users.id, made.map((user) => user.id)));
}

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  await resetDay();
  await removeManager();
  await db.insert(users).values({ ...MANAGER, displayName: 'Wellawatte manager', role: 'store_manager', outletId: 'OUT002', pinHash: await hash(PIN) });
  await db.insert(users).values({ ...TRUCK_SHOP, displayName: 'Mount Lavinia manager', role: 'store_manager', pinHash: await hash(PIN) });
  for (const [agent, username] of [[kasun, 'kasun'], [ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [dilshan, 'dilshan']] as const) await signIn(agent, username);
  for (const [agent, { staffId }] of [[wellawatte, MANAGER], [mountLavinia, TRUCK_SHOP]] as const) {
    const login = await signInAs(agent, { staffId, pin: PIN });
    expect(login.status).toBe(200);
    agent.set(PHONE_ACCOUNT_HEADER, login.body.id);
  }
});
beforeEach(async () => {
  await resetDay();
  await initClock();
  freeze(WED, 16 * 60);
  vi.mocked(announce).mockReset();
});
afterAll(async () => {
  await resetDay();
  await removeManager();
  await db.update(demoDay).set(originalClock);
  testClock.at = '';
  setClockForTests(null);
  await stop(server);
  await pool.end();
});

async function answerSending(issueId: string) {
  const open = IssueList.parse((await ruwan.get('/api/v1/issues')).body).issues.find((problem) => problem.id === issueId)!;
  freeze(THU, 8 * 60 + 35);
  const res = await ruwan.post(`/api/v1/issues/${issueId}/decide`).send({ revision: open.revision, decision: 'send_replacements' });
  expect(res.status, JSON.stringify(res.body.error)).toBe(200);
  return DecideIssueResponse.parse(res.body);
}
const replacementOf = async (issueId: string) => (await db.select().from(orders).where(eq(orders.replacesIssueId, issueId)))[0]!;
const partsOf = (originalId: string) => db.select().from(orders).where(eq(orders.splitFrom, originalId)).orderBy(orders.id);
const problemNow = async (issueId: string) => (await snapshot((tx) => issuesOf(tx, eq(issues.id, issueId))))[0]!;
const listOf = async (agent: typeof nadeesha) => StoreOrderList.parse((await agent.get('/api/v1/store/orders').query({ list: 'open' })).body).orders;
// The shop's next order with the clock back at Thu 09:00, when Friday is the day an order placed now is for.
async function nextOrderAtNine(agent: typeof nadeesha) {
  freeze(THU, 9 * 60);
  const next = StoreNextOrder.parse((await agent.get('/api/v1/store/next-order')).body);
  expect(next.deliveryDate).toBe(FRI);
  return next;
}
// Friday's board, which opens once Friday's orders closed at Thu 16:00.
let board: PlanBoard;
const ref = (): PlanRef => (board.plan.id ? { planId: board.plan.id, revision: board.plan.revision } : { planId: null, demoDay: board.demoDay });
async function readFriday() {
  freeze(THU, 16 * 60);
  board = PlanBoard.parse((await ruwan.get(URL)).body);
  return board;
}
const boardWrite = async (res: request.Response) => {
  expect(res.status, JSON.stringify(res.body.error)).toBe(200);
  board = PlanBoard.parse(res.body);
  return board;
};

// Wellawatte's refusal of 2 chilled cartons answered "Send 2 replacements", and Wellawatte's own Friday order of 5 dry
// cartons, placed at Thu 09:00 before Friday's orders close.
async function refusalReplaced() {
  const trip = await deliveredWalkthrough(walk, { wellawatte: 'refused' });
  const refusal = trip.problems[0]!;
  await answerSending(refusal.id);
  freeze(THU, 9 * 60);
  const next = StoreNextOrder.parse((await wellawatte.get('/api/v1/store/next-order')).body);
  const saved = await wellawatte.put('/api/v1/store/next-order/draft').send({ deliveryDate: next.deliveryDate, lines: [{ productId: 'fresh-dry-carton', quantity: 5 }], driverNote: '', refs: {} });
  expect(saved.status).toBe(200);
  const placed = await wellawatte.post('/api/v1/store/next-order/place').send({ deliveryDate: next.deliveryDate, refs: saved.body.draft.refs });
  expect(placed.status).toBe(200);
  return { refusal, replacement: await replacementOf(refusal.id), own: StoreNextOrder.parse(placed.body).placed!.orders[0]! };
}

it('AC-28 keeps both parts of a replacement Ruwan splits 1 and 1 on Friday\'s board replacements of Thu 25 Jun, out of OUT002\'s next order, and the refusal\'s replacement whole', async () => {
  const { refusal, replacement, own } = await refusalReplaced();
  await readFriday();
  expect(board.orders.map((order) => order.id)).toContain(replacement.id);
  await boardWrite(await ruwan.post(`${URL}/split`).send({ ...ref(), orderId: replacement.id, keep: [{ productId: 'fresh-chilled-carton', quantity: 1 }] }));
  const parts = await partsOf(replacement.id);
  expect(parts.map((part) => [part.status, part.deliveryDate, part.replacesIssueId])).toEqual([['placed', FRI, null], ['placed', FRI, null]]);
  const open = await listOf(wellawatte);
  expect(parts.map((part) => open.find((order) => order.id === part.id)!.replacementFor)).toEqual([THU, THU]);
  expect(open.find((order) => order.id === own.id)!.replacementFor).toBeNull();
  expect((await problemNow(refusal.id)).replacement).toEqual({ day: FRI, units: 2 });
  expect((await nextOrderAtNine(wellawatte)).placed?.orders.map((order) => order.id)).toEqual([own.id]);
});

it('AC-29 keeps both parts of a replacement the suggested plan for Friday splits replacements of Thu 25 Jun, out of the shop\'s next order, and the report\'s replacement whole', async () => {
  const trip = await deliveredWalkthrough(walk);
  const delivery = (await shopScreen(nadeesha).read()).deliveries.find((each) => each.stopId === driverStop(trip, 1).id)!;
  const write = receiptOf(delivery, [11, 8, 3], { reason: 'missing' });
  freeze(THU, 8 * 60 + 33);
  expect((await nadeesha.post('/api/v1/store/receipts').send(write)).status).toBe(200);
  await answerSending(write.writeId);
  const replacement = await replacementOf(write.writeId);
  // More chilled cartons than one fridge trip can carry: the largest holds 902 by volume.
  await db.update(orderLines).set({ quantity: 950 }).where(eq(orderLines.orderId, replacement.id));
  await readFriday();
  await boardWrite(await ruwan.post(`${URL}/suggest`).send(ref()));
  expect((await db.select().from(orders).where(eq(orders.id, replacement.id)))[0]!.status).toBe('split');
  const parts = await partsOf(replacement.id);
  expect(parts).toHaveLength(2);
  const units = await Promise.all(parts.map(async (part) => (await db.select().from(orderLines).where(eq(orderLines.orderId, part.id))).reduce((sum, line) => sum + line.quantity, 0)));
  expect(units.reduce((sum, n) => sum + n, 0)).toBe(950);
  const open = await listOf(nadeesha);
  expect(parts.map((part) => open.find((order) => order.id === part.id)!.replacementFor)).toEqual([THU, THU]);
  expect((await problemNow(write.writeId)).replacement).toEqual({ day: FRI, units: 950 });
  expect((await nextOrderAtNine(nadeesha)).placed).toBeNull();
});

it('AC-30 gives the order joined back on the board Thu 25 Jun as the day it replaces again, and OUT002\'s next order still does not count it', async () => {
  const { refusal, replacement, own } = await refusalReplaced();
  await readFriday();
  await boardWrite(await ruwan.post(`${URL}/split`).send({ ...ref(), orderId: replacement.id, keep: [{ productId: 'fresh-chilled-carton', quantity: 1 }] }));
  await boardWrite(await ruwan.post(`${URL}/join`).send({ ...ref(), orderId: replacement.id }));
  expect(await partsOf(replacement.id)).toEqual([]);
  const joined = (await listOf(wellawatte)).find((order) => order.id === replacement.id)!;
  expect(joined).toMatchObject({ status: 'placed', units: 2, replacementFor: THU });
  expect((await problemNow(refusal.id)).replacement).toEqual({ day: FRI, units: 2 });
  expect((await nextOrderAtNine(wellawatte)).placed?.orders.map((order) => order.id)).toEqual([own.id]);
});

// Ruwan saves a day's plan with these trips, every other order of the day waiting, and sends it.
async function sendPlan(date: string, trips: DraftTrip[]) {
  const day = PlanBoard.parse((await ruwan.get(`/api/v1/plans/${date}`)).body);
  const on = new Set(trips.flatMap((trip) => trip.stops.flatMap((stop) => stop.orderIds)));
  const draft: DraftPlan = { mixBrands: false, trips, deferrals: day.orders.filter((order) => !on.has(order.id))
    .map((order) => ({ orderId: order.id, code: 'dispatcher_choice', reason: 'Scheduled for a later run.' })) };
  const reference = day.plan.id ? { planId: day.plan.id, revision: day.plan.revision } : { planId: null, demoDay: day.demoDay };
  const saved = await ruwan.put(`/api/v1/plans/${date}/draft`).send({ ...reference, plan: draft });
  expect(saved.status, JSON.stringify(saved.body.error)).toBe(200);
  const ready = PlanBoard.parse(saved.body);
  expect(ready.check!.ok, JSON.stringify(ready.check!.problems.filter((problem) => problem.level === 'block'))).toBe(true);
  expect((await ruwan.post(`/api/v1/plans/${date}/send`).send({ planId: ready.plan.id, revision: ready.plan.revision })).status).toBe(200);
}
// Kasun loads the truck's one stop whole and marks it ready.
async function loadWhole(vehicleId: string) {
  const loader = loaderScreen(kasun);
  const day = await loader.read();
  let truck = answeredTruck(await loader.start(truckOf(day, vehicleId), day.plan!), vehicleId);
  truck = answeredTruck(await loader.stopLoaded(truck, 1), vehicleId);
  return answeredTruck(await loader.ready(truck), vehicleId);
}
// Dilshan's writes on the truck's trip of the day, each at its minute.
async function drive(date: string, vehicleId: string, writes: [kind: Parameters<typeof driverWrite>[1], minute: number, seq?: number, more?: (trip: ReturnType<typeof driverTrip>) => object][]) {
  const driver = driverScreen(dilshan);
  freeze(date, writes[0]![1]);
  let trip = driverTrip(await driver.read(), vehicleId);
  for (const [kind, minute, seq, more] of writes) {
    freeze(date, minute);
    trip = answeredTrip(await driver.send(driverWrite(trip, kind, at(minute, date).toISOString(), seq, more?.(trip) ?? {})), vehicleId);
  }
  return trip;
}

it('keeps every replacement line within the 999 a receipt counts: two orders of 500 cartons refused in full are replaced by orders of 999 and 1, planned, loaded, delivered and confirmed', async () => {
  const dilshanId = (await db.select().from(users).where(eq(users.username, 'dilshan')))[0]!.id;
  // Wed 15:30: Mount Lavinia places two orders of 500 dry cartons each for Thursday, the most a shop's line may hold
  // being 999.
  freeze(WED, 15 * 60 + 30);
  const big: string[] = [];
  for (const _ of [1, 2]) {
    const saved = await mountLavinia.put('/api/v1/store/next-order/draft').send({ deliveryDate: THU, lines: [{ productId: 'fresh-dry-carton', quantity: 500 }], driverNote: '', refs: {} });
    expect(saved.status, JSON.stringify(saved.body.error)).toBe(200);
    const placed = await mountLavinia.post('/api/v1/store/next-order/place').send({ deliveryDate: THU, refs: saved.body.draft.refs });
    expect(placed.status, JSON.stringify(placed.body.error)).toBe(200);
    big.push(...PlaceOrdersResponse.parse(placed.body).placedOrders.map((order) => order.id));
  }
  // Wed 16:00: VEH019, a 7,200 kg and 38 m³ truck, carries the 1,000 cartons to Mount Lavinia, Dilshan driving.
  freeze(WED, 16 * 60);
  await sendPlan(THU, [{ vehicleId: 'VEH019', tripNo: 1, leaveAt: null, driverId: dilshanId, stops: [{ outletId: TRUCK_SHOP.outletId, orderIds: big }] }]);
  freeze(THU, 2 * 60 + 30);
  await loadWhole('VEH019');
  // Thu 03:58: the shop refuses all of them, damaged, and Dilshan ends the trip.
  const thursday = await drive(THU, 'VEH019', [
    ['start', 3 * 60 + 31], ['arrive', 3 * 60 + 54, 1],
    ['refuse', 3 * 60 + 58, 1, (trip) => ({ reason: 'damaged', note: '', lines: driverStop(trip, 1).lines.map((line) => ({ lineId: line.lineId, refused: line.loaded! })) })],
    ['finish', 4 * 60 + 20],
  ]);
  const refusal = thursday.problems[0]!;
  expect(refusal.lines.map((line) => line.counted)).toEqual([500, 500]);
  // Thu 04:30: Ruwan answers "Send 1000 replacements". One order would hold a line of 1,000 that no receipt can count,
  // so the dry cartons come as 999 on one order and 1 on another, both for Friday.
  const open = IssueList.parse((await ruwan.get('/api/v1/issues')).body).issues.find((problem) => problem.id === refusal.id)!;
  freeze(THU, 4 * 60 + 30);
  const answered = await ruwan.post(`/api/v1/issues/${refusal.id}/decide`).send({ revision: open.revision, decision: 'send_replacements' });
  expect(answered.status, JSON.stringify(answered.body.error)).toBe(200);
  expect(DecideIssueResponse.parse(answered.body).decided.replacement).toEqual({ day: FRI, units: 1000 });
  const made = await db.select().from(orders).where(eq(orders.replacesIssueId, refusal.id));
  const lines = await db.select().from(orderLines).where(inArray(orderLines.orderId, made.map((order) => order.id)));
  expect(made.map((order) => [order.outletId, order.temp, order.deliveryDate, order.status])).toEqual([[TRUCK_SHOP.outletId, 'dry', FRI, 'placed'], [TRUCK_SHOP.outletId, 'dry', FRI, 'placed']]);
  expect(made.map((order) => lines.filter((line) => line.orderId === order.id).map((line) => [line.productId, line.quantity])).sort((a, b) => a[0]![1] as number - (b[0]![1] as number)))
    .toEqual([[['fresh-dry-carton', 1]], [['fresh-dry-carton', 999]]]);
  // Friday: planned on VEH019 again, loaded, and handed over whole.
  freeze(THU, 16 * 60);
  await sendPlan(FRI, [{ vehicleId: 'VEH019', tripNo: 1, leaveAt: null, driverId: dilshanId, stops: [{ outletId: TRUCK_SHOP.outletId, orderIds: made.map((order) => order.id) }] }]);
  freeze(FRI, 2 * 60 + 30);
  expect((await loadWhole('VEH019')).stops[0]!.lines.map((line) => line.going).sort((a, b) => a - b)).toEqual([1, 999]);
  const friday = await drive(FRI, 'VEH019', [['start', 3 * 60 + 31], ['arrive', 3 * 60 + 54, 1], ['deliver', 3 * 60 + 58, 1, () => ({ photo })], ['finish', 4 * 60 + 20]]);
  // Fri 08:30: the shop confirms all 1,000 cartons, 999 and 1.
  freeze(FRI, 8 * 60 + 30);
  const shop = shopScreen(mountLavinia);
  const delivery = (await shop.read()).deliveries.find((each) => each.stopId === driverStop(friday, 1).id)!;
  expect(delivery.lines.map((line) => line.delivered).sort((a, b) => a - b)).toEqual([1, 999]);
  const confirmed = await shop.send(receiptOf(delivery, delivery.lines.map((line) => line.delivered)));
  expect(confirmed.status, JSON.stringify(confirmed.body.error)).toBe(200);
  const received = await db.select().from(orderLines).where(inArray(orderLines.orderId, made.map((order) => order.id)));
  expect(received.map((line) => line.receivedQty).sort((a, b) => a! - b!)).toEqual([1, 999]);
  expect((await db.select().from(orders).where(inArray(orders.id, made.map((order) => order.id)))).map((order) => order.status)).toEqual(['received', 'received']);
});
