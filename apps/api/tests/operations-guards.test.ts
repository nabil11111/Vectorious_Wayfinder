// Spec 016's guards that its first tests left loose: another depot's trips, one event per closed attempt, the retry
// order, and no older plan's deferrals before Thursday is sent.
import { PlanBoard, type DraftPlan } from '@wayfinder/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { demoDay, issueLines, issues, orderLines, orders, plans, stopOrders, stops, trips, users } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { driverStop } from './driver-plan';
import { resetDay, signIn, THU, WED } from './loading-plan';
import { FRI, journey, operations } from './operations-plan';
import { serve, stop } from './serve';
const clock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async original => {
  const actual = await original<typeof import('../src/lib/clock')>();
  return { ...actual, demoClockAt: (...args: Parameters<typeof actual.demoClockAt>) => ({ ...actual.demoClockAt(...args), now: clock.at || actual.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async original => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const freeze = (date: string, min: number) => { const at = depotInstant(date, min); clock.at = at.toISOString(); setClockForTests(at); };
const server = await serve(createApp());
const ruwan = request.agent(server), nadeesha = request.agent(server), kasun = request.agent(server), dilshan = request.agent(server);
const walk = { ruwan, nadeesha, kasun, dilshan, freeze }, road = journey(walk), read = () => operations(ruwan);
let originalClock: typeof demoDay.$inferSelect;
beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, name] of [[ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [kasun, 'kasun'], [dilshan, 'dilshan']] as const) await signIn(agent, name);
});
beforeEach(async () => { await resetDay(); await initClock(); freeze(WED, 960); });
afterAll(async () => { await resetDay(); await db.update(demoDay).set(originalClock); clock.at = ''; setClockForTests(null); await stop(server); await pool.end(); });

// Rule 2 / AC-13: another depot's trip still out from an earlier day (the only way a foreign trip can match the
// "earlier out" branch of the trip query) stays out of every count, row and event.
it('AC-13 a Kandy trip still out from Wednesday never reaches Peliyagoda', async () => {
  const trip = await road.started();
  const before = await read();
  const [order] = await db.insert(orders).values({ outletId: 'OUT076', deliveryDate: WED, temp: 'dry', status: 'planned', placedAt: depotInstant('2026-06-23', 9 * 60) }).returning();
  const [line] = await db.insert(orderLines).values({ orderId: order!.id, productId: 'fresh-dry-carton', quantity: 10 }).returning();
  const [plan] = await db.insert(plans).values({ depotId: 'Kandy', date: WED, status: 'published', publishedAt: depotInstant('2026-06-23', 17 * 60) }).returning();
  const [foreign] = await db.insert(trips).values({ planId: plan!.id, vehicleId: 'VEH044', tripNo: 1, status: 'out', leftAt: depotInstant(WED, 300) }).returning();
  const [kandyStop] = await db.insert(stops).values({ tripId: foreign!.id, seq: 1, outletId: 'OUT076' }).returning();
  await db.insert(stopOrders).values({ stopId: kandyStop!.id, orderId: order!.id });
  void line;
  const res = await ruwan.get('/api/v1/operations');
  expect(res.status).toBe(200);
  expect(res.body).toEqual(before);
  expect(res.body.outTripIds).toEqual([trip.tripId]);
});

// Rule 7 / D-69 / AC-9: "A refusal/closed attempt has one event, not another from stops.done_at."
it('AC-9 a closed attempt yields one problem event and no outcome event of its own', async () => {
  const trip = await road.write(await road.wellawatte(), 'closed', 228, 2);
  const wellawatte = driverStop(trip, 2).id;
  const day = await read();
  const own = day.events.filter(event => event.stopId === wellawatte);
  expect(own.map(event => event.kind).sort()).toEqual(['arrived', 'problem_raised', 'stop_loaded']);
});

// Rule 1 / D-66 / AC-10 with the next day's plan already sent: the watched day is Friday, Thursday's trip is a
// separate dated section, and Friday's totals and deferrals come from Friday's plan only.
it('AC-10 rollover with Friday published keeps Thursday separate', async () => {
  let trip = await road.wellawatte();
  trip = await road.write(trip, 'refuse', 228, 2, { reason: 'damaged', note: '', lines: [{ lineId: driverStop(trip, 2).lines.find(line => line.temp === 'chilled')!.lineId, refused: 2 }] });
  freeze(THU, 16 * 60 + 30);
  const board = PlanBoard.parse((await ruwan.get('/api/v1/plans')).body);
  expect(board.day!.date).toBe(FRI);
  const draft: DraftPlan = { mixBrands: false, trips: [], deferrals: board.orders.map(order => ({ orderId: order.id, code: 'dispatcher_choice', reason: 'Scheduled for a later run.' })) };
  const saved = await ruwan.put(`/api/v1/plans/${FRI}/draft`).send({ planId: null, demoDay: board.demoDay, plan: draft });
  expect(saved.status).toBe(200);
  const ready = PlanBoard.parse(saved.body);
  const sent = await ruwan.post(`/api/v1/plans/${FRI}/send`).send({ planId: ready.plan.id, revision: ready.plan.revision });
  expect(sent.status).toBe(200);
  const day = await read();
  expect(day).toMatchObject({ day: FRI, plan: { id: ready.plan.id, detailRecorded: true }, groups: [], counts: { stopsTotal: 0, tripsTotal: 0, vehiclesOut: 1, deferredOrders: board.orders.length },
    outTripIds: [trip.tripId], earlierOut: [{ date: THU, brandTotals: [{ brand: 'Fresh', vehiclesTotal: 1, stopsTotal: 2, stopsDone: 2 }] }] });
  expect(day.events.filter(event => event.kind === 'plan_sent').map(event => event.planId)).toEqual([ready.plan.id]);
  expect(day.events.some(event => event.kind === 'problem_raised' && event.issueKind === 'refused')).toBe(true);
  const [driver] = await db.select().from(users).where(eq(users.username, 'dilshan'));
  void driver; void issues; void issueLines;
});

// AC-9: "use 013's retry order". Sending stop 1 back while stop 2 is untouched puts stop 2 next (nextStop), so the
// out row and attention follow Wellawatte, not the reopened Nugegoda.
it('AC-9 Try again puts the reopened stop behind the untouched one', async () => {
  let trip = await road.started();
  trip = await road.write(trip, 'arrive', 214, 1);
  trip = await road.write(trip, 'closed', 218, 1);
  const closed = trip.problems.find(problem => problem.kind === 'closed')!;
  freeze(THU, 219);
  const { decide, shownTrip } = await import('./operations-plan');
  await decide(ruwan, closed.id, 'try_again');
  const day = await read();
  expect(shownTrip(day).outRow).toMatchObject({ nextStop: { outletId: 'OUT002' }, arrivalIsOriginal: false, plannedArrival: depotInstant(THU, 324).toISOString() });
});

// AC-2: "no deferrals on a sent Thursday plan" while Thursday is unsent.
it('AC-2 no sent Thursday plan means no deferrals', async () => {
  expect((await read()).counts.deferredOrders).toBe(0);
});
