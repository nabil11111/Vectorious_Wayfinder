import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_DAY } from '@wayfinder/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/client';
import { orders, users } from '../src/db/schema';
import { depotInstant, setClockForTests } from '../src/lib/clock';
import { getNextOrder } from '../src/orders/store-orders';

// A database seeded before spec 009 holds drafts with no saved time, and seeding again leaves a seeded day alone.
// Migration 0003 gives those drafts a time, or the shop could not open its next order after an upgrade.
const migration = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle/0003_shop-orders.sql'), 'utf8');
const backfill = migration.split('--> statement-breakpoint').map((part) => part.trim()).find((part) => part.includes('UPDATE "orders" SET "saved_at"'));

afterAll(async () => {
  setClockForTests(null);
  await pool.end();
});

describe('upgrading a database seeded before shop orders', () => {
  it('gives every draft a saved time, so the shop can open its next order', async () => {
    expect(backfill).toBeDefined();
    setClockForTests(depotInstant(DEMO_DAY.orderDay, 15 * 60));
    const [nadeesha] = await db.select({ id: users.id }).from(users).where(eq(users.username, 'nadeesha'));
    const drafts = and(eq(orders.outletId, 'OUT001'), eq(orders.status, 'draft'));
    const found = await db.select({ id: orders.id, savedAt: orders.savedAt }).from(orders).where(drafts);
    expect(found).toHaveLength(2);
    try {
      // The drafts as the old seed left them, then the migration's statement.
      await db.update(orders).set({ savedAt: null }).where(drafts);
      await db.execute(sql.raw(backfill!));
      const next = await getNextOrder({ userId: nadeesha!.id, outletId: 'OUT001' });
      expect(next.draft?.savedAt).toEqual(expect.any(String));
    } finally {
      for (const row of found) await db.update(orders).set({ savedAt: row.savedAt }).where(eq(orders.id, row.id));
    }
  });
});
