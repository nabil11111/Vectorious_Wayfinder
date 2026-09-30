import { hash, verify } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { moveAdminOffSharedPassword } from '../src/db/admin-password';
import { db, pool } from '../src/db/client';
import { users } from '../src/db/schema';

const shared = process.env.SEED_PASSWORD ?? 'wayfinder-demo';
const own = process.env.SEED_ADMIN_PASSWORD ?? 'wayfinder-admin';
const setAdmin = async (password: string) => db.update(users).set({ passwordHash: await hash(password) }).where(eq(users.username, 'admin'));
const adminHash = async () => (await db.select().from(users).where(eq(users.username, 'admin')))[0]!.passwordHash;

afterAll(async () => {
  await setAdmin(own);
  await pool.end();
});

describe('admin password on a database seeded before admin had its own', () => {
  it('moves admin off the shared demo password', async () => {
    await setAdmin(shared);
    await moveAdminOffSharedPassword();
    expect(await verify(await adminHash(), own)).toBe(true);
    expect(await verify(await adminHash(), shared)).toBe(false);
  });

  it('leaves a password someone has changed alone', async () => {
    await setAdmin('changed-by-a-person');
    await moveAdminOffSharedPassword();
    expect(await verify(await adminHash(), 'changed-by-a-person')).toBe(true);
  });
});
