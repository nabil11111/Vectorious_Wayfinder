import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/client';
import { plans, trips, vehicles } from '../src/db/schema';

// A date no real plan will use, so this never collides with seeded or hand-made plans.
const date = '2099-01-01';
afterAll(async () => {
  await db.delete(plans).where(eq(plans.date, date));
  await pool.end();
});

describe('plan tables', () => {
  it('allow a vehicle two trips in a day and refuse a third', async () => {
    const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.depotId, 'Peliyagoda')).limit(1);
    const [plan] = await db.insert(plans).values({ depotId: 'Peliyagoda', date }).returning();
    const trip = (tripNo: number) => db.insert(trips).values({ planId: plan!.id, vehicleId: vehicle!.id, tripNo });
    await trip(1);
    await trip(2);
    await expect(trip(3)).rejects.toThrow();
  });
});
