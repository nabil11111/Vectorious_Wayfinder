import { DriverDay, NotificationList, ReceivingList, StoreReceiving } from '@wayfinder/contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { auditLog, demoDay } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { resetDay, signIn, THU, WED } from './loading-plan';
import { readyWalkthrough, driverScreen, driverTrip, driverWrite, answeredTrip } from './driver-plan';
import { serve, stop } from './serve';

const clock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async original => {
  const lib = await original<typeof import('../src/lib/clock')>();
  return { ...lib, demoClockAt: (...args: Parameters<typeof lib.demoClockAt>) => ({ ...lib.demoClockAt(...args), now: clock.at || lib.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async original => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const freeze = (date: string, minute: number) => { const at = depotInstant(date, minute); clock.at = at.toISOString(); setClockForTests(at); };
const app = createApp(); app.set('trust proxy', 'loopback');
const server = await serve(app);
let ip = 120;
const agent = () => request.agent(server).set('X-Forwarded-For', `192.0.2.${++ip}`);
const shop = agent(), otherShop = agent(), dispatch = agent(), driver = agent(), otherDriver = agent(), loader = agent();
let original: typeof demoDay.$inferSelect;
beforeAll(async () => {
  original = (await db.select().from(demoDay))[0]!;
  for (const [a, name] of [[shop, 'nadeesha'], [otherShop, 'chamari'], [dispatch, 'ruwan'], [driver, 'dilshan'], [otherDriver, 'anura'], [loader, 'kasun']] as const) await signIn(a, name);
});
beforeEach(async () => { await resetDay(); await db.delete(auditLog).where(eq(auditLog.action, 'receiving.updated')); await initClock(); freeze(WED, 900); vi.mocked(announce).mockClear(); });
afterAll(async () => { await resetDay(); await db.update(demoDay).set(original); setClockForTests(null); await stop(server); await pool.end(); });
const read = async () => { const res = await shop.get('/api/v1/store/receiving'); expect(res.status).toBe(200); return StoreReceiving.parse(res.body); };
const write = (held: StoreReceiving, status = 'ready', note = '') => shop.put('/api/v1/store/receiving').send({ date: held.date, demoDay: held.demoDay, revision: held.state!.revision, status, note });

it('starts Not confirmed and writes only the account shop with app-clock audit evidence', async () => {
  const held = await read(); expect(held.state).toMatchObject({ outletId: 'OUT001', date: WED, status: 'unconfirmed', revision: 0, updatedAt: null });
  const res = await write(held, 'ready', '  Rear entrance  '); expect(res.status).toBe(200);
  expect(StoreReceiving.parse(res.body).state).toMatchObject({ status: 'ready', note: 'Rear entrance', revision: 1, updatedAt: clock.at });
  expect(StoreReceiving.parse((await otherShop.get('/api/v1/store/receiving')).body).state?.status).toBe('unconfirmed');
  const facts = await db.select().from(auditLog).where(eq(auditLog.action, 'receiving.updated'));
  expect(facts).toHaveLength(1); expect(facts[0]!.at.toISOString()).toBe(clock.at);
  expect(facts[0]!.after).toMatchObject({ outletId: 'OUT001', date: WED, status: 'ready', revision: 1 });
  expect((await shop.put('/api/v1/store/receiving').send({ ...res.body.state, demoDay: held.demoDay, outletId: 'OUT002' })).status).toBe(400);
});
it('serializes two first-insert writers, rejects a stale revision, and clearing never reuses zero', async () => {
  const held = await read();
  const results = await Promise.all([write(held, 'ready'), write(held, 'unavailable')]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  const fresh = await read(); expect(fresh.state!.revision).toBe(1);
  expect((await write(fresh, 'unconfirmed')).status).toBe(200);
  expect((await read()).state).toMatchObject({ status: 'unconfirmed', revision: 2, note: null });
  expect((await write(held)).status).toBe(409);
  expect(await db.select().from(auditLog).where(eq(auditLog.action, 'receiving.updated'))).toHaveLength(2);
});
it('keeps today after 16:00, rejects rollover and reset attempts, and never carries yesterday forward', async () => {
  const held = await read(); freeze(WED, 1020); expect((await read()).date).toBe(WED);
  expect((await write(held)).status).toBe(200);
  freeze(THU, 150); expect((await read()).state).toMatchObject({ date: THU, status: 'unconfirmed', revision: 0 });
  expect((await write(held)).status).toBe(409);
  const next = await read(); await db.update(demoDay).set({ day: next.demoDay + 1 });
  expect((await write(next)).status).toBe(409);
});
it('returns no declaration day on a nonoperating calendar day and refuses writes there', async () => {
  const held = await read(); freeze('2026-06-28', 600);
  expect(await read()).toMatchObject({ date: null, state: null });
  expect((await write({ ...held, date: '2026-06-28' })).status).toBe(409);
});
it('enforces role, outlet, captured account and dispatcher depot scope', async () => {
  const held = await read();
  for (const a of [driver, dispatch, loader]) expect((await a.get('/api/v1/store/receiving')).status).toBe(403);
  expect((await driver.get('/api/v1/operations/receiving')).status).toBe(403);
  expect((await dispatch.get('/api/v1/operations/receiving?depot=Kandy')).status).toBe(409);
  expect((await shop.put('/api/v1/store/receiving').set('x-wayfinder-account', '00000000-0000-4000-8000-000000000000').send({ date: held.date, demoDay: held.demoDay, revision: 0, status: 'ready', note: '' })).status).toBe(409);
  const list = ReceivingList.parse((await dispatch.get('/api/v1/operations/receiving')).body);
  expect(list.states.find(s => s.outletId === 'OUT001')).toMatchObject({ shopName: 'Fresh Nugegoda', status: 'unconfirmed' });
  expect(list.states.some(s => s.outletId === 'OUT076')).toBe(false);
});
it('enriches only assigned stops and notifies assigned drivers and dispatchers after 16:00 with stable IDs', async () => {
  await readyWalkthrough({ nadeesha: shop, ruwan: dispatch, kasun: loader, freeze });
  const screen = driverScreen(driver);
  let trip = driverTrip(await screen.read());
  trip = answeredTrip(await screen.send(driverWrite(trip, 'start', clock.at)));
  const held = await read(); freeze(THU, 1020);
  expect((await write(held, 'unavailable', 'Receiving team returns at 18:00.')).status).toBe(200);
  const notices = async (a: typeof driver) => NotificationList.parse((await a.get('/api/v1/notifications')).body).items.filter(n => n.kind === 'receiving_updated');
  const own = await notices(driver); expect(own).toHaveLength(1); expect(await notices(otherDriver)).toEqual([]); expect(await notices(loader)).toEqual([]);
  expect(await notices(dispatch)).toHaveLength(1); expect(await notices(driver)).toEqual(own);
  expect(own[0]).toMatchObject({ at: clock.at, tone: 'warn', link: '/driver' }); expect(own[0]!.line).toContain('Temporarily unavailable');
  // The driver day switches at 16:00; an earlier trip still out keeps its own dated declaration.
  const day = DriverDay.parse((await driver.get('/api/v1/driver')).body);
  expect(day.trips[0]!.stops[0]).toMatchObject({ receiving: { date: THU, status: 'unavailable', note: 'Receiving team returns at 18:00.' } });
  const event = vi.mocked(announce).mock.calls.slice().reverse().find(([change]) => change.topic === 'receiving')![0];
  expect(event.recipientIds).toContain(day.driverId);
  const outsider = (await otherDriver.get('/api/v1/auth/me')).body;
  expect(outsider.id).toBeTruthy(); expect(event.recipientIds).not.toContain(outsider.id);
  // Manager unavailable is advisory: the driver can still record arrival with normal evidence.
  trip = driverTrip(day);
  expect((await screen.send(driverWrite(trip, 'arrive', clock.at, 1))).status).toBe(200);
  const beforeReset = await read();
  expect((await dispatch.post('/api/v1/demo/reset').send({})).status).toBe(200);
  expect((await read()).state?.status).toBe('unconfirmed');
  expect(await notices(driver)).toEqual([]); expect(await notices(dispatch)).toEqual([]);
  expect((await write(beforeReset)).status).toBe(409);
});
