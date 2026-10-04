import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity';

// One browser's push subscription (spec 031). The endpoint belongs to the browser, so a later sign-in on the same
// phone replaces the owner. pushed_ids are the updates already handed to that browser, so turning alerts on does not
// repeat the day and a retry does not show one twice.
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  pushedIds: text('pushed_ids').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('push_subscriptions_endpoint').on(t.endpoint)]);
