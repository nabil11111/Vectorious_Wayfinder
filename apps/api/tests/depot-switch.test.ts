import {
  DriverDay, IssueList, LiveEvent, LoadingDay, Me, OperationsDay, PHONE_ACCOUNT_HEADER, PlanBoard, StoreNextOrder, type LoginRequest,
} from '@wayfinder/contracts';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { demoId } from '../src/db/demo-day';
import { demoDay, orders, outlets, plans, sessions, trips, users, vehicles } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce, closeStreams } from '../src/lib/live';
import { driverScreen, driverTrip, driverWrite } from './driver-plan';
import { answeredTruck, answerFlag, loaderScreen, resetDay, stopOf, truckOf } from './loading-plan';
import { address, serve, stop } from './serve';
import { PIN, SIGN_IN, signInAs, signInBody } from './sign-in';

// Spec 020: the dispatcher's depot switch. The choice belongs to the session (D-93): it holds until the dispatcher
// switches again or signs out, a new sign-in starts at their own depot, and every route that reads the caller's depot
// follows it unchanged. The accounts spec 020 adds sign in to their own shop or depot.

// The app's clock is held where a test puts it.
const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at || clock.demoClockAt(...args).now }) };
});
const freeze = (date: string, minute: number) => { const at = depotInstant(date, minute); testClock.at = at.toISOString(); setClockForTests(at); };
const WED = '2026-06-24';
const THU = '2026-06-25';

const server = await serve(createApp());
type Agent = ReturnType<typeof request.agent>;
const SWITCH = '/api/v1/me/depot';
const code = (res: request.Response) => [res.status, res.body.error?.code];

afterAll(async () => {
  closeStreams();
  await stop(server);
  await pool.end();
});

// An account signed in on an agent of its own, which keeps the session cookie and, as a phone does, names the account
// on every write (spec 015), and the Me it was answered with. A fixture account is named by its username, any other
// sign-in by its staff ID and PIN.
async function signIn(who: string | LoginRequest): Promise<{ agent: Agent; me: Me }> {
  const agent = request.agent(server);
  const res = await signInAs(agent, who);
  expect([who, res.status]).toEqual([who, 200]);
  const me = Me.parse(res.body);
  agent.set(PHONE_ACCOUNT_HEADER, me.id);
  return { agent, me };
}
const switchTo = (agent: Agent, depotId: unknown) => agent.put(SWITCH).send({ depotId });
const meOf = async (agent: Agent) => Me.parse((await agent.get('/api/v1/auth/me')).body);
const boardDepotOf = async (agent: Agent) => PlanBoard.parse((await agent.get('/api/v1/plans')).body).depot;
// The depot chosen on each session of these accounts, as the sessions table holds it.
const chosenOn = async (usernames: string[]) => (await db.select({ depotId: sessions.depotId }).from(sessions)
  .innerJoin(users, eq(users.id, sessions.userId)).where(inArray(users.username, usernames))).map((session) => session.depotId);

describe('the depot switch', () => {
  it('AC-3 answers Ruwan\'s Me with Kandy, and his session plans Kandy until he switches back', async () => {
    const { agent, me } = await signIn('ruwan');
    expect(me.depotId).toBe('Peliyagoda');

    const res = await switchTo(agent, 'Kandy');
    expect(res.status).toBe(200);
    expect(Me.parse(res.body)).toEqual({ ...me, depotId: 'Kandy' });
    expect(await meOf(agent)).toEqual({ ...me, depotId: 'Kandy' });
    expect(await boardDepotOf(agent)).toBe('Kandy');

    // Back to his own depot.
    expect(Me.parse((await switchTo(agent, 'Peliyagoda')).body)).toEqual(me);
    expect(await meOf(agent)).toEqual(me);
    expect(await boardDepotOf(agent)).toBe('Peliyagoda');
  });

  it('AC-3 starts a new sign-in at his own depot, and the session that switched keeps its choice until it signs out', async () => {
    const first = await signIn('ruwan');
    expect((await switchTo(first.agent, 'Kandy')).status).toBe(200);

    const second = await signIn('ruwan');
    expect(second.me.depotId).toBe('Peliyagoda');
    expect((await meOf(second.agent)).depotId).toBe('Peliyagoda');
    expect(await boardDepotOf(second.agent)).toBe('Peliyagoda');
    expect((await meOf(first.agent)).depotId).toBe('Kandy');
    expect(await boardDepotOf(first.agent)).toBe('Kandy');

    // Signing out ends the session, and the choice with it.
    expect((await first.agent.post('/api/v1/auth/logout').set('Content-Type', 'application/json')).status).toBe(204);
    expect(code(await first.agent.get('/api/v1/auth/me'))).toEqual([401, 'signed_out']);
    expect(code(await switchTo(first.agent, 'Kandy'))).toEqual([401, 'signed_out']);
  });

  it('AC-3 lets another tab of the same session read the chosen depot on its next read', async () => {
    // Two tabs of one browser send the same session cookie.
    const signedIn = await request(server).post(SIGN_IN).send(signInBody('ruwan'));
    const cookie = signedIn.get('Set-Cookie')![0]!.split(';')[0]!;
    const otherTab = async () => PlanBoard.parse((await request(server).get('/api/v1/plans').set('Cookie', cookie)).body).depot;
    expect(await otherTab()).toBe('Peliyagoda');
    expect((await request(server).put(SWITCH).set('Cookie', cookie).send({ depotId: 'Kandy' })).status).toBe(200);
    expect(await otherTab()).toBe('Kandy');
  });

  it('AC-4 answers 403 to a loader, a driver, a store manager and an admin, and leaves their sessions as they were', async () => {
    const others = ['kasun', 'dilshan', 'prasanna', 'nadeesha', 'admin'];
    for (const username of others) {
      const { agent, me } = await signIn(username);
      expect([username, ...code(await switchTo(agent, 'Kandy'))]).toEqual([username, 403, 'forbidden']);
      // A body that is not a switch at all is refused for the role first.
      expect([username, ...code(await agent.put(SWITCH).send({}))]).toEqual([username, 403, 'forbidden']);
      expect(await meOf(agent)).toEqual(me);
    }
    expect(new Set(await chosenOn(others))).toEqual(new Set([null]));
  });

  it('AC-4 answers 400 for a depot that does not exist and for a body without one, and keeps the depot chosen before', async () => {
    const { agent, me } = await signIn('ruwan');
    expect((await switchTo(agent, 'Kandy')).status).toBe(200);

    const unknown = await switchTo(agent, 'Galle');
    expect(code(unknown)).toEqual([400, 'unknown_record']);
    expect(unknown.body.error.details).toEqual({ id: 'Galle' });
    // Depot ids are matched exactly, as every other id is.
    expect(code(await switchTo(agent, 'kandy'))).toEqual([400, 'unknown_record']);
    for (const body of [{}, { depotId: '' }, { depotId: 7 }, { depotId: null }, { depot: 'Kandy' }]) {
      expect([body, ...code(await agent.put(SWITCH).send(body))]).toEqual([body, 400, 'invalid_input']);
    }
    expect(await meOf(agent)).toEqual({ ...me, depotId: 'Kandy' });
    expect(await boardDepotOf(agent)).toBe('Kandy');
  });

  it('answers 401 to someone signed out', async () => {
    expect(code(await request(server).put(SWITCH).send({ depotId: 'Kandy' }))).toEqual([401, 'signed_out']);
    expect(code(await request(server).put(SWITCH).set('Cookie', 'wf_session=not-a-session').send({ depotId: 'Kandy' }))).toEqual([401, 'signed_out']);
  });
});

// ── Ruwan on Kandy's day ─────────────────────────────────────────────────────────────────────────────────────────────
// Every test starts from the seeded day at Wed 24 Jun 16:00, when orders for Thursday have closed, and the day is put
// back at the end.

type Depot = 'Kandy' | 'Peliyagoda';
const OTHER: Record<Depot, Depot> = { Kandy: 'Peliyagoda', Peliyagoda: 'Kandy' };
// Every dispatcher read: the plan board, Live day and the dashboard, the problems, and the three look-up pages.
const DISPATCHER_READS = ['/api/v1/plans', '/api/v1/operations', '/api/v1/issues', '/api/v1/lookup/orders', '/api/v1/lookup/history', '/api/v1/lookup/fleet'];

const idsOf = async <T extends { id: string }>(rows: Promise<T[]>) => (await rows).map((row) => row.id).sort();
const shopsOf = (depot: Depot) => idsOf(db.select({ id: outlets.id }).from(outlets).where(eq(outlets.depotId, depot)));
const vehiclesOf = (depot: Depot) => idsOf(db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.depotId, depot)));
const ordersOf = (depot: Depot) => idsOf(db.select({ id: orders.id }).from(orders).innerJoin(outlets, eq(outlets.id, orders.outletId)).where(eq(outlets.depotId, depot)));
const plansOf = (depot: Depot) => idsOf(db.select({ id: plans.id }).from(plans).where(eq(plans.depotId, depot)));
const tripsOf = (depot: Depot) => idsOf(db.select({ id: trips.id }).from(trips).innerJoin(plans, eq(plans.id, trips.planId)).where(eq(plans.depotId, depot)));
// The depot's loaders and drivers. Its dispatcher is left out: Ruwan works on both depots.
const crewOf = (depot: Depot) => idsOf(db.select({ id: users.id }).from(users).where(and(eq(users.depotId, depot), inArray(users.role, ['loader', 'driver']))));

// An answer holds the depot's records and none of the other depot's: every shop and vehicle it names is the depot's, and
// not one order, plan, trip, loader or driver of the other depot is in it.
async function expectOnly(depot: Depot, what: string, body: unknown) {
  const text = JSON.stringify(body);
  const [shops, fleet] = [new Set(await shopsOf(depot)), new Set(await vehiclesOf(depot))];
  expect([what, [...new Set(text.match(/OUT\d{3}/g))].filter((id) => !shops.has(id))]).toEqual([what, []]);
  expect([what, [...new Set(text.match(/VEH\d{3}/g))].filter((id) => !fleet.has(id))]).toEqual([what, []]);
  const theirs = [...await ordersOf(OTHER[depot]), ...await plansOf(OTHER[depot]), ...await tripsOf(OTHER[depot]), ...await crewOf(OTHER[depot])];
  expect([what, theirs.filter((id) => text.includes(id))]).toEqual([what, []]);
}

const answered = (res: request.Response) => {
  expect(res.status, JSON.stringify(res.body.error)).toBe(200);
  return PlanBoard.parse(res.body);
};
const boardOf = async (agent: Agent) => answered(await agent.get('/api/v1/plans'));
// Each record of the depot's day that planning could change, so a test can show that planning the other depot left it.
async function recordsOf(depot: Depot) {
  const shops = db.select({ id: outlets.id }).from(outlets).where(eq(outlets.depotId, depot));
  return {
    orders: await db.select().from(orders).where(inArray(orders.outletId, shops)).orderBy(orders.id),
    plans: await db.select().from(plans).where(eq(plans.depotId, depot)).orderBy(plans.id),
    trips: await tripsOf(depot),
  };
}

describe('a dispatcher switched to Kandy', () => {
  let ruwan: Agent;
  let sarath: Agent;
  let ashen: Agent;
  let ashenId: string;
  let originalClock: typeof demoDay.$inferSelect;

  beforeAll(async () => {
    originalClock = (await db.select().from(demoDay))[0]!;
    ruwan = (await signIn('ruwan')).agent;
    sarath = (await signIn({ staffId: 'L-002', pin: PIN })).agent;
    const driver = await signIn({ staffId: 'D-037', pin: PIN });
    [ashen, ashenId] = [driver.agent, driver.me.id];
  });
  beforeEach(async () => {
    await resetDay();
    await initClock();
    freeze(WED, 16 * 60);
  });
  afterAll(async () => {
    await resetDay();
    await db.update(demoDay).set(originalClock);
    testClock.at = '';
    setClockForTests(null);
  });

  // Ruwan, on Kandy, builds Thursday's suggested plan, gives the first vehicle on it to D-037, accepts the planner's
  // decisions and sends it. Answers the sent board.
  async function sendKandysPlan(): Promise<PlanBoard> {
    expect((await switchTo(ruwan, 'Kandy')).status).toBe(200);
    const start = await boardOf(ruwan);
    let board = answered(await ruwan.post(`/api/v1/plans/${THU}/suggest`).send({ planId: null, demoDay: start.demoDay }));
    const { vehicleId, driverId: was } = board.plan.trips[0]!;
    // The suggestion gives every truck a driver (spec 022), so D-037 swaps with the first truck's, as the driver menu does.
    const trips = board.plan.trips.map((trip) => (trip.vehicleId === vehicleId ? { ...trip, driverId: ashenId } : trip.driverId === ashenId ? { ...trip, driverId: was } : trip));
    board = answered(await ruwan.put(`/api/v1/plans/${THU}/draft`)
      .send({ planId: board.plan.id, revision: board.plan.revision, plan: { mixBrands: board.plan.mixBrands, trips, deferrals: board.plan.deferrals } }));
    const open = board.suggestion!.decisions.filter((decision) => decision.open).map((decision) => decision.key);
    if (open.length) board = answered(await ruwan.post(`/api/v1/plans/${THU}/decisions`).send({ planId: board.plan.id, revision: board.plan.revision, keys: open }));
    return answered(await ruwan.post(`/api/v1/plans/${THU}/send`).send({ planId: board.plan.id, revision: board.plan.revision }));
  }

  it('AC-3 shows the plan board Kandy\'s Thursday after the switch, with its vehicles and drivers and none of Peliyagoda\'s, and Peliyagoda\'s after switching back', async () => {
    expect((await switchTo(ruwan, 'Kandy')).status).toBe(200);
    const kandy = await boardOf(ruwan);
    expect(kandy).toMatchObject({ depot: 'Kandy', day: { date: THU, open: true }, plan: { id: null, trips: [], deferrals: [] } });
    // Kandy's 64 orders for Thursday, its 22 vehicles and its 22 drivers, Prasanna and D-037 among them.
    expect(kandy.orders.map((order) => order.id).sort()).toEqual(await ordersOf('Kandy'));
    expect(kandy.orders).toHaveLength(64);
    expect(kandy.vehicles.map((vehicle) => vehicle.id).sort()).toEqual(await vehiclesOf('Kandy'));
    expect(kandy.drivers).toHaveLength(22);
    expect(kandy.drivers.map((driver) => driver.name)).toEqual(expect.arrayContaining(['Prasanna', 'Ashen']));
    await expectOnly('Kandy', 'board', kandy);

    // Back on Peliyagoda: the walkthrough's board, 102 orders due before Nadeesha places her draft, 35 drivers.
    expect((await switchTo(ruwan, 'Peliyagoda')).status).toBe(200);
    const peliyagoda = await boardOf(ruwan);
    expect(peliyagoda).toMatchObject({ depot: 'Peliyagoda', day: { date: THU, open: true }, plan: { id: null } });
    expect(peliyagoda.orders).toHaveLength(102);
    expect(peliyagoda.drivers).toHaveLength(35);
    await expectOnly('Peliyagoda', 'board', peliyagoda);
  });

  it('AC-3 builds and sends Kandy\'s suggested plan on Kandy, and leaves every record of Peliyagoda\'s as it was', async () => {
    const peliyagoda = await recordsOf('Peliyagoda');
    const sent = await sendKandysPlan();
    expect(sent).toMatchObject({ depot: 'Kandy', plan: { status: 'published' } });
    // Every one of Kandy's orders is on a trip or deferred with a reason, and only Kandy's vehicles carry them.
    const onTrips = sent.plan.trips.flatMap((trip) => trip.stops.flatMap((stop) => stop.orderIds));
    expect([...onTrips, ...sent.plan.deferrals.map((deferral) => deferral.orderId)].sort()).toEqual(sent.orders.map((order) => order.id).sort());
    expect(onTrips.length).toBeGreaterThan(0);
    await expectOnly('Kandy', 'sent board', sent);
    expect(await db.select({ depotId: plans.depotId, status: plans.status }).from(plans).where(eq(plans.date, THU))).toEqual([{ depotId: 'Kandy', status: 'published' }]);

    // Peliyagoda's day is untouched: its orders, its plans and its board's 102 unplanned orders.
    expect(await recordsOf('Peliyagoda')).toEqual(peliyagoda);
    expect((await switchTo(ruwan, 'Peliyagoda')).status).toBe(200);
    expect(await boardOf(ruwan)).toMatchObject({ depot: 'Peliyagoda', plan: { id: null, status: 'draft' } });
  });

  it('AC-3 and AC-7 let L-002 load a Kandy truck and flag a line, Ruwan answer it on Kandy and not on Peliyagoda, and D-037 drive the trip', async () => {
    const sent = await sendKandysPlan();
    const trip = sent.plan.trips.find((t) => t.driverId === ashenId && t.tripNo === 1)!;
    freeze(THU, 2 * 60 + 30);

    // L-002's loading list is Kandy's sent plan.
    const loader = loaderScreen(sarath);
    const day = await loader.read();
    expect(day).toMatchObject({ depot: 'Kandy', day: THU, plan: { id: sent.plan.id } });
    await expectOnly('Kandy', 'loading', day);
    let truck = answeredTruck(await loader.start(truckOf(day, trip.vehicleId), day.plan!), trip.vehicleId);
    // Last stop first, then the first stop with one carton short.
    for (const seq of truck.stops.map((stop) => stop.seq).filter((seq) => seq !== 1).sort((a, b) => b - a)) truck = answeredTruck(await loader.stopLoaded(truck, seq), trip.vehicleId);
    const line = stopOf(truck, 1).lines[0]!;
    truck = answeredTruck(await loader.flag(truck, 1, [{ lineId: line.lineId, counted: line.quantity - 1 }]), trip.vehicleId);
    truck = answeredTruck(await loader.stopLoaded(truck, 1), trip.vehicleId);
    const flagId = truck.issues[0]!.id;

    // On Peliyagoda Ruwan neither sees it nor can answer it.
    expect((await switchTo(ruwan, 'Peliyagoda')).status).toBe(200);
    expect(IssueList.parse((await ruwan.get('/api/v1/issues')).body).issues.map((issue) => issue.id)).not.toContain(flagId);
    expect(code(await ruwan.post(`/api/v1/issues/${flagId}/decide`).send({ revision: 0, decision: 'go_short' }))).toEqual([400, 'unknown_record']);
    // On Kandy he answers it, and the truck is made ready.
    expect((await switchTo(ruwan, 'Kandy')).status).toBe(200);
    const answer = await answerFlag(ruwan, flagId, 'go_short');
    expect(answer.decided).toMatchObject({ id: flagId, status: 'decided', decision: 'go_short' });
    await expectOnly('Kandy', 'answer', answer);
    truck = answeredTruck(await loader.ready(truckOf(await loader.read(), trip.vehicleId)), trip.vehicleId);
    expect(truck.status).toBe('ready');

    // D-037 drives it.
    freeze(THU, 3 * 60 + 30);
    const driver = driverScreen(ashen);
    const driverDay = await driver.read();
    expect(driverDay).toMatchObject({ depot: 'Kandy', driver: 'Ashen', driverId: ashenId, day: THU, planSent: true });
    await expectOnly('Kandy', 'driver', driverDay);
    const started = await driver.send(driverWrite(driverTrip(driverDay, trip.vehicleId), 'start', testClock.at));
    expect(started.status).toBe(200);
    expect(driverTrip(DriverDay.parse(started.body), trip.vehicleId).status).toBe('out');
  });

  it('AC-3 reads Live day, the problems and the look-ups for Kandy with none of Peliyagoda\'s records, and for Peliyagoda with none of Kandy\'s after switching back', async () => {
    const sent = await sendKandysPlan();
    freeze(THU, 2 * 60 + 30);
    for (const path of DISPATCHER_READS) {
      const res = await ruwan.get(path);
      expect([path, res.status]).toEqual([path, 200]);
      await expectOnly('Kandy', path, res.body);
    }
    // Each is Kandy's, with Kandy's sent plan.
    expect(OperationsDay.parse((await ruwan.get('/api/v1/operations')).body)).toMatchObject({ depot: { id: 'Kandy' }, plan: { id: sent.plan.id } });
    for (const page of ['orders', 'history', 'fleet']) expect([page, (await ruwan.get(`/api/v1/lookup/${page}`)).body.depot]).toEqual([page, { id: 'Kandy', name: 'Kandy' }]);
    expect((await ruwan.get('/api/v1/lookup/history')).body.publication).toMatchObject({ id: sent.plan.id, date: THU });

    expect((await switchTo(ruwan, 'Peliyagoda')).status).toBe(200);
    for (const path of DISPATCHER_READS) {
      const res = await ruwan.get(path);
      expect([path, res.status]).toEqual([path, 200]);
      await expectOnly('Peliyagoda', path, res.body);
    }
    expect(OperationsDay.parse((await ruwan.get('/api/v1/operations')).body)).toMatchObject({ depot: { id: 'Peliyagoda' }, plan: null });
  });

  it('AC-5 sends a stream opened after the switch the chosen depot\'s changes and not the other\'s', async () => {
    const base = address(server);
    const signedIn = await fetch(`${base}${SIGN_IN}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signInBody('ruwan')) });
    expect(signedIn.status).toBe(200);
    await signedIn.body?.cancel();
    const cookie = signedIn.headers.getSetCookie()[0]!.split(';')[0]!;

    for (const depot of ['Kandy', 'Peliyagoda'] as const) {
      const switched = await fetch(`${base}${SWITCH}`, { method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ depotId: depot }) });
      expect([depot, switched.status]).toEqual([depot, 200]);
      await switched.body?.cancel();

      const stream = await listen(`${base}/api/v1/events`, cookie);
      announce({ topic: 'plans', id: `${depot}'s change`, depotId: depot });
      announce({ topic: 'plans', id: `${OTHER[depot]}'s change`, depotId: OTHER[depot] });
      announce({ topic: 'last' });
      await soon(() => expect(changesIn(stream.text)).toContainEqual({ topic: 'last' }));
      expect([depot, changesIn(stream.text)]).toEqual([depot, [{ topic: 'plans', id: `${depot}'s change` }, { topic: 'last' }]]);
      closeStreams();
      await stream.over;
    }
  });

  it('AC-7 signs S-047 in to its own shop, where its Thursday orders are and it orders more, and S-076 to its Kandy shop', async () => {
    freeze(WED, 15 * 60 + 10);
    const seeded = (outletId: string) => (['chilled', 'dry'] as const).map((temp) => demoId('order', `${THU}:${outletId}:${temp}`));

    const s047 = await signIn({ staffId: 'S-047', pin: PIN });
    expect(s047.me).toMatchObject({ staffId: 'S-047', role: 'store_manager', outletId: 'OUT046', depotId: 'Peliyagoda' });
    const home = StoreNextOrder.parse((await s047.agent.get('/api/v1/store/next-order')).body);
    expect(home).toMatchObject({ outlet: { id: 'OUT046' }, deliveryDate: THU, draft: null });
    expect(home.placed!.orders.map((order) => order.id)).toEqual(seeded('OUT046'));
    // Five more dry cartons for Thursday, placed for its own shop under its own name.
    const drafted = StoreNextOrder.parse((await s047.agent.put('/api/v1/store/next-order/draft')
      .send({ deliveryDate: THU, lines: [{ productId: 'fresh-dry-carton', quantity: 5 }], driverNote: '', refs: {} })).body);
    expect((await s047.agent.post('/api/v1/store/next-order/place').send({ deliveryDate: THU, refs: drafted.draft!.refs })).status).toBe(200);
    const made = await db.select().from(orders).where(and(eq(orders.outletId, 'OUT046'), notInArray(orders.id, seeded('OUT046'))));
    expect(made.map((order) => [order.status, order.deliveryDate, order.createdBy, order.placedBy])).toEqual([['placed', THU, s047.me.id, s047.me.id]]);

    const s076 = await signIn({ staffId: 'S-076', pin: PIN });
    expect(s076.me).toMatchObject({ staffId: 'S-076', role: 'store_manager', outletId: 'OUT076', depotId: 'Kandy' });
    const kandyShop = StoreNextOrder.parse((await s076.agent.get('/api/v1/store/next-order')).body);
    expect(kandyShop).toMatchObject({ outlet: { id: 'OUT076' }, deliveryDate: THU });
    expect(kandyShop.placed!.orders.map((order) => [order.id, order.units])).toEqual([[seeded('OUT076')[0], 50], [seeded('OUT076')[1], 62]]);
  });
});

// A live stream as an open screen holds it, read in the background as live.test.ts does: `text` is all the server has
// written, and `over` settles when the stream ends or is cut.
async function listen(url: string, cookie: string) {
  const res = await fetch(url, { headers: { cookie } });
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const stream = { text: '', ended: false, over: Promise.resolve() };
  stream.over = (async () => {
    for (let piece = await reader.read(); !piece.done; piece = await reader.read()) stream.text += decoder.decode(piece.value, { stream: true });
    stream.ended = true;
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
