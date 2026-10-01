import { boolean, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { roleEnum } from './enums';
import { depots, outlets } from './reference';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // The fixtures' and the tests' handle for an account. Nobody signs in with it.
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  role: roleEnum('role').notNull(),
  // What a person signs in with (spec 018): a role letter, a dash and three digits, and a four-digit PIN, of which
  // only the hash is kept. A row seeded before them has neither until the seed fills them in, and the sign-in treats
  // a row without both as unknown.
  staffId: text('staff_id').unique(),
  pinHash: text('pin_hash'),
  // Wrong PINs in a row, and when the lock the fifth one sets ends.
  failedPins: smallint('failed_pins').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  // A store manager belongs to one outlet; dispatchers, loaders and drivers to one depot.
  outletId: text('outlet_id').references(() => outlets.id),
  depotId: text('depot_id').references(() => depots.id),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// The cookie holds a random token; only its SHA-256 is stored, so a leaked table cannot be used to log in.
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // The depot a dispatcher switched this session to (spec 020, D-93). Null until they switch: their own depot. A new
  // sign-in is a new session, so it starts there.
  depotId: text('depot_id').references(() => depots.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
