import { randomUUID } from 'node:crypto';
import {
  BOTH_DEPOTS, DecideIssueResponse, DriverDay, IssueList, LiveEvent, LoadingDay, Me, OperationsDay, PHONE_ACCOUNT_HEADER, PlanBoard,
  type IssueDecision, type LoadingTruck, type LoginRequest,
} from '@wayfinder/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import type { Request, Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { auditLog, deferrals, demoDay, issues, orders, outlets, photos, plans, sessions, stopOrders, stops, trips, users, vehicles } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce, closeStreams } from '../src/lib/live';
import { DEPOT_HEADER, hashToken, readDepotOf, requireShownDepot } from '../src/middleware/auth';
import { answeredTruck, dryLine, heldRows, loaderScreen, resetDay, sendWalkthroughPlan, stopOf, truckOf } from './loading-plan';
import { address, serve, stop } from './serve';
import { PIN, signInAs } from './sign-in';

// Spec 021: both depots together (D-96). A dispatcher's session can be on Both, and then every dispatcher read names the
// depot it reads, a plan write is refused, an answer goes to the problem's own depot and the live stream carries both
// depots. Signing in still starts at the dispatcher's own depot.

// The app's clock is held where a test puts it.
const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at || clock.demoClockAt(...args).now }) };
});
const freeze = (date: string, minute: number) => { const at = depotInstant(date, minute); testClock.at = at.toISOString(); setClockForTests(at); };
const WED = '2026-06-24';
const THU = '2026-06-25';

// Each account asks from an address of its own, as each person's phone or screen does, so the reads below stay inside
// the address limit.
const app = createApp();
app.set('trust proxy', 'loopback');
const server = await serve(app);
let addresses = 0;
type Agent = ReturnType<typeof request.agent>;
const SWITCH = '/api/v1/me/depot';
const code = (res: request.Response) => [res.status, res.body.error?.code];

afterAll(async () => {
  closeStreams();
  await stop(server);
  await pool.end();
});

// An account signed in on an agent of its own, which, as a phone does, names the account on every write it saves first
// (spec 015): the Me it was answered with, its session cookie, and the session's id as the table keeps it.
interface Account { agent: Agent; me: Me; cookie: string; session: string }
async function signIn(who: string | LoginRequest): Promise<Account> {
  addresses += 1;
  const agent = request.agent(server).set('X-Forwarded-For', `198.51.100.${addresses}`);
  const res = await signInAs(agent, who);
  expect([who, res.status]).toEqual([who, 200]);
  const me = Me.parse(res.body);
  agent.set(PHONE_ACCOUNT_HEADER, me.id);
  const cookie = res.headers['set-cookie']![0]!.split(';')[0]!;
  return { agent, me, cookie, session: hashToken(cookie.split('=')[1]!) };
}
const switchTo = (agent: Agent, depotId: unknown) => agent.put(SWITCH).send({ depotId });
const meOf = async (agent: Agent) => Me.parse((await agent.get('/api/v1/auth/me')).body);
// What a session keeps of the switch.
const chosenOn = async (session: string) => (await db.select({ depotId: sessions.depotId, allDepots: sessions.allDepots }).from(sessions)
  .where(eq(sessions.id, session)))[0];
// A dispatcher as the session middleware gives a request, on the scope a test names.
const dispatcher: Me = { id: '00000000-0000-4000-8000-000000000000', username: 'ruwan', staffId: 'X-000', displayName: 'Ruwan', role: 'dispatcher', depotId: null, outletId: null };
const readOf = (scope: string, query: Record<string, unknown>) => readDepotOf({ user: { ...dispatcher, depotId: scope }, query } as unknown as Request);

describe('the switch to Both', () => {
  it('AC-1 answers Ruwan\'s Me with Both and keeps it on his session, and Peliyagoda or Kandy afterwards brings back one depot', async () => {
    expect(BOTH_DEPOTS).toBe('Both');
    const { agent, me, session } = await signIn('ruwan');
    expect(me.depotId).toBe('Peliyagoda');

    const both = await switchTo(agent, 'Both');
    expect(both.status).toBe(200);
    expect(Me.parse(both.body)).toEqual({ ...me, depotId: 'Both' });
    expect(await meOf(agent)).toEqual({ ...me, depotId: 'Both' });
    expect(await chosenOn(session)).toEqual({ depotId: null, allDepots: true });

    // Kandy brings back one depot, and Both again, then Peliyagoda.
    expect(Me.parse((await switchTo(agent, 'Kandy')).body)).toEqual({ ...me, depotId: 'Kandy' });
    expect(await meOf(agent)).toEqual({ ...me, depotId: 'Kandy' });
    expect(await chosenOn(session)).toEqual({ depotId: 'Kandy', allDepots: false });
    expect(Me.parse((await switchTo(agent, 'Both')).body)).toEqual({ ...me, depotId: 'Both' });
    expect(await chosenOn(session)).toEqual({ depotId: null, allDepots: true });
    expect(Me.parse((await switchTo(agent, 'Peliyagoda')).body)).toEqual(me);
    expect(await meOf(agent)).toEqual(me);
    expect(await chosenOn(session)).toEqual({ depotId: 'Peliyagoda', allDepots: false });
  });

  it('AC-1 starts a new sign-in at his own depot, and the session on Both keeps it for each of its tabs until it signs out', async () => {
    const first = await signIn('ruwan');
    expect((await switchTo(first.agent, 'Both')).status).toBe(200);

    const second = await signIn('ruwan');
    expect(second.me.depotId).toBe('Peliyagoda');
    expect((await meOf(second.agent)).depotId).toBe('Peliyagoda');
    expect(await chosenOn(second.session)).toEqual({ depotId: null, allDepots: false });
    expect((await meOf(first.agent)).depotId).toBe('Both');

    // Signing out ends the session, and Both with it.
    expect((await first.agent.post('/api/v1/auth/logout').set('Content-Type', 'application/json')).status).toBe(204);
    expect(code(await first.agent.get('/api/v1/auth/me'))).toEqual([401, 'signed_out']);
    expect(await chosenOn(first.session)).toBeUndefined();
  });

  it('AC-1 answers 403 to a loader, a driver, a store manager and an admin asking for Both, and leaves their sessions as they were', async () => {
    const others = ['kasun', 'dilshan', 'prasanna', 'nadeesha', 'admin'];
    for (const username of others) {
      const { agent, me } = await signIn(username);
      expect([username, ...code(await switchTo(agent, 'Both'))]).toEqual([username, 403, 'forbidden']);
      expect(await meOf(agent)).toEqual(me);
    }
    const kept = await db.select({ depotId: sessions.depotId, allDepots: sessions.allDepots }).from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId)).where(inArray(users.username, others));
    expect(kept.length).toBeGreaterThanOrEqual(others.length);
    expect(new Set(kept.map((session) => JSON.stringify(session)))).toEqual(new Set([JSON.stringify({ depotId: null, allDepots: false })]));
  });

  it('AC-1 keeps Both when a switch is refused: a depot not on the list, Both written another way, or no depot', async () => {
    const { agent, me, session } = await signIn('ruwan');
    expect((await switchTo(agent, 'Both')).status).toBe(200);
    for (const depotId of ['Galle', 'both', 'BOTH']) {
      const res = await switchTo(agent, depotId);
      expect([depotId, ...code(res)]).toEqual([depotId, 400, 'unknown_record']);
      expect(res.body.error.details).toEqual({ id: depotId });
    }
    for (const body of [{}, { depotId: '' }, { depotId: null }, { depot: 'Both' }]) {
      expect([body, ...code(await agent.put(SWITCH).send(body))]).toEqual([body, 400, 'invalid_input']);
    }
    expect(await meOf(agent)).toEqual({ ...me, depotId: 'Both' });
    expect(await chosenOn(session)).toEqual({ depotId: null, allDepots: true });
  });
});

describe('a tab that names its scope (rule 5, D-95)', () => {
  it('refuses a tab that still names one depot once the session is on Both, and a tab on Both once the session is on one depot', async () => {
    const { agent } = await signIn('ruwan');
    expect((await switchTo(agent, 'Both')).status).toBe(200);
    for (const depot of ['Peliyagoda', 'Kandy']) {
      for (const path of ['/api/v1/operations', '/api/v1/issues', '/api/v1/lookup/fleet', '/api/v1/plans']) {
        expect([depot, path, ...code(await agent.get(path).set(DEPOT_HEADER, depot))]).toEqual([depot, path, 409, 'depot_changed']);
      }
    }
    expect((await switchTo(agent, 'Kandy')).status).toBe(200);
    for (const path of ['/api/v1/operations', '/api/v1/issues', '/api/v1/lookup/fleet', '/api/v1/plans']) {
      expect([path, ...code(await agent.get(path).set(DEPOT_HEADER, 'Both'))]).toEqual([path, 409, 'depot_changed']);
    }
    // The switch itself goes through whatever the tab names.
    expect(Me.parse((await switchTo(agent, 'Both').set(DEPOT_HEADER, 'Kandy')).body).depotId).toBe('Both');
    expect(Me.parse((await switchTo(agent, 'Kandy').set(DEPOT_HEADER, 'Both')).body).depotId).toBe('Kandy');
  });

  it('lets a request through when the scope it names is the session\'s, Both included', () => {
    const shown = (scope: string, named: string | undefined) => {
      const passed: unknown[] = [];
      const req = { get: () => named, user: { ...dispatcher, depotId: scope }, path: '/operations' } as unknown as Request;
      requireShownDepot(req, {} as Response, (err?: unknown) => { passed.push(err ?? null); });
      return passed;
    };
    expect(shown('Both', 'Both')).toEqual([null]);
    expect(shown('Both', undefined)).toEqual([null]);
    expect(shown('Kandy', 'Kandy')).toEqual([null]);
    expect(shown('Both', 'Kandy')).toEqual([expect.objectContaining({ status: 409, code: 'depot_changed' })]);
    expect(shown('Peliyagoda', 'Both')).toEqual([expect.objectContaining({ status: 409, code: 'depot_changed' })]);
  });
});

describe('the depot of a dispatcher\'s read', () => {
  it('on one depot is that depot, named or not, and a read that names the other depot was made by a tab the session left', async () => {
    expect(await readOf('Kandy', {})).toBe('Kandy');
    expect(await readOf('Kandy', { depot: 'Kandy' })).toBe('Kandy');
    expect(await readOf('Peliyagoda', { depot: 'Peliyagoda', range: 'day' })).toBe('Peliyagoda');
    await expect(readOf('Kandy', { depot: 'Peliyagoda' })).rejects.toMatchObject({ status: 409, code: 'depot_changed' });
    await expect(readOf('Peliyagoda', { depot: 'Both' })).rejects.toMatchObject({ status: 409, code: 'depot_changed' });
  });

  it('on Both is the depot the read names, which must be on the list, and a read that names none is refused', async () => {
    expect(await readOf('Both', { depot: 'Peliyagoda' })).toBe('Peliyagoda');
    expect(await readOf('Both', { depot: 'Kandy', date: '2026-06-25' })).toBe('Kandy');
    await expect(readOf('Both', {})).rejects.toMatchObject({ status: 400, code: 'pick_a_depot' });
    await expect(readOf('Both', { range: 'day' })).rejects.toMatchObject({ status: 400, code: 'pick_a_depot' });
    for (const depot of ['Galle', 'kandy', 'Both']) {
      await expect(readOf('Both', { depot })).rejects.toMatchObject({ status: 400, code: 'unknown_record', details: { id: depot } });
    }
  });

  it('takes one depot name, never an empty one or two', async () => {
    for (const scope of ['Both', 'Kandy']) {
      for (const depot of ['', ['Kandy', 'Peliyagoda'], 'x'.repeat(65)]) {
        await expect(readOf(scope, { depot })).rejects.toBeInstanceOf(ZodError);
      }
    }
  });
});

// ── Ruwan on both depots' day ────────────────────────────────────────────────────────────────────────────────────────
// Thursday's plan is sent at both depots: the walkthrough's at Peliyagoda (VEH035 with Dilshan) and Kandy's suggested
// plan with D-037 on its first vehicle. Kasun has flagged one of VEH035's dry cartons short at Fresh Nugegoda and L-002 a
// carton short on Kandy's first truck, both still open. Each flag has a photo and each depot's first stop a proof photo,
// written straight into the table, since the photo reads check only whose depot a photo is. The clock reads Thu 02:30.
// Ruwan keeps one session on Both, and plans and compares on another session of his, on one depot at a time.

type Depot = 'Peliyagoda' | 'Kandy';
const DEPOTS = ['Peliyagoda', 'Kandy'] as const;
const OTHER: Record<Depot, Depot> = { Kandy: 'Peliyagoda', Peliyagoda: 'Kandy' };
interface BothDay {
  plans: Record<Depot, PlanBoard>;
  // Each depot's open flag, and the stop with its proof photo.
  flags: Record<Depot, string>;
  stops: Record<Depot, string>;
  pictures: Record<Depot, Buffer>;
  proofs: Record<Depot, Buffer>;
}

// A one-pixel-wide JPEG `rows` high, so each photo of the day is told apart by its bytes.
const jpegOf = (rows: number) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, rows, 0, 1, 1, 1, 17, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0, 0xff, 0xd9]);
// The path with the depot it names, after any query of its own.
const naming = (path: string, depot: string) => `${path}${path.includes('?') ? '&' : '?'}depot=${encodeURIComponent(depot)}`;
// Every dispatcher read of a depot's day: Live day and the dashboard, the problems and the bell, a problem's photo, the
// three look-up pages with and without their own query, and a stop's proof photo.
const readsOf = (day: BothDay, depot: Depot) => [
  '/api/v1/operations', '/api/v1/issues', `/api/v1/issues/${day.flags[depot]}/photo`,
  '/api/v1/lookup/orders', `/api/v1/lookup/orders?date=${THU}`, '/api/v1/lookup/orders?range=four_weeks',
  '/api/v1/lookup/history', `/api/v1/lookup/history?date=${THU}`, '/api/v1/lookup/fleet', `/api/v1/lookup/stops/${day.stops[depot]}/photo`,
];
const isPhoto = (path: string) => path.endsWith('/photo');

const idsOf = async <T extends { id: string }>(rows: Promise<T[]>) => (await rows).map((row) => row.id).sort();
const shopsOf = (depot: Depot) => idsOf(db.select({ id: outlets.id }).from(outlets).where(eq(outlets.depotId, depot)));
const vehiclesOf = (depot: Depot) => idsOf(db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.depotId, depot)));
const ordersOf = (depot: Depot) => idsOf(db.select({ id: orders.id }).from(orders).innerJoin(outlets, eq(outlets.id, orders.outletId)).where(eq(outlets.depotId, depot)));
const plansOf = (depot: Depot) => idsOf(db.select({ id: plans.id }).from(plans).where(eq(plans.depotId, depot)));
const tripsOf = (depot: Depot) => idsOf(db.select({ id: trips.id }).from(trips).innerJoin(plans, eq(plans.id, trips.planId)).where(eq(plans.depotId, depot)));
const issuesOf = (depot: Depot) => idsOf(db.select({ id: issues.id }).from(issues).innerJoin(stops, eq(stops.id, issues.stopId))
  .innerJoin(trips, eq(trips.id, stops.tripId)).innerJoin(plans, eq(plans.id, trips.planId)).where(eq(plans.depotId, depot)));
// The depot's loaders and drivers. Its dispatcher is left out: Ruwan works on both depots.
const crewOf = (depot: Depot) => idsOf(db.select({ id: users.id }).from(users).where(and(eq(users.depotId, depot), inArray(users.role, ['loader', 'driver']))));

// An answer holds the depot's records and none of the other depot's: every shop and vehicle it names is the depot's, and
// not one order, plan, trip, problem, loader or driver of the other depot is in it.
async function expectOnly(depot: Depot, what: string, body: unknown) {
  const text = JSON.stringify(body);
  const [shops, fleet] = [new Set(await shopsOf(depot)), new Set(await vehiclesOf(depot))];
  expect([what, [...new Set(text.match(/OUT\d{3}/g))].filter((id) => !shops.has(id))]).toEqual([what, []]);
  expect([what, [...new Set(text.match(/VEH\d{3}/g))].filter((id) => !fleet.has(id))]).toEqual([what, []]);
  const theirs = [...await ordersOf(OTHER[depot]), ...await plansOf(OTHER[depot]), ...await tripsOf(OTHER[depot]), ...await issuesOf(OTHER[depot]), ...await crewOf(OTHER[depot])];
  expect([what, theirs.filter((id) => text.includes(id))]).toEqual([what, []]);
}

const answered = (res: request.Response) => {
  expect(res.status, JSON.stringify(res.body.error)).toBe(200);
  return PlanBoard.parse(res.body);
};

// Every record planning, loading or an answer could change, so a test can show that a refused write changed none.
async function heldRecords() {
  return {
    ...await heldRows(),
    stopOrders: await db.select().from(stopOrders).orderBy(stopOrders.stopId, stopOrders.orderId),
    deferrals: await db.select().from(deferrals).orderBy(deferrals.id),
  };
}

describe('a dispatcher on both depots', () => {
  // Ruwan's session on Both, and another of his on one depot.
  let ruwan: Account;
  let planner: Account;
  let nadeesha: Account;
  let kasun: Account;
  let sarath: Account;
  let ashen: Account;
  let originalClock: typeof demoDay.$inferSelect;
  let day: BothDay;

  beforeAll(async () => {
    originalClock = (await db.select().from(demoDay))[0]!;
    [ruwan, planner, nadeesha, kasun, sarath, ashen] = [await signIn('ruwan'), await signIn('ruwan'), await signIn('nadeesha'),
      await signIn('kasun'), await signIn({ staffId: 'L-002', pin: PIN }), await signIn({ staffId: 'D-037', pin: PIN })];
  });
  afterAll(async () => {
    await resetDay();
    await db.update(demoDay).set(originalClock);
    testClock.at = '';
    setClockForTests(null);
  });

  // The seeded day at Wed 16:00, when orders for Thursday have closed, with Ruwan's planning session on Peliyagoda.
  async function seededDay() {
    await resetDay();
    await initClock();
    freeze(WED, 16 * 60);
    expect((await switchTo(planner.agent, 'Peliyagoda')).status).toBe(200);
  }

  // On Kandy, the planning session builds Thursday's suggested plan, gives its first vehicle to D-037 and accepts the
  // planner's decisions. Answers the board with the draft.
  async function kandysDraft(): Promise<PlanBoard> {
    expect((await switchTo(planner.agent, 'Kandy')).status).toBe(200);
    const start = answered(await planner.agent.get('/api/v1/plans'));
    let board = answered(await planner.agent.post(`/api/v1/plans/${THU}/suggest`).send({ planId: null, demoDay: start.demoDay }));
    const vehicleId = board.plan.trips[0]!.vehicleId;
    // Swap the two crews so Ashen drives the first truck and every sent trip retains an assigned driver (028 B1).
    const previousDriver = board.plan.trips[0]!.driverId;
    const trips = board.plan.trips.map((trip) => (trip.vehicleId === vehicleId ? { ...trip, driverId: ashen.me.id } : trip.driverId === ashen.me.id ? { ...trip, driverId: previousDriver } : trip));
    board = answered(await planner.agent.put(`/api/v1/plans/${THU}/draft`)
      .send({ planId: board.plan.id, revision: board.plan.revision, plan: { mixBrands: board.plan.mixBrands, trips, deferrals: board.plan.deferrals } }));
    const open = board.suggestion!.decisions.filter((decision) => decision.open).map((decision) => decision.key);
    if (open.length) board = answered(await planner.agent.post(`/api/v1/plans/${THU}/decisions`).send({ planId: board.plan.id, revision: board.plan.revision, keys: open }));
    return board;
  }

  // The loader starts the truck, loads every stop but the first, last first, and flags one carton short on the first.
  async function flagFirstStop(loader: Account, vehicleId: string, lineOf: (truck: LoadingTruck) => LoadingTruck['stops'][number]['lines'][number]) {
    const screen = loaderScreen(loader.agent);
    const loading = await screen.read();
    let truck = answeredTruck(await screen.start(truckOf(loading, vehicleId), loading.plan!), vehicleId);
    for (const seq of truck.stops.map((stop) => stop.seq).filter((seq) => seq !== 1).sort((a, b) => b - a)) truck = answeredTruck(await screen.stopLoaded(truck, seq), vehicleId);
    const line = lineOf(truck);
    truck = answeredTruck(await screen.flag(truck, 1, [{ lineId: line.lineId, counted: line.quantity - 1 }]), vehicleId);
    const flag = truck.issues.find((issue) => issue.status === 'open')!;
    return { vehicleId, flag: flag.id, stop: stopOf(truck, 1).id };
  }

  // Both depots' day as the block above describes it, with Ruwan's own session on Both.
  async function bothDepotsDay(): Promise<BothDay> {
    await seededDay();
    const peliyagoda = await sendWalkthroughPlan({ nadeesha: nadeesha.agent, ruwan: planner.agent, freeze });
    let kandy = await kandysDraft();
    kandy = answered(await planner.agent.post(`/api/v1/plans/${THU}/send`).send({ planId: kandy.plan.id, revision: kandy.plan.revision }));
    const flagged = {
      Peliyagoda: await flagFirstStop(kasun, 'VEH035', dryLine),
      Kandy: await flagFirstStop(sarath, kandy.plan.trips[0]!.vehicleId, (truck) => stopOf(truck, 1).lines[0]!),
    };
    const built: BothDay = {
      plans: { Peliyagoda: peliyagoda, Kandy: kandy },
      flags: { Peliyagoda: flagged.Peliyagoda.flag, Kandy: flagged.Kandy.flag },
      stops: { Peliyagoda: flagged.Peliyagoda.stop, Kandy: flagged.Kandy.stop },
      pictures: { Peliyagoda: jpegOf(2), Kandy: jpegOf(3) },
      proofs: { Peliyagoda: jpegOf(4), Kandy: jpegOf(5) },
    };
    // A problem's photo is its loader's, and a proof its truck's driver's.
    const takenAt = depotInstant(THU, 2 * 60 + 30);
    for (const depot of DEPOTS) {
      const loader = depot === 'Peliyagoda' ? kasun : sarath;
      const driverId = built.plans[depot].plan.trips.find((trip) => trip.vehicleId === flagged[depot].vehicleId)!.driverId!;
      await db.insert(photos).values([
        { id: randomUUID(), stopId: built.stops[depot], issueId: built.flags[depot], jpeg: built.pictures[depot], takenBy: loader.me.id, takenAt },
        { id: randomUUID(), stopId: built.stops[depot], issueId: null, jpeg: built.proofs[depot], takenBy: driverId, takenAt },
      ]);
    }
    expect((await switchTo(ruwan.agent, 'Both')).status).toBe(200);
    return built;
  }

  describe('reading', () => {
    beforeAll(async () => { day = await bothDepotsDay(); });

    it('AC-2 answers every read that names no depot 400 pick_a_depot, from a tab on Both or from none', async () => {
      for (const path of new Set([...readsOf(day, 'Peliyagoda'), ...readsOf(day, 'Kandy')])) {
        for (const named of [undefined, 'Both']) {
          const asked = ruwan.agent.get(path);
          const res = await (named ? asked.set(DEPOT_HEADER, named) : asked);
          expect([path, named, ...code(res)]).toEqual([path, named, 400, 'pick_a_depot']);
        }
      }
    });

    it('AC-2 answers each read that names a depot with that depot\'s, as a session on that depot reads it, and Peliyagoda\'s and Kandy\'s differ', async () => {
      const read: Record<Depot, Record<string, unknown>> = { Peliyagoda: {}, Kandy: {} };
      for (const depot of DEPOTS) {
        expect((await switchTo(planner.agent, depot)).status).toBe(200);
        for (const path of readsOf(day, depot)) {
          const one = await planner.agent.get(path);
          expect([depot, path, one.status]).toEqual([depot, path, 200]);
          for (const named of [undefined, 'Both']) {
            const asked = ruwan.agent.get(naming(path, depot));
            const both = await (named ? asked.set(DEPOT_HEADER, named) : asked);
            expect([depot, path, named, both.status]).toEqual([depot, path, named, 200]);
            expect([depot, path, named, both.body]).toEqual([depot, path, named, one.body]);
          }
          read[depot][path.replace(day.flags[depot], ':flag').replace(day.stops[depot], ':stop')] = one.body;
          if (!isPhoto(path)) await expectOnly(depot, path, one.body);
        }
      }
      // Each read is the depot it names: its depot, its own sent plan and its own photos.
      expect(OperationsDay.parse(read.Peliyagoda['/api/v1/operations'])).toMatchObject({ depot: { id: 'Peliyagoda' }, plan: { id: day.plans.Peliyagoda.plan.id } });
      expect(OperationsDay.parse(read.Kandy['/api/v1/operations'])).toMatchObject({ depot: { id: 'Kandy' }, plan: { id: day.plans.Kandy.plan.id } });
      for (const depot of DEPOTS) {
        expect(IssueList.parse(read[depot]['/api/v1/issues']).issues.map((issue) => issue.id)).toEqual([day.flags[depot]]);
        for (const page of ['orders', 'history', 'fleet']) expect([depot, page, (read[depot][`/api/v1/lookup/${page}`] as { depot: unknown }).depot]).toEqual([depot, page, { id: depot, name: depot }]);
        expect(read[depot]['/api/v1/issues/:flag/photo']).toEqual(day.pictures[depot]);
        expect(read[depot]['/api/v1/lookup/stops/:stop/photo']).toEqual(day.proofs[depot]);
      }
      for (const path of Object.keys(read.Peliyagoda)) expect([path, read.Peliyagoda[path]]).not.toEqual([path, read.Kandy[path]]);
    });

    it('AC-2 answers a photo named for the other depot 400 unknown_record, as that depot\'s session would', async () => {
      for (const depot of DEPOTS) {
        for (const path of [`/api/v1/issues/${day.flags[depot]}/photo`, `/api/v1/lookup/stops/${day.stops[depot]}/photo`]) {
          expect([path, ...code(await ruwan.agent.get(naming(path, OTHER[depot])))]).toEqual([path, 400, 'unknown_record']);
        }
      }
    });

    it('AC-2 answers a read on Both that names a depot not on the list 400 unknown_record, and one written wrong 400 invalid_input, its own query still checked', async () => {
      for (const path of readsOf(day, 'Kandy')) {
        for (const depot of ['Galle', 'kandy', 'Both']) {
          const res = await ruwan.agent.get(naming(path, depot));
          expect([path, depot, ...code(res)]).toEqual([path, depot, 400, 'unknown_record']);
          expect(res.body.error.details).toEqual({ id: depot });
        }
        expect([path, ...code(await ruwan.agent.get(naming(path, '')))]).toEqual([path, 400, 'invalid_input']);
        expect([path, ...code(await ruwan.agent.get(naming(naming(path, 'Kandy'), 'Peliyagoda')))]).toEqual([path, 400, 'invalid_input']);
      }
      for (const path of ['/api/v1/lookup/orders?range=year', '/api/v1/lookup/history?date=2026-02-30', '/api/v1/lookup/fleet?day=today',
        `/api/v1/lookup/stops/${day.stops.Kandy}/photo?size=big`]) {
        expect([path, ...code(await ruwan.agent.get(naming(path, 'Kandy')))]).toEqual([path, 400, 'invalid_input']);
      }
    });

    it('AC-2 lets a session on one depot name its own depot or none, and answers one that names the other 409 depot_changed', async () => {
      for (const depot of DEPOTS) {
        expect((await switchTo(planner.agent, depot)).status).toBe(200);
        for (const path of readsOf(day, depot)) {
          const none = await planner.agent.get(path);
          const own = await planner.agent.get(naming(path, depot));
          expect([depot, path, none.status, own.status]).toEqual([depot, path, 200, 200]);
          expect([depot, path, own.body]).toEqual([depot, path, none.body]);
          expect([depot, path, ...code(await planner.agent.get(naming(path, OTHER[depot])))]).toEqual([depot, path, 409, 'depot_changed']);
        }
      }
    });

    it('refuses the dispatcher\'s reads to every other role whatever depot they name, and leaves their own reads on their own depot', async () => {
      const admin = await signIn('admin');
      const others = [['kasun', kasun.agent, 'forbidden'], ['D-037', ashen.agent, 'forbidden'], ['nadeesha', nadeesha.agent, 'forbidden'], ['admin', admin.agent, 'no_depot']] as const;
      for (const path of readsOf(day, 'Kandy')) {
        for (const [who, agent, refusal] of others) {
          expect([who, path, ...code(await agent.get(naming(path, 'Kandy')))]).toEqual([who, path, 403, refusal]);
        }
      }
      // A loader and a driver read their own depot's day, whatever depot a request names.
      expect(LoadingDay.parse((await kasun.agent.get('/api/v1/loading?depot=Kandy')).body)).toMatchObject({ depot: 'Peliyagoda', plan: { id: day.plans.Peliyagoda.plan.id } });
      expect(LoadingDay.parse((await sarath.agent.get('/api/v1/loading?depot=Peliyagoda')).body)).toMatchObject({ depot: 'Kandy', plan: { id: day.plans.Kandy.plan.id } });
      expect(DriverDay.parse((await ashen.agent.get('/api/v1/driver?depot=Peliyagoda')).body)).toMatchObject({ depot: 'Kandy', driverId: ashen.me.id });
    });

    it('AC-4 sends a stream on Both every depot\'s changes, and a stream opened after a switch to one depot only that depot\'s', async () => {
      const both = await listen(ruwan.cookie);
      const kandyLoader = await listen(sarath.cookie);
      announce({ topic: 'plans', id: 'Peliyagoda\'s change', depotId: 'Peliyagoda' });
      announce({ topic: 'plans', id: 'Kandy\'s change', depotId: 'Kandy' });
      announce({ topic: 'orders', id: 'a shop\'s own change', outletId: 'OUT076' });
      announce({ topic: 'clock' });
      announce({ topic: 'last' });
      await soon(() => expect(changesIn(both.text)).toContainEqual({ topic: 'last' }));
      await soon(() => expect(changesIn(kandyLoader.text)).toContainEqual({ topic: 'last' }));
      expect(changesIn(both.text)).toEqual([{ topic: 'plans', id: 'Peliyagoda\'s change' }, { topic: 'plans', id: 'Kandy\'s change' }, { topic: 'clock' }, { topic: 'last' }]);
      // Every other role hears its own depot as before.
      expect(changesIn(kandyLoader.text)).toEqual([{ topic: 'plans', id: 'Kandy\'s change' }, { topic: 'clock' }, { topic: 'last' }]);
      closeStreams();
      await Promise.all([both.over, kandyLoader.over]);

      // The other session of Ruwan's, switched to Kandy, hears Kandy alone.
      expect((await switchTo(planner.agent, 'Kandy')).status).toBe(200);
      const kandy = await listen(planner.cookie);
      announce({ topic: 'plans', id: 'Peliyagoda\'s change', depotId: 'Peliyagoda' });
      announce({ topic: 'plans', id: 'Kandy\'s change', depotId: 'Kandy' });
      announce({ topic: 'last' });
      await soon(() => expect(changesIn(kandy.text)).toContainEqual({ topic: 'last' }));
      expect(changesIn(kandy.text)).toEqual([{ topic: 'plans', id: 'Kandy\'s change' }, { topic: 'last' }]);
      closeStreams();
      await kandy.over;
    });

    it('AC-3 saves an answer given on Both on the problem\'s own depot, as with that depot chosen, and its loader hears it', async () => {
      const [both, peliyagodaLoader, kandyLoader] = [await listen(ruwan.cookie), await listen(kasun.cookie), await listen(sarath.cookie)];
      const answers: Record<Depot, IssueDecision> = { Peliyagoda: 'go_short', Kandy: 'load_all' };
      const at = depotInstant(THU, 2 * 60 + 30);
      for (const depot of DEPOTS) {
        const res = await ruwan.agent.post(`/api/v1/issues/${day.flags[depot]}/decide`).set(DEPOT_HEADER, 'Both').send({ revision: 0, decision: answers[depot] });
        expect([depot, res.status]).toEqual([depot, 200]);
        const answer = DecideIssueResponse.parse(res.body);
        expect(answer.decided).toMatchObject({ id: day.flags[depot], status: 'decided', decision: answers[depot], decidedBy: 'Ruwan', decidedAt: at.toISOString() });
        // It answers the problem's depot's list, which no longer holds it, as that depot's read now does.
        await expectOnly(depot, 'answer', answer);
        expect(answer.issues).toEqual([]);
        const after = await ruwan.agent.get(naming('/api/v1/issues', depot));
        expect(IssueList.parse(after.body)).toEqual({ day: answer.day, replaceOn: answer.replaceOn, issues: answer.issues });
        // Saved on the problem as with the depot chosen: the answer, who gave it and when, and its audit row.
        const [saved] = await db.select().from(issues).where(eq(issues.id, day.flags[depot]));
        expect(saved).toMatchObject({ status: 'decided', decision: answers[depot], decidedBy: ruwan.me.id, decidedAt: at, revision: 1 });
        const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.entity, 'issue'), eq(auditLog.entityId, day.flags[depot]), eq(auditLog.action, 'issue.decided')));
        expect(audit).toMatchObject({ actorId: ruwan.me.id, after: { status: 'decided', decision: answers[depot], revision: 1 } });
      }
      // Each loader's truck shows its own answer.
      const loaded = { Peliyagoda: await loaderScreen(kasun.agent).read(), Kandy: await loaderScreen(sarath.agent).read() };
      for (const depot of DEPOTS) {
        const flagged = loaded[depot].trucks.flatMap((truck) => truck.issues).find((issue) => issue.id === day.flags[depot]);
        expect([depot, flagged]).toMatchObject([depot, { status: 'decided', decision: answers[depot] }]);
      }
      // Ruwan's stream on Both hears both answers, and each loader only the answer to its own depot's flag.
      announce({ topic: 'last' });
      for (const stream of [both, peliyagodaLoader, kandyLoader]) await soon(() => expect(changesIn(stream.text)).toContainEqual({ topic: 'last' }));
      const told = [{ topic: 'issues' }, { topic: 'loading' }];
      expect(changesIn(both.text)).toEqual([...told, ...told, { topic: 'last' }]);
      expect(changesIn(peliyagodaLoader.text)).toEqual([...told, { topic: 'last' }]);
      expect(changesIn(kandyLoader.text)).toEqual([...told, { topic: 'last' }]);
      closeStreams();
      await Promise.all([both.over, peliyagodaLoader.over, kandyLoader.over]);
    });

    it('AC-3 refuses on Both an answer to a problem on no depot\'s list, and one already given, as on one depot', async () => {
      const held = await heldRecords();
      const unknown = randomUUID();
      const res = await ruwan.agent.post(`/api/v1/issues/${unknown}/decide`).send({ revision: 0, decision: 'go_short' });
      expect(code(res)).toEqual([400, 'unknown_record']);
      expect(res.body.error.details).toEqual({ id: unknown });
      expect(code(await ruwan.agent.post(`/api/v1/issues/${day.flags.Kandy}/decide`).send({ revision: 0, decision: 'go_short' }))).toEqual([409, 'stale']);
      expect(code(await ruwan.agent.post(`/api/v1/issues/${day.flags.Kandy}/decide`).send({ revision: 1, decision: 'go_short' }))).toEqual([409, 'stale']);
      expect(code(await ruwan.agent.post('/api/v1/issues/not-a-problem/decide').send({ revision: 0, decision: 'go_short' }))).toEqual([400, 'invalid_input']);
      expect(await heldRecords()).toEqual(held);
    });
  });

  describe('planning', () => {
    let kandy: PlanBoard;
    let peliyagoda: PlanBoard;
    beforeAll(async () => {
      await seededDay();
      peliyagoda = await sendWalkthroughPlan({ nadeesha: nadeesha.agent, ruwan: planner.agent, freeze });
      kandy = await kandysDraft();
      expect((await switchTo(ruwan.agent, 'Both')).status).toBe(200);
    });

    it('AC-3 refuses every plan route on Both with 409 pick_a_depot and changes nothing: Kandy\'s draft and Peliyagoda\'s sent plan stay as they were', async () => {
      const held = await heldRecords();
      const draft = { planId: kandy.plan.id, revision: kandy.plan.revision };
      const order = kandy.orders.find((one) => one.lines.length > 1)!;
      const plan = `/api/v1/plans/${THU}`;
      const writes: [string, () => request.Test][] = [
        ['board', () => ruwan.agent.get('/api/v1/plans')],
        ['board of the day', () => ruwan.agent.get(plan)],
        ['board naming its depot', () => ruwan.agent.get(naming(plan, 'Kandy'))],
        ['draft save', () => ruwan.agent.put(`${plan}/draft`).send({ ...draft, plan: { mixBrands: kandy.plan.mixBrands, trips: kandy.plan.trips, deferrals: kandy.plan.deferrals.slice(1) } })],
        ['split', () => ruwan.agent.post(`${plan}/split`).send({ ...draft, orderId: order.id, keep: [{ productId: order.lines[0]!.productId, quantity: order.lines[0]!.quantity }] })],
        ['join', () => ruwan.agent.post(`${plan}/join`).send({ ...draft, orderId: order.id })],
        ['send', () => ruwan.agent.post(`${plan}/send`).send(draft)],
        ['back to edit', () => ruwan.agent.post(`${plan}/unsend`).send({ planId: peliyagoda.plan.id, revision: peliyagoda.plan.revision })],
        ['find a slot', () => ruwan.agent.get(`${plan}/slots`).query({ orderId: order.id })],
        ['build', () => ruwan.agent.post(`${plan}/suggest`).send(draft)],
        ['build the first', () => ruwan.agent.post(`${plan}/suggest`).send({ planId: null, demoDay: kandy.demoDay })],
        ['accept', () => ruwan.agent.post(`${plan}/decisions`).send({ ...draft, keys: ['early_leave:VEH044:1'] })],
        ['a body of the wrong shape', () => ruwan.agent.post(`${plan}/send`).send({ planId: 'nobody' })],
      ];
      for (const [what, write] of writes) {
        for (const named of [undefined, 'Both']) {
          const res = await (named ? write().set(DEPOT_HEADER, named) : write());
          expect([what, named, ...code(res)]).toEqual([what, named, 409, 'pick_a_depot']);
          expect(res.body.error.message).toBe('A plan belongs to one depot. Pick the depot to plan.');
        }
      }
      expect(await heldRecords()).toEqual(held);

      // The same writes go through once the session is on their depot: Kandy's draft is sent, and Peliyagoda's sent plan
      // goes back to edit.
      expect((await switchTo(ruwan.agent, 'Kandy')).status).toBe(200);
      expect(answered(await ruwan.agent.post(`${plan}/send`).send(draft)).plan.status).toBe('published');
      expect((await switchTo(ruwan.agent, 'Peliyagoda')).status).toBe(200);
      expect(answered(await ruwan.agent.post(`${plan}/unsend`).send({ planId: peliyagoda.plan.id, revision: peliyagoda.plan.revision })).plan.status).toBe('draft');
    });
  });
});

// A live stream as an open screen holds it, read in the background as live.test.ts does: `text` is all the server has
// written, and `over` settles when the stream ends or is cut.
async function listen(cookie: string) {
  const res = await fetch(`${address(server)}/api/v1/events`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const stream = { text: '', over: Promise.resolve() };
  stream.over = (async () => {
    for (let piece = await reader.read(); !piece.done; piece = await reader.read()) stream.text += decoder.decode(piece.value, { stream: true });
  })();
  return stream;
}
// The changes a stream was sent, without the heartbeats. The last piece is left out: empty, or a message still arriving.
const changesIn = (text: string) => text.split('\n\n').slice(0, -1).filter((block) => block !== ': ping')
  .map((block) => LiveEvent.parse(JSON.parse(block.replace('event: change\ndata: ', ''))));
// Looks again until the check passes, for what the server sends a moment after it was asked.
async function soon(check: () => unknown): Promise<void> {
  const giveUp = performance.now() + 2000;
  for (;;) {
    try {
      await check();
      return;
    } catch (err) {
      if (performance.now() > giveUp) throw err;
      await new Promise((again) => setTimeout(again, 10));
    }
  }
}
