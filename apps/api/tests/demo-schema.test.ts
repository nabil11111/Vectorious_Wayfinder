import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/client';
import { demoDay, fuelLog, plans, trips, vehicleDaysOff, vehicles } from '../src/db/schema';

// A date no real plan or seeded day will use, so this never collides with either.
const date = '2099-01-02';
const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.depotId, 'Peliyagoda')).limit(1);
const vehicleId = vehicle!.id;

afterAll(async () => {
  await db.delete(plans).where(eq(plans.date, date));
  await db.delete(fuelLog).where(eq(fuelLog.date, date));
  await db.delete(vehicleDaysOff).where(eq(vehicleDaysOff.date, date));
  await pool.end();
});

describe('demo day tables', () => {
  it('keep the clock to one row', async () => {
    const at = new Date('2026-06-24T09:30:00Z');
    await expect(db.insert(demoDay).values({ id: 2, clockBase: at, clockSetAt: at })).rejects.toThrow();
  });

  it('take a vehicle off a date once, with its reason', async () => {
    await db.insert(vehicleDaysOff).values({ vehicleId, date, reason: 'Brake service' });
    await expect(db.insert(vehicleDaysOff).values({ vehicleId, date, reason: 'Again' })).rejects.toThrow();
  });

  it('refuse a fuel row with no litres', async () => {
    await expect(db.insert(fuelLog).values({ vehicleId, date, litres: '0' })).rejects.toThrow();
  });

  it('hold one history row per vehicle per day, and one row per trip', async () => {
    await db.insert(fuelLog).values({ vehicleId, date, litres: '41.5', note: 'Seeded history' });
    await expect(db.insert(fuelLog).values({ vehicleId, date, litres: '12' })).rejects.toThrow();

    const [plan] = await db.insert(plans).values({ depotId: 'Peliyagoda', date }).returning();
    const [trip] = await db.insert(trips).values({ planId: plan!.id, vehicleId, tripNo: 1 }).returning();
    await db.insert(fuelLog).values({ vehicleId, date, litres: '63.6', tripId: trip!.id });
    await expect(db.insert(fuelLog).values({ vehicleId, date, litres: '63.6', tripId: trip!.id })).rejects.toThrow();
  });

  it('remove a trip\'s fuel row with its trip, and keep the history row', async () => {
    await db.delete(plans).where(eq(plans.date, date));
    const left = await db.select().from(fuelLog).where(and(eq(fuelLog.vehicleId, vehicleId), eq(fuelLog.date, date)));
    expect(left.map((row) => [row.litres, row.tripId])).toEqual([['41.5', null]]);
  });
});
