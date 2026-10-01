import { sql } from 'drizzle-orm';
import { customType, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity';
import { issues } from './issues';
import { stops, trips } from './planning';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

// A phone's applied writes survive leaving the driver's day. Real time records when a repeat was last answered.
export const driverWrites = pgTable('driver_writes', {
  id: uuid('id').primaryKey(),
  driverId: uuid('driver_id').notNull().references(() => users.id),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  bodyHash: text('body_hash').notNull(),
  answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('driver_writes_driver').on(t.driverId, t.answeredAt)]);

// The proof and its delivery commit together. Problem photos name the problem, preserving each retry's attempt.
export const photos = pgTable('photos', {
  id: uuid('id').primaryKey(),
  stopId: uuid('stop_id').notNull().references(() => stops.id, { onDelete: 'cascade' }),
  issueId: uuid('issue_id').references(() => issues.id, { onDelete: 'cascade' }),
  jpeg: bytea('jpeg').notNull(),
  takenBy: uuid('taken_by').notNull().references(() => users.id),
  takenAt: timestamp('taken_at', { withTimezone: true }).notNull(),
}, t => [uniqueIndex('photos_issue').on(t.issueId), uniqueIndex('photos_proof').on(t.stopId).where(sql`${t.issueId} is null`)]);
