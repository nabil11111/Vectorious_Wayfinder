import { hash } from '@node-rs/argon2';
import { PHONE_ACCOUNT_HEADER } from '@wayfinder/contracts';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { auditLog, demoDay, phoneWrites, trips, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { driverStop, driverWrite, heldDriverRows } from './driver-plan';
import { code, resetDay, signIn, THU, WED } from './loading-plan';
import { at, deliveredWalkthrough, receiptOf, shopScreen, type ReceiptWalk } from './receipt-plan';
import { serve, stop } from './serve';
import { PIN, signInAs } from './sign-in';

// Every write a phone saved first is bound to the account that saved it (D-45, D-57): the phone sends that account's id
// with it, and the server refuses it under any other session, so a write one account saved never goes out as another's,
// even when the other manages the same shop or drives the same trip. The phone then waits for its account, as after a
// 401.

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
const chaminda = agentAt('192.0.2.95');
const otherManager = agentAt('192.0.2.96');
const walk: ReceiptWalk = { nadeesha, ruwan, kasun, dilshan, freeze };
let originalClock: typeof demoDay.$inferSelect;
const id: Record<string, string> = {};

// A second store manager at Fresh Nugegoda, made here as spec 009's tests make theirs, and removed at the end with the
// audit rows it wrote.
const SECOND = { username: 'accounts-test-nugegoda', staffId: 'S-941' };
async function removeSecond() {
  const made = await db.select({ id: users.id }).from(users).where(eq(users.username, SECOND.username));
  if (!made.length) return;
  await db.delete(auditLog).where(inArray(auditLog.actorId, made.map((user) => user.id)));
  await db.delete(users).where(inArray(users.id, made.map((user) => user.id)));
}

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  await resetDay();
  await removeSecond();
  await db.insert(users).values({ ...SECOND, displayName: 'Second Nugegoda manager', role: 'store_manager', outletId: 'OUT001', pinHash: await hash(PIN) });
  for (const [agent, username] of [[kasun, 'kasun'], [ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [dilshan, 'dilshan'], [chaminda, 'chaminda']] as const) await signIn(agent, username);
  const login = await signInAs(otherManager, { staffId: SECOND.staffId, pin: PIN });
  expect(login.status).toBe(200);
  otherManager.set(PHONE_ACCOUNT_HEADER, login.body.id);
  for (const row of await db.select().from(users).where(inArray(users.username, ['nadeesha', 'dilshan', 'chaminda', SECOND.username]))) id[row.username] = row.id;
});
beforeEach(async () => {
  await resetDay();
  await initClock();
  freeze(WED, 16 * 60);
  vi.mocked(announce).mockReset();
});
afterAll(async () => {
  await resetDay();
  await removeSecond();
  await db.update(demoDay).set(originalClock);
  testClock.at = '';
  setClockForTests(null);
  await stop(server);
  await pool.end();
});

const ANOTHER = 'This record was saved by another account. Sign in as that account to send it.';
async function refusedAs(send: () => request.Test) {
  const before = await heldDriverRows();
  vi.mocked(announce).mockClear();
  const res = await send();
  expect(code(res)).toEqual([409, 'other_account']);
  expect(res.body.error.message).toBe(ANOTHER);
  expect(await heldDriverRows()).toEqual(before);
  expect(announce).not.toHaveBeenCalled();
}

it('refuses Nadeesha\'s receipt sent under another manager of her shop, or naming no account, and applies it under her own session as hers', async () => {
  const trip = await deliveredWalkthrough(walk);
  const delivery = (await shopScreen(nadeesha).read()).deliveries.find((each) => each.stopId === driverStop(trip, 1).id)!;
  const write = receiptOf(delivery, [11, 8, 3], { reason: 'missing' });
  freeze(THU, 8 * 60 + 33);
  // The other manager's session with Nadeesha's record: her shop, so without the check it would apply as his.
  await refusedAs(() => otherManager.post('/api/v1/store/receipts').set(PHONE_ACCOUNT_HEADER, id.nadeesha!).send(write));
  await refusedAs(() => otherManager.post('/api/v1/store/receipts').unset(PHONE_ACCOUNT_HEADER).send(write));
  await refusedAs(() => nadeesha.post('/api/v1/store/receipts').unset(PHONE_ACCOUNT_HEADER).send(write));
  await refusedAs(() => nadeesha.post('/api/v1/store/receipts').set(PHONE_ACCOUNT_HEADER, id[SECOND.username]!).send(write));
  expect((await nadeesha.post('/api/v1/store/receipts').set(PHONE_ACCOUNT_HEADER, id.nadeesha!).send(write)).status).toBe(200);
  expect(await db.select({ userId: phoneWrites.userId }).from(phoneWrites).where(eq(phoneWrites.id, write.writeId))).toEqual([{ userId: id.nadeesha }]);
});

it('refuses Dilshan\'s write sent under another driver of the trip, or naming no account, and applies it under his own session as his', async () => {
  const trip = await deliveredWalkthrough(walk);
  freeze(THU, 3 * 60 + 45);
  const arrival = driverWrite(trip, 'arrive', at(3 * 60 + 45).toISOString(), 2);
  // Chaminda drives the trip now, so without the check Dilshan's saved arrival would apply as his.
  await db.update(trips).set({ driverId: id.chaminda! }).where(eq(trips.id, trip.tripId));
  await refusedAs(() => chaminda.post('/api/v1/driver/writes').set(PHONE_ACCOUNT_HEADER, id.dilshan!).send(arrival));
  await refusedAs(() => chaminda.post('/api/v1/driver/writes').unset(PHONE_ACCOUNT_HEADER).send(arrival));
  await db.update(trips).set({ driverId: id.dilshan! }).where(eq(trips.id, trip.tripId));
  await refusedAs(() => dilshan.post('/api/v1/driver/writes').unset(PHONE_ACCOUNT_HEADER).send(arrival));
  await refusedAs(() => dilshan.post('/api/v1/driver/writes').set(PHONE_ACCOUNT_HEADER, id.chaminda!).send(arrival));
  expect((await dilshan.post('/api/v1/driver/writes').set(PHONE_ACCOUNT_HEADER, id.dilshan!).send(arrival)).status).toBe(200);
  expect(await db.select({ userId: phoneWrites.userId }).from(phoneWrites).where(eq(phoneWrites.id, arrival.writeId))).toEqual([{ userId: id.dilshan }]);
});

it('checks the session and role before the account, so a phone write with no session is still 401 and another role still 403', async () => {
  const write = { kind: 'receipt' };
  expect(code(await agentAt('192.0.2.97').post('/api/v1/store/receipts').set(PHONE_ACCOUNT_HEADER, id.nadeesha!).send(write))).toEqual([401, 'signed_out']);
  expect(code(await dilshan.post('/api/v1/store/receipts').set(PHONE_ACCOUNT_HEADER, id.dilshan!).send(write))).toEqual([403, 'forbidden']);
  expect(code(await nadeesha.post('/api/v1/driver/writes').set(PHONE_ACCOUNT_HEADER, id.nadeesha!).send(write))).toEqual([403, 'forbidden']);
});
