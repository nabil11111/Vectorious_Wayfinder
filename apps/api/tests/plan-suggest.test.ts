import { randomUUID } from 'node:crypto';
import { PlanBoard, type DraftPlan, type PlanCheck, type PlanRef, type Problem } from '@wayfinder/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { clearDemoDay, demoId, seedDemoDay } from '../src/db/demo-day';
import { auditLog, deferrals, demoDay, orderLines, orders, outlets, plans, stopOrders, stops, trips, users, vehicleDaysOff } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { buildSuggestedPlan, type PlannerResult } from '../src/planning';
import { demoFixture } from '../src/planning/planner/testing/demo';
import { serve, stop } from './serve';
import { signInAs } from './sign-in';

// Spec 014: building the suggested plan on the board, accepting the planner's decisions, and the send's refusal while
// one is open. Every test starts from the seeded day at Wed 24 Jun 16:00 with no plan for Thursday.

const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at || clock.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async (original) => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
// One test makes the planner find no plan that passes every check, and one gives the build a plan a save would refuse.
// Every other build runs the real planner as it is.
const planner = vi.hoisted(() => ({ unavailable: null as PlanCheck | null, alter: null as ((result: PlannerResult) => PlannerResult) | null }));
vi.mock('../src/planning/planner/build', async (original) => {
  const real = await original<typeof import('../src/planning/planner/build')>();
  return { ...real, buildSuggestedPlan: (input: Parameters<typeof real.buildSuggestedPlan>[0]): PlannerResult => {
    if (planner.unavailable) return { status: 'unavailable', check: planner.unavailable };
    const result = real.buildSuggestedPlan(input);
    return planner.alter ? planner.alter(result) : result;
  } };
});

const WED = '2026-06-24';
const DATE = '2026-06-25';
const URL = `/api/v1/plans/${DATE}`;
// The four carried-over orders (spec 008), by the seed's own ids.
const CARRIED = {
  OUT060: demoId('order', '2026-06-23:OUT060:chilled'),
  OUT001: demoId('order', '2026-06-24:OUT001:chilled'),
  OUT054: demoId('order', '2026-06-24:OUT054:chilled'),
  OUT030: demoId('order', '2026-06-24:OUT030:chilled'),
};
const WEDNESDAY_PLAN = demoId('plan', `${WED}:Peliyagoda`);

const server = await serve(createApp());
const ruwan = request.agent(server);
const nadeesha = request.agent(server);
const kasun = request.agent(server);
const dilshan = request.agent(server);
const admin = request.agent(server);
let originalClock: typeof demoDay.$inferSelect;
let board: PlanBoard;
let ruwanId: string;
let dilshanId: string;

const freeze = (date = WED, minute = 960) => { const at = depotInstant(date, minute); testClock.at = at.toISOString(); setClockForTests(at); };
const reset = () => db.transaction(async (tx) => { await clearDemoDay(tx); await seedDemoDay(tx); });
const ref = (b = board): PlanRef => (b.plan.id ? { planId: b.plan.id, revision: b.plan.revision } : { planId: null, demoDay: b.demoDay });
const planOf = (b = board): DraftPlan => ({ mixBrands: b.plan.mixBrands, trips: b.plan.trips, deferrals: b.plan.deferrals });
const empty = (): DraftPlan => ({ mixBrands: false, trips: [], deferrals: [] });
const code = (res: request.Response) => [res.status, res.body.error?.code];
const read = async () => { board = PlanBoard.parse((await ruwan.get('/api/v1/plans')).body); return board; };
const build = (reference = ref()) => ruwan.post(`${URL}/suggest`).send(reference);
const accept = (keys: string[], reference = ref()) => ruwan.post(`${URL}/decisions`).send({ ...reference, keys });
const save = (plan: DraftPlan, reference = ref()) => ruwan.put(`${URL}/draft`).send({ ...reference, plan });
const send = (reference = ref()) => ruwan.post(`${URL}/send`).send(reference);
const answered = (res: request.Response) => {
  expect(res.status, JSON.stringify(res.body.error)).toBe(200);
  board = PlanBoard.parse(res.body);
  return board;
};
const tripOf = (orderId: string, b = board) => {
  const trip = b.plan.trips.find((t) => t.stops.some((s) => s.orderIds.includes(orderId)));
  return trip ? [trip.vehicleId, trip.tripNo] : null;
};
const choiceOf = (orderId: string, b = board) => b.suggestion!.choices.find((c) => c.orderId === orderId);
const stored = async (planId = board.plan.id!) => (await db.select({ suggestion: plans.suggestion }).from(plans).where(eq(plans.id, planId)))[0]!.suggestion;
// The audit log outlives a reset, and the seeded orders keep their ids, so a test reads only the rows it wrote.
let earlierAudits = new Set<string>();
const audits = async (entityId: string, action: string) => (await db.select().from(auditLog).where(and(eq(auditLog.entityId, entityId), eq(auditLog.action, action))))
  .filter((row) => !earlierAudits.has(row.id));
// OUT001's carried-over order raised from 12 to 180 chilled cartons, which only the fridge van can take (rule 4).
const raiseNugegoda = () => db.update(orderLines).set({ quantity: 180 }).where(eq(orderLines.orderId, CARRIED.OUT001));
// Peliyagoda's drivers in staff ID order, D-001 Dilshan first (spec 022, D-97).
const staffOrder = async () => (await db.select({ id: users.id }).from(users)
  .where(and(eq(users.depotId, 'Peliyagoda'), eq(users.role, 'driver'), eq(users.active, true))).orderBy(users.staffId)).map((row) => row.id);
// Each vehicle of a draft, in id order, with its trips' drivers.
const driversOf = (b = board) => {
  const drivers = new Map<string, (string | null)[]>();
  for (const trip of [...b.plan.trips].sort((x, y) => x.vehicleId.localeCompare(y.vehicleId))) drivers.set(trip.vehicleId, [...(drivers.get(trip.vehicleId) ?? []), trip.driverId]);
  return drivers;
};
// Dilshan put on VEH035 as the board's driver menu puts him there once the suggestion gave every truck a driver: the
// vehicle he drove takes VEH035's driver (spec 022, AC-5).
const dilshanOnVeh035 = (b = board): DraftPlan => {
  const was = b.plan.trips.find((t) => t.vehicleId === 'VEH035')?.driverId ?? null;
  return { ...planOf(b), trips: b.plan.trips.map((t) => (t.vehicleId === 'VEH035' ? { ...t, driverId: dilshanId } : t.driverId === dilshanId ? { ...t, driverId: was } : t)) };
};
// Everything a build or an accept may write, so a refusal can be shown to change nothing.
const held = async () => ({
  orders: await db.select().from(orders).orderBy(orders.id), lines: await db.select().from(orderLines).orderBy(orderLines.id),
  plans: await db.select().from(plans).orderBy(plans.id), trips: await db.select().from(trips).orderBy(trips.id),
  stops: await db.select().from(stops).orderBy(stops.id), assignments: await db.select().from(stopOrders).orderBy(stopOrders.stopId, stopOrders.orderId),
  deferrals: await db.select().from(deferrals).orderBy(deferrals.id), audits: await db.select().from(auditLog).orderBy(auditLog.id),
});
// Runs a write and checks that every announcement comes after its transaction committed.
async function afterCommit<T>(write: () => Promise<T>): Promise<T> {
  let committed = false;
  const transaction = db.transaction.bind(db);
  const spy = vi.spyOn(db, 'transaction').mockImplementation((async (...args: Parameters<typeof db.transaction>) => {
    const result = await transaction(...args); committed = true; return result;
  }) as typeof db.transaction);
  vi.mocked(announce).mockReset();
  vi.mocked(announce).mockImplementation(() => { expect(committed).toBe(true); });
  try { return await write(); } finally { spy.mockRestore(); }
}
const announced = () => vi.mocked(announce).mock.calls.map(([event]) => event);

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, username] of [[ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [kasun, 'kasun'], [dilshan, 'dilshan'], [admin, 'admin']] as const) {
    expect((await signInAs(agent, username)).status).toBe(200);
  }
  const people = await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.username, ['ruwan', 'dilshan']));
  ruwanId = people.find((p) => p.username === 'ruwan')!.id;
  dilshanId = people.find((p) => p.username === 'dilshan')!.id;
});
beforeEach(async () => {
  await reset(); await initClock(); freeze();
  await read();
  earlierAudits = new Set((await db.select({ id: auditLog.id }).from(auditLog)).map((row) => row.id));
  vi.mocked(announce).mockReset();
});
afterAll(async () => { await reset(); await db.update(demoDay).set(originalClock); setClockForTests(null); await stop(server); await pool.end(); });

// ── Building the suggestion ──────────────────────────────────────────────────────────────────────────────────────

it('AC-1 builds the seeded day into a new plan\'s draft in one write, with every order on one stop or deferred', async () => {
  expect(board.plan.id).toBeNull();
  expect(board.suggestion).toBeNull();
  answered(await build());
  expect(board.plan).toMatchObject({ status: 'draft', revision: 1, savedAt: testClock.at });
  expect(board.suggestion!.builtAt).toBe(testClock.at);
  expect(board.check!.ok).toBe(true);
  expect(board.check!.problems.filter((p) => p.level === 'block')).toEqual([]);
  const onTrips = board.plan.trips.flatMap((t) => t.stops.flatMap((s) => s.orderIds));
  const deferred = board.plan.deferrals.map((d) => d.orderId);
  expect(board.orders).toHaveLength(102);
  expect([...onTrips, ...deferred].sort()).toEqual(board.orders.map((o) => o.id).sort());
  expect(board.counts).toMatchObject({ trips: 27, vehiclesUsed: 26, vehiclesWorking: 35, ordersDue: 102, ordersOnTrips: 96, ordersDeferred: 6, ordersUnplanned: 0 });
  // The walkthrough's warnings: two long waits and a Fresh workload over its budget.
  expect(board.check!.problems.filter((p) => p.level === 'warn').map((p) => p.code).sort()).toEqual(['long_wait', 'long_wait', 'over_time_budget']);
  expect(await db.select().from(plans).where(eq(plans.date, DATE))).toHaveLength(1);
  expect(PlanBoard.parse((await ruwan.get('/api/v1/plans')).body)).toEqual(board);
});

it('AC-2 saves exactly what the planner gives for spec 011\'s seeded-day fixture, the reasons naming each shop', async () => {
  answered(await build());
  const { input } = await demoFixture();
  const fixture = buildSuggestedPlan(input);
  if (fixture.status === 'unavailable') throw new Error('Expected the seeded suggestion');
  const tripsOf = (list: { vehicleId: string; tripNo: number; leaveAt?: number | null; stops: { outletId: string; orderIds: string[] }[] }[]) => list
    .map((t) => ({ vehicleId: t.vehicleId, tripNo: t.tripNo, leaveAt: t.leaveAt ?? null, stops: t.stops.map((s) => ({ outletId: s.outletId, orderIds: [...s.orderIds].sort() })) }))
    .sort((a, b) => a.vehicleId.localeCompare(b.vehicleId) || a.tripNo - b.tripNo);
  expect(tripsOf(board.plan.trips)).toEqual(tripsOf(fixture.input.plan.trips));
  expect(board.plan.deferrals.map((d) => [d.orderId, d.code]).sort()).toEqual(fixture.input.plan.deferrals.map((d) => [d.orderId, d.code]).sort());
  expect(board.suggestion!.choices.map((c) => [c.orderId, c.rank, c.resultOrderIds])).toEqual(fixture.choices.map((c) => [c.orderId, c.rank, c.resultOrderIds]));
  expect(board.suggestion!.decisions.map((d) => [d.kind, d.orderId, d.vehicleId, d.tripNo, d.leaveAt])).toEqual(fixture.decisions.map((d) => (d.kind === 'early_leave'
    ? [d.kind, null, d.vehicleId, d.tripNo, d.leaveAt] : [d.kind, d.orderId, null, null, null])));
  // The walkthrough's numbers are spec 011's pin: 27 trips, no split, and six chilled orders that wait for their windows.
  expect(fixture.input.plan.trips).toHaveLength(27);
  expect(fixture.splits).toEqual([]);
  expect(fixture.decisions.map((d) => d.kind)).toEqual(Array(6).fill('late_order'));
  // The fixture calls a shop by its id, so its sentences name the district. Given the shops' names, the planner writes
  // the board's sentences word for word.
  const names = new Map((await db.select({ id: outlets.id, name: outlets.name }).from(outlets)).map((o) => [o.id, o.name]));
  const named = buildSuggestedPlan({ ...input, outlets: input.outlets.map((o) => ({ ...o, name: names.get(o.id)! })) });
  if (named.status === 'unavailable') throw new Error('Expected the seeded suggestion');
  expect(board.suggestion!.choices.map((c) => c.reason)).toEqual(named.choices.map((c) => c.reason));
  expect(board.suggestion!.decisions.map((d) => d.reason)).toEqual(named.decisions.map((d) => d.reason));
  expect(board.plan.deferrals.map((d) => [d.orderId, d.reason]).sort()).toEqual(named.input.plan.deferrals.map((d) => [d.orderId, d.reason]).sort());
  expect(board.plan.deferrals.map((d) => d.reason)).toContain('No fridge truck could reach Fresh Pannala before its window closed at 07:45 on Thursday.');
});

it('AC-3 keeps the suggestion as built on the board, through a save, a split and a join', async () => {
  answered(await build());
  const kept = await stored();
  const first = PlanBoard.parse((await ruwan.get(URL)).body);
  expect(first.suggestion).toEqual(board.suggestion);
  const { choices, decisions } = first.suggestion!;
  expect(choices.map((c) => c.rank)).toEqual(Array.from({ length: 102 }, (_, i) => i + 1));
  expect(choices.slice(0, 4).map((c) => c.orderId)).toEqual([CARRIED.OUT060, CARRIED.OUT001, CARRIED.OUT054, CARRIED.OUT030]);
  expect(choices.every((c) => c.resultOrderIds.length === 1 && c.resultOrderIds[0] === c.orderId && c.reason.trim().length > 0)).toBe(true);
  expect(choices[0]!.reason).toMatch(/^Rank 1: waited since Tuesday; chilled; Fresh Dickwella/);
  expect(decisions).toHaveLength(6);
  expect(decisions.every((d) => d.kind === 'late_order' && d.acceptedAt === null && d.open)).toBe(true);
  // A save (Dilshan drives VEH035), a split of the big Style order and its join leave the suggestion as built.
  answered(await save(dilshanOnVeh035()));
  const big = board.orders.find((o) => o.outletId === 'OUT017')!;
  answered(await ruwan.post(`${URL}/split`).send({ ...ref(), orderId: big.id, keep: [{ productId: 'style-folded', quantity: 50 }] }));
  answered(await ruwan.post(`${URL}/join`).send({ ...ref(), orderId: big.id }));
  expect(board.plan.revision).toBe(4);
  expect(await stored()).toEqual(kept);
  expect(board.suggestion).toEqual(first.suggestion);
});

it('AC-4 makes the planner\'s split as a hand split does and puts each part where the planner put it', async () => {
  await raiseNugegoda();
  const [original] = await db.select().from(orders).where(eq(orders.id, CARRIED.OUT001));
  answered(await build());
  expect((await db.select().from(orders).where(eq(orders.id, CARRIED.OUT001)))[0]).toEqual({ ...original, status: 'split', revision: original!.revision + 1 });
  const children = await db.select().from(orders).where(eq(orders.splitFrom, CARRIED.OUT001));
  expect(children).toHaveLength(2);
  for (const child of children) {
    expect(child).toMatchObject({ status: 'placed', outletId: 'OUT001', temp: 'chilled', deliveryDate: WED, driverNote: original!.driverNote, placedAt: original!.placedAt, placedBy: original!.placedBy });
  }
  expect([...choiceOf(CARRIED.OUT001)!.resultOrderIds].sort()).toEqual(children.map((c) => c.id).sort());
  const [first, second] = choiceOf(CARRIED.OUT001)!.resultOrderIds.map((id) => board.orders.find((o) => o.id === id)!);
  expect(first!.load).toMatchObject({ units: 150, kg: 1035, m3: 5.55 });
  expect(second!.load.units).toBe(30);
  expect([first!.originalUnits, second!.originalUnits]).toEqual([180, 180]);
  expect([tripOf(first!.id), tripOf(second!.id)]).toEqual([['VEH035', 1], ['VEH035', 2]]);
  const later = board.check!.trips.find((t) => t.vehicleId === 'VEH035' && t.tripNo === 2)!;
  expect(later.times!.stops.find((s) => s.outletId === 'OUT001')!.arriveAt).toBe(6 * 60 + 34);
  expect(board.suggestion!.decisions.filter((d) => d.kind === 'waited_again')).toEqual([]);
  expect(board.check!.ok).toBe(true);
  expect(await audits(CARRIED.OUT001, 'order.split')).toHaveLength(1);
});

it('AC-5 joins this draft\'s split back before planning again, and makes two new parts in the same places', async () => {
  await raiseNugegoda();
  answered(await build());
  const before = choiceOf(CARRIED.OUT001)!.resultOrderIds;
  answered(await build());
  const again = choiceOf(CARRIED.OUT001)!.resultOrderIds;
  expect(again).toHaveLength(2);
  expect(again.filter((id) => before.includes(id))).toEqual([]);
  expect(await db.select().from(orders).where(inArray(orders.id, before))).toEqual([]);
  expect(await db.select().from(orderLines).where(inArray(orderLines.orderId, before))).toEqual([]);
  expect(again.map((id) => board.orders.find((o) => o.id === id)!.load.units)).toEqual([150, 30]);
  expect(again.map((id) => tripOf(id))).toEqual([['VEH035', 1], ['VEH035', 2]]);
  expect(await audits(CARRIED.OUT001, 'order.joined')).toHaveLength(1);
  expect(await audits(CARRIED.OUT001, 'order.split')).toHaveLength(2);
  expect(board.plan.revision).toBe(2);
});

it('AC-5 leaves a part that a sent plan deferred as a part and plans each part whole', async () => {
  await raiseNugegoda();
  answered(await build());
  const [first, second] = choiceOf(CARRIED.OUT001)!.resultOrderIds as [string, string];
  await db.insert(deferrals).values({ planId: WEDNESDAY_PLAN, orderId: second, code: 'no_van', reason: 'The van that reaches this shop was full.' });
  await db.update(orders).set({ status: 'deferred' }).where(eq(orders.id, second));
  await read();
  answered(await build());
  expect((await db.select().from(orders).where(eq(orders.splitFrom, CARRIED.OUT001))).map((o) => o.id).sort()).toEqual([first, second].sort());
  expect((await db.select().from(orders).where(eq(orders.id, CARRIED.OUT001)))[0]!.status).toBe('split');
  expect(choiceOf(CARRIED.OUT001)).toBeUndefined();
  expect(choiceOf(first)!.resultOrderIds).toEqual([first]);
  expect(choiceOf(second)!.resultOrderIds).toEqual([second]);
  expect(await audits(CARRIED.OUT001, 'order.joined')).toEqual([]);
});

it('AC-6 replaces every trip and deferral of a hand-made draft, and a vehicle the suggestion uses keeps its driver', async () => {
  const other = board.drivers.find((d) => d.id !== dilshanId)!.id;
  const stopAt = (outletId: string) => ({ outletId, orderIds: board.orders.filter((o) => o.outletId === outletId).map((o) => o.id) });
  answered(await save({
    mixBrands: false,
    trips: [
      { vehicleId: 'VEH035', tripNo: 1, leaveAt: null, driverId: dilshanId, stops: [stopAt('OUT001')] },
      { vehicleId: 'VEH004', tripNo: 1, leaveAt: 200, driverId: null, stops: [stopAt('OUT026'), stopAt('OUT028')] },
      { vehicleId: 'VEH008', tripNo: 1, leaveAt: null, driverId: other, stops: [] },
    ],
    deferrals: [{ orderId: CARRIED.OUT060, code: 'dispatcher_choice', reason: 'Matara takes it on Friday.' }],
  }));
  answered(await build());
  expect(board.plan.revision).toBe(2);
  expect(board.plan.trips.filter((t) => t.vehicleId === 'VEH035').map((t) => t.driverId)).toEqual([dilshanId]);
  // VEH004 had no driver, so it takes a free one (spec 022, AC-3), and the planner's own leaving time.
  expect(board.plan.trips.filter((t) => t.vehicleId === 'VEH004').map((t) => [t.driverId !== null, t.leaveAt])).toEqual([[true, null]]);
  // VEH008 is not in the suggestion, so its driver is free again: every truck but VEH035 takes the depot's next free
  // driver in staff ID order, and he is one of them.
  expect(board.plan.trips.some((t) => t.vehicleId === 'VEH008')).toBe(false);
  const others = [...driversOf()].filter(([vehicleId]) => vehicleId !== 'VEH035').map(([, drivers]) => drivers[0]);
  expect(others).toEqual((await staffOrder()).filter((id) => id !== dilshanId).slice(0, others.length));
  expect(others).toContain(other);
  expect(board.plan.deferrals.some((d) => d.code === 'dispatcher_choice')).toBe(false);
  expect(board.counts).toMatchObject({ trips: 27, ordersOnTrips: 96, ordersDeferred: 6, ordersUnplanned: 0, drivers: 26 });
  expect(tripOf(CARRIED.OUT060)).toEqual(['VEH004', 1]);
});

it('spec 022 AC-3 gives every truck of the built plan its own driver of the depot, the same on both its trips', async () => {
  answered(await build());
  const drivers = driversOf();
  expect(drivers.size).toBe(26);
  // One driver per truck, on both its trips.
  expect([...drivers].filter(([, list]) => new Set(list).size !== 1)).toEqual([]);
  const chosen = [...drivers.values()].map((list) => list[0]);
  // Each a driver of Peliyagoda, and none on two trucks.
  expect(chosen.filter((driverId) => !board.drivers.some((d) => d.id === driverId))).toEqual([]);
  expect(new Set(chosen).size).toBe(26);
  // With no driver in the draft before, the trucks in id order take the depot's drivers in staff ID order.
  expect(chosen).toEqual((await staffOrder()).slice(0, 26));
  expect(chosen[0]).toBe(dilshanId);
  expect(board.counts).toMatchObject({ vehiclesUsed: 26, drivers: 26 });
  // A build again keeps each truck's driver.
  answered(await build());
  expect(driversOf()).toEqual(drivers);
});

// ── Refusals and what a build tells ──────────────────────────────────────────────────────────────────────────────

it('AC-7 refuses a build or an accept without a session, to another role and to an admin', async () => {
  for (const path of ['suggest', 'decisions']) {
    const url = `${URL}/${path}`;
    expect(code(await request.agent(server).post(url).send({}))).toEqual([401, 'signed_out']);
    for (const agent of [nadeesha, kasun, dilshan]) expect(code(await agent.post(url).send({}))).toEqual([403, 'forbidden']);
    expect(code(await admin.post(url).send({}))).toEqual([403, 'no_depot']);
  }
});

it('AC-7 refuses a build naming another plan or revision, a first build from before a reset and a sent plan, writing nothing', async () => {
  let before = await held();
  expect(code(await build({ planId: null, demoDay: board.demoDay + 1 }))).toEqual([409, 'stale']);
  expect(await held()).toEqual(before);
  const saved = answered(await save(empty()));
  vi.mocked(announce).mockReset();
  before = await held();
  expect(code(await build({ planId: randomUUID(), revision: 1 }))).toEqual([409, 'stale']);
  expect(code(await build({ planId: saved.plan.id!, revision: 0 }))).toEqual([409, 'stale']);
  expect(code(await build({ planId: null, demoDay: saved.demoDay }))).toEqual([409, 'stale']);
  expect(await held()).toEqual(before);
  await db.update(plans).set({ status: 'published' }).where(eq(plans.id, saved.plan.id!));
  before = await held();
  expect(code(await build(ref(saved)))).toEqual([409, 'plan_sent']);
  expect(await held()).toEqual(before);
  expect(announce).not.toHaveBeenCalled();
});

it('AC-7 refuses a build before the orders close, after the day moved and with no day left, writing nothing', async () => {
  const before = await held();
  freeze(WED, 959);
  const open = await build();
  expect(code(open)).toEqual([409, 'orders_open']);
  expect(open.body.error.details).toEqual({ date: DATE, cutoffAt: depotInstant(WED, 960).toISOString() });
  freeze(DATE, 210);
  expect(code(await build())).toEqual([409, 'day_moved']);
  freeze('2026-06-27', 960);
  expect(code(await build())).toEqual([409, 'no_plan_day']);
  expect(await held()).toEqual(before);
  expect(announce).not.toHaveBeenCalled();
});

it('AC-8 answers planner_unavailable with the planner\'s blocks and leaves the draft and its split as they were', async () => {
  const stopAt = (outletId: string) => ({ outletId, orderIds: board.orders.filter((o) => o.outletId === outletId).map((o) => o.id) });
  answered(await save({ ...empty(), trips: [{ vehicleId: 'VEH023', tripNo: 1, leaveAt: null, driverId: null, stops: ['OUT016', 'OUT017', 'OUT018', 'OUT019'].map(stopAt) }] }));
  const big = board.orders.find((o) => o.outletId === 'OUT017')!;
  answered(await ruwan.post(`${URL}/split`).send({ ...ref(), orderId: big.id, keep: [{ productId: 'style-folded', quantity: 50 }, { productId: 'style-shoes', quantity: 25 }] }));
  const block: Problem = { code: 'fuel_over_quota', level: 'block', message: 'VEH001 needs 45.2 L this week and has 40 L left.', vehicleId: 'VEH001' };
  planner.unavailable = { ok: false, problems: [block], trips: [], vehicles: [] };
  try {
    vi.mocked(announce).mockReset();
    let before = await held();
    const refused = await build();
    expect(code(refused)).toEqual([409, 'planner_unavailable']);
    expect(refused.body.error.message).toBe('The planner could not build a plan that passes every check, so the draft is as it was.');
    expect(refused.body.error.details).toEqual({ blocks: [block] });
    expect(await held()).toEqual(before);
    // With no plan yet, none is made.
    await reset(); await read();
    before = await held();
    expect(code(await build())).toEqual([409, 'planner_unavailable']);
    expect(await held()).toEqual(before);
    expect(await db.select().from(plans).where(eq(plans.date, DATE))).toEqual([]);
  } finally {
    planner.unavailable = null;
  }
  expect(announce).not.toHaveBeenCalled();
});

it('AC-8 refuses a day of more than 300 orders before the planner runs', async () => {
  const shops = board.shops.filter((s) => s.brand === 'Style');
  const extra = Array.from({ length: 199 }, (_, i) => ({ id: randomUUID(), outletId: shops[i % shops.length]!.id, deliveryDate: DATE, temp: 'dry' as const, status: 'placed' as const, placedAt: depotInstant(WED, 900) }));
  await db.insert(orders).values(extra);
  await db.insert(orderLines).values(extra.map((o) => ({ orderId: o.id, productId: 'style-bags', quantity: 1 })));
  expect((await read()).orders).toHaveLength(301);
  const before = await held();
  const refused = await build();
  expect(code(refused)).toEqual([409, 'planner_unavailable']);
  expect(refused.body.error).toMatchObject({ message: 'The planner plans at most 300 orders, and Thu 25 Jun has 301.', details: { blocks: [] } });
  expect(await held()).toEqual(before);
  expect(announce).not.toHaveBeenCalled();
});

it('answers a plan of the planner\'s that a save would refuse as a server error, writing and announcing nothing', async () => {
  // plan.md, step 8: the draft is checked as a save would be, and a failure there is a fault on our side. Nadeesha's
  // unplaced draft is a real order, but not one of the day's, so only that check stops it.
  const draftOrder = demoId('order', `${DATE}:OUT001:chilled`);
  planner.alter = (result) => (result.status === 'unavailable' ? result : { ...result, input: { ...result.input, plan: { ...result.input.plan,
    deferrals: [...result.input.plan.deferrals, { orderId: draftOrder, code: 'window', reason: 'Not an order of this day.' }] } } });
  try {
    const before = await held();
    const refused = await build();
    expect(code(refused)).toEqual([500, 'server_error']);
    expect(await held()).toEqual(before);
    expect(announce).not.toHaveBeenCalled();
  } finally {
    planner.alter = null;
  }
});

it('AC-9 writes plan.suggested and announces the plan, and a split shop\'s orders, only after the commit', async () => {
  answered(await afterCommit(() => build()));
  expect(announced()).toEqual([{ topic: 'plans', depotId: 'Peliyagoda' }]);
  const [first] = await audits(board.plan.id!, 'plan.suggested');
  expect(first).toMatchObject({
    actorId: ruwanId, entity: 'plan',
    before: { revision: 0, trips: [], deferrals: [] },
    after: { revision: 1, trips: 27, ordersOnTrips: 96, deferrals: 6, partsMade: [], splitsJoined: [], decisions: board.suggestion!.decisions.map((d) => d.key) },
  });
  // A split, and then its join back on the next build, tell the depot and the shop.
  const replaced = planOf();
  await raiseNugegoda();
  answered(await afterCommit(() => build()));
  expect(announced()).toEqual([{ topic: 'plans', depotId: 'Peliyagoda' }, { topic: 'orders', depotId: 'Peliyagoda' }, { topic: 'orders', outletId: 'OUT001' }]);
  const parts = choiceOf(CARRIED.OUT001)!.resultOrderIds;
  answered(await afterCommit(() => build()));
  expect(announced()).toEqual([{ topic: 'plans', depotId: 'Peliyagoda' }, { topic: 'orders', depotId: 'Peliyagoda' }, { topic: 'orders', outletId: 'OUT001' }]);
  const rows = await audits(board.plan.id!, 'plan.suggested');
  expect(rows).toHaveLength(3);
  const second = rows.find((r) => (r.before as { revision: number }).revision === 1)!;
  expect(second.before).toEqual({ revision: 1, trips: replaced.trips, deferrals: replaced.deferrals });
  expect(second.after).toMatchObject({ revision: 2, partsMade: parts, splitsJoined: [] });
  expect(rows.find((r) => (r.before as { revision: number }).revision === 2)!.after).toMatchObject({ revision: 3, splitsJoined: [CARRIED.OUT001] });
});

it('AC-10 queues a build and a save of the same plan: both finish, and one is refused as stale', async () => {
  let responses = await Promise.all([build(), save(empty())]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(responses.find((r) => r.status === 409)!.body.error.code).toBe('stale');
  await read();
  responses = await Promise.all([save(empty()), build()]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(responses.find((r) => r.status === 409)!.body.error.code).toBe('stale');
});

it('AC-10 queues a build and a demo reset: both finish, and a build the reset went before is stale', async () => {
  const responses = await Promise.all([ruwan.post('/api/v1/demo/reset').send({}), build()]);
  expect(responses[0]!.status).toBe(200);
  expect([200, 409]).toContain(responses[1]!.status);
  if (responses[1]!.status === 409) expect(responses[1]!.body.error.code).toBe('stale');
  expect(await db.select().from(plans).where(eq(plans.date, DATE))).toEqual([]);
  // The board on screen is from before the reset, so its build is stale.
  expect(code(await build())).toEqual([409, 'stale']);
  expect(await db.select().from(plans).where(eq(plans.date, DATE))).toEqual([]);
});

// ── Decisions ────────────────────────────────────────────────────────────────────────────────────────────────────

it('AC-12 accepts a decision at the app clock\'s time, raises the revision, and keeps it accepted', async () => {
  answered(await build());
  const [first, ...rest] = board.suggestion!.decisions.map((d) => d.key) as [string, ...string[]];
  freeze(WED, 968);
  answered(await afterCommit(() => accept([first])));
  expect(announced()).toEqual([{ topic: 'plans', depotId: 'Peliyagoda' }]);
  expect(board.plan).toMatchObject({ revision: 2, savedAt: testClock.at });
  expect(board.suggestion!.decisions.find((d) => d.key === first)).toMatchObject({ acceptedAt: testClock.at, open: false });
  expect(board.suggestion!.decisions.filter((d) => d.open).map((d) => d.key)).toEqual(rest);
  const [audit] = await audits(board.plan.id!, 'plan.decided');
  expect(audit).toMatchObject({ actorId: ruwanId, entity: 'plan', before: { revision: 1 }, after: { revision: 2, keys: [first] } });
  // Still accepted after a read and an edit elsewhere on the plan.
  expect(PlanBoard.parse((await ruwan.get(URL)).body).suggestion).toEqual(board.suggestion);
  answered(await save(dilshanOnVeh035()));
  expect(board.suggestion!.decisions.find((d) => d.key === first)).toMatchObject({ acceptedAt: depotInstant(WED, 968).toISOString(), open: false });
});

it('AC-12 refuses a key that is not an open decision, and AC-7\'s refusals, changing nothing', async () => {
  answered(await build());
  const keys = board.suggestion!.decisions.map((d) => d.key) as [string, string, ...string[]];
  answered(await accept([keys[0]]));
  vi.mocked(announce).mockReset();
  const before = await held();
  for (const wrong of [[keys[0]], [`late_order:${randomUUID()}`], ['early_leave:VEH004:1'], [keys[1], 'waited_again:nobody']]) {
    const refused = await accept(wrong);
    expect(code(refused)).toEqual([400, 'invalid_input']);
    expect(refused.body.error.message).toBe('That is not an open decision of this plan.');
  }
  expect(code(await accept([keys[1], keys[1]]))).toEqual([400, 'invalid_input']);
  expect(code(await accept([]))).toEqual([400, 'invalid_input']);
  expect(code(await accept([keys[1]], { planId: board.plan.id!, revision: board.plan.revision - 1 }))).toEqual([409, 'stale']);
  expect(code(await accept([keys[1]], { planId: randomUUID(), revision: board.plan.revision }))).toEqual([409, 'stale']);
  expect(code(await accept([keys[1]], { planId: null, demoDay: board.demoDay }))).toEqual([409, 'stale']);
  freeze(WED, 959);
  expect(code(await accept([keys[1]]))).toEqual([409, 'orders_open']);
  freeze(DATE, 210);
  expect(code(await accept([keys[1]]))).toEqual([409, 'day_moved']);
  freeze('2026-06-27', 960);
  expect(code(await accept([keys[1]]))).toEqual([409, 'no_plan_day']);
  freeze();
  expect(await held()).toEqual(before);
  await db.update(plans).set({ status: 'published' }).where(eq(plans.id, board.plan.id!));
  const sent = await held();
  expect(code(await accept([keys[1]]))).toEqual([409, 'plan_sent']);
  expect(await held()).toEqual(sent);
  expect(announce).not.toHaveBeenCalled();
});

it('AC-12 cannot accept a decision an edit has ended', async () => {
  answered(await build());
  const decision = board.suggestion!.decisions[0]!;
  answered(await save({ ...planOf(), deferrals: board.plan.deferrals.map((d) => (d.orderId === decision.orderId ? { ...d, reason: 'Kurunegala takes it on Friday.' } : d)) }));
  expect(board.suggestion!.decisions[0]).toMatchObject({ key: decision.key, acceptedAt: null, open: false });
  expect(code(await accept([decision.key]))).toEqual([400, 'invalid_input']);
  // A first accept of the plan names it by its id; a board read before the first build has nothing to accept.
  await reset(); await read();
  expect(code(await accept([decision.key]))).toEqual([400, 'invalid_input']);
  expect(await db.select().from(plans).where(eq(plans.date, DATE))).toEqual([]);
});

it('AC-13 refuses to send while a decision is open, and sends once every one is accepted, warnings and all', async () => {
  await db.insert(vehicleDaysOff).values({ vehicleId: 'VEH035', date: DATE, reason: 'Fridge unit repair' });
  await read();
  answered(await build());
  expect(board.plan.deferrals.find((d) => d.orderId === CARRIED.OUT001)).toMatchObject({ code: 'no_van' });
  const keys = board.suggestion!.decisions.map((d) => d.key);
  expect(keys).toContain(`waited_again:${CARRIED.OUT001}`);
  expect(board.check!.ok).toBe(true);
  vi.mocked(announce).mockReset();
  const before = await held();
  const refused = await send();
  expect(code(refused)).toEqual([409, 'decisions_open']);
  expect(refused.body.error.details).toEqual({ keys });
  expect(refused.body.error.message).toBe(`${keys.length} of the planner's decisions are still open. Accept them before sending.`);
  expect(await held()).toEqual(before);
  expect(announce).not.toHaveBeenCalled();
  answered(await accept(keys));
  expect(board.suggestion!.decisions.every((d) => d.acceptedAt === testClock.at && !d.open)).toBe(true);
  const warnings = board.check!.problems.filter((p) => p.level === 'warn');
  answered(await send());
  expect(board.plan.status).toBe('published');
  expect(board.check!.problems.filter((p) => p.level === 'warn')).toEqual(warnings);
  expect(board.suggestion!.decisions.every((d) => d.acceptedAt === testClock.at && !d.open)).toBe(true);
  // The sent plan keeps its suggestion and its accepted decisions through a read.
  expect(PlanBoard.parse((await ruwan.get(URL)).body).suggestion).toEqual(board.suggestion);
});

it('AC-13 sends once each decision is accepted or ended by an edit', async () => {
  answered(await build());
  const [ended, ...rest] = board.suggestion!.decisions;
  answered(await accept(rest.map((d) => d.key)));
  const refused = await send();
  expect(code(refused)).toEqual([409, 'decisions_open']);
  expect(refused.body.error.details).toEqual({ keys: [ended!.key] });
  expect(refused.body.error.message).toBe('1 of the planner\'s decisions is still open. Accept it before sending.');
  answered(await save({ ...planOf(), deferrals: board.plan.deferrals.map((d) => (d.orderId === ended!.orderId ? { ...d, code: 'dispatcher_choice' as const } : d)) }));
  expect(board.suggestion!.decisions.filter((d) => d.open)).toEqual([]);
  answered(await send());
  expect(board.plan.status).toBe('published');
});
