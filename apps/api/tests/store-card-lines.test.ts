import { hash } from '@node-rs/argon2';
import { IssueList, PHONE_ACCOUNT_HEADER, PlanBoard, type DraftPlan, type StoreOrder } from '@wayfinder/contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { demoId } from '../src/db/demo-day';
import { auditLog, demoDay, phoneWrites, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { resetDay, signIn, THU, WED } from './loading-plan';
import { FRI } from './operations-plan';
import { deliveredWalkthrough, MORNING_DONE, receiptOf, shopScreen, type ReceiptWalk } from './receipt-plan';
import { serve, stop } from './serve';
import { PIN, signInAs } from './sign-in';

// Q-36: a shop's card gives each problem of its order a line the server words, naming the cartons it is about. At
// Kotahena in phase 5 a refusal answered with replacements and a report answered with none read "3 replacements come on
// Fri 26 Jun. · No replacement is coming." Here Wellawatte, the walkthrough's refusing shop, does the same.

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
const kasun = agentAt('192.0.2.91');
const ruwan = agentAt('192.0.2.92');
const nadeesha = agentAt('192.0.2.93');
const dilshan = agentAt('192.0.2.94');
const wellawatte = agentAt('192.0.2.95');
const walk: ReceiptWalk = { nadeesha, ruwan, kasun, dilshan, freeze };
const shop = shopScreen(wellawatte);
const nugegoda = shopScreen(nadeesha);
let originalClock: typeof demoDay.$inferSelect;

// A store manager at Fresh Wellawatte, made here as spec 015's card tests make theirs, and removed at the end.
const MANAGER = { username: 'lines-test-wellawatte', staffId: 'S-922' };
// Its receipt leaves an audit row and a phone write under its name, which a reset keeps, so they go first.
async function removeManager() {
  const [manager] = await db.select({ id: users.id }).from(users).where(eq(users.username, MANAGER.username));
  if (!manager) return;
  await db.delete(auditLog).where(eq(auditLog.actorId, manager.id));
  await db.delete(phoneWrites).where(eq(phoneWrites.userId, manager.id));
  await db.delete(users).where(eq(users.id, manager.id));
}

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  await removeManager();
  await db.insert(users).values({ ...MANAGER, displayName: 'Wellawatte manager', role: 'store_manager', outletId: 'OUT002', pinHash: await hash(PIN) });
  for (const [agent, username] of [[kasun, 'kasun'], [ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [dilshan, 'dilshan']] as const) await signIn(agent, username);
  const signedIn = await signInAs(wellawatte, { staffId: MANAGER.staffId, pin: PIN });
  expect(signedIn.status).toBe(200);
  // The phone names the account that saved a receipt (D-57).
  wellawatte.set(PHONE_ACCOUNT_HEADER, signedIn.body.id);
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

const CHILLED = demoId('order', `${THU}:OUT002:chilled`);
const DRY = demoId('order', `${THU}:OUT002:dry`);
const linesOf = (list: StoreOrder[], id: string) => list.find((order) => order.id === id)!.problems.map((problem) => problem.line);

async function answer(kind: string, outletId: string, decision: string, minute: number) {
  const open = IssueList.parse((await ruwan.get('/api/v1/issues')).body).issues.find((problem) => problem.kind === kind && problem.stop.outletId === outletId)!;
  freeze(THU, minute);
  expect((await ruwan.post(`/api/v1/issues/${open.id}/decide`).send({ revision: open.revision, decision })).status).toBe(200);
  freeze(THU, MORNING_DONE);
}

it('words a refusal replaced on Friday and a report not replaced apart, each naming its cartons', async () => {
  await deliveredWalkthrough(walk, { wellawatte: 'refused' });
  expect(linesOf((await shop.list('today')).orders, CHILLED)).toEqual(['2 damaged chilled cartons: the depot decides what happens to them']);
  await answer('refused', 'OUT002', 'send_replacements', 3 * 60 + 52);
  // Of the 46 chilled cartons handed over, 44 came; the dry ones all came.
  const delivery = (await shop.read()).deliveries[0]!;
  const write = receiptOf(delivery, delivery.lines.map((line) => (line.temp === 'chilled' ? line.delivered - 2 : line.delivered)));
  const sent = { ...write, lines: write.lines.map((line, i) => (delivery.lines[i]!.temp === 'chilled' ? { ...line, reason: 'missing' } : line)) };
  freeze(THU, 8 * 60 + 40);
  expect((await shop.send(sent)).status).toBe(200);
  freeze(THU, MORNING_DONE + 11);
  expect(linesOf((await shop.list('today')).orders, CHILLED)).toEqual([
    '2 damaged chilled cartons: replacements come on Fri 26 Jun', '2 missing chilled cartons: the depot is reviewing your report',
  ]);
  await answer('receipt', 'OUT002', 'no_replacement', 8 * 60 + 44);
  for (const name of ['today', 'past'] as const) {
    const list = (await shop.list(name)).orders;
    expect(linesOf(list, CHILLED)).toEqual(['2 damaged chilled cartons: replacements come on Fri 26 Jun', '2 missing chilled cartons: no replacement']);
    expect(linesOf(list, DRY)).toEqual([]);
  }
});

it('says warm chilled goods on the chilled cards of a report of the cold alone, and nothing on the dry one', async () => {
  await deliveredWalkthrough(walk);
  const delivery = (await nugegoda.read()).deliveries[0]!;
  freeze(THU, 8 * 60 + 33);
  expect((await nugegoda.send(receiptOf(delivery, delivery.lines.map((line) => line.delivered), { cold: false }))).status).toBe(200);
  await answer('receipt', 'OUT001', 'no_replacement', 8 * 60 + 35);
  const list = (await nugegoda.list('today')).orders;
  expect(list.map((order) => [order.temp, order.problems.map((problem) => problem.line)])).toEqual([
    ['chilled', ['Chilled cartons that came warm: no replacement']], ['chilled', ['Chilled cartons that came warm: no replacement']], ['dry', []],
  ]);
});

// Q-41: Fresh Mulgampola's 39 chilled cartons, brought back from a closed shop, stayed under "Coming today" with
// Thursday's window. Here Wellawatte's two orders do the same.
it('takes a closed shop\'s brought-back orders off Today, and Orders says they were brought back and wait for the next plan', async () => {
  await deliveredWalkthrough(walk, { wellawatte: 'closed' });
  // Before the answer they may still come today, so they stay.
  expect((await shop.list('today')).orders.map((order) => [order.id, order.broughtBack])).toEqual([[CHILLED, false], [DRY, false]]);
  await answer('closed', 'OUT002', 'bring_back', 3 * 60 + 52);
  freeze(THU, 9 * 60 + 38);
  expect((await shop.list('today')).orders).toEqual([]);
  const open = (await shop.list('open')).orders;
  expect(open.map((order) => [order.id, order.status, order.broughtBack])).toEqual([[CHILLED, 'placed', true], [DRY, 'placed', true]]);
  expect(linesOf(open, CHILLED)).toEqual(['48 chilled cartons: brought back to the depot, waiting for the next plan']);
  expect(linesOf(open, DRY)).toEqual(['46 dry cartons: brought back to the depot, waiting for the next plan']);
});

// L-14: Chamari at Fresh Wellawatte opened Today after the 48 chilled cartons were brought back, and nothing on it said
// they did not come or what happens to them. Today keeps a line for each brought-back order, with its new day once a
// sent plan takes it, until the day moves on.
it('says on Today what happened to each order brought back from the closed shop, and its new day once a plan takes it', async () => {
  await deliveredWalkthrough(walk, { wellawatte: 'closed' });
  expect((await shop.list('today')).broughtBack).toBeNull();
  await answer('closed', 'OUT002', 'bring_back', 3 * 60 + 52);
  freeze(THU, 9 * 60 + 38);
  const today = await shop.list('today');
  expect(today.orders).toEqual([]);
  expect(today.broughtBack).toEqual({ title: 'Not coming today', orders: [
    { orderId: CHILLED, line: '48 chilled cartons brought back to the depot · waiting for the next plan' },
    { orderId: DRY, line: '46 dry cartons brought back to the depot · waiting for the next plan' },
  ] });
  // Only Today says it.
  for (const name of ['open', 'past'] as const) expect((await shop.list(name)).broughtBack).toBeNull();

  // Ruwan sends Friday's plan with the chilled order on it; the dry one waits.
  freeze(THU, 16 * 60);
  const board = PlanBoard.parse((await ruwan.get('/api/v1/plans')).body);
  expect(board.day?.date).toBe(FRI);
  const [driver] = await db.select().from(users).where(eq(users.username, 'dilshan'));
  const draft: DraftPlan = { mixBrands: false, trips: [{ vehicleId: 'VEH035', tripNo: 1, leaveAt: null, driverId: driver!.id, stops: [{ outletId: 'OUT002', orderIds: [CHILLED] }] }],
    deferrals: board.orders.filter((order) => order.id !== CHILLED).map((order) => ({ orderId: order.id, code: 'dispatcher_choice', reason: 'Scheduled for a later run.' })) };
  const saved = await ruwan.put(`/api/v1/plans/${FRI}/draft`).send({ planId: null, demoDay: board.demoDay, plan: draft });
  expect(saved.status).toBe(200);
  const ready = PlanBoard.parse(saved.body);
  expect((await ruwan.post(`/api/v1/plans/${FRI}/send`).send({ planId: ready.plan.id, revision: ready.plan.revision })).status).toBe(200);
  expect((await shop.list('today')).broughtBack!.orders).toEqual([
    { orderId: CHILLED, line: '48 chilled cartons brought back to the depot · planned for Fri 26 Jun' },
    { orderId: DRY, line: '46 dry cartons brought back to the depot · waiting for the next plan' },
  ]);

  // On Friday the chilled order is coming today, and Thursday's closed shop is no longer Today's news.
  freeze(FRI, 60);
  const friday = await shop.list('today');
  expect(friday.orders.map((order) => order.id)).toEqual([CHILLED]);
  expect(friday.broughtBack).toBeNull();
});
