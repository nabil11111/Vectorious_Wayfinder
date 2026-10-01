import { StoreOrderList } from '@wayfinder/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { demoDay, orderLines, orders, stopOrders, stops } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { driverStop } from './driver-plan';
import { resetDay, signIn, THU, WED } from './loading-plan';
import { at, deliveredWalkthrough, receiptOf, shopScreen, type ReceiptWalk } from './receipt-plan';
import { serve, stop } from './serve';

// Q-35: Nugegoda, Kotahena and Wellawatte each got their chilled cartons on one truck and their dry ones on another in
// phase 5, and a manager who confirmed the first never heard the second still waited. Today now says how many
// deliveries wait and lists each with its stop, until each is confirmed. Here Nugegoda gets a second drop of 3 dry
// cartons at 04:06, as VEH038 brought Kotahena's.

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
const kasun = agentAt('192.0.2.101');
const ruwan = agentAt('192.0.2.102');
const nadeesha = agentAt('192.0.2.103');
const dilshan = agentAt('192.0.2.104');
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

// A second drop at Nugegoda on the same trip: one order of 3 dry cartons handed over at 04:06.
async function secondDrop(tripId: string) {
  const [order] = await db.insert(orders).values({ outletId: 'OUT001', deliveryDate: THU, temp: 'dry', status: 'delivered', placedAt: depotInstant(WED, 10 * 60) }).returning();
  await db.insert(orderLines).values({ orderId: order!.id, productId: 'fresh-dry-carton', quantity: 3, loadedQty: 3, deliveredQty: 3 });
  const [made] = await db.insert(stops).values({ tripId, seq: 3, outletId: 'OUT001', loadedAt: at(2 * 60 + 30), arrivedAt: at(4 * 60 + 2), doneAt: at(4 * 60 + 6), outcome: 'delivered', revision: 2 }).returning();
  await db.insert(stopOrders).values({ stopId: made!.id, orderId: order!.id });
  return made!.id;
}
const today = async () => StoreOrderList.parse((await nadeesha.get('/api/v1/store/orders').query({ list: 'today' })).body).toConfirm;
const confirm = async (stopId: string) => {
  const delivery = (await shop.read()).deliveries.find((each) => each.stopId === stopId)!;
  freeze(THU, 8 * 60 + 33);
  expect((await shop.send(receiptOf(delivery, delivery.lines.map((line) => line.delivered)))).status).toBe(200);
};

it('says on Today how many deliveries wait and lists each with its stop, until each is confirmed', async () => {
  const trip = await deliveredWalkthrough(walk);
  const first = driverStop(trip, 1).id;
  const second = await secondDrop(trip.tripId);
  expect(await today()).toEqual({ title: '2 deliveries to confirm', deliveries: [
    { stopId: first, line: '20 chilled and 3 dry cartons · Delivered 03:38 · VEH035 · Dilshan' },
    { stopId: second, line: '3 dry cartons · Delivered 04:06 · VEH035 · Dilshan' },
  ] });
  // The first confirmed, the second still waits, and Today still says so.
  await confirm(first);
  expect(await today()).toEqual({ title: '1 delivery to confirm', deliveries: [{ stopId: second, line: '3 dry cartons · Delivered 04:06 · VEH035 · Dilshan' }] });
  await confirm(second);
  expect(await today()).toBeNull();
});

it('says nothing more on Today for a shop with one delivery, whose card already says it was delivered', async () => {
  await deliveredWalkthrough(walk);
  expect(await today()).toBeNull();
  // Only Today carries it.
  expect(StoreOrderList.parse((await nadeesha.get('/api/v1/store/orders').query({ list: 'open' })).body).toConfirm).toBeNull();
});
