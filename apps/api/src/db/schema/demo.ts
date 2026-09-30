import { sql } from 'drizzle-orm';
import { check, date, integer, numeric, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { trips } from './planning';
import { vehicles } from './reference';

// The demo day (spec 008). One row holds the app's clock and whether the seeded day has been written. The
// clock is stored as two times, so it carries on from where it was after a restart.
export const demoDay = pgTable('demo_day', {
  id: smallint('id').primaryKey().default(1),
  // The app's time at the moment the clock was last set, and the real time at that moment.
  clockBase: timestamp('clock_base', { withTimezone: true }).notNull(),
  clockSetAt: timestamp('clock_set_at', { withTimezone: true }).notNull(),
  // Goes up by one on every move and every reset, so two people cannot move the clock at once.
  revision: integer('revision').notNull().default(0),
  // Goes up by one on every reset.
  day: integer('day').notNull().default(1),
  // The real time the day was written. Empty means the seed has not written it yet.
  seededAt: timestamp('seeded_at', { withTimezone: true }),
}, (t) => [check('demo_day_one_row', sql`${t.id} = 1`)]);

// A vehicle that cannot be used on a date, with the reason the dispatcher sees. The plan checker reads it
// as "available" for the plan date.
export const vehicleDaysOff = pgTable('vehicle_days_off', {
  vehicleId: text('vehicle_id').notNull().references(() => vehicles.id),
  date: date('date').notNull(),
  reason: text('reason').notNull(),
}, (t) => [primaryKey({ columns: [t.vehicleId, t.date] })]);

// Litres a vehicle used on a date. The plan checker adds a week of these up against the weekly quota (D-20).
// A history row has no trip and there is one per vehicle per day. A sent trip writes one row of its own.
export const fuelLog = pgTable('fuel_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  vehicleId: text('vehicle_id').notNull().references(() => vehicles.id),
  date: date('date').notNull(),
  litres: numeric('litres', { precision: 6, scale: 1 }).notNull(),
  tripId: uuid('trip_id').references(() => trips.id, { onDelete: 'cascade' }),
  note: text('note'),
}, (t) => [
  check('fuel_log_litres_positive', sql`${t.litres} > 0`),
  uniqueIndex('fuel_log_history_day').on(t.vehicleId, t.date).where(sql`${t.tripId} is null`),
  uniqueIndex('fuel_log_trip').on(t.tripId).where(sql`${t.tripId} is not null`),
]);
