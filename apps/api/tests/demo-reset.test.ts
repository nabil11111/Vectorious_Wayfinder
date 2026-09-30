import { ClockState, LiveEvent, ROLES, type Role } from '@wayfinder/contracts';
import { eq, inArray, isNotNull, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { clearDemoDay, demoId, seedDemoDay } from '../src/db/demo-day';
import {
  auditLog, deferrals, demoDay, fuelLog, orderLines, orders, outlets, plans, products, stopOrders, stops, trips, vehicleDaysOff, vehicles,
} from '../src/db/schema';
import { clockState, depotDate, depotInstant, depotMinutes, initClock, realNow } from '../src/lib/clock';
import * as live from '../src/lib/live';
import { address, serve, stop } from './serve';

const server = await serve(createApp());
const base = address(server);
const password = process.env.SEED_PASSWORD ?? 'wayfinder-demo';
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'wayfinder-admin';

const MINUTE = 60_000;
const WED = '2026-06-24';
const THU = '2026-06-25';
const FRI = '2026-06-26';
// Depot times on the two days of the demo, as the instants the API sends. wed('15:00') is 15:00 on Wed 24 Jun
// 2026 at the depot.
const on = (date: string) => (time: string) => new Date(`${date}T${time.padEnd(8, ':00')}+05:30`).toISOString();
const wed = on(WED);
const thu = on(THU);

// Test files share one database and this one resets the day. So it keeps the clock row it found and writes
// it back when it ends, leaves the day as the seed writes it, takes out the audit rows it wrote and signs out.
const [clockFound] = await db.select().from(demoDay);
const auditFound = new Set((await db.select({ id: auditLog.id }).from(auditLog)).map((row) => row.id));

// One sign-in per role for the whole file, because one address gets ten tries in 15 minutes.
const USERNAMES: Record<Role, string> = { store_manager: 'nadeesha', dispatcher: 'ruwan', loader: 'kasun', driver: 'dilshan', admin: 'admin' };
const people = {} as Record<Role, { id: string; cookie: string }>;

beforeAll(async () => {
  for (const role of ROLES) {
    const res = await request(server).post('/api/v1/auth/login').send({ username: USERNAMES[role], password: role === 'admin' ? adminPassword : password });
    const cookie = res.get('Set-Cookie')?.[0]?.split(';')[0];
    if (!cookie) throw new Error(`${USERNAMES[role]} could not sign in: ${res.status}`);
    people[role] = { id: res.body.id, cookie };
  }
});

const reset = (role: Role) => request(server).post('/api/v1/demo/reset').set('Cookie', people[role].cookie).send({});
const pressNext = (role: Role, revision: number) => request(server).post('/api/v1/demo/clock/next').set('Cookie', people[role].cookie).send({ revision });
const getClock = (role: Role) => request(server).get('/api/v1/clock').set('Cookie', people[role].cookie);
const clockRow = async () => (await db.select().from(demoDay))[0]!;

// The day as the seed itself writes it, with nothing archived. It does not go through the endpoint under
// test, so what a reset leaves can be held against it.
async function seedTheDay() {
  await db.transaction(async (tx) => {
    await clearDemoDay(tx);
    await tx.update(vehicles).set({ archivedAt: null }).where(isNotNull(vehicles.archivedAt));
    await tx.update(outlets).set({ archivedAt: null }).where(isNotNull(outlets.archivedAt));
    await tx.update(products).set({ archivedAt: null }).where(isNotNull(products.archivedAt));
    await seedDemoDay(tx);
  });
}

// Writes the clock row as if the clock had been set to this time that long ago, and reads it into memory the
// way a starting server does.
async function setClock(time: string, ago = 0, revision = 0, day = 1) {
  const clock = { clockBase: new Date(time), clockSetAt: new Date(realNow().getTime() - ago), revision, day };
  await db.insert(demoDay).values(clock).onConflictDoUpdate({ target: demoDay.id, set: clock });
  await initClock();
}

// Every test starts where the first seed leaves things: the day it wrote, and the clock at Wed 15:00 with
// revision 0 and day 1. So a test that fails leaves nothing behind for the next one.
beforeEach(async () => {
  await seedTheDay();
  await setClock(wed('15:00'));
});

afterEach(() => {
  live.closeStreams();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await seedTheDay();
  if (clockFound) await db.insert(demoDay).values(clockFound).onConflictDoUpdate({ target: demoDay.id, set: clockFound });
  else await db.delete(demoDay);
  const written = (await db.select({ id: auditLog.id }).from(auditLog)).map((row) => row.id).filter((id) => !auditFound.has(id));
  if (written.length) await db.delete(auditLog).where(inArray(auditLog.id, written));
  for (const { cookie } of Object.values(people)) await request(server).post('/api/v1/auth/logout').set('Cookie', cookie).send({});
  await stop(server);
  await pool.end();
});

type Row = Record<string, unknown>;

// Every row of some tables as the database holds it, in a fixed order. The columns that say when the system
// really wrote a row differ from one run to the next, so a comparison between two runs leaves them out.
async function rowsIn<T extends string>(tables: readonly T[], { realTime = true } = {}) {
  const row = realTime ? sql`to_jsonb(t)` : sql`to_jsonb(t) - '{created_at,updated_at,clock_set_at,seeded_at}'::text[]`;
  const held = {} as Record<T, Row[]>;
  for (const table of tables) {
    const found = await db.execute<{ row: Row }>(sql`select ${row} as row from ${sql.identifier(table)} t order by 1`);
    held[table] = found.rows.map((r) => r.row);
  }
  return held;
}

// The tables are asked of the database, so one that a later piece adds is compared as well.
const tables = async () => (await db.execute<{ name: string }>(sql`select tablename as name from pg_tables where schemaname = 'public' order by 1`)).rows.map((table) => table.name);
// What a reset must not touch (AC-40). Every other table is the day's.
const KEPT = ['users', 'sessions', 'audit_log'] as const;
const everyTable = async () => rowsIn((await tables()).filter((table) => !KEPT.some((kept) => kept === table)), { realTime: false });
// The same rows with the clock's two counters at these numbers. A move and a reset raise the revision and a
// reset raises the day, so they are the one thing a reset does not put back.
const raised = (held: Record<string, Row[]>, revision: number, day: number) => ({ ...held, demo_day: [{ ...held.demo_day?.[0], revision, day }] });

// The tables a day of work changes, which are the ones AC-39 names.
const WORKED = ['orders', 'order_lines', 'plans', 'deferrals', 'trips', 'stops', 'stop_orders', 'fuel_log', 'vehicle_days_off', 'vehicles', 'outlets', 'products'];

// A day of work, written straight into the tables because the pieces that do it are not built yet. A later
// piece that adds a table adds a row of it here and its name above, so a reset is held to that table too.
async function workTheDay() {
  // Nadeesha makes her chilled cartons 9, places both drafts and orders for Friday as well. Another shop's
  // order is taken out.
  const drafts = [demoId('order', `${THU}:OUT001:chilled`), demoId('order', `${THU}:OUT001:dry`)];
  await db.update(orderLines).set({ quantity: 9 }).where(eq(orderLines.orderId, drafts[0]!));
  await db.update(orders).set({ status: 'placed', placedAt: depotInstant(WED, 15 * 60 + 5), revision: 2 }).where(inArray(orders.id, drafts));
  const [friday] = await db.insert(orders)
    .values({ outletId: 'OUT001', deliveryDate: FRI, temp: 'dry', status: 'placed', createdBy: people.store_manager.id, placedAt: depotInstant(WED, 15 * 60 + 10) })
    .returning();
  await db.insert(orderLines).values({ orderId: friday!.id, productId: 'fresh-dry-carton', quantity: 20 });
  await db.delete(orders).where(eq(orders.id, demoId('order', `${THU}:OUT002:dry`)));

  // Ruwan starts Thursday's plan: a trip with one stop and an order on it, and one order left to wait.
  const [plan] = await db.insert(plans).values({ depotId: 'Peliyagoda', date: THU, createdBy: people.dispatcher.id }).returning();
  const [trip] = await db.insert(trips).values({ planId: plan!.id, vehicleId: 'VEH010', driverId: people.driver.id, tripNo: 1 }).returning();
  const [stop] = await db.insert(stops).values({ tripId: trip!.id, seq: 1, outletId: 'OUT004' }).returning();
  await db.insert(stopOrders).values({ stopId: stop!.id, orderId: demoId('order', `${THU}:OUT004:dry`) });
  await db.insert(deferrals).values({ planId: plan!.id, orderId: demoId('order', `${THU}:OUT003:chilled`), code: 'over_capacity', reason: 'The fridge van was full.' });

  // The trip's litres are logged, a truck goes into the workshop and the fridge van comes out of it early.
  await db.insert(fuelLog).values({ vehicleId: 'VEH010', date: THU, litres: '12.5', tripId: trip!.id });
  await db.insert(vehicleDaysOff).values({ vehicleId: 'VEH010', date: FRI, reason: 'Flat tyre' });
  await db.delete(vehicleDaysOff).where(eq(vehicleDaysOff.vehicleId, 'VEH036'));

  // An admin archives a vehicle, a shop and an item.
  const archivedAt = realNow();
  await db.update(vehicles).set({ archivedAt }).where(eq(vehicles.id, 'VEH010'));
  await db.update(outlets).set({ archivedAt }).where(eq(outlets.id, 'OUT004'));
  await db.update(products).set({ archivedAt }).where(eq(products.id, 'style-bags'));
}

// The audit log, each row with how long ago the database says it was written.
const audits = () => db
  .select({ id: auditLog.id, action: auditLog.action, actorId: auditLog.actorId, entity: auditLog.entity, entityId: auditLog.entityId, before: auditLog.before, after: auditLog.after,
    secondsAgo: sql`extract(epoch from now() - ${auditLog.at})`.mapWith(Number) })
  .from(auditLog);

// Opens the live stream as an open screen does and keeps reading it in the background, until the server ends
// it. `text` is everything the server has written so far.
async function listen(role: Role) {
  const res = await fetch(`${base}/api/v1/events`, { headers: { cookie: people[role].cookie } });
  if (res.status !== 200) throw new Error(`The stream was refused: ${res.status} ${await res.text()}`);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  void (async () => {
    for (let piece = await reader.read(); !piece.done; piece = await reader.read()) text += decoder.decode(piece.value, { stream: true });
  })();
  return { get text() { return text; } };
}
// The changes a stream has been sent so far, without the heartbeats. LiveEvent is strict, so a message that
// holds more than a topic and an id fails here.
const heard = (stream: { text: string }) => stream.text.split('\n\n').slice(0, -1).filter((block) => block !== ': ping')
  .map((block) => LiveEvent.parse(JSON.parse(block.replace('event: change\ndata: ', ''))));

describe('POST /demo/reset', () => {
  it('AC-39 lets a signed-in person of any role reset the day: what people made is gone, nothing stays archived, the seeded day is back and the clock is at Wed 15:00 with the day number one higher', async () => {
    const seeded = await everyTable();
    for (const role of ROLES) {
      // A day's work behind them and the trucks on the road for ten minutes, on day 2 of the demo.
      await workTheDay();
      await setClock(thu('03:30'), 10 * MINUTE, 7, 2);
      const worked = await everyTable();
      for (const table of WORKED) expect([table, worked[table]]).not.toEqual([table, seeded[table]]);

      const from = realNow().getTime();
      const res = await reset(role);
      const to = realNow().getTime();
      expect([role, res.status]).toEqual([role, 200]);
      expect(ClockState.parse(res.body)).toEqual(res.body);
      expect(res.body).toEqual({
        demo: true, now: wed('15:00'), part: 'ordering', holdsAt: wed('15:59:59'),
        next: { part: 'planning', at: wed('16:00') }, revision: 8, day: 3,
      });

      // Every table is as the seed wrote it. So the orders and the plan that people made are gone with their
      // lines, trip, stop and deferral, the fuel and workshop rows are the seeded ones, nothing is archived,
      // and the seeded rows that were changed or taken out are back as they were.
      expect(await everyTable()).toEqual(raised(seeded, 8, 3));

      // Stored as the first part's start and the real time of the reset, with the note that the day is
      // written, so a server that starts again neither moves the clock nor seeds a second day.
      const stored = await clockRow();
      expect(stored).toMatchObject({ clockBase: new Date(wed('15:00')), revision: 8, day: 3 });
      expect(stored.seededAt).not.toBeNull();
      for (const real of [stored.clockSetAt, stored.seededAt!]) {
        expect(real.getTime()).toBeGreaterThanOrEqual(from);
        expect(real.getTime()).toBeLessThanOrEqual(to);
      }

      // It runs on from 15:00 for the next request, with no restart.
      const clock = (await getClock(role)).body;
      expect(clock).toMatchObject({ demo: true, part: 'ordering', revision: 8, day: 3 });
      expect([depotDate(new Date(clock.now)), depotMinutes(new Date(clock.now))]).toEqual([WED, 15 * 60]);
    }
  });

  it('AC-40 leaves every table but the users, the sessions and the audit log exactly as the first seed wrote it: the 104 orders and 142 order lines are back and nothing else is left', async () => {
    const first = await everyTable();
    expect([first.orders?.length, first.order_lines?.length]).toEqual([104, 142]);

    // A reset of a day nobody has touched changes nothing but the clock's counters.
    expect((await reset('admin')).status).toBe(200);
    expect(await everyTable()).toEqual(raised(first, 1, 2));

    // A day people have worked: the draft is placed, there is a plan with a trip, a vehicle is archived and
    // the clock was moved twice.
    await workTheDay();
    for (const revision of [1, 2]) expect((await pressNext('dispatcher', revision)).status).toBe(200);
    const { audit_log: audited, ...signedIn } = await rowsIn(KEPT);
    // Each of the three holds something, so a cascade that reached it would show.
    for (const rows of [signedIn.users, signedIn.sessions, audited]) expect(rows).not.toEqual([]);

    expect((await reset('store_manager')).status).toBe(200);

    // Two moves and two resets on the revision, two resets on the day. Everything else is the first seed.
    expect(await everyTable()).toEqual(raised(first, 4, 3));

    // The people and their sign-ins are as they were, and the audit log has every row it had and the reset's.
    const { audit_log: auditedNow, ...signedInNow } = await rowsIn(KEPT);
    expect(signedInNow).toEqual(signedIn);
    expect(auditedNow).toEqual(expect.arrayContaining(audited));
    expect(auditedNow).toHaveLength(audited.length + 1);
  });

  it('AC-41 answers both of two resets that come at the same moment and leaves one seeded day, with the day number raised twice', async () => {
    const seeded = await everyTable();
    await workTheDay();
    const had = new Set((await audits()).map((row) => row.id));
    const waiting = async () => (await db.execute<{ waiting: number }>(
      sql`select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`)).rows[0]?.waiting ?? 0;
    // The test holds the clock row until both requests are waiting for it, so neither can be done before the
    // other has begun.
    const { both } = await db.transaction(async (tx) => {
      await tx.select().from(demoDay).for('update');
      const both = Promise.all([reset('dispatcher'), reset('loader')]);
      // A busy machine can take seconds to get both requests to the lock, so this waits long enough not to
      // mistake a slow start for a failure.
      await vi.waitUntil(async () => (await waiting()) >= 2, { timeout: 15_000, interval: 10 });
      return { both };
    });
    const answers = await both;
    expect(answers.map((res) => res.status)).toEqual([200, 200]);
    // They took turns: one made it day 2 and the other day 3.
    expect(answers.map((res) => [res.body.revision, res.body.day]).sort()).toEqual([[1, 2], [2, 3]]);

    // One seeded day, with no row twice and none missing.
    expect(await everyTable()).toEqual(raised(seeded, 2, 3));
    expect((await getClock('driver')).body).toMatchObject({ part: 'ordering', revision: 2, day: 3 });

    // Each wrote its own audit row, and the second started from the clock the first one left.
    const written = (await audits()).filter((row) => !had.has(row.id));
    expect(written.map((row) => [row.action, ClockState.parse(row.before).day, ClockState.parse(row.after).day]).sort())
      .toEqual([['demo.day_reset', 1, 2], ['demo.day_reset', 2, 3]]);
  });

  it('AC-23 announces demo to every open stream when the day is reset', async () => {
    // An open screen for each role. A reset changes the day for all of them, whatever their depot or shop.
    const screens = await Promise.all(ROLES.map((role) => listen(role)));

    expect((await reset('loader')).status).toBe(200);

    await vi.waitFor(() => expect(screens.map(heard)).toEqual(ROLES.map(() => [{ topic: 'demo' }])));
  });

  it('AC-23 tells the screens only once the reset is saved and the clock is read again, so what they fetch on hearing of it is the new day', async () => {
    await setClock(thu('08:30'), 0, 4);
    // What another connection reads at the moment of the announcement is what has been saved by then, and
    // the clock in memory at that moment is what GET /clock answers a screen that asks at once.
    let saved: Promise<{ revision: number; day: number }[]> | undefined;
    let inMemory: ClockState | undefined;
    const announce = vi.spyOn(live, 'announce').mockImplementation(() => {
      saved = db.select({ revision: demoDay.revision, day: demoDay.day }).from(demoDay).execute();
      inMemory = clockState();
    });

    expect((await reset('driver')).status).toBe(200);

    expect(announce.mock.calls).toEqual([[{ topic: 'demo' }]]);
    expect(await saved).toEqual([{ revision: 5, day: 2 }]);
    expect(inMemory).toMatchObject({ part: 'ordering', revision: 5, day: 2 });
  });

  it('AC-8 writes one audit row for a reset, with the person and the clock before and after', async () => {
    await setClock(thu('02:30'), 10 * MINUTE, 2);
    const had = new Set((await audits()).map((row) => row.id));
    const res = await reset('loader');
    const written = (await audits()).filter((row) => !had.has(row.id));
    expect(written).toHaveLength(1);

    const audit = written[0]!;
    expect(audit).toMatchObject({ action: 'demo.day_reset', actorId: people.loader.id, entity: 'demo_day', entityId: '1', after: res.body });
    const before = ClockState.parse(audit.before);
    expect(before).toMatchObject({ demo: true, part: 'loading', next: { part: 'on_the_road', at: thu('03:30') }, revision: 2, day: 1 });
    expect([depotDate(new Date(before.now)), depotMinutes(new Date(before.now))]).toEqual([THU, 2 * 60 + 40]);
    expect(ClockState.parse(audit.after)).toMatchObject({ now: wed('15:00'), part: 'ordering', revision: 3, day: 2 });
    // The row's own time is when it really happened, by the database's clock. It is not the app's time.
    expect(audit.secondsAgo).toBeGreaterThanOrEqual(0);
    expect(audit.secondsAgo).toBeLessThan(60);
  });

  it('AC-8 takes the clock before the reset from the row it locks, so the audit row is right when the copy in memory fell behind', async () => {
    // The row moves on and this process does not hear of it, as when a commit lands and its answer is lost.
    await db.update(demoDay).set({ clockBase: new Date(thu('03:30')), clockSetAt: realNow(), revision: 3 });
    expect((await getClock('driver')).body).toMatchObject({ part: 'ordering', revision: 0 });
    const had = new Set((await audits()).map((row) => row.id));

    expect((await reset('driver')).body).toMatchObject({ part: 'ordering', revision: 4, day: 2 });

    const written = (await audits()).filter((row) => !had.has(row.id));
    expect(written.map((row) => ClockState.parse(row.before))).toMatchObject([{ part: 'on_the_road', revision: 3, day: 1 }]);
  });

  it('changes nothing and tells nobody when a reset fails halfway', async () => {
    await workTheDay();
    await setClock(thu('02:30'), 10 * MINUTE, 2);
    const before = await rowsIn(await tables());
    const announce = vi.spyOn(live, 'announce');
    // The seed stops, as it does when an account it needs is gone. By then the reset has removed the day.
    vi.spyOn(await import('../src/db/demo-day'), 'seedDemoDay').mockRejectedValue(new Error('The demo day needs the account "ruwan", and it is not there.'));

    const res = await reset('loader');
    expect([res.status, res.body.error?.code]).toEqual([500, 'server_error']);

    // Every table is as it was, to the last column: the day people worked, the clock, and no audit row.
    expect(await rowsIn(await tables())).toEqual(before);
    expect(announce).not.toHaveBeenCalled();
    expect((await getClock('loader')).body).toMatchObject({ part: 'loading', revision: 2, day: 1 });
  });
});
