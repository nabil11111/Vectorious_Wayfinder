import { afterAll, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/client';
import { clearDemoDay, seedDemoDay } from '../src/db/demo-day';
import { demoDay, orders, plans } from '../src/db/schema';
import { snapshot } from '../src/orders/store-orders';

// A reset truncates the day's tables, and a read holds each table it has touched until it ends. This file runs
// one reset of its own, which writes the seeded day again.
afterAll(async () => {
  await pool.end();
});

// Waits until a session in this database is queued for a lock: the reset has reached its truncate.
async function resetIsWaiting(): Promise<void> {
  for (let tries = 0; tries < 250; tries += 1) {
    const { rows } = await pool.query<{ waiting: number }>(
      'select count(*)::int as waiting from pg_locks where not granted and database = (select oid from pg_database where datname = current_database())',
    );
    if (rows[0]!.waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('The reset never waited for the read.');
}

describe('a read and a demo reset at the same moment', () => {
  it('take turns instead of deadlocking', async () => {
    let letReadFinish!: () => void;
    const readMayFinish = new Promise<void>((resolve) => { letReadFinish = resolve; });
    let markReading!: () => void;
    const reading = new Promise<void>((resolve) => { markReading = resolve; });

    // As the plan board reads: plans first, then orders.
    const read = snapshot(async (tx) => {
      await tx.select({ id: plans.id }).from(plans).limit(1);
      markReading();
      await readMayFinish;
      return (await tx.select({ id: orders.id }).from(orders)).length;
    });
    await reading;
    const reset = db.transaction(async (tx) => {
      await tx.select().from(demoDay).for('update');
      await clearDemoDay(tx);
      await seedDemoDay(tx);
    });
    await resetIsWaiting();
    letReadFinish();

    const [seen] = await Promise.all([read, reset]);
    expect(seen).toBeGreaterThan(0);
  });
});
