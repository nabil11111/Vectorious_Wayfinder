import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { issueKindEnum, issueStatusEnum } from './enums';
import { users } from './identity';
import { orderLines } from './orders';
import { stops } from './planning';

// A problem is one record whoever raises it (D-36): a loader's flag, a driver's refusal or closed shop, and a shop's
// report on its receipt, each a kind. The dispatcher decides it once. reason and decision are text checked against
// their lists in the contracts, as deferrals.code is, because each kind brings its own.
export const issues = pgTable('issues', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: issueKindEnum('kind').notNull(),
  reason: text('reason').notNull(),
  status: issueStatusEnum('status').notNull().default('open'),
  // An answer names the revision it saw, so two tabs cannot both answer.
  revision: integer('revision').notNull().default(0),
  stopId: uuid('stop_id').notNull().references(() => stops.id, { onDelete: 'cascade' }),
  raisedBy: uuid('raised_by').notNull().references(() => users.id),
  // Times people see come from the app clock (D-18).
  raisedAt: timestamp('raised_at', { withTimezone: true }).notNull(),
  note: text('note'),
  decision: text('decision'),
  decidedBy: uuid('decided_by').references(() => users.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
}, (t) => [
  // An answer is whole or absent: all three decision columns are set exactly when the problem is decided.
  check('issues_decided', sql`(${t.status} = 'open' and ${t.decision} is null and ${t.decidedBy} is null and ${t.decidedAt} is null)
    or (${t.status} = 'decided' and ${t.decision} is not null and ${t.decidedBy} is not null and ${t.decidedAt} is not null)`),
  index('issues_stop').on(t.stopId),
]);

// The lines a problem counts. For a loader's flag, counted is the good units at the dock.
export const issueLines = pgTable('issue_lines', {
  issueId: uuid('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  orderLineId: uuid('order_line_id').notNull().references(() => orderLines.id, { onDelete: 'cascade' }),
  counted: integer('counted').notNull(),
}, (t) => [
  primaryKey({ columns: [t.issueId, t.orderLineId] }),
  check('issue_lines_counted', sql`${t.counted} >= 0`),
]);
