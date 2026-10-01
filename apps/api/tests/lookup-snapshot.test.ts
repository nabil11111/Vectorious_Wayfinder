import { eq, sql } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';
import { db, pool } from '../src/db/client';
import { clearDemoDay, seedDemoDay } from '../src/db/demo-day';
import { demoDay, fuelLog, orders } from '../src/db/schema';
import * as board from '../src/plans/board';
import * as problems from '../src/issues/read';
import * as driver from '../src/driver/day';
import { driverStop } from './driver-plan';
import { decide } from './operations-plan';
import { receiptOf, shopScreen } from './receipt-plan';
import { sendWalkthroughPlan, THU } from './loading-plan';
import { lookupHarness } from './lookup-plan';
const clock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async original => {
  const actual = await original<typeof import('../src/lib/clock')>();
  return { ...actual, demoClockAt: (...args: Parameters<typeof actual.demoClockAt>) => ({ ...actual.demoClockAt(...args), now: clock.at || actual.demoClockAt(...args).now }) };
});
const h = await lookupHarness(clock);

// Pause after the snapshot's first query. The other transaction really commits before the rest of the read.
async function acrossWrite<T>(read: () => Promise<T>, write: () => Promise<unknown>) {
  let entered!: () => void, release!: () => void;
  const atRead = new Promise<void>(resolve => { entered = resolve; }), resume = new Promise<void>(resolve => { release = resolve; });
  const original = board.readMoment;
  const spy = vi.spyOn(board, 'readMoment').mockImplementationOnce(async tx => { const value = await original(tx); entered(); await resume; return value; });
  const pending = read();
  try { await atRead; await write(); } finally { release(); spy.mockRestore(); }
  return pending;
}
for (const kind of ['orders', 'fleet'] as const) {
  it(`AC-27 ${kind} keeps one snapshot while a write commits`, async () => {
    const read = async () => await h[kind]();
    const before = await read();
    const during = await acrossWrite(read, async () => {
      if (kind === 'orders') await db.update(orders).set({ status: 'placed' }).where(eq(orders.status, 'draft'));
      else await db.insert(fuelLog).values({ vehicleId: 'VEH001', date: THU, litres: '1.1' });
    });
    expect(during).toEqual(before);
    expect(await read()).not.toEqual(before);
  });
  it(`AC-27 ${kind} holds reset outside its snapshot without deadlock`, async () => {
    await sendWalkthroughPlan(h);
    const read = async () => await h[kind](), before = await read();
    let entered!: () => void, release!: () => void;
    const atRead = new Promise<void>(resolve => { entered = resolve; }), resume = new Promise<void>(resolve => { release = resolve; });
    const original = board.readMoment;
    const spy = vi.spyOn(board, 'readMoment').mockImplementationOnce(async tx => { const value = await original(tx); entered(); await resume; return value; });
    const pending = read();
    await atRead;
    const reset = db.transaction(async tx => {
      await tx.select().from(demoDay).for('update');
      await clearDemoDay(tx); await seedDemoDay(tx); await tx.update(demoDay).set({ day: sql`${demoDay.day} + 1` });
    });
    try {
      let waiting = false;
      for (let n = 0; n < 250; n++) {
        const locks = await pool.query('select 1 from pg_locks where not granted and database = (select oid from pg_database where datname = current_database())');
        if (locks.rowCount) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
    } finally { release(); spy.mockRestore(); }
    const [during] = await Promise.all([pending, reset]);
    expect(during).toEqual(before);
    expect((await read()).demoDay).toBe(before.demoDay! + 1);
  });
}
it('AC-27 history keeps the closed stop and its issue in one snapshot across Try again', async () => {
  const trip = await h.road.write(await h.road.wellawatte(), 'closed', 228, 2);
  const problem = trip.problems.find(row => row.kind === 'closed')!;
  const read = () => h.history(`?date=${THU}`), before = await read();
  let entered!: () => void, release!: () => void;
  const atRead = new Promise<void>(resolve => { entered = resolve; }), resume = new Promise<void>(resolve => { release = resolve; });
  const original = problems.issuesOf;
  const spy = vi.spyOn(problems, 'issuesOf').mockImplementationOnce(async (tx, where) => { entered(); await resume; return original(tx, where); });
  const pending = read();
  try { await atRead; await decide(h.ruwan, problem.id, 'try_again'); } finally { release(); spy.mockRestore(); }
  expect(await pending).toEqual(before);
  expect((await read()).trips[0]!.stops[1]).toMatchObject({ outcome: null, attempts: [{ decision: 'try_again' }] });
});
it('AC-27 history cannot mix pre-confirmation orders with post-confirmation receipt lines', async () => {
  const trip = await h.road.wellawatte(), shop = shopScreen(h.nadeesha), delivery = await shop.one(driverStop(trip, 1).id);
  h.freeze(THU, 513);
  const read = () => h.history(`?date=${THU}`), before = await read();
  let entered!: () => void, release!: () => void;
  const atRead = new Promise<void>(resolve => { entered = resolve; }), resume = new Promise<void>(resolve => { release = resolve; });
  const original = driver.driverTripsOf;
  const spy = vi.spyOn(driver, 'driverTripsOf').mockImplementationOnce(async (tx, rows, at) => { const value = await original(tx, rows, at); entered(); await resume; return value; });
  const pending = read();
  try {
    await atRead;
    expect((await shop.send(receiptOf(delivery, [11, 8, 3], { reason: 'missing' }))).status).toBe(200);
  } finally { release(); spy.mockRestore(); }
  expect(await pending).toEqual(before);
  expect((await read()).trips[0]!.stops[0]!.receipt).toMatchObject({ received: 22 });
});
for (const kind of ['history', 'proof'] as const) {
  it(`AC-27 ${kind} and reset finish in separate committed generations`, async () => {
    const trip = await h.road.wellawatte(), url = `/api/v1/lookup/stops/${driverStop(trip, 1).id}/photo`;
    const read = async () => {
      if (kind === 'history') return h.history(`?date=${THU}`);
      const res = await h.ruwan.get(url); expect(res.status).toBe(200); return res.body;
    };
    const before = await read();
    let entered!: () => void, release!: () => void;
    const atRead = new Promise<void>(resolve => { entered = resolve; }), resume = new Promise<void>(resolve => { release = resolve; });
    const original = board.readMoment;
    const spy = vi.spyOn(board, 'readMoment').mockImplementationOnce(async tx => { const value = await original(tx); entered(); await resume; return value; });
    const pending = read();
    await atRead;
    const reset = db.transaction(async tx => {
      await tx.select().from(demoDay).for('update');
      await clearDemoDay(tx); await seedDemoDay(tx); await tx.update(demoDay).set({ day: sql`${demoDay.day} + 1` });
    });
    try {
      let waiting = false;
      for (let n = 0; n < 250; n++) {
        const locks = await pool.query('select 1 from pg_locks where not granted and database = (select oid from pg_database where datname = current_database())');
        if (locks.rowCount) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
    } finally { release(); spy.mockRestore(); }
    const [during] = await Promise.all([pending, reset]);
    expect(during).toEqual(before);
    if (kind === 'history') expect(await h.history(`?date=${THU}`)).toMatchObject({ publication: null, counts: null, demoDay: before.demoDay + 1 });
    else expect((await h.ruwan.get(url)).status).toBe(400);
  });
}
