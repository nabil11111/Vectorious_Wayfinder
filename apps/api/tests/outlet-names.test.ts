import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/client';
import { outlets } from '../src/db/schema';

const api = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
type Row = Record<string, string>;
const read = (file: string): Row[] => parse(readFileSync(path.resolve(api, '../../data', file)), { columns: true, skip_empty_lines: true });
const shops = read('shared/outlets.csv');
const named = read('fixtures/outlet-names.csv');
const nameOf = new Map(named.map((r) => [r.outlet_id!, r.name!]));

// The seed is a script that closes the database when it is done, so it runs the way people run it. On Windows
// npm is a .cmd file, which only a shell can start.
const seed = () => execFileSync('npm', ['run', 'db:seed'], { cwd: api, stdio: 'pipe', shell: process.platform === 'win32' });
afterAll(() => pool.end());

describe('outlet names fixture', () => {
  it('names exactly the 120 outlets of outlets.csv', () => {
    expect(Object.keys(named[0]!)).toEqual(['outlet_id', 'name']);
    expect(named).toHaveLength(120);
    expect(named.map((r) => r.outlet_id).sort()).toEqual(shops.map((r) => r.outlet_id).sort());
  });

  it('puts the brand first, then a place, with no stray spaces', () => {
    const wrong = shops.filter((shop) => !new RegExp(`^${shop.brand} \\S(.*\\S)?$`).test(nameOf.get(shop.outlet_id!) ?? ''));
    expect(wrong.map((shop) => shop.outlet_id)).toEqual([]);
  });

  it('never uses a name twice inside a district', () => {
    const full = shops.map((shop) => `${shop.district}: ${nameOf.get(shop.outlet_id!)}`);
    expect(full.filter((name, i) => full.indexOf(name) !== i)).toEqual([]);
  });

  it('calls OUT001 Fresh Nugegoda and OUT017 Style Liberty Plaza, like the design', () => {
    expect(nameOf.get('OUT001')).toBe('Fresh Nugegoda');
    expect(nameOf.get('OUT017')).toBe('Style Liberty Plaza');
  });
});

describe('seeding outlet names', () => {
  it('renames outlets that were seeded before the fixture existed', async () => {
    // What the seed called them then: numbered per brand and district, like "Fresh Colombo 3".
    const counter = new Map<string, number>();
    for (const shop of shops) {
      const key = `${shop.brand} ${shop.district}`;
      counter.set(key, (counter.get(key) ?? 0) + 1);
      await db.update(outlets).set({ name: `${key} ${counter.get(key)}` }).where(eq(outlets.id, shop.outlet_id!));
    }
    seed();
    const rows = await db.select({ id: outlets.id, name: outlets.name }).from(outlets);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.name]))).toMatchObject(Object.fromEntries(nameOf));
  }, 30_000);

  it('changes no outlet row when it runs a second time', async () => {
    // xmin moves whenever a row is written, even with the values it already had.
    const rows = async () => (await db.execute(sql`select xmin, * from outlets order by id`)).rows;
    seed();
    const before = await rows();
    seed();
    expect(await rows()).toEqual(before);
  }, 30_000);
});
