import { hash } from '@node-rs/argon2';
import { deliveryFigures, IssueList, StoreNextOrder, type StoreOrder } from '@wayfinder/contracts';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { demoId } from '../src/db/demo-day';
import { demoDay, issues, orderLines, orders, stops, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { driverStop } from './driver-plan';
import { resetDay, signIn, THU, WED } from './loading-plan';
import { at, deliveredWalkthrough, HANDED_OVER, MORNING_DONE, receiptOf, shopScreen, type ReceiptWalk } from './receipt-plan';
import { serve, stop } from './serve';
import { PIN, signInAs } from './sign-in';

// Spec 015, rule 11: what each of a shop's orders carries for its card, its delivery, receipt, problems and
// replacement (AC-31 up to the receipt, AC-32), and a replacement read through its parts and counted once in the next order.

const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at || clock.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async (original) => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const freeze = (date: string, minute: number) => { const instant = depotInstant(date, minute); testClock.at = instant.toISOString(); setClockForTests(instant); };
const FRI = '2026-06-26';
const app = createApp();
app.set('trust proxy', 'loopback');
const server = await serve(app);
const agentAt = (address: string) => request.agent(server).set('X-Forwarded-For', address);
const kasun = agentAt('192.0.2.41');
const ruwan = agentAt('192.0.2.42');
const nadeesha = agentAt('192.0.2.43');
const dilshan = agentAt('192.0.2.44');
const wellawatte = agentAt('192.0.2.45');
const walk: ReceiptWalk = { nadeesha, ruwan, kasun, dilshan, freeze };
const nugegodaShop = shopScreen(nadeesha);
const wellawatteShop = shopScreen(wellawatte);
let originalClock: typeof demoDay.$inferSelect;

// A store manager at Fresh Wellawatte, made here as spec 009's tests make theirs, and removed at the end.
const MANAGER = { username: 'cards-test-wellawatte', staffId: 'S-921' };
const removeManager = () => db.delete(users).where(eq(users.username, MANAGER.username));

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  await removeManager();
  await db.insert(users).values({ ...MANAGER, displayName: 'Wellawatte manager', role: 'store_manager', outletId: 'OUT002', pinHash: await hash(PIN) });
  for (const [agent, username] of [[kasun, 'kasun'], [ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [dilshan, 'dilshan']] as const) await signIn(agent, username);
  expect((await signInAs(wellawatte, { staffId: MANAGER.staffId, pin: PIN })).status).toBe(200);
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

const NUGEGODA = { twelve: demoId('order', `${WED}:OUT001:chilled`), eight: demoId('order', `${THU}:OUT001:chilled`), dry: demoId('order', `${THU}:OUT001:dry`) };
const WELLAWATTE = { chilled: demoId('order', `${THU}:OUT002:chilled`), dry: demoId('order', `${THU}:OUT002:dry`) };
const factsOf = ({ delivery, receipt, problems, replacementFor }: StoreOrder) => ({ delivery, receipt, problems, replacementFor });
const byId = (list: StoreOrder[], id: string) => {
  const found = list.find((order) => order.id === id);
  if (!found) throw new Error(`Order ${id} is not on the list.`);
  return found;
};

async function answer(seq: number, decision: string, minute: number) {
  const open = IssueList.parse((await ruwan.get('/api/v1/issues')).body).issues.find((problem) => problem.kind !== 'loading' && problem.stop.seq === seq)!;
  freeze(THU, minute);
  const res = await ruwan.post(`/api/v1/issues/${open.id}/decide`).send({ revision: open.revision, decision });
  expect(res.status).toBe(200);
  freeze(THU, MORNING_DONE);
  return open.id;
}

it('AC-31 gives Nadeesha\'s three orders, before the receipt, their handover at 03:38 on VEH035 by Dilshan, on Today and Open alike', async () => {
  const trip = await deliveredWalkthrough(walk);
  const handedOver = (delivered: number, shortFromDepot: number) => ({
    delivery: { stopId: driverStop(trip, 1).id, vehicleId: 'VEH035', driver: 'Dilshan', arrivedAt: at(3 * 60 + 34).toISOString(), doneAt: at(HANDED_OVER).toISOString(),
      outcome: 'delivered', late: false, delivered, shortFromDepot, wontFit: 0, refused: 0, refusalReason: null },
    receipt: null, problems: [], replacementFor: null,
  });
  for (const name of ['today', 'open'] as const) {
    const list = (await nugegodaShop.list(name)).orders;
    expect(list.map((order) => [order.id, order.status])).toEqual([[NUGEGODA.twelve, 'delivered'], [NUGEGODA.eight, 'delivered'], [NUGEGODA.dry, 'delivered']]);
    expect(list.map(factsOf)).toEqual([handedOver(12, 0), handedOver(8, 0), handedOver(3, 1)]);
  }
});

it('AC-31 gives Nadeesha\'s orders, after her receipt and Ruwan\'s answer, 11, 8 and 3 received with 1, 0 and 1 short, the report answered by a replacement on Fri 26 Jun, and the replacement replacing Thu 25 Jun', async () => {
  const trip = await deliveredWalkthrough(walk);
  const delivery = (await nugegodaShop.read()).deliveries[0]!;
  const write = receiptOf(delivery, [11, 8, 3], { reason: 'missing' });
  freeze(THU, 8 * 60 + 33);
  expect((await nugegodaShop.send(write)).status).toBe(200);
  await answer(1, 'send_replacements', 8 * 60 + 35);
  const handedOver = (delivered: number, shortFromDepot: number) => ({ stopId: driverStop(trip, 1).id, vehicleId: 'VEH035', driver: 'Dilshan', arrivedAt: at(3 * 60 + 34).toISOString(),
    doneAt: at(HANDED_OVER).toISOString(), outcome: 'delivered', late: false, delivered, shortFromDepot, wontFit: 0, refused: 0, refusalReason: null });
  const received = (units: number, short: number) => ({ at: at(8 * 60 + 31).toISOString(), sentAt: at(8 * 60 + 33).toISOString(), units, short });
  const expected = [
    { delivery: handedOver(12, 0), receipt: received(11, 1), problems: [{ id: write.writeId, kind: 'receipt', units: 1, decision: 'send_replacements', replacementDay: FRI, line: '1 missing chilled carton: a replacement comes on Fri 26 Jun' }], replacementFor: null },
    { delivery: handedOver(8, 0), receipt: received(8, 0), problems: [], replacementFor: null },
    { delivery: handedOver(3, 1), receipt: received(3, 1), problems: [], replacementFor: null },
  ];
  for (const name of ['today', 'past'] as const) {
    const list = (await nugegodaShop.list(name)).orders;
    expect([NUGEGODA.twelve, NUGEGODA.eight, NUGEGODA.dry].map((id) => factsOf(byId(list, id)))).toEqual(expected);
  }
  const replacement = (await db.select().from(orders).where(eq(orders.replacesIssueId, write.writeId)))[0]!;
  const open = (await nugegodaShop.list('open')).orders;
  expect(open.map((order) => order.id)).toEqual([replacement.id]);
  expect(byId(open, replacement.id)).toMatchObject({ deliveryDate: FRI, status: 'placed', units: 1, delivery: null, receipt: null, problems: [], replacementFor: THU });
});

it('AC-31 gives the seeded history its receipt and nothing else, Wednesday\'s 6 dry cartons received at 07:42', async () => {
  freeze(THU, MORNING_DONE);
  const past = (await nugegodaShop.list('past')).orders;
  expect(factsOf(past[0]!)).toEqual({ delivery: null, receipt: { at: depotInstant(WED, 7 * 60 + 42).toISOString(), sentAt: null, units: 6, short: 0 }, problems: [], replacementFor: null });
  const tuesday = past.filter((order) => order.deliveryDate === '2026-06-23').map((order) => [order.temp, order.receipt]);
  expect(tuesday).toEqual([['chilled', { at: depotInstant('2026-06-23', 7 * 60 + 9).toISOString(), sentAt: null, units: 13, short: 0 }],
    ['dry', { at: depotInstant('2026-06-23', 7 * 60 + 9).toISOString(), sentAt: null, units: 7, short: 0 }]]);
  expect(past.every((order) => order.delivery === null && order.problems.length === 0 && order.replacementFor === null && order.receipt?.sentAt === null)).toBe(true);
});

it('L-21 gives the dry carton that did not fit on the truck as won\'t fit, not short from the depot, on the card and the delivery', async () => {
  const trip = await deliveredWalkthrough(walk, { reason: 'wont_fit' });
  const list = (await nugegodaShop.list('today')).orders;
  expect(byId(list, NUGEGODA.dry).delivery).toMatchObject({ delivered: 3, shortFromDepot: 0, wontFit: 1 });
  expect(byId(list, NUGEGODA.eight).delivery).toMatchObject({ delivered: 8, shortFromDepot: 0, wontFit: 0 });
  const delivery = await nugegodaShop.one(driverStop(trip, 1).id);
  expect(delivery.lines.find((line) => line.temp === 'dry')).toMatchObject({ ordered: 4, loaded: 3, delivered: 3, wontFit: 1 });
  expect(deliveryFigures(delivery)).toMatchObject({ shortFromDepot: 0, wontFit: 1 });
});

it('AC-32 gives Wellawatte\'s chilled order 46 delivered, 2 refused and damaged, and the refusal with its answer, and its dry one neither', async () => {
  const trip = await deliveredWalkthrough(walk, { wellawatte: 'refused' });
  const refusal = trip.problems[0]!;
  const refused = {
    stopId: driverStop(trip, 2).id, vehicleId: 'VEH035', driver: 'Dilshan', arrivedAt: at(3 * 60 + 45).toISOString(), doneAt: at(3 * 60 + 48).toISOString(),
    outcome: 'refused', late: false, shortFromDepot: 0, wontFit: 0, refusalReason: 'damaged',
  };
  let list = (await wellawatteShop.list('today')).orders;
  expect(factsOf(byId(list, WELLAWATTE.chilled))).toEqual({ delivery: { ...refused, delivered: 46, refused: 2 }, receipt: null,
    problems: [{ id: refusal.id, kind: 'refused', units: 2, decision: null, replacementDay: null, line: '2 damaged chilled cartons: the depot decides what happens to them' }], replacementFor: null });
  expect(factsOf(byId(list, WELLAWATTE.dry))).toEqual({ delivery: { ...refused, delivered: 46, refused: 0 }, receipt: null, problems: [], replacementFor: null });
  await answer(2, 'bring_back', 3 * 60 + 52);
  list = (await wellawatteShop.list('open')).orders;
  expect(byId(list, WELLAWATTE.chilled).problems).toEqual([{ id: refusal.id, kind: 'refused', units: 2, decision: 'bring_back', replacementDay: null, line: '2 damaged chilled cartons: they go back to the depot' }]);
});

it('AC-32 gives a closed shop\'s orders the attempt and an open problem, then after Try again no delivery and the answer', async () => {
  const trip = await deliveredWalkthrough(walk, { wellawatte: 'closed' });
  const closed = trip.problems[0]!;
  const attempt = { stopId: driverStop(trip, 2).id, vehicleId: 'VEH035', driver: 'Dilshan', arrivedAt: at(3 * 60 + 45).toISOString(), doneAt: at(3 * 60 + 48).toISOString(),
    outcome: 'closed', late: false, delivered: null, shortFromDepot: 0, wontFit: 0, refused: 0, refusalReason: null };
  let list = (await wellawatteShop.list('open')).orders;
  expect([WELLAWATTE.chilled, WELLAWATTE.dry].map((id) => factsOf(byId(list, id)))).toEqual([
    { delivery: attempt, receipt: null, problems: [{ id: closed.id, kind: 'closed', units: 48, decision: null, replacementDay: null, line: '48 chilled cartons: the depot decides, today or another day' }], replacementFor: null },
    { delivery: attempt, receipt: null, problems: [{ id: closed.id, kind: 'closed', units: 46, decision: null, replacementDay: null, line: '46 dry cartons: the depot decides, today or another day' }], replacementFor: null },
  ]);
  await answer(2, 'try_again', 3 * 60 + 52);
  list = (await wellawatteShop.list('open')).orders;
  expect([WELLAWATTE.chilled, WELLAWATTE.dry].map((id) => factsOf(byId(list, id)))).toEqual([
    { delivery: null, receipt: null, problems: [{ id: closed.id, kind: 'closed', units: 48, decision: 'try_again', replacementDay: null, line: '48 chilled cartons: the driver comes back after the other stops' }], replacementFor: null },
    { delivery: null, receipt: null, problems: [{ id: closed.id, kind: 'closed', units: 46, decision: 'try_again', replacementDay: null, line: '46 dry cartons: the driver comes back after the other stops' }], replacementFor: null },
  ]);
});

it('AC-32 gives a closed shop\'s orders, once brought back and placed again, the attempt and the answer', async () => {
  const trip = await deliveredWalkthrough(walk, { wellawatte: 'closed' });
  const closed = trip.problems[0]!;
  await answer(2, 'bring_back', 3 * 60 + 52);
  const list = (await wellawatteShop.list('open')).orders;
  const chilled = byId(list, WELLAWATTE.chilled);
  expect(chilled.status).toBe('placed');
  expect(factsOf(chilled)).toEqual({
    delivery: { stopId: driverStop(trip, 2).id, vehicleId: 'VEH035', driver: 'Dilshan', arrivedAt: at(3 * 60 + 45).toISOString(), doneAt: at(3 * 60 + 48).toISOString(),
      outcome: 'closed', late: false, delivered: null, shortFromDepot: 0, wontFit: 0, refused: 0, refusalReason: null },
    receipt: null, problems: [{ id: closed.id, kind: 'closed', units: 48, decision: 'bring_back', replacementDay: null, line: '48 chilled cartons: brought back to the depot, waiting for the next plan' }], replacementFor: null,
  });
});

it('AC-32 calls an arrival after the window\'s close late, Wellawatte\'s at 08:05 against its 08:00, and Nugegoda\'s at 03:34 not', async () => {
  const trip = await deliveredWalkthrough(walk, { wellawatte: 'refused' });
  await db.update(stops).set({ arrivedAt: at(8 * 60 + 5), doneAt: at(8 * 60 + 8) }).where(eq(stops.id, driverStop(trip, 2).id));
  freeze(THU, 9 * 60);
  const list = (await wellawatteShop.list('today')).orders;
  expect([WELLAWATTE.chilled, WELLAWATTE.dry].map((id) => byId(list, id).delivery?.late)).toEqual([true, true]);
  expect((await nugegodaShop.list('today')).orders.map((order) => order.delivery?.late)).toEqual([false, false, false]);
});

it('reads a replacement and each part of a split one as replacing the delivery\'s day, and counts their active quantities once in the shop\'s next order', async () => {
  const trip = await deliveredWalkthrough(walk, { wellawatte: 'refused' });
  const refusal = trip.problems[0]!;
  const chilledLine = driverStop(trip, 2).lines.find((line) => line.temp === 'chilled')!;
  // A replacement of 2 chilled cartons for Friday, as an answer places it, and the shop's own Friday order.
  const placed = { outletId: 'OUT002', deliveryDate: FRI, placedAt: at(3 * 60 + 52) } as const;
  const [replacement] = await db.insert(orders).values({ ...placed, temp: 'chilled', status: 'placed', replacesIssueId: refusal.id }).returning();
  await db.insert(orderLines).values({ orderId: replacement!.id, productId: chilledLine.productId, quantity: 2 });
  const [own] = await db.insert(orders).values({ ...placed, temp: 'dry', status: 'placed' }).returning();
  await db.insert(orderLines).values({ orderId: own!.id, productId: 'fresh-dry-carton', quantity: 5 });
  let list = (await wellawatteShop.list('open')).orders;
  expect(byId(list, replacement!.id).replacementFor).toBe(THU);
  expect(byId(list, own!.id).replacementFor).toBeNull();
  expect(byId(list, WELLAWATTE.chilled).problems).toEqual([{ id: refusal.id, kind: 'refused', units: 2, decision: null, replacementDay: FRI, line: '2 damaged chilled cartons: the depot decides what happens to them' }]);
  const next = async () => StoreNextOrder.parse((await wellawatte.get('/api/v1/store/next-order')).body);
  const whole = (await next()).placed!;
  expect(whole.orders.map((order) => order.id).sort()).toEqual([replacement!.id, own!.id].sort());
  expect(whole.lines.reduce((total, line) => total + line.quantity, 0)).toBe(7);

  // The plan splits it into 1 and 1 (D-30): the original is split and each part points at it.
  await db.update(orders).set({ status: 'split' }).where(eq(orders.id, replacement!.id));
  const parts = await db.insert(orders).values([{ ...placed, temp: 'chilled', status: 'placed', splitFrom: replacement!.id }, { ...placed, temp: 'chilled', status: 'placed', splitFrom: replacement!.id }]).returning();
  await db.insert(orderLines).values(parts.map((part) => ({ orderId: part.id, productId: chilledLine.productId, quantity: 1 })));
  list = (await wellawatteShop.list('open')).orders;
  expect(parts.map((part) => byId(list, part.id).replacementFor)).toEqual([THU, THU]);
  expect(list.some((order) => order.id === replacement!.id)).toBe(false);
  const split = (await next()).placed!;
  expect(split.orders.map((order) => order.id).sort()).toEqual([...parts.map((part) => part.id), own!.id].sort());
  expect(split.lines.reduce((total, line) => total + line.quantity, 0)).toBe(7);
  expect(byId(list, WELLAWATTE.chilled).problems[0]!.replacementDay).toBe(FRI);
  // A shop's own order split by the plan is no replacement.
  await db.update(orders).set({ replacesIssueId: null }).where(eq(orders.id, replacement!.id));
  list = (await wellawatteShop.list('open')).orders;
  expect(parts.map((part) => byId(list, part.id).replacementFor)).toEqual([null, null]);
  expect(await db.select({ id: issues.id }).from(issues).where(inArray(issues.id, [refusal.id]))).toHaveLength(1);
});
