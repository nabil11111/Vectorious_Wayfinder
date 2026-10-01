import { hash } from '@node-rs/argon2';
import type { Role } from '@wayfinder/contracts';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { config } from '../lib/config';
import { db } from './client';
import { DEMO_USERS } from './fixtures';
import { users } from './schema';

export interface DemoAccount {
  username: string;
  staffId: string;
  displayName: string;
  role: Role;
  depot: string | null;
  outlet: string | null;
}

// The demo accounts and what they sign in with (spec 018). An account that is not there is added with its staff ID
// and the demo PIN, admin's own for admin. One seeded before staff IDs has neither: it gets them once, each only
// where it is empty, and nothing else of the row changes, so a staff ID or PIN that is there stays. A later start
// finds nothing to do, so it hashes nothing and writes nothing. Each PIN is hashed once for all the accounts using it.
export async function seedDemoAccounts(accounts: readonly DemoAccount[] = DEMO_USERS): Promise<{ added: number; filled: number }> {
  const rows = await db.select({ username: users.username, staffId: users.staffId, pinHash: users.pinHash })
    .from(users).where(inArray(users.username, accounts.map((account) => account.username)));
  const found = new Map(rows.map((row) => [row.username, row]));
  const missing = accounts.filter((account) => !found.has(account.username));
  const empty = accounts.filter((account) => {
    const row = found.get(account.username);
    return row !== undefined && (row.staffId === null || row.pinHash === null);
  });
  if (!missing.length && !empty.length) return { added: 0, filled: 0 };

  const demoPinHash = await hash(config.SEED_PIN);
  const adminPinHash = await hash(config.SEED_ADMIN_PIN);
  const pinHashOf = (account: DemoAccount) => (account.role === 'admin' ? adminPinHash : demoPinHash);

  const added = missing.length
    ? await db.insert(users).values(missing.map((account) => ({
      username: account.username,
      staffId: account.staffId,
      displayName: account.displayName,
      role: account.role,
      pinHash: pinHashOf(account),
      depotId: account.depot,
      outletId: account.outlet,
    }))).onConflictDoNothing().returning({ id: users.id })
    : [];
  let filled = 0;
  for (const account of empty) {
    const done = await db.update(users)
      .set({ staffId: sql`coalesce(${users.staffId}, ${account.staffId})`, pinHash: sql`coalesce(${users.pinHash}, ${pinHashOf(account)})` })
      .where(and(eq(users.username, account.username), or(isNull(users.staffId), isNull(users.pinHash))))
      .returning({ id: users.id });
    filled += done.length;
  }
  return { added: added.length, filled };
}
