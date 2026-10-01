import { randomUUID } from 'node:crypto';
import { CrewList, PlanBoard, type Crew, type DraftPlan } from '@wayfinder/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { clearDemoDay, demoId, seedDemoDay } from '../src/db/demo-day';
import { demoDay, plans, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { sendWalkthroughPlan } from './loading-plan';
import { serve, stop } from './serve';
import { signInAs } from './sign-in';

// Spec 026: the crew picker's read. Every crew of the dispatcher's depot for a trip's orders, with its driver, the
// districts it ran on the latest sent plan, whether its truck takes the orders, and the picker's order. Every test starts
// from the seeded day at Wed 24 Jun 16:00, Thursday's orders closed and no plan for Thursday.

const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at || clock.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async (original) => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));

const WED = '2026-06-24';
const THU = '2026-06-25';
const FRI = '2026-06-26';
// Fresh Nugegoda's 12 carried-over chilled cartons: a van-only shop, and a chilled order.
const NUGEGODA = demoId('order', '2026-06-24:OUT001:chilled');

const server = await serve(createApp());
const ruwan = request.agent(server);
const nadeesha = request.agent(server);
const kasun = request.agent(server);
const dilshan = request.agent(server);
const admin = request.agent(server);
let originalClock: typeof demoDay.$inferSelect;
let board: PlanBoard;
// Every driver's staff ID, by account.
let staffIds: Map<string, string>;
let dilshanId: string;

const freeze = (date = WED, minute = 960) => { const at = depotInstant(date, minute); testClock.at = at.toISOString(); setClockForTests(at); };
const reset = () => db.transaction(async (tx) => { await clearDemoDay(tx); await seedDemoDay(tx); });
const code = (res: request.Response) => [res.status, res.body.error?.code];
const read = async () => { board = PlanBoard.parse((await ruwan.get('/api/v1/plans')).body); return board; };
const ask = (date: string, orderIds: string[], agent = ruwan) => agent.get(`/api/v1/plans/${date}/crews?orders=${orderIds.join(',')}`);
const crews = async (date: string, orderIds: string[], agent = ruwan) => {
  const res = await ask(date, orderIds, agent);
  expect(res.status, JSON.stringify(res.body.error)).toBe(200);
  return CrewList.parse(res.body);
};
const crewOf = (list: CrewList, vehicleId: string) => list.crews.find((crew) => crew.vehicleId === vehicleId)!;
const staffOf = (crew: Crew) => (crew.driverId === null ? null : staffIds.get(crew.driverId) ?? 'not a driver');
const pairs = (list: CrewList) => Object.fromEntries(list.crews.map((crew) => [crew.vehicleId, staffOf(crew)]));
const veh = (n: number) => `VEH${String(n).padStart(3, '0')}`;
const staffId = (n: number) => `D-${String(n).padStart(3, '0')}`;

// The picker's order: the crews that can be picked first, fitting before not, then those that ran the district, then
// the most fuel left, then by truck; the others last, by truck.
const keyOf = (crew: Crew) => (crew.unavailable === null
  ? [0, crew.fits ? 0 : 1, crew.ranHere ? 0 : 1, -crew.fuelLeftPct, crew.vehicleId] : [1, 0, 0, 0, crew.vehicleId]);
const after = (a: Crew, b: Crew) => {
  const [x, y] = [keyOf(a), keyOf(b)];
  for (const [i, part] of x.entries()) if (part !== y[i]) return part! > y[i]!;
  return true;
};
const inPickerOrder = (list: CrewList) => list.crews.every((crew, i) => i === 0 || after(crew, list.crews[i - 1]!));

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, username] of [[ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [kasun, 'kasun'], [dilshan, 'dilshan'], [admin, 'admin']] as const) {
    expect((await signInAs(agent, username)).status).toBe(200);
  }
  const drivers = await db.select({ id: users.id, staffId: users.staffId, username: users.username }).from(users).where(eq(users.role, 'driver'));
  staffIds = new Map(drivers.map((d) => [d.id, d.staffId!]));
  dilshanId = drivers.find((d) => d.username === 'dilshan')!.id;
});
beforeEach(async () => { await reset(); await initClock(); freeze(); await read(); });
afterAll(async () => { await reset(); await db.update(demoDay).set(originalClock); setClockForTests(null); await stop(server); await pool.end(); });

it('AC-4 pairs Peliyagoda\'s drivers in staff ID order with its trucks in id order on the seeded day, which has no history', async () => {
  const list = await crews(THU, []);
  expect(list.crews).toHaveLength(38);
  // D-001 Dilshan drives VEH001, D-003 Chaminda VEH002 and so on to D-036 Wasantha on VEH035, the fridge van. The last
  // three trucks are past the last driver. A truck in the workshop names no driver (L-05): VEH003, VEH005 and VEH036.
  expect(pairs(list)).toEqual(Object.fromEntries([
    ['VEH001', 'D-001'], ...Array.from({ length: 34 }, (_, i) => [veh(i + 2), [3, 5].includes(i + 2) ? null : staffId(i + 3)]), ['VEH036', null], ['VEH037', null], ['VEH038', null],
  ]));
  // The seed's sent plans hold no trips, so no truck ran a district last time, and with no orders every truck fits.
  expect(list.crews.every((crew) => crew.lastDistricts.length === 0 && !crew.ranHere && crew.fits && crew.misfits.length === 0)).toBe(true);
  expect(list).toMatchObject({ orderIds: [], revision: 0, load: { kg: 0, m3: 0 } });
  expect(inPickerOrder(list)).toBe(true);
});

it('AC-1 lists the crews for Fresh Nugegoda\'s chilled order: the fridge van that fits first, and the workshop\'s last with their reasons', async () => {
  const list = await crews(THU, [NUGEGODA]);
  const order = board.orders.find((o) => o.id === NUGEGODA)!;
  expect(list).toMatchObject({ orderIds: [NUGEGODA], revision: 0, load: { kg: order.load.kg, m3: order.load.m3 } });
  expect(list.crews[0]).toEqual({
    vehicleId: 'VEH035', driverId: list.crews[0]!.driverId, type: 'van', temp: 'reefer', weightCapKg: 1040, volumeCapM3: 7,
    fuelLeftPct: board.vehicles.find((v) => v.id === 'VEH035')!.fuelLeftPct, readyAt: null, lastDistricts: [], ranHere: false, fits: true, misfits: [], unavailable: null,
  });
  expect(staffOf(list.crews[0]!)).toBe('D-036');
  // Nugegoda takes vans only, and the order needs a fridge: of the trucks that can be picked, only the fridge van fits.
  expect(list.crews.filter((crew) => crew.fits && crew.unavailable === null).map((crew) => crew.vehicleId)).toEqual(['VEH035']);
  expect(crewOf(list, 'VEH001').misfits).toEqual([{ code: 'van_only', orderId: null, outletId: 'OUT001' }]);
  expect(crewOf(list, 'VEH008').misfits).toEqual([{ code: 'van_only', orderId: null, outletId: 'OUT001' }, { code: 'needs_reefer', orderId: NUGEGODA, outletId: 'OUT001' }]);
  expect(crewOf(list, 'VEH037').misfits).toEqual([{ code: 'needs_reefer', orderId: NUGEGODA, outletId: 'OUT001' }]);
  // The trucks in the workshop come last, by truck, with the workshop's reasons. VEH036, the other fridge van, would fit.
  expect(list.crews.slice(-3).map((crew) => [crew.vehicleId, crew.unavailable, crew.fits])).toEqual([
    ['VEH003', { kind: 'workshop', reason: 'Fridge unit repair' }, false],
    ['VEH005', { kind: 'workshop', reason: 'Brake service' }, false],
    ['VEH036', { kind: 'workshop', reason: 'Gearbox repair' }, true],
  ]);
  expect(list.crews.slice(0, -3).every((crew) => crew.unavailable === null)).toBe(true);
  expect(inPickerOrder(list)).toBe(true);
});

it('AC-1 names the draft\'s driver for a truck on the draft, a driver once only, and puts a truck on two trips last', async () => {
  const plan: DraftPlan = { mixBrands: false, deferrals: [], trips: [
    { vehicleId: 'VEH002', tripNo: 1, leaveAt: null, driverId: dilshanId, stops: [] },
    { vehicleId: 'VEH002', tripNo: 2, leaveAt: null, driverId: dilshanId, stops: [] },
    { vehicleId: 'VEH004', tripNo: 1, leaveAt: null, driverId: null, stops: [] },
  ] };
  const saved = await ruwan.put(`/api/v1/plans/${THU}/draft`).send({ planId: null, demoDay: board.demoDay, plan });
  expect(saved.status, JSON.stringify(saved.body.error)).toBe(200);
  const list = await crews(THU, [NUGEGODA]);
  expect(list.revision).toBe(1);
  // VEH002 runs both its trips with Dilshan, so it cannot take another and comes with the workshop's trucks.
  expect(crewOf(list, 'VEH002')).toMatchObject({ driverId: dilshanId, unavailable: { kind: 'two_trips' } });
  expect(list.crews.slice(-4).map((crew) => crew.vehicleId)).toEqual(['VEH002', 'VEH003', 'VEH005', 'VEH036']);
  // VEH004 has a trip with no driver, and the draft's choice stands.
  expect(crewOf(list, 'VEH004')).toMatchObject({ driverId: null, unavailable: null });
  // VEH001's usual driver drives VEH002 on the draft, so he is on VEH002's row alone and VEH001 names no driver (L-05).
  expect(crewOf(list, 'VEH001').driverId).toBeNull();
  expect(list.crews.filter((crew) => crew.driverId === dilshanId).map((crew) => crew.vehicleId)).toEqual(['VEH002']);
  expect(inPickerOrder(list)).toBe(true);
});

it('AC-4 takes the usual drivers and districts from the latest sent plan, and puts a crew that ran the orders\' district first', async () => {
  // Thursday's plan, sent: VEH035 to Fresh Nugegoda and Fresh Wellawatte in Colombo with Dilshan, and VEH004 to two
  // Gampaha shops with no driver. Friday's orders close at Thursday 16:00.
  await sendWalkthroughPlan({ nadeesha, ruwan, freeze }, { withVeh004: true });
  freeze(THU, 16 * 60);
  const friday = PlanBoard.parse((await ruwan.get(`/api/v1/plans/${FRI}`)).body);
  const shop = (outletId: string) => friday.shops.find((s) => s.id === outletId)!;
  // A dry order for a Colombo shop that any truck can reach and the fridge van can carry.
  const order = friday.orders.find((o) => shop(o.outletId).district === 'Colombo' && shop(o.outletId).parking === 'normal' && o.temp === 'dry' && o.load.kg <= 1040 && o.load.m3 <= 7)!;
  const list = await crews(FRI, [order.id]);
  // Dilshan drove VEH035 to Colombo, so he is its usual driver now and it ran the order's district.
  expect(crewOf(list, 'VEH035')).toMatchObject({ driverId: dilshanId, lastDistricts: ['Colombo'], ranHere: true, fits: true });
  // VEH004 ran Gampaha with no driver, so the pairing gives it one. The trucks history does not pair take the drivers it
  // left, in staff ID order: VEH001 Chaminda (D-003) up to VEH034 Wasantha (D-036).
  expect(crewOf(list, 'VEH004')).toMatchObject({ lastDistricts: ['Gampaha'], ranHere: false });
  expect(pairs(list)).toEqual(Object.fromEntries([
    ...Array.from({ length: 34 }, (_, i) => [veh(i + 1), staffId(i + 3)]), ['VEH035', 'D-001'], ['VEH036', null], ['VEH037', null], ['VEH038', null],
  ]));
  // Of the crews that fit, the one that ran Colombo comes first, ahead of trucks with more fuel left.
  const fitting = list.crews.filter((crew) => crew.fits && crew.unavailable === null);
  expect(fitting[0]!.vehicleId).toBe('VEH035');
  expect(fitting.some((crew) => crew.fuelLeftPct > fitting[0]!.fuelLeftPct)).toBe(true);
  expect(inPickerOrder(list)).toBe(true);
});

it('L-04 does not call a crew fitting whose truck is ready again only after every window of the orders closes', async () => {
  // The suggested plan: many trucks run a first trip, and a crew for another Fresh trip's orders would start its second.
  const built = await ruwan.post(`/api/v1/plans/${THU}/suggest`).send({ planId: null, demoDay: board.demoDay });
  expect(built.status, JSON.stringify(built.body.error)).toBe(200);
  const day = PlanBoard.parse(built.body);
  const shop = (outletId: string) => day.shops.find((s) => s.id === outletId)!;
  const fresh = day.plan.trips.find((t) => t.tripNo === 1 && t.stops.length > 1 && shop(t.stops[0]!.outletId).brand === 'Fresh')!;
  const orderIds = fresh.stops.flatMap((s) => s.orderIds);
  const list = await crews(THU, orderIds);
  // The latest the orders' windows close, as the planner reads a window: its mall slot, and 07:59 for a Fresh shop.
  const closes = Math.max(...fresh.stops.map((s) => {
    const at = shop(s.outletId);
    return Math.min(at.windowClose, at.mallClose ?? at.windowClose, at.brand === 'Fresh' ? 479 : Infinity);
  }));
  const readyOf = (vehicleId: string) => day.check!.trips.find((t) => t.vehicleId === vehicleId && t.tripNo === 1)?.times?.readyAgainAt ?? null;
  const second = list.crews.filter((crew) => crew.unavailable === null && day.plan.trips.some((t) => t.vehicleId === crew.vehicleId));
  expect(second.length).toBeGreaterThan(0);
  for (const crew of second) {
    expect(crew.readyAt).toBe(readyOf(crew.vehicleId));
    const late = crew.readyAt !== null && crew.readyAt > closes;
    expect(crew.misfits.some((m) => m.code === 'ready_late'), crew.vehicleId).toBe(late);
    if (late) expect(crew.fits).toBe(false);
  }
  expect(second.some((crew) => crew.misfits.some((m) => m.code === 'ready_late'))).toBe(true);
  // A truck with no trip yet is ready at the usual time, and says nothing of it.
  expect(list.crews.filter((crew) => !day.plan.trips.some((t) => t.vehicleId === crew.vehicleId)).every((crew) => crew.readyAt === null)).toBe(true);
  expect(inPickerOrder(list)).toBe(true);
});

it('reads the crews of the depot the dispatcher has switched to', async () => {
  expect((await ruwan.put('/api/v1/me/depot').send({ depotId: 'Kandy' })).status).toBe(200);
  try {
    const list = await crews(THU, []);
    // Kandy's 22 trucks, VEH039 to VEH060, with its 22 drivers in staff ID order: Prasanna (D-002), then D-037 to D-057.
    expect(pairs(list)).toEqual(Object.fromEntries(Array.from({ length: 22 }, (_, i) => [veh(i + 39), i === 0 ? 'D-002' : staffId(i + 36)])));
  } finally {
    expect((await ruwan.put('/api/v1/me/depot').send({ depotId: 'Peliyagoda' })).status).toBe(200);
  }
});

it('refuses the crews read without a session, to another role and to an admin, for orders that are not the day\'s, and for a sent plan', async () => {
  expect(code(await ask(THU, [], request.agent(server)))).toEqual([401, 'signed_out']);
  for (const agent of [nadeesha, kasun, dilshan]) expect(code(await ask(THU, [], agent))).toEqual([403, 'forbidden']);
  expect(code(await ask(THU, [], admin))).toEqual([403, 'no_depot']);
  expect(code(await ruwan.get(`/api/v1/plans/${THU}/crews`))).toEqual([400, 'invalid_input']);
  expect(code(await ask(THU, ['VEH035']))).toEqual([400, 'invalid_input']);
  expect(code(await ask('2026-13-40', []))).toEqual([400, 'invalid_input']);
  const stranger = randomUUID();
  const unknown = await ask(THU, [NUGEGODA, stranger]);
  expect(code(unknown)).toEqual([400, 'unknown_record']);
  expect(unknown.body.error.details).toEqual({ id: stranger });
  // Wednesday's sent plan, and Thursday's once it is sent.
  expect(code(await ask(WED, []))).toEqual([409, 'plan_sent']);
  const saved = await ruwan.put(`/api/v1/plans/${THU}/draft`).send({ planId: null, demoDay: board.demoDay, plan: { mixBrands: false, trips: [], deferrals: [] } });
  await db.update(plans).set({ status: 'published' }).where(and(eq(plans.id, saved.body.plan.id), inArray(plans.date, [THU])));
  expect(code(await ask(THU, [NUGEGODA]))).toEqual([409, 'plan_sent']);
});
