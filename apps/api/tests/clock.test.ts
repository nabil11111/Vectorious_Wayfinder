import { ClockState, ROLES, type Role } from '@wayfinder/contracts';
import { eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { auditLog, demoDay } from '../src/db/schema';
import { demoClockAt, depotDate, depotMinutes, initClock, now, realNow, restartClock, setClockForTests } from '../src/lib/clock';
import { config } from '../src/lib/config';
import * as live from '../src/lib/live';
import { serve, stop } from './serve';

const app = await serve(createApp());
const password = process.env.SEED_PASSWORD ?? 'wayfinder-demo';
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'wayfinder-admin';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
// Depot times on the two days of the demo, as the instants the API sends. wed('15:18') is 15:18 on Wed 24 Jun
// 2026 at the depot. Sri Lanka is five and a half hours ahead of UTC all year.
const on = (date: string) => (time: string) => new Date(`${date}T${time.padEnd(8, ':00')}+05:30`).toISOString();
const wed = on('2026-06-24');
const thu = on('2026-06-25');

// The audit rows of clock moves, each with how long ago the database says it was written.
const moves = () => db
  .select({ id: auditLog.id, actorId: auditLog.actorId, entity: auditLog.entity, entityId: auditLog.entityId, before: auditLog.before, after: auditLog.after,
    secondsAgo: sql`extract(epoch from now() - ${auditLog.at})`.mapWith(Number) })
  .from(auditLog).where(eq(auditLog.action, 'demo.clock_moved'));

// Test files share one database and this one moves the clock. So it keeps the clock row it found and writes
// it back when it ends, takes out the audit rows it wrote and signs out.
const [clockFound] = await db.select().from(demoDay);
const movesFound = new Set((await moves()).map((move) => move.id));
// What a test started and must end, last one first: the servers and database pools of startAgain().
const started: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  setClockForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const end of started.splice(0).reverse()) await end();
});

afterAll(async () => {
  if (clockFound) await db.insert(demoDay).values(clockFound).onConflictDoUpdate({ target: demoDay.id, set: clockFound });
  else await db.delete(demoDay);
  const written = (await moves()).map((move) => move.id).filter((id) => !movesFound.has(id));
  if (written.length) await db.delete(auditLog).where(inArray(auditLog.id, written));
  for (const { cookie } of Object.values(people)) await request(app).post('/api/v1/auth/logout').set('Cookie', cookie).send({});
  await stop(app);
  await pool.end();
});

// One sign-in per role for the whole file, because one address gets ten tries in 15 minutes.
const USERNAMES: Record<Role, string> = { store_manager: 'nadeesha', dispatcher: 'ruwan', loader: 'kasun', driver: 'dilshan', admin: 'admin' };
const people = {} as Record<Role, { id: string; cookie: string }>;

beforeAll(async () => {
  for (const role of ROLES) {
    const res = await request(app).post('/api/v1/auth/login').send({ username: USERNAMES[role], password: role === 'admin' ? adminPassword : password });
    const cookie = res.get('Set-Cookie')?.[0]?.split(';')[0];
    if (!cookie) throw new Error(`${USERNAMES[role]} could not sign in: ${res.status}`);
    people[role] = { id: res.body.id, cookie };
  }
});

const getClock = (role: Role, from = app) => request(from).get('/api/v1/clock').set('Cookie', people[role].cookie);
const pressNext = (role: Role, revision: number) => request(app).post('/api/v1/demo/clock/next').set('Cookie', people[role].cookie).send({ revision });
const clockRow = async () => (await db.select().from(demoDay))[0]!;

// Writes the clock row as if the clock had been set to this time that long ago, and reads it into memory the
// way a starting server does.
async function setClock(time: string, ago = 0, revision = 0, day = 1) {
  const clock = { clockBase: new Date(time), clockSetAt: new Date(realNow().getTime() - ago), revision, day };
  await db.insert(demoDay).values(clock).onConflictDoUpdate({ target: demoDay.id, set: clock });
  await initClock();
  return clock;
}

// A running clock says the time it was set to plus the real time since. The real time it read lies between
// the moment just before it was asked and the moment just after, so that is exactly how far it may have run.
async function expectRunning(clock: { clockBase: Date; clockSetAt: Date }, read: () => string | Promise<string>) {
  const from = realNow().getTime();
  const ran = Date.parse(await read()) - clock.clockBase.getTime();
  const to = realNow().getTime();
  expect(ran).toBeGreaterThanOrEqual(from - clock.clockSetAt.getTime());
  expect(ran).toBeLessThanOrEqual(to - clock.clockSetAt.getTime());
}

// A server that has just started: the modules loaded fresh with nothing in memory, and the clock read from
// the database before the first request.
async function startAgain() {
  vi.resetModules();
  const fresh = { app: await import('../src/app'), clock: await import('../src/lib/clock'), client: await import('../src/db/client') };
  started.push(() => fresh.client.pool.end());
  await fresh.clock.initClock();
  const server = await serve(fresh.app.createApp());
  started.push(() => stop(server));
  return { app: server, clock: fresh.clock };
}

describe('the demo clock, worked out from the stored row and the real time', () => {
  // The real time is an argument, so 18 minutes, two days or a restart pass without waiting. Any real moment
  // will do. This clock was set when the real time was 10:00:00.
  const setAt = new Date('2026-09-30T10:00:00Z');
  const setTo = (time: string) => ({ clockBase: new Date(time), clockSetAt: setAt, revision: 4, day: 2 });
  const after = (ms: number) => new Date(setAt.getTime() + ms);

  it('AC-2 moves by the real time that passes inside a part: set to 15:00, 18 real minutes later it says 15:18', () => {
    expect(demoClockAt(setTo(wed('15:00')), after(18 * MINUTE))).toEqual({
      demo: true, now: wed('15:18'), part: 'ordering', holdsAt: wed('15:59:59'),
      next: { part: 'planning', at: wed('16:00') }, revision: 4, day: 2,
    });
    // To the millisecond, as an instant ending in Z.
    expect(demoClockAt(setTo(wed('15:00')), after(18 * MINUTE + 30_500)).now).toBe('2026-06-24T09:48:30.500Z');
  });

  it('AC-3 waits one second before the next part: set to 15:00, 70 real minutes later it says 15:59:59, and two days later it still does', () => {
    const clock = setTo(wed('15:00'));
    expect(demoClockAt(clock, after(59 * MINUTE + 58_000)).now).toBe(wed('15:59:58'));
    for (const real of [after(59 * MINUTE + 59_000), after(70 * MINUTE), after(2 * DAY)]) {
      expect(demoClockAt(clock, real)).toMatchObject({ now: wed('15:59:59'), part: 'ordering', holdsAt: wed('15:59:59') });
    }
  });

  it('AC-3 stops at Thu 25 Jun 23:59:59 in the last part', () => {
    const clock = setTo(thu('08:30'));
    expect(demoClockAt(clock, after(60 * MINUTE)).now).toBe(thu('09:30'));
    for (const real of [after(16 * 60 * MINUTE), after(30 * DAY)]) {
      expect(demoClockAt(clock, real)).toMatchObject({ now: thu('23:59:59'), part: 'delivered', holdsAt: thu('23:59:59'), next: null });
    }
  });

  it('AC-3 waits at the end of each of the five parts of the day', () => {
    const parts = [
      ['ordering', wed('15:00'), wed('15:59:59'), 'planning'],
      ['planning', wed('16:00'), thu('02:29:59'), 'loading'],
      ['loading', thu('02:30'), thu('03:29:59'), 'on_the_road'],
      ['on_the_road', thu('03:30'), thu('08:29:59'), 'delivered'],
      ['delivered', thu('08:30'), thu('23:59:59'), undefined],
    ] as const;
    for (const [part, starts, waitsAt, next] of parts) {
      const clock = demoClockAt(setTo(starts), after(3 * DAY));
      expect([clock.part, clock.now, clock.holdsAt, clock.next?.part]).toEqual([part, waitsAt, waitsAt, next]);
    }
  });

  it('AC-7 carries on from the stored time plus the real time that has passed: set to 16:00 at 10:00:00, started again at 10:05:20, it says 16:05:20', () => {
    // Nothing but the stored row outlives a restart, and the row is all this takes.
    expect(demoClockAt(setTo(wed('16:00')), new Date('2026-09-30T10:05:20Z')).now).toBe(wed('16:05:20'));
  });

  it('AC-7 goes no further than the waiting point, however long the server was stopped', () => {
    expect(demoClockAt(setTo(wed('16:00')), after(5 * DAY)).now).toBe(thu('02:29:59'));
  });

  it('stays at the time it was set to when the real clock is put back', () => {
    expect(demoClockAt(setTo(wed('16:00')), after(-90_000)).now).toBe(wed('16:00'));
  });
});

describe('GET /clock', () => {
  it('AC-2 runs at real speed: set to 15:00 eighteen real minutes ago, it says 15:18', async () => {
    const clock = await setClock(wed('15:00'), 18 * MINUTE);
    const res = await getClock('dispatcher');
    expect(res.status).toBe(200);
    expect(ClockState.parse(res.body)).toEqual(res.body);
    expect(res.body).toEqual({
      demo: true, now: expect.any(String), part: 'ordering', holdsAt: wed('15:59:59'),
      next: { part: 'planning', at: wed('16:00') }, revision: 0, day: 1,
    });
    expect([depotDate(new Date(res.body.now)), depotMinutes(new Date(res.body.now))]).toEqual(['2026-06-24', 15 * 60 + 18]);
    await expectRunning(clock, async () => (await getClock('dispatcher')).body.now);
    // now() is what every other piece reads, and it is the same clock.
    await expectRunning(clock, () => now().toISOString());
  });

  it('AC-3 waits one second before the next part: set to 15:00 seventy real minutes ago, it says 15:59:59', async () => {
    await setClock(wed('15:00'), 70 * MINUTE);
    expect((await getClock('store_manager')).body).toMatchObject({ now: wed('15:59:59'), part: 'ordering', holdsAt: wed('15:59:59') });
    expect(now().toISOString()).toBe(wed('15:59:59'));

    // The last part has no next one to wait for. It stops at the end of the delivery day.
    await setClock(thu('08:30'), 2 * DAY);
    expect((await getClock('store_manager')).body).toMatchObject({ now: thu('23:59:59'), part: 'delivered', holdsAt: thu('23:59:59'), next: null });
  });

  it('AC-7 carries on when the server starts again: set to 16:00 five minutes and twenty seconds ago, it says 16:05:20', async () => {
    const clock = await setClock(wed('16:00'), 5 * MINUTE + 20_000, 1);
    const server = await startAgain();
    const res = await getClock('dispatcher', server.app);
    expect(res.body).toMatchObject({ demo: true, part: 'planning', revision: 1, day: 1 });
    expect([depotDate(new Date(res.body.now)), depotMinutes(new Date(res.body.now))]).toEqual(['2026-06-24', 16 * 60 + 5]);
    await expectRunning(clock, async () => (await getClock('dispatcher', server.app)).body.now);
    await expectRunning(clock, () => server.clock.now().toISOString());
  });

  it('AC-7 goes no further than the waiting point when the server starts again days later', async () => {
    await setClock(wed('16:00'), 2 * DAY, 1);
    const server = await startAgain();
    expect((await getClock('dispatcher', server.app)).body).toMatchObject({ now: thu('02:29:59'), part: 'planning' });
    expect(server.clock.now().toISOString()).toBe(thu('02:29:59'));
  });

  it('AC-9 answers 401 signed_out to a signed-out person who asks for the clock, the next part or a reset', async () => {
    await setClock(wed('15:00'));
    const before = await clockRow();
    const asked = [
      await request(app).get('/api/v1/clock'),
      await request(app).post('/api/v1/demo/clock/next').send({ revision: 0 }),
      await request(app).post('/api/v1/demo/reset').send({}),
    ];
    expect(asked.map((res) => [res.status, res.body.error?.code])).toEqual(Array(3).fill([401, 'signed_out']));
    expect(await clockRow()).toEqual(before);
  });

  it('AC-10 is the real time with demo false and no part when demo mode is off, and the next part and the reset answer 404', async () => {
    // The clock row is still in the database and says 24 Jun. With demo mode off nothing reads it.
    await setClock(wed('15:00'));
    vi.stubEnv('DEMO_MODE', 'false');
    const server = await startAgain();

    const from = realNow().getTime();
    const res = await getClock('dispatcher', server.app);
    const to = realNow().getTime();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ demo: false, now: expect.any(String), part: null, holdsAt: null, next: null, revision: 0, day: 1 });
    expect(Date.parse(res.body.now)).toBeGreaterThanOrEqual(from);
    expect(Date.parse(res.body.now)).toBeLessThanOrEqual(to);
    expect(Math.abs(server.clock.now().getTime() - realNow().getTime())).toBeLessThan(1000);

    for (const path of ['/api/v1/demo/clock/next', '/api/v1/demo/reset']) {
      const asked = await request(server.app).post(path).set('Cookie', people.dispatcher.cookie).send({ revision: 0 });
      expect([path, asked.status, asked.body.error?.code]).toEqual([path, 404, 'not_found']);
    }
  });

  it('AC-12 stays exactly where a test sets it, with no running and no waiting point: a test sets Sat 20 Jun 2026 10:00 and reads it back', async () => {
    // The stored clock waits at 15:59:59. A time a test sets is not held to that.
    await setClock(wed('15:00'), 70 * MINUTE);
    const saturday = new Date('2026-06-20T10:00:00+05:30');
    setClockForTests(saturday);
    expect(now()).toEqual(saturday);
    expect((await getClock('driver')).body).toMatchObject({ now: saturday.toISOString(), holdsAt: null });

    // Past the waiting point, and past the end of the demo day.
    const later = '2026-06-27T03:30:00.000Z';
    for (const time of [wed('18:00'), later]) {
      setClockForTests(new Date(time));
      expect(now().toISOString()).toBe(time);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(now().toISOString()).toBe(later);

    setClockForTests(null);
    expect(now().toISOString()).toBe(wed('15:59:59'));
  });

  it('leaves sessions on the real time: the app\'s clock an hour past a session\'s limit signs nobody out', async () => {
    await setClock(wed('15:00'));
    // Judged by the app's clock, a session made in the last minute would have ended an hour ago.
    setClockForTests(new Date(realNow().getTime() + (config.SESSION_TTL_HOURS + 1) * 60 * MINUTE));
    expect((await getClock('loader')).status).toBe(200);
  });
});

describe('POST /demo/clock/next', () => {
  it('AC-4 moves to the start of the next part and raises the revision by one: from ordering at 15:20 to planning at Wed 16:00:00', async () => {
    await setClock(wed('15:00'), 20 * MINUTE, 3);
    const from = realNow().getTime();
    const res = await pressNext('dispatcher', 3);
    const to = realNow().getTime();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      demo: true, now: wed('16:00'), part: 'planning', holdsAt: thu('02:29:59'),
      next: { part: 'loading', at: thu('02:30') }, revision: 4, day: 1,
    });

    // Stored as the part's start and the real time of the move, so it carries on from there after a restart.
    const stored = await clockRow();
    expect(stored).toMatchObject({ clockBase: new Date(wed('16:00')), revision: 4, day: 1 });
    expect(stored.clockSetAt.getTime()).toBeGreaterThanOrEqual(from);
    expect(stored.clockSetAt.getTime()).toBeLessThanOrEqual(to);

    // It runs on from 16:00, for everyone.
    expect((await getClock('store_manager')).body).toMatchObject({ part: 'planning', revision: 4 });
    await expectRunning(stored, async () => (await getClock('store_manager')).body.now);
    await expectRunning(stored, () => now().toISOString());
  });

  it('AC-4 lets a signed-in person of any role move the clock', async () => {
    for (const [revision, role] of ROLES.entries()) {
      await setClock(wed('15:00'), 0, revision);
      const res = await pressNext(role, revision);
      expect([role, res.status, res.body.part, res.body.revision]).toEqual([role, 200, 'planning', revision + 1]);
    }
  });

  it('AC-4 goes one part at a time through the day', async () => {
    await setClock(wed('15:00'));
    const day = [['planning', wed('16:00')], ['loading', thu('02:30')], ['on_the_road', thu('03:30')], ['delivered', thu('08:30')]] as const;
    for (const [revision, [part, starts]] of day.entries()) {
      const res = await pressNext('loader', revision);
      expect([res.status, res.body.part, res.body.now, res.body.revision]).toEqual([200, part, starts, revision + 1]);
    }
    expect((await getClock('loader')).body).toMatchObject({ part: 'delivered', revision: 4 });
  });

  it('AC-5 refuses an older revision with the clock as it is now and changes nothing: Ruwan and Kasun both see revision 3', async () => {
    await setClock(wed('16:00'), 0, 3);
    expect((await pressNext('dispatcher', 3)).body).toMatchObject({ part: 'loading', revision: 4 });
    const [moved, audited] = [await clockRow(), (await moves()).length];

    const res = await pressNext('loader', 3);
    expect([res.status, res.body.error.code]).toEqual([409, 'stale_clock']);
    // Kasun's screen shows the clock as it is now from these details.
    const { now: said, ...rest } = ClockState.parse(res.body.error.details);
    expect(rest).toEqual({ demo: true, part: 'loading', holdsAt: thu('03:29:59'), next: { part: 'on_the_road', at: thu('03:30') }, revision: 4, day: 1 });
    expect([depotDate(new Date(said)), depotMinutes(new Date(said))]).toEqual(['2026-06-25', 2 * 60 + 30]);
    // A revision the clock has not reached yet is not the clock's either.
    const ahead = await pressNext('loader', 5);
    expect([ahead.status, ahead.body.error.code]).toEqual([409, 'stale_clock']);

    expect(await clockRow()).toEqual(moved);
    expect(await moves()).toHaveLength(audited);
    expect((await getClock('loader')).body).toMatchObject({ part: 'loading', revision: 4 });
  });

  it('AC-5 moves the clock once when two people press Next at the same moment, so nobody skips a part', async () => {
    await setClock(wed('16:00'), 0, 3);
    const audited = (await moves()).length;
    const waiting = async () => (await db.execute<{ waiting: number }>(
      sql`select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`)).rows[0]?.waiting ?? 0;
    // The test holds the clock row until both requests are waiting for it, so neither can be done before the
    // other has begun.
    const { both } = await db.transaction(async (tx) => {
      await tx.select().from(demoDay).for('update');
      const both = Promise.all([pressNext('dispatcher', 3), pressNext('loader', 3)]);
      // A busy machine can take seconds to get both requests to the lock, so this waits long enough not to
      // mistake a slow start for a failure.
      await vi.waitUntil(async () => (await waiting()) >= 2, { timeout: 15_000, interval: 10 });
      return { both };
    });
    const answers = await both;
    expect(answers.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(answers.find((res) => res.status === 409)?.body.error).toMatchObject({ code: 'stale_clock', details: { part: 'loading', revision: 4 } });
    expect(await clockRow()).toMatchObject({ clockBase: new Date(thu('02:30')), revision: 4 });
    expect(await moves()).toHaveLength(audited + 1);
  });

  it('AC-5 calls an older revision stale in the last part too, so that screen still gets the clock as it is', async () => {
    await setClock(thu('03:30'), 0, 7);
    await pressNext('dispatcher', 7);
    const res = await pressNext('loader', 7);
    expect([res.status, res.body.error.code]).toEqual([409, 'stale_clock']);
    expect(res.body.error.details).toMatchObject({ part: 'delivered', next: null, revision: 8 });
  });

  it('takes the clock from the database when it refuses a move, so a copy in memory that fell behind is right again', async () => {
    await setClock(wed('15:00'), 0, 3);
    // The row moves on and this process does not hear of it, as when a commit lands and its answer is lost.
    await db.update(demoDay).set({ clockBase: new Date(wed('16:00')), clockSetAt: realNow(), revision: 4 });
    expect((await getClock('loader')).body).toMatchObject({ part: 'ordering', revision: 3 });

    const res = await pressNext('loader', 3);
    expect([res.status, res.body.error.code]).toEqual([409, 'stale_clock']);
    expect(res.body.error.details).toMatchObject({ part: 'planning', revision: 4 });
    expect((await getClock('loader')).body).toMatchObject({ part: 'planning', revision: 4 });
  });

  it('AC-6 answers 409 no_next_part in the last part and changes nothing', async () => {
    await setClock(thu('08:30'), 5 * MINUTE, 4);
    const [before, audited] = [await clockRow(), (await moves()).length];
    const res = await pressNext('driver', 4);
    expect([res.status, res.body.error.code]).toEqual([409, 'no_next_part']);
    expect(await clockRow()).toEqual(before);
    expect(await moves()).toHaveLength(audited);
  });

  it('AC-8 writes one audit row for a move, with the person and the clock before and after', async () => {
    await setClock(wed('15:00'), 20 * MINUTE);
    const had = new Set((await moves()).map((move) => move.id));
    const res = await pressNext('dispatcher', 0);
    const written = (await moves()).filter((move) => !had.has(move.id));
    expect(written).toHaveLength(1);

    const move = written[0]!;
    expect(move).toMatchObject({ actorId: people.dispatcher.id, entity: 'demo_day', entityId: '1', after: res.body });
    const before = ClockState.parse(move.before);
    expect(before).toMatchObject({ demo: true, part: 'ordering', next: { part: 'planning', at: wed('16:00') }, revision: 0, day: 1 });
    expect([depotDate(new Date(before.now)), depotMinutes(new Date(before.now))]).toEqual(['2026-06-24', 15 * 60 + 20]);
    expect(ClockState.parse(move.after)).toMatchObject({ now: wed('16:00'), part: 'planning', revision: 1, day: 1 });
    // The row's own time is when it really happened, by the database's clock. It is not the app's time.
    expect(move.secondsAgo).toBeGreaterThanOrEqual(0);
    expect(move.secondsAgo).toBeLessThan(60);
  });

  it('refuses a request that does not carry a whole revision, and moves nothing', async () => {
    await setClock(wed('15:00'));
    const before = await clockRow();
    for (const body of [{}, { revision: '0' }, { revision: 0.5 }, { revision: -1 }]) {
      const res = await request(app).post('/api/v1/demo/clock/next').set('Cookie', people.admin.cookie).send(body);
      expect([body, res.status, res.body.error.code]).toEqual([body, 400, 'invalid_input']);
    }
    expect(await clockRow()).toEqual(before);
  });

  it('tells every open screen once the move is saved, and tells nobody about a move it refused', async () => {
    await setClock(wed('15:00'));
    // What another connection reads at the moment of the announcement is what has been saved by then.
    let saved: Promise<{ revision: number }[]> | undefined;
    const announce = vi.spyOn(live, 'announce').mockImplementation(() => {
      saved = db.select({ revision: demoDay.revision }).from(demoDay).execute();
    });
    await pressNext('driver', 0);
    expect(announce.mock.calls).toEqual([[{ topic: 'clock' }]]);
    expect(await saved).toEqual([{ revision: 1 }]);

    await pressNext('driver', 0);
    expect(announce).toHaveBeenCalledTimes(1);
  });
});

describe('starting the server and starting the day again', () => {
  it('does not start in demo mode when the clock row is missing, and says to run the seed', async () => {
    await setClock(wed('15:00'));
    const row = await clockRow();
    await db.delete(demoDay);
    try {
      await expect(initClock()).rejects.toThrow(/seed/i);
    } finally {
      // The row also holds the note that the seeded day is written, so it goes back whole and at once.
      await db.insert(demoDay).values(row);
    }
  });

  it('writes the clock back to the first part and raises the revision and the day, inside the caller\'s transaction', async () => {
    await setClock(thu('03:30'), 10 * MINUTE, 7, 2);
    const before = await clockRow();
    const seededAt = new Date('2026-09-30T09:00:00Z');
    let answered: ClockState | undefined;
    let inside: typeof before | undefined;
    await expect(db.transaction(async (tx) => {
      // The reset writes the day before it restarts the clock. That note must outlive the restart.
      await tx.update(demoDay).set({ seededAt });
      answered = await restartClock(tx);
      [inside] = await tx.select().from(demoDay);
      tx.rollback();
    })).rejects.toThrow('Rollback');

    expect(answered).toEqual({
      demo: true, now: wed('15:00'), part: 'ordering', holdsAt: wed('15:59:59'),
      next: { part: 'planning', at: wed('16:00') }, revision: 8, day: 3,
    });
    expect(inside).toMatchObject({ clockBase: new Date(wed('15:00')), revision: 8, day: 3, seededAt });
    // The caller rolled back, so the clock is where it was, in the database and in memory.
    expect(await clockRow()).toEqual(before);
    expect((await getClock('driver')).body).toMatchObject({ part: 'on_the_road', revision: 7, day: 2 });
  });

  it('runs from Wed 15:00 once the reset has committed and read the clock again', async () => {
    await setClock(thu('08:30'), 0, 4);
    const answered = await db.transaction((tx) => restartClock(tx));
    expect(answered).toMatchObject({ now: wed('15:00'), part: 'ordering', revision: 5, day: 2 });
    await initClock();
    expect((await getClock('driver')).body).toMatchObject({ demo: true, part: 'ordering', revision: 5, day: 2 });
    await expectRunning(await clockRow(), async () => (await getClock('driver')).body.now);
  });
});
