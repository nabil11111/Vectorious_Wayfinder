import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hash, verify } from '@node-rs/argon2';
import type { Role } from '@wayfinder/contracts';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool, type Tx } from '../src/db/client';
import { seedDemoAccounts } from '../src/db/demo-accounts';
import { clearDemoDay } from '../src/db/demo-day';
import { DEMO_USERS } from '../src/db/fixtures';
import { auditLog, outlets, users, vehicleDaysOff, vehicles } from '../src/db/schema';
import { ADMIN_PIN, PIN } from './sign-in';

// Spec 018, AC-5: the seed gives every demo account its staff ID and PIN, on a fresh database and, once, on one seeded
// before staff IDs. Spec 020, AC-1: every shop has a store manager, Kandy its drivers and a loader, and
// docs/accounts.md lists the same accounts.

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

// Spec 018's table: the named accounts, then D-003 to D-036 for Chaminda to Wasantha in fixture order. Spec 020 keeps
// them as they are, and the accounts it adds follow from the shops and Kandy's fleet (the tests under it below).
const NAMED: Record<string, string> = { nadeesha: 'S-001', ishara: 'S-002', tharindu: 'S-003', ruwan: 'P-001', kasun: 'L-001', dilshan: 'D-001', prasanna: 'D-002', admin: 'A-001' };
const DRIVERS = ['chaminda', 'lasantha', 'priyantha', 'sanjeewa', 'mahesh', 'nuwan', 'saman', 'pradeep', 'asanka', 'chathura', 'kamal', 'sunil', 'nimal',
  'janaka', 'roshan', 'suresh', 'anura', 'buddhika', 'dinesh', 'gayan', 'harsha', 'isuru', 'jagath', 'kelum', 'lahiru', 'madushan', 'nalin', 'pasan',
  'rangana', 'sampath', 'thilak', 'udara', 'viraj', 'wasantha'];
const TABLE: Record<string, string> = { ...NAMED, ...Object.fromEntries(DRIVERS.map((name, i) => [name, `D-${String(i + 3).padStart(3, '0')}`])) };

// Every PIN the rows hold, checked against the PIN each row should have. The seed hashes a PIN once for all the
// accounts it writes at a time, so each pair is checked once rather than once per row.
async function expectPins(rows: { username: string; pinHash: string | null }[]) {
  const pairs = new Map(rows.map((row) => [`${row.pinHash} ${pinOf(row.username)}`, [row.pinHash, pinOf(row.username)] as const]));
  for (const [pinHash, pin] of pairs.values()) expect([pinHash !== null && await verify(pinHash, pin), pin]).toEqual([true, pin]);
}

describe('the demo accounts on a fresh database', () => {
  it('AC-5 the seed gave every demo account its staff ID and the demo PIN, admin its own, and spec 018\'s accounts the IDs of its table', async () => {
    const rows = await demoRows();
    const staffIdsOf = (list: readonly { username: string; staffId: string | null }[]) => Object.fromEntries(list.map((account) => [account.username, account.staffId]));
    expect(staffIdsOf(rows)).toEqual(staffIdsOf(DEMO_USERS));
    expect(Object.fromEntries(Object.keys(TABLE).map((username) => [username, staffIdsOf(rows)[username]]))).toEqual(TABLE);
    await expectPins(rows);
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

// Spec 020: an account for every shop, and Kandy's staff. The staff IDs follow from the shops and the vehicles the
// database holds, so the fixtures are checked against the rules and not against themselves.
const THU = '2026-06-25';
const staffNumber = (prefix: string, n: number) => `${prefix}-${String(n).padStart(3, '0')}`;
const ROLE_NAMES: Record<Role, string> = { store_manager: 'Store manager', dispatcher: 'Dispatcher', loader: 'Loader', driver: 'Driver', admin: 'Admin' };

describe('every shop\'s account and Kandy\'s staff (spec 020)', () => {
  it('AC-1 gives each of the 120 shops exactly one store manager: S-001 to S-003 as they were, then S-004 to S-120 in outlet order', async () => {
    const shops = await db.select({ id: outlets.id, depotId: outlets.depotId }).from(outlets).orderBy(outlets.id);
    expect(shops).toHaveLength(120);
    const managers = (await demoRows()).filter((row) => row.role === 'store_manager');

    // One for each shop, of the shop's own depot.
    expect(managers.map((manager) => manager.outletId).sort()).toEqual(shops.map((shop) => shop.id));
    expect(managers.filter((manager) => manager.depotId !== shops.find((shop) => shop.id === manager.outletId)!.depotId)).toEqual([]);

    // The walkthrough's three keep theirs, and the other 117 follow in outlet order from S-004.
    const walkthrough: Record<string, string> = { OUT001: 'S-001', OUT017: 'S-002', OUT064: 'S-003' };
    const others = shops.map((shop) => shop.id).filter((id) => !(id in walkthrough));
    const expected = { ...walkthrough, ...Object.fromEntries(others.map((id, i) => [id, staffNumber('S', i + 4)])) };
    expect(Object.fromEntries(managers.map((manager) => [manager.outletId, manager.staffId]))).toEqual(expected);
    // OUT002 is S-004, the spec's S-047 is OUT046, and the last shop is S-120.
    expect([expected.OUT002, expected.OUT046, expected.OUT120]).toEqual(['S-004', 'S-047', 'S-120']);
  });

  it('AC-1 gives Kandy a driver for each of its vehicles not in the workshop on Thursday, Prasanna\'s D-002 and D-037 onwards, and L-002 as its loader', async () => {
    const fleet = await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.depotId, 'Kandy'));
    const inWorkshop = await db.select({ id: vehicleDaysOff.vehicleId }).from(vehicleDaysOff)
      .innerJoin(vehicles, eq(vehicles.id, vehicleDaysOff.vehicleId)).where(and(eq(vehicles.depotId, 'Kandy'), eq(vehicleDaysOff.date, THU)));
    // None of Kandy's 22 is in the workshop on the seeded Thursday.
    expect([fleet.length, inWorkshop]).toEqual([22, []]);

    const staff = (await demoRows()).filter((row) => row.depotId === 'Kandy' && row.role !== 'store_manager');
    const drivers = staff.filter((row) => row.role === 'driver').map((row) => row.staffId).sort();
    expect(drivers).toEqual(['D-002', ...Array.from({ length: fleet.length - 1 }, (_, i) => staffNumber('D', 37 + i))]);
    expect(staff.filter((row) => row.role !== 'driver').map((row) => [row.staffId, row.role])).toEqual([['L-002', 'loader']]);
    // And Peliyagoda's staff stay as spec 018 left them: Ruwan, Kasun and a driver for each of its 35 working vehicles.
    const peliyagoda = (await demoRows()).filter((row) => row.depotId === 'Peliyagoda' && row.role !== 'store_manager');
    expect(peliyagoda.map((row) => row.staffId).sort()).toEqual(['D-001', ...Array.from({ length: 34 }, (_, i) => staffNumber('D', 3 + i)), 'L-001', 'P-001']);
  });

  it('AC-1 names every account from a fixed list, its username built from the name, no two alike', () => {
    expect(DEMO_USERS.filter((account) => account.username !== account.displayName.toLowerCase())).toEqual([]);
    expect(new Set(DEMO_USERS.map((account) => account.username)).size).toBe(DEMO_USERS.length);
    expect(new Set(DEMO_USERS.map((account) => account.staffId)).size).toBe(DEMO_USERS.length);
    expect(DEMO_USERS).toHaveLength(42 + 117 + 21 + 1);
  });

  it('AC-1 lists every account in docs/accounts.md with its staff ID, name, role, shop or depot and default PIN, and no other', async () => {
    const doc = readFileSync(fileURLToPath(new URL('../../../docs/accounts.md', import.meta.url)), 'utf8');
    const listed = [...doc.matchAll(/^\| `([A-Z]-\d{3})` \| ([^|]+?) \| ([^|]+?) \| ([^|]+?) \| `(\d{4})` \|$/gm)].map(([, staffId, name, role, where, pin]) => [staffId!, name!, role!, where!, pin!]);
    const shopNames = new Map((await db.select({ id: outlets.id, name: outlets.name }).from(outlets)).map((shop) => [shop.id, shop.name]));
    const whereOf = (account: (typeof DEMO_USERS)[number]) =>
      (account.outlet ? `${shopNames.get(account.outlet)} (${account.outlet})` : account.depot ? `${account.depot} depot` : 'Everything');
    const expected = DEMO_USERS.map((account) => [account.staffId, account.displayName, ROLE_NAMES[account.role], whereOf(account), account.role === 'admin' ? '9024' : '1234']);
    const byStaffId = (rows: string[][]) => [...rows].sort((a, b) => a[0]!.localeCompare(b[0]!));
    expect(byStaffId(listed)).toEqual(byStaffId(expected));
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
    expect(after.map((row) => [row.username, row.staffId])).toEqual(before.map((row) => [row.username, DEMO_USERS.find((account) => account.username === row.username)!.staffId]));
    await expectPins(after);
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

// Spec 020's failure paths: an install seeded before every shop had an account has spec 018's 42 accounts and none of
// the 139 this spec adds. The seed adds those on its next start and touches nothing that is there. Each test runs in a
// transaction it rolls back, so the accounts it takes away to make such an install come back.
class RolledBack extends Error {}
async function rolledBack(work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await work(tx);
      throw new RolledBack();
    });
  } catch (err) {
    if (!(err instanceof RolledBack)) throw err;
  }
}
const ADDED = DEMO_USERS.filter((account) => !(account.username in TABLE)).map((account) => account.username);
const allVersions = async (tx: Tx) => (await tx.execute<{ id: string; version: string }>(sql`select id, xmin::text as version from users order by id`)).rows;

describe('the demo accounts on a database seeded before spec 020', () => {
  it('AC-1 adds the 139 accounts it is missing with their staff IDs, shops and depots and the demo PIN, and writes no account that was there', async () => {
    await rolledBack(async (tx) => {
      // Such an install: nothing of the day or of the audit log can point at accounts it never had.
      expect(ADDED).toHaveLength(139);
      await clearDemoDay(tx);
      await tx.delete(auditLog).where(inArray(auditLog.actorId, tx.select({ id: users.id }).from(users).where(inArray(users.username, ADDED))));
      await tx.delete(users).where(inArray(users.username, ADDED));
      const before = await allVersions(tx);
      vi.mocked(hash).mockClear();

      expect(await seedDemoAccounts(DEMO_USERS, tx)).toEqual({ added: 139, filled: 0 });
      expect(hashed().filter((pin) => pin === PIN)).toEqual([PIN]);

      // Every account that was there is as it was, and the new ones are the fixtures' with the demo PIN.
      const after = await allVersions(tx);
      expect(after.filter((row) => before.some((was) => was.id === row.id))).toEqual(before);
      const made = await tx.select().from(users).where(inArray(users.username, ADDED)).orderBy(users.username);
      expect(made.map((row) => [row.username, row.staffId, row.displayName, row.role, row.depotId, row.outletId, row.active, row.failedPins, row.lockedUntil]))
        .toEqual(DEMO_USERS.filter((account) => ADDED.includes(account.username)).sort((a, b) => a.username.localeCompare(b.username))
          .map((account) => [account.username, account.staffId, account.displayName, account.role, account.depot, account.outlet, true, 0, null]));
      await expectPins(made);

      // The next start finds every account and writes nothing.
      const added = await allVersions(tx);
      vi.mocked(hash).mockClear();
      expect(await seedDemoAccounts(DEMO_USERS, tx)).toEqual({ added: 0, filled: 0 });
      expect(vi.mocked(hash)).not.toHaveBeenCalled();
      expect(await allVersions(tx)).toEqual(added);
    });
  });
});
