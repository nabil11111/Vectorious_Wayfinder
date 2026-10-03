import { sql } from 'drizzle-orm';
import { check, date, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity';
import { outlets } from './reference';

// One advisory receiving declaration per outlet and delivery day. Missing rows mean Not confirmed.
// Keep real updates, including an explicit return to unconfirmed, so stale writes cannot reuse revision zero.
export const outletReceiving = pgTable('outlet_receiving', {
  outletId: text('outlet_id').notNull().references(() => outlets.id),
  date: date('date').notNull(),
  status: text('status').notNull(),
  note: text('note'),
  revision: integer('revision').notNull(),
  updatedBy: uuid('updated_by').notNull().references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.outletId, t.date] }),
  check('outlet_receiving_status', sql`${t.status} in ('unconfirmed', 'ready', 'unavailable')`),
  check('outlet_receiving_revision', sql`${t.revision} > 0`),
  check('outlet_receiving_note_length', sql`length(${t.note}) <= 200`),
]);
