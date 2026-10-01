import { randomUUID } from 'node:crypto';
import { type DriverTrip } from '@wayfinder/contracts';
import { eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { demoDay, orderLines, orders, stopOrders, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { answeredTrip, driverScreen, driverStop, driverTrip, driverWrite, heldDriverRows, readyWalkthrough } from './driver-plan';
import { code, resetDay, signIn, THU, WED } from './loading-plan';
import { at, deliveredWalkthrough, HANDED_OVER, MORNING_DONE, shopScreen, type ReceiptWalk } from './receipt-plan';
import { serve, stop } from './serve';

// Spec 015, AC-1 to AC-4: the shop reads the deliveries it confirms, and one delivery by its stop.

const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at || clock.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async (original) => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const freeze = (date: string, minute: number) => { const instant = depotInstant(date, minute); testClock.at = instant.toISOString(); setClockForTests(instant); };
const FRI = '2026-06-26';
// Each phone has an address of its own, so the walkthroughs do not share one request allowance.
const app = createApp();
app.set('trust proxy', 'loopback');
const server = await serve(app);
const agentAt = (address: string) => request.agent(server).set('X-Forwarded-For', address);
const kasun = agentAt('192.0.2.31');
const ruwan = agentAt('192.0.2.32');
const nadeesha = agentAt('192.0.2.33');
const dilshan = agentAt('192.0.2.34');
const admin = agentAt('192.0.2.35');
const walk: ReceiptWalk = { nadeesha, ruwan, kasun, dilshan, freeze };
const shop = shopScreen(nadeesha);
const driver = driverScreen(dilshan);
let originalClock: typeof demoDay.$inferSelect;
let nadeeshaId: string;

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, username] of [[kasun, 'kasun'], [ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [dilshan, 'dilshan'], [admin, 'admin']] as const) await signIn(agent, username);
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

// A receipt as the tables keep it once applied (D-61), written straight in: every line received as handed over.
async function confirmedInTables(stopId: string, receivedAt: Date) {
  const ids = (await db.select({ id: stopOrders.orderId }).from(stopOrders).where(eq(stopOrders.stopId, stopId))).map((row) => row.id);
  await db.update(orders).set({ status: 'received', receivedAt, receiptSentAt: receivedAt, arrivedCold: sql`case when ${orders.temp} = 'chilled' then true end` }).where(inArray(orders.id, ids));
  await db.update(orderLines).set({ receivedQty: sql`${orderLines.deliveredQty}` }).where(inArray(orderLines.orderId, ids));
}

const nugegodaLines = (trip: DriverTrip) => driverStop(trip, 1).lines.map((line) => ({ lineId: line.lineId, orderId: line.orderId }));

it('AC-1 answers Nugegoda\'s delivery to confirm at Thu 08:30, with its lines in the loader\'s order, no applied id, and writes nothing', async () => {
  const trip = await deliveredWalkthrough(walk);
  const before = await heldDriverRows();
  const [twelve, eight, dry] = nugegodaLines(trip);
  expect(await shop.read()).toEqual({
    outlet: { id: 'OUT001', name: 'Fresh Nugegoda', brand: 'Fresh', windowOpen: '05:00', windowClose: '07:30', dockType: 'street' },
    userId: nadeeshaId, today: THU, appliedWriteIds: [],
    deliveries: [{
      stopId: driverStop(trip, 1).id, revision: 2, day: THU, vehicleId: 'VEH035', driver: 'Dilshan', arrivedAt: at(3 * 60 + 34).toISOString(), doneAt: at(HANDED_OVER).toISOString(),
      outcome: 'delivered', late: false, refusalReason: null, receipt: null,
      lines: [
        { ...twelve, temp: 'chilled', productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', ordered: 12, loaded: 12, delivered: 12, received: null },
        { ...eight, temp: 'chilled', productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', ordered: 8, loaded: 8, delivered: 8, received: null },
        { ...dry, temp: 'dry', productId: 'fresh-dry-carton', name: 'Dry carton', unit: 'carton', ordered: 4, loaded: 3, delivered: 3, received: null },
      ],
    }],
  });
  expect(await heldDriverRows()).toEqual(before);
});

it('AC-2 lists no delivery while stop 1 is arrived and not handed over', async () => {
  await deliveredWalkthrough(walk, { stopAt: 'arrived' });
  expect((await shop.read()).deliveries).toEqual([]);
});

it('AC-2 lists no closed stop', async () => {
  await readyWalkthrough(walk);
  let trip = driverTrip(await driver.read());
  for (const [kind, minute, seq] of [['start', 3 * 60 + 31, undefined], ['arrive', 3 * 60 + 34, 1], ['closed', 3 * 60 + 38, 1]] as const) {
    freeze(THU, minute);
    trip = answeredTrip(await driver.send(driverWrite(trip, kind, at(minute).toISOString(), seq)));
  }
  freeze(THU, MORNING_DONE);
  expect(driverStop(trip, 1).outcome).toBe('closed');
  expect((await shop.read()).deliveries).toEqual([]);
});

it('AC-2 never lists Wellawatte\'s refusal at OUT001, and lists a delivery confirmed today but not one confirmed on an earlier day', async () => {
  const trip = await deliveredWalkthrough(walk, { wellawatte: 'refused' });
  const nugegoda = driverStop(trip, 1).id;
  expect((await shop.read()).deliveries.map((delivery) => delivery.stopId)).toEqual([nugegoda]);
  await confirmedInTables(nugegoda, at(8 * 60 + 31));
  freeze(THU, 9 * 60);
  const today = await shop.read();
  expect(today.deliveries.map((delivery) => [delivery.stopId, delivery.receipt?.at])).toEqual([[nugegoda, at(8 * 60 + 31).toISOString()]]);
  expect(today.deliveries[0]!.lines.map((line) => line.received)).toEqual([12, 8, 3]);
  freeze(FRI, 9 * 60);
  expect(await shop.read()).toMatchObject({ today: FRI, deliveries: [] });
});

it('AC-3 answers one delivery by its stop whatever its day, and refuses a stop of another shop or one not handed over with unknown_record', async () => {
  const trip = await deliveredWalkthrough(walk, { wellawatte: 'refused' });
  const nugegoda = driverStop(trip, 1).id;
  const listed = (await shop.read()).deliveries[0]!;
  expect(await shop.one(nugegoda)).toEqual(listed);
  await confirmedInTables(nugegoda, at(8 * 60 + 31));
  freeze(FRI, 9 * 60);
  const confirmed = await shop.one(nugegoda);
  expect(confirmed).toMatchObject({ stopId: nugegoda, day: THU, receipt: { at: at(8 * 60 + 31).toISOString(), sentAt: at(8 * 60 + 31).toISOString(), cold: true, report: null } });
  const before = await heldDriverRows();
  for (const stopId of [driverStop(trip, 2).id, randomUUID()]) {
    const res = await nadeesha.get(`/api/v1/store/deliveries/${stopId}`);
    expect(code(res)).toEqual([400, 'unknown_record']);
    expect(res.body.error).toMatchObject({ message: 'That delivery is not on your list.', details: { id: stopId } });
  }
  expect(code(await nadeesha.get('/api/v1/store/deliveries/not-a-stop'))).toEqual([400, 'invalid_input']);
  expect(await heldDriverRows()).toEqual(before);
});

it('AC-3 refuses a stop of the shop that is not handed over yet', async () => {
  const trip = await deliveredWalkthrough(walk, { stopAt: 'arrived' });
  const res = await nadeesha.get(`/api/v1/store/deliveries/${driverStop(trip, 1).id}`);
  expect(code(res)).toEqual([400, 'unknown_record']);
});

it('AC-4 answers 401 with no session, 403 forbidden to the other roles and 403 no_outlet to an admin, on all three endpoints', async () => {
  const stopId = randomUUID();
  const asks = [
    (agent: ReturnType<typeof request.agent>) => agent.get('/api/v1/store/deliveries'),
    (agent: ReturnType<typeof request.agent>) => agent.get(`/api/v1/store/deliveries/${stopId}`),
    (agent: ReturnType<typeof request.agent>) => agent.post('/api/v1/store/receipts').send({ kind: 'receipt' }),
  ];
  const before = await heldDriverRows();
  for (const ask of asks) {
    expect(code(await ask(agentAt('192.0.2.36')))).toEqual([401, 'signed_out']);
    for (const agent of [ruwan, kasun, dilshan]) expect(code(await ask(agent))).toEqual([403, 'forbidden']);
    expect(code(await ask(admin))).toEqual([403, 'no_outlet']);
  }
  expect(await heldDriverRows()).toEqual(before);
  expect(announce).not.toHaveBeenCalled();
});
