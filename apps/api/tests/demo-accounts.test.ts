import { hash, verify } from '@node-rs/argon2';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool } from '../src/db/client';
import { seedDemoAccounts } from '../src/db/demo-accounts';
import { DEMO_USERS } from '../src/db/fixtures';
import { users } from '../src/db/schema';
import { ADMIN_PIN, PIN } from './sign-in';

// Spec 018, AC-5: the seed gives every demo account its staff ID and PIN, on a fresh database and, once, on one seeded
// before staff IDs.

// Every hash the seed makes goes through argon2's hash. The spy counts them and changes nothing.
vi.mock('@node-rs/argon2', async (original) => {
  const argon2 = await original<typeof import('@node-rs/argon2')>();
  return { ...argon2, hash: vi.fn(argon2.hash) };
});
const hashed = () => vi.mocked(hash).mock.calls.map(([pin]) => pin).sort();

const USERNAMES = DEMO_USERS.map((account) => account.username);
const demoRows = () => db.select().from(users).where(inArray(users.username, USERNAMES)).orderBy(users.username);
const rowOf = async (username: string) => (await db.select().from(users).where(eq(users.username, username)))[0]!;
const pinOf = (username: string) => (username === 'admin' ? ADMIN_PIN : PIN);
// Each demo row's version. Postgres gives a row a new one whenever it is written.
const versions = async () => (await pool.query<{ username: string; version: string }>(
  'select username, xmin::text as version from users where username = any($1) order by username', [USERNAMES])).rows;
const written = (before: { username: string; version: string }[], after: { username: string; version: string }[]) =>
  after.filter((row, i) => row.version !== before[i]!.version).map((row) => row.username);

// The demo accounts as this file found them, put back before every test and at the end. Accounts made here go too.
const found = await demoRows();
const MADE = 'demo-accounts-test-';
async function putBack() {
  await db.delete(users).where(like(users.username, `${MADE}%`));
  for (const row of found) await db.update(users).set(row).where(eq(users.id, row.id));
}
beforeEach(async () => {
  await putBack();
  vi.mocked(hash).mockClear();
});
afterAll(async () => {
  await putBack();
  await pool.end();
});

// spec.md's table: the named accounts, then D-003 to D-036 for Chaminda to Wasantha in fixture order.
const NAMED: Record<string, string> = { nadeesha: 'S-001', ishara: 'S-002', tharindu: 'S-003', ruwan: 'P-001', kasun: 'L-001', dilshan: 'D-001', prasanna: 'D-002', admin: 'A-001' };
const DRIVERS = ['chaminda', 'lasantha', 'priyantha', 'sanjeewa', 'mahesh', 'nuwan', 'saman', 'pradeep', 'asanka', 'chathura', 'kamal', 'sunil', 'nimal',
  'janaka', 'roshan', 'suresh', 'anura', 'buddhika', 'dinesh', 'gayan', 'harsha', 'isuru', 'jagath', 'kelum', 'lahiru', 'madushan', 'nalin', 'pasan',
  'rangana', 'sampath', 'thilak', 'udara', 'viraj', 'wasantha'];
const TABLE: Record<string, string> = { ...NAMED, ...Object.fromEntries(DRIVERS.map((name, i) => [name, `D-${String(i + 3).padStart(3, '0')}`])) };

describe('the demo accounts on a fresh database', () => {
  it('AC-5 the seed gave every demo account its staff ID from the table and the demo PIN, admin its own', async () => {
    const rows = await demoRows();
    expect(rows.length).toBe(Object.keys(TABLE).length);
    for (const row of rows) {
      expect([row.username, row.staffId]).toEqual([row.username, TABLE[row.username]]);
      expect(await verify(row.pinHash!, pinOf(row.username))).toBe(true);
    }
  });

  it('AC-5 adds an account that is not there with its staff ID and PIN, hashing each PIN once', async () => {
    const fresh = [
      { username: `${MADE}driver`, staffId: 'D-901', displayName: 'Test driver', role: 'driver', depot: 'Peliyagoda', outlet: null },
      { username: `${MADE}second-driver`, staffId: 'D-902', displayName: 'Second test driver', role: 'driver', depot: 'Peliyagoda', outlet: null },
      { username: `${MADE}admin`, staffId: 'A-901', displayName: 'Test admin', role: 'admin', depot: null, outlet: null },
    ] as const;
    expect(await seedDemoAccounts(fresh)).toEqual({ added: 3, filled: 0 });
    expect(hashed()).toEqual([PIN, ADMIN_PIN].sort());
    for (const account of fresh) {
      const row = await rowOf(account.username);
      expect(row).toMatchObject({ staffId: account.staffId, displayName: account.displayName, role: account.role, depotId: account.depot, outletId: null, active: true, failedPins: 0, lockedUntil: null });
      expect(await verify(row.pinHash!, account.role === 'admin' ? ADMIN_PIN : PIN)).toBe(true);
    }
  });
});

describe('the demo accounts on a database seeded before staff IDs', () => {
  it('AC-5 gives every demo account its staff ID and PIN, hashing each PIN once and touching nothing else', async () => {
    await db.update(users).set({ staffId: null, pinHash: null }).where(inArray(users.username, USERNAMES));
    // Dilshan has typed two wrong PINs, which stays as it is.
    await db.update(users).set({ failedPins: 2 }).where(eq(users.username, 'dilshan'));
    const before = await demoRows();
    expect(await seedDemoAccounts()).toEqual({ added: 0, filled: USERNAMES.length });
    expect(hashed()).toEqual([PIN, ADMIN_PIN].sort());
    const after = await demoRows();
    const rest = (rows: typeof after) => rows.map(({ staffId: _staffId, pinHash: _pinHash, ...other }) => other);
    expect(rest(after)).toEqual(rest(before));
    for (const row of after) {
      expect(row.staffId).toBe(TABLE[row.username]);
      expect(await verify(row.pinHash!, pinOf(row.username))).toBe(true);
    }
  });

  it('AC-5 fills only what is empty and leaves an account that has its staff ID and PIN alone', async () => {
    // Nadeesha has a PIN of her own, Ruwan has no PIN and Kasun has no staff ID.
    const nadeeshas = await hash(PIN === '5555' ? '6666' : '5555');
    await db.update(users).set({ pinHash: nadeeshas }).where(eq(users.username, 'nadeesha'));
    await db.update(users).set({ pinHash: null }).where(eq(users.username, 'ruwan'));
    await db.update(users).set({ staffId: null }).where(eq(users.username, 'kasun'));
    const kasunsPin = (await rowOf('kasun')).pinHash;
    const before = await versions();
    vi.mocked(hash).mockClear();

    expect(await seedDemoAccounts()).toEqual({ added: 0, filled: 2 });
    expect(written(before, await versions())).toEqual(['kasun', 'ruwan']);
    expect((await rowOf('nadeesha')).pinHash).toBe(nadeeshas);
    const ruwan = await rowOf('ruwan');
    expect(ruwan.staffId).toBe('P-001');
    expect(await verify(ruwan.pinHash!, PIN)).toBe(true);
    expect(await rowOf('kasun')).toMatchObject({ staffId: 'L-001', pinHash: kasunsPin });
  });

  it('AC-5 does nothing on every later start: no hashing and no row written', async () => {
    const before = await versions();
    expect(await seedDemoAccounts()).toEqual({ added: 0, filled: 0 });
    expect(vi.mocked(hash)).not.toHaveBeenCalled();
    expect(written(before, await versions())).toEqual([]);
  });
});
