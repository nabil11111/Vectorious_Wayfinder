import { eq, sql } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';
import { db, pool } from '../src/db/client';
import { clearDemoDay, seedDemoDay } from '../src/db/demo-day';
import { demoDay, fuelLog, orders } from '../src/db/schema';
import * as board from '../src/plans/board';
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
    const read = () => h[kind]();
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
    const read = () => h[kind](), before = await read();
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
