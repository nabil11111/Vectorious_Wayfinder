import { hash, verify } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { config } from '../lib/config';
import { db } from './client';
import { users } from './schema';

// Databases seeded before admin had its own password still have admin on the shared demo one, and the seed
// never touches an account that already exists. This moves admin over once. It only acts while admin is
// still on the shared password, so a password someone has changed is left alone on every later start.
export async function moveAdminOffSharedPassword(): Promise<boolean> {
  if (config.SEED_ADMIN_PASSWORD === config.SEED_PASSWORD) return false;
  const [admin] = await db.select().from(users).where(eq(users.username, 'admin'));
  if (!admin || !(await verify(admin.passwordHash, config.SEED_PASSWORD))) return false;
  await db.update(users).set({ passwordHash: await hash(config.SEED_ADMIN_PASSWORD) }).where(eq(users.id, admin.id));
  return true;
}
