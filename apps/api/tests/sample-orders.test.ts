import { SampleOrdersPreview, SampleOrdersResult, StoreOrderList } from '@wayfinder/contracts';
import { and, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { clearDemoDay, seedDemoDay } from '../src/db/demo-day';
import { auditLog, demoDay, orderLines, orders, outlets, products, users, vehicles } from '../src/db/schema';
import { initClock, realNow, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { pickShops } from '../src/orders/sample-lines';
import { serve, stop } from './serve';
import { signInAs } from './sign-in';

// Spec 028: the demo control's "Add sample shop orders". Every test starts from the seeded day with the clock at Wed
// 15:00 in "Orders open", and the file puts the day and the clock back as it found them.

vi.mock('../src/lib/live', async (original) => ({ ...(await original<typeof import('../src/lib/live')>()), announce: vi.fn() }));

const server = await serve(createApp());
const SAMPLE = '/api/v1/demo/sample-orders';
const THU = '2026-06-25';
const wed = (time: string) => new Date(`2026-06-24T${time}:00+05:30`);

const [clockFound] = await db.select().from(demoDay);
const auditFound = new Set((await db.select({ id: auditLog.id }).from(auditLog)).map((row) => row.id));

type Agent = ReturnType<typeof request.agent>;
const as = {} as Record<'ruwan' | 'nadeesha' | 'kasun' | 'admin' | 'tharindu', Agent>;
let ruwanCookie = '';
beforeAll(async () => {
  for (const who of Object.keys({ ruwan: 0, nadeesha: 0, kasun: 0, admin: 0, tharindu: 0 }) as (keyof typeof as)[]) {
    const agent = request.agent(server);
    const res = await signInAs(agent, who);
    if (res.status !== 200) throw new Error(`${who} could not sign in: ${res.status}`);
    as[who] = agent;
    if (who === 'ruwan') ruwanCookie = res.get('Set-Cookie')![0]!.split(';')[0]!;
  }
});

async function seedTheDay() {
  await db.transaction(async (tx) => {
    await clearDemoDay(tx);
    await tx.update(vehicles).set({ archivedAt: null }).where(isNotNull(vehicles.archivedAt));
    await tx.update(outlets).set({ archivedAt: null }).where(isNotNull(outlets.archivedAt));
    await tx.update(products).set({ archivedAt: null }).where(isNotNull(products.archivedAt));
    await seedDemoDay(tx);
  });
}
async function setClock(at: Date) {
  const clock = { clockBase: at, clockSetAt: realNow(), revision: 0, day: 1 };
  await db.insert(demoDay).values(clock).onConflictDoUpdate({ target: demoDay.id, set: clock });
  await initClock();
}

beforeEach(async () => {
  await seedTheDay();
  await setClock(wed('15:00'));
  vi.mocked(announce).mockClear();
});
afterEach(async () => {
  setClockForTests(null);
  await as.ruwan.put('/api/v1/me/depot').send({ depotId: 'Peliyagoda' });
});
afterAll(async () => {
  await seedTheDay();
  if (clockFound) await db.insert(demoDay).values(clockFound).onConflictDoUpdate({ target: demoDay.id, set: clockFound });
  else await db.delete(demoDay);
  await initClock();
  const written = (await db.select({ id: auditLog.id }).from(auditLog)).map((row) => row.id).filter((id) => !auditFound.has(id));
  if (written.length) await db.delete(auditLog).where(inArray(auditLog.id, written));
  for (const agent of Object.values(as)) await agent.post('/api/v1/auth/logout').send({});
  await stop(server);
  await pool.end();
});

const press = (shops: 10 | 25 | 'all', agent = as.ruwan) => agent.post(SAMPLE).send({ shops });
const pressed = async (shops: 10 | 25 | 'all') => {
  const res = await press(shops);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return SampleOrdersResult.parse(res.body);
};
const answer = (res: request.Response) => [res.status, res.body.error?.code];

// The orders a press made: every order for Thursday that a store manager placed, with its lines.
async function sampleOrders() {
  const rows = await db.select().from(orders).where(and(eq(orders.deliveryDate, THU), isNotNull(orders.placedBy), eq(orders.status, 'placed')));
  const lines = rows.length ? await db.select().from(orderLines).where(inArray(orderLines.orderId, rows.map((row) => row.id))) : [];
  return rows.map((row) => ({ ...row, lines: lines.filter((line) => line.orderId === row.id).map((l) => [l.productId, l.quantity]).sort() }));
}
const shape = (list: Awaited<ReturnType<typeof sampleOrders>>) => list.map((o) => ({ outletId: o.outletId, temp: o.temp, lines: o.lines, driverNote: o.driverNote }))
  .sort((a, b) => `${a.outletId}${a.temp}`.localeCompare(`${b.outletId}${b.temp}`));

// Peliyagoda's shops with no order for Thursday on the seeded day. OUT001 has Nadeesha's draft.
const FREE_AT_PELIYAGODA = ['OUT015', 'OUT020', 'OUT021', 'OUT023', 'OUT024', 'OUT035', 'OUT038', 'OUT049', 'OUT064', 'OUT070'];
// Frees 20 more Peliyagoda shops by taking out their seeded Thursday orders, so a press of 10 has more to pick from.
const MORE = ['OUT002', 'OUT003', 'OUT004', 'OUT005', 'OUT006', 'OUT007', 'OUT008', 'OUT009', 'OUT010', 'OUT011', 'OUT012', 'OUT013', 'OUT014',
  'OUT016', 'OUT018', 'OUT019', 'OUT022', 'OUT025', 'OUT026', 'OUT027'];
const freeMore = () => db.delete(orders).where(and(inArray(orders.outletId, MORE), eq(orders.deliveryDate, THU)));

describe('who may press (AC-10)', () => {
  it('is the dispatcher only: signed out 401, every other role 403', async () => {
    expect(answer(await request(server).post(SAMPLE).send({ shops: 10 }))).toEqual([401, 'signed_out']);
    expect(answer(await request(server).get(SAMPLE))).toEqual([401, 'signed_out']);
    for (const who of ['nadeesha', 'kasun', 'admin'] as const) {
      expect([who, ...answer(await press(10, as[who]))]).toEqual([who, 403, 'forbidden']);
      expect([who, ...answer(await as[who].get(SAMPLE))]).toEqual([who, 403, 'forbidden']);
    }
    expect(await sampleOrders()).toEqual([]);
  });

  it('takes only 10, 25 or every shop', async () => {
    for (const shops of [0, 5, 'some', null]) expect(answer(await as.ruwan.post(SAMPLE).send({ shops }))).toEqual([400, 'invalid_input']);
  });

  it('is refused for a tab that shows another depot than the session (D-95)', async () => {
    expect(answer(await as.ruwan.post(SAMPLE).set('x-wayfinder-depot', 'Kandy').send({ shops: 10 }))).toEqual([409, 'depot_changed']);
    expect(await sampleOrders()).toEqual([]);
  });

  it('is not there with demo mode off', async () => {
    vi.stubEnv('DEMO_MODE', 'false');
    vi.resetModules();
    const fresh = await import('../src/app');
    const client = await import('../src/db/client');
    const off = await serve(fresh.createApp());
    try {
      const cookie = ruwanCookie;
      expect(answer(await request(off).post(SAMPLE).set('Cookie', cookie).send({ shops: 10 }))).toEqual([404, 'not_found']);
      expect(answer(await request(off).get(SAMPLE).set('Cookie', cookie))).toEqual([404, 'not_found']);
    } finally {
      await stop(off);
      await client.pool.end();
      vi.unstubAllEnvs();
    }
  });
});

describe('outside "Orders open" (AC-9)', () => {
  it('answers 409 orders_not_open with a plain sentence and places nothing', async () => {
    await setClock(wed('16:00'));
    const res = await press(10);
    expect(answer(res)).toEqual([409, 'orders_not_open']);
    expect(res.body.error.message).toBe('Sample orders can be added only while orders are open, before 16:00.');
    expect(await sampleOrders()).toEqual([]);
  });
});

describe('a press at Peliyagoda', () => {
  it('AC-3 every shop that has not ordered: on the seeded day the 10 free shops, and the rest left alone', async () => {
    const preview = SampleOrdersPreview.parse((await as.ruwan.get(SAMPLE)).body);
    expect(preview).toEqual({ deliveryDate: THU, depots: [{ depotId: 'Peliyagoda', shops: 75, canOrder: 10 }] });
    const before = await db.select({ id: orders.id, status: orders.status, revision: orders.revision }).from(orders);

    const result = await pressed('all');
    expect(result.deliveryDate).toBe(THU);
    expect(result.depots).toEqual([{ depotId: 'Peliyagoda', orders: 10, newOrders: 10, outletIds: expect.any(Array), topUpIds: [], alreadyHad: 65, cannotOrder: 0 }]);
    expect([...result.depots[0]!.outletIds].sort()).toEqual(FREE_AT_PELIYAGODA);
    // Nothing that was there changed, Nadeesha's draft included.
    const after = await db.select({ id: orders.id, status: orders.status, revision: orders.revision }).from(orders).where(inArray(orders.id, before.map((o) => o.id)));
    expect(after.sort((a, b) => a.id.localeCompare(b.id))).toEqual(before.sort((a, b) => a.id.localeCompare(b.id)));
    expect((await db.select().from(orders).where(and(eq(orders.outletId, 'OUT001'), eq(orders.status, 'draft')))).length).toBe(2);

    // "Every shop that hasn't ordered" never tops up: a second press places nothing.
    const again = await pressed('all');
    expect(again.depots).toEqual([{ depotId: 'Peliyagoda', orders: 0, newOrders: 0, outletIds: [], topUpIds: [], alreadyHad: 75, cannotOrder: 0 }]);
    expect((await sampleOrders()).length).toBe(10);
  });

  it('AC-2 when the free shops run out, tops up from shops that ordered, by the same shuffle, never the draft shop or a shop twice', async () => {
    const result = await pressed(25);
    const done = result.depots[0]!;
    expect(done).toMatchObject({ depotId: 'Peliyagoda', orders: 25, newOrders: 10, alreadyHad: 65, cannotOrder: 0 });
    expect([...done.outletIds].sort()).toEqual(FREE_AT_PELIYAGODA);
    expect(done.topUpIds).toHaveLength(15);
    expect(new Set([...done.outletIds, ...done.topUpIds]).size).toBe(25);
    expect(done.topUpIds).not.toContain('OUT001');
    // The top-ups are the first shops of the day's shuffle that had ordered.
    const all = await db.select({ id: outlets.id }).from(outlets).where(eq(outlets.depotId, 'Peliyagoda'));
    const ordered = (shop: { id: string }) => !FREE_AT_PELIYAGODA.includes(shop.id) && shop.id !== 'OUT001';
    expect(done.topUpIds).toEqual(pickShops(all, THU, 'Peliyagoda').filter(ordered).slice(0, 15).map((shop) => shop.id));

    // Each top-up is one small order of one line or a few, with no note, beside the shop's seeded order.
    const made = await sampleOrders();
    expect(made).toHaveLength(25);
    for (const id of done.topUpIds) {
      const mine = made.filter((o) => o.outletId === id);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.driverNote).toBeNull();
      const seeded = await db.select().from(orders).where(and(eq(orders.outletId, id), eq(orders.deliveryDate, THU), isNull(orders.placedBy)));
      expect(seeded.length).toBeGreaterThan(0);
      const units = (mine[0]!.lines as [string, number][]).reduce((sum, [, q]) => sum + q, 0);
      const seededUnits = (await db.select().from(orderLines).where(inArray(orderLines.orderId, seeded.map((o) => o.id)))).reduce((sum, l) => sum + l.quantity, 0);
      expect(units).toBeLessThanOrEqual(Math.max(1, Math.ceil(seededUnits * 0.35)));
    }

    // A second press tops up again, and a shop topped up before may get another.
    const second = (await pressed(25)).depots[0]!;
    expect(second).toMatchObject({ orders: 25, newOrders: 0, outletIds: [] });
    expect(new Set(second.topUpIds).size).toBe(25);
    expect(second.topUpIds).not.toContain('OUT001');
    expect((await sampleOrders()).length).toBe(50);
  });

  it('AC-1 AC-6 places each order as the shop itself would, signed by its manager, and the shop sees it', async () => {
    await freeMore();
    const result = await pressed(10);
    const placed = result.depots[0]!;
    expect(placed.outletIds).toHaveLength(10);
    expect(placed.alreadyHad).toBe(45);
    const made = await sampleOrders();
    expect(new Set(made.map((o) => o.outletId))).toEqual(new Set(placed.outletIds));
    expect(made).toHaveLength(placed.orders);

    const shops = await db.select().from(outlets).where(inArray(outlets.id, placed.outletIds));
    const managers = await db.select().from(users).where(and(eq(users.role, 'store_manager'), inArray(users.outletId, placed.outletIds)));
    const items = await db.select().from(products);
    for (const order of made) {
      const shop = shops.find((s) => s.id === order.outletId)!;
      const manager = managers.filter((m) => m.outletId === shop.id).sort((a, b) => a.staffId!.localeCompare(b.staffId!))[0]!;
      expect(order).toMatchObject({ status: 'placed', deliveryDate: THU, createdBy: manager.id, placedBy: manager.id });
      expect(order.placedAt).not.toBeNull();
      expect(order.savedAt).not.toBeNull();
      // Its brand's items, in the order's temperature, whole numbers from 1 to 999, and a note the form would take.
      for (const [productId, quantity] of order.lines as [string, number][]) {
        const item = items.find((i) => i.id === productId)!;
        expect([order.outletId, item.brand, item.temp]).toEqual([order.outletId, shop.brand, order.temp]);
        expect(Number.isInteger(quantity) && quantity >= 1 && quantity <= 999).toBe(true);
      }
      expect((order.driverNote ?? '').length).toBeLessThanOrEqual(200);
    }
    // A Fresh shop with chilled and dry cartons placed two orders, as on its own screen.
    expect(placed.orders).toBe(made.length);

    // The picked shops are the first 10 of the day's shuffle that may order.
    const all = await db.select({ id: outlets.id }).from(outlets).where(eq(outlets.depotId, 'Peliyagoda'));
    const free = new Set([...FREE_AT_PELIYAGODA, ...MORE]);
    expect(placed.outletIds).toEqual(pickShops(all, THU, 'Peliyagoda').filter((s) => free.has(s.id)).slice(0, 10).map((s) => s.id));
  });

  it('AC-6 shows in the shop own list of open orders', async () => {
    const result = await pressed(10);
    expect(result.depots[0]!.outletIds).toContain('OUT064');
    const open = StoreOrderList.parse((await as.tharindu.get('/api/v1/store/orders?list=open')).body);
    const thursday = open.orders.filter((o) => o.deliveryDate === THU);
    expect(thursday).toHaveLength(1);
    expect(thursday[0]).toMatchObject({ status: 'placed', temp: 'dry' });
    expect(thursday[0]!.lines.every((line) => line.productId.startsWith('tech-'))).toBe(true);
  });

  it('AC-4 the same press on the same day places the same shops and lines, and a second press other shops', async () => {
    await freeMore();
    const first = await pressed(10);
    const firstOrders = await sampleOrders();
    // Take them out and press again: the same.
    await db.delete(orders).where(inArray(orders.id, firstOrders.map((o) => o.id)));
    const again = await pressed(10);
    expect(again).toEqual(first);
    expect(shape(await sampleOrders())).toEqual(shape(firstOrders));
    // A second press adds other shops.
    const second = await pressed(10);
    expect(second.depots[0]!.outletIds).toHaveLength(10);
    expect(second.depots[0]!.outletIds.filter((id) => first.depots[0]!.outletIds.includes(id))).toEqual([]);
    expect(second.depots[0]!.alreadyHad).toBe(55);
  });

  it('AC-5 places them 40 to 90 seconds apart in the order picked, the last at the press and none later', async () => {
    await freeMore();
    const at = wed('15:20');
    setClockForTests(at);
    const result = await pressed(10);
    const made = await sampleOrders();
    const times = result.depots[0]!.outletIds.map((id) => made.find((o) => o.outletId === id)!.placedAt!.getTime());
    expect(times.at(-1)).toBe(at.getTime());
    for (let i = 1; i < times.length; i += 1) {
      const gap = (times[i]! - times[i - 1]!) / 1000;
      expect(gap).toBeGreaterThanOrEqual(40);
      expect(gap).toBeLessThanOrEqual(90);
    }
    expect(made.every((o) => o.placedAt!.getTime() <= at.getTime() && o.savedAt!.getTime() === o.placedAt!.getTime())).toBe(true);
  });

  it('AC-7 announces orders to each shop and its depot, once its order is saved', async () => {
    const result = await pressed(10);
    const told = vi.mocked(announce).mock.calls.map(([change]) => change);
    expect(told).toHaveLength(10);
    expect(told.map((c) => c.outletId).sort()).toEqual([...result.depots[0]!.outletIds].sort());
    expect(told.every((c) => c.topic === 'orders' && c.depotId === 'Peliyagoda')).toBe(true);
  });

  it('writes one audit row with what it placed', async () => {
    const earlier = new Set((await db.select({ id: auditLog.id }).from(auditLog)).map((row) => row.id));
    const result = await pressed(10);
    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'demo.sample_orders'));
    const mine = rows.filter((row) => !earlier.has(row.id));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.after).toEqual(result);
  });
});

describe('on Both (AC-8)', () => {
  it('places the number chosen at each depot and answers for each', async () => {
    expect((await as.ruwan.put('/api/v1/me/depot').send({ depotId: 'Both' })).status).toBe(200);
    const preview = SampleOrdersPreview.parse((await as.ruwan.get(SAMPLE)).body);
    expect(preview.depots).toEqual([{ depotId: 'Peliyagoda', shops: 75, canOrder: 10 }, { depotId: 'Kandy', shops: 45, canOrder: 2 }]);
    const result = await pressed(10);
    expect(result.depots.map((d) => [d.depotId, d.orders, d.newOrders, [...d.outletIds].sort(), d.topUpIds.length, d.alreadyHad])).toEqual([
      ['Peliyagoda', 10, 10, FREE_AT_PELIYAGODA, 0, 65],
      ['Kandy', 10, 2, ['OUT090', 'OUT120'], 8, 43],
    ]);
  });
});

describe('a reset (AC-11)', () => {
  it('takes the sample orders away like every other order', async () => {
    const seeded = (await db.select({ n: sql<number>`count(*)::int` }).from(orders))[0]!.n;
    await pressed('all');
    expect((await db.select({ n: sql<number>`count(*)::int` }).from(orders))[0]!.n).toBe(seeded + 10);
    expect((await as.ruwan.post('/api/v1/demo/reset').send({})).status).toBe(200);
    expect((await db.select({ n: sql<number>`count(*)::int` }).from(orders))[0]!.n).toBe(seeded);
    expect(await sampleOrders()).toEqual([]);
    expect((await db.select().from(orders).where(and(eq(orders.deliveryDate, THU), isNull(orders.placedAt), ne(orders.status, 'draft')))).length).toBe(0);
  });
});
