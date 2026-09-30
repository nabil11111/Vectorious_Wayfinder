import { randomUUID } from 'node:crypto';
import { LoadingDay, PlanBoard, type DraftPlan, type DraftTrip, type LoadingDecision, type LoadingStop, type LoadingTruck } from '@wayfinder/contracts';
import { eq, sql } from 'drizzle-orm';
import type request from 'supertest';
import { expect } from 'vitest';
import { db } from '../src/db/client';
import { clearDemoDay, seedDemoDay } from '../src/db/demo-day';
import { auditLog, issueLines, issues, orderLines, orders, plans, stopOrders, stops, trips, users } from '../src/db/schema';
import { depotInstant } from '../src/lib/clock';

// The day every loading test starts from (spec 012, plan.md "Test plan"). Nadeesha places her draft, and Ruwan sends
// Thursday's plan through the endpoints of specs 009 and 010. Each test file mocks the clock itself, because a mock
// belongs to the file that makes it, and hands its setter in here with the agents it signed in once.

export type Agent = ReturnType<typeof request.agent>;
export const WED = '2026-06-24';
export const THU = '2026-06-25';
export const PASSWORD = process.env.SEED_PASSWORD ?? 'wayfinder-demo';
export const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'wayfinder-admin';

export interface Walkthrough {
  nadeesha: Agent;
  ruwan: Agent;
  // Sets the app clock to a depot date and minutes after its midnight.
  freeze: (date: string, minute: number) => void;
}

// The seeded day again, as spec 008's reset writes it.
export const resetDay = () => db.transaction(async (tx) => { await clearDemoDay(tx); await seedDemoDay(tx); });

export async function signIn(agent: Agent, username: string): Promise<void> {
  const res = await agent.post('/api/v1/auth/login').send({ username, password: username === 'admin' ? ADMIN_PASSWORD : PASSWORD });
  expect(res.status).toBe(200);
}

export const code = (res: request.Response) => [res.status, res.body.error?.code];

// Nadeesha places her draft at Wed 15:30. At 16:00 Ruwan sends Thursday's plan: VEH035 with OUT001's three orders
// on stop 1 and OUT002's two on stop 2, Dilshan driving, and with VEH004's trip to OUT026 and OUT028 when asked (spec
// 010's AC-11), every other order of the day deferred. The clock then reads Thu 25 Jun 02:30.
export async function sendWalkthroughPlan(walk: Walkthrough, { withVeh004 = false } = {}): Promise<PlanBoard> {
  walk.freeze(WED, 15 * 60 + 30);
  const next = (await walk.nadeesha.get('/api/v1/store/next-order')).body;
  expect((await walk.nadeesha.post('/api/v1/store/next-order/place').send({ deliveryDate: next.deliveryDate, refs: next.draft.refs })).status).toBe(200);
  walk.freeze(WED, 16 * 60);
  const board = PlanBoard.parse((await walk.ruwan.get('/api/v1/plans')).body);
  const [dilshan] = await db.select({ id: users.id }).from(users).where(eq(users.username, 'dilshan'));
  const stopAt = (outletId: string) => ({ outletId, orderIds: board.orders.filter((o) => o.outletId === outletId).map((o) => o.id) });
  const planned: DraftTrip[] = [{ vehicleId: 'VEH035', tripNo: 1, leaveAt: null, driverId: dilshan!.id, stops: [stopAt('OUT001'), stopAt('OUT002')] }];
  if (withVeh004) planned.push({ vehicleId: 'VEH004', tripNo: 1, leaveAt: null, driverId: null, stops: [stopAt('OUT026'), stopAt('OUT028')] });
  const on = new Set(planned.flatMap((t) => t.stops.flatMap((s) => s.orderIds)));
  const draft: DraftPlan = { mixBrands: false, trips: planned,
    deferrals: board.orders.filter((o) => !on.has(o.id)).map((o) => ({ orderId: o.id, code: 'dispatcher_choice', reason: 'Scheduled for a later run.' })) };
  const saved = await walk.ruwan.put(`/api/v1/plans/${THU}/draft`).send({ planId: null, demoDay: board.demoDay, plan: draft });
  expect(saved.status).toBe(200);
  const ready = PlanBoard.parse(saved.body);
  expect(ready.check!.ok).toBe(true);
  const sent = await walk.ruwan.post(`/api/v1/plans/${THU}/send`).send({ planId: ready.plan.id, revision: ready.plan.revision });
  expect(sent.status).toBe(200);
  walk.freeze(THU, 2 * 60 + 30);
  return PlanBoard.parse(sent.body);
}

export function truckOf(day: LoadingDay, vehicleId: string): LoadingTruck {
  const truck = day.trucks.find((t) => t.vehicleId === vehicleId);
  if (!truck) throw new Error(`${vehicleId} is not on the loading day.`);
  return truck;
}
export function stopOf(truck: LoadingTruck, seq: number): LoadingStop {
  const stop = truck.stops.find((s) => s.seq === seq);
  if (!stop) throw new Error(`${truck.vehicleId} has no stop ${seq}.`);
  return stop;
}
// The walkthrough's flagged line: Fresh Nugegoda's 4 dry cartons on VEH035's stop 1.
export const dryLine = (truck: LoadingTruck) => stopOf(truck, 1).lines.find((line) => line.temp === 'dry')!;

// The loader's screen: the loading day, and the four writes as the phone sends them, each naming the trip's revision
// the screen saw and carrying a new id, unless a retry passes the same one. A body may override any field.
export function loaderScreen(agent: Agent) {
  const post = (truck: LoadingTruck, action: string, body: object = {}, writeId: string = randomUUID()) =>
    agent.post(`/api/v1/loading/trips/${truck.tripId}/${action}`).send({ writeId, revision: truck.revision, ...body });
  return {
    post,
    async read(): Promise<LoadingDay> {
      const res = await agent.get('/api/v1/loading');
      expect(res.status).toBe(200);
      return LoadingDay.parse(res.body);
    },
    start: (truck: LoadingTruck, plan: { id: string; revision: number }, writeId?: string) => post(truck, 'start', { plan }, writeId),
    stopLoaded: (truck: LoadingTruck, seq: number, writeId?: string) => post(truck, 'stop-loaded', { stopId: stopOf(truck, seq).id }, writeId),
    flag: (truck: LoadingTruck, seq: number, lines: { lineId: string; counted: number }[], more: object = {}, writeId?: string) =>
      post(truck, 'flags', { stopId: stopOf(truck, seq).id, reason: 'short', note: '', lines, ...more }, writeId),
    ready: (truck: LoadingTruck, writeId?: string) => post(truck, 'ready', {}, writeId),
  };
}
// A write's answer, and one truck in it.
export const answeredTruck = (res: request.Response, vehicleId: string) => {
  expect(res.status).toBe(200);
  return truckOf(LoadingDay.parse(res.body), vehicleId);
};

// The dispatcher's answer to a flag, written as spec 012's answer writes it: decided by Ruwan at the app clock's time.
export async function answerFlag(issueId: string, decision: LoadingDecision, at: Date): Promise<void> {
  const [ruwan] = await db.select({ id: users.id }).from(users).where(eq(users.username, 'ruwan'));
  await db.update(issues).set({ status: 'decided', decision, decidedBy: ruwan!.id, decidedAt: at, revision: sql`${issues.revision} + 1` }).where(eq(issues.id, issueId));
}

// A Kandy plan with one loading trip, written straight into the tables: a truck, stop and line of another depot.
export async function kandyTrip() {
  const [order] = await db.insert(orders).values({ outletId: 'OUT076', deliveryDate: THU, temp: 'dry', status: 'planned', placedAt: depotInstant(WED, 9 * 60) }).returning();
  const [line] = await db.insert(orderLines).values({ orderId: order!.id, productId: 'fresh-dry-carton', quantity: 10 }).returning();
  const [plan] = await db.insert(plans).values({ depotId: 'Kandy', date: THU, status: 'published', publishedAt: depotInstant(WED, 17 * 60) }).returning();
  const [trip] = await db.insert(trips).values({ planId: plan!.id, vehicleId: 'VEH044', tripNo: 1, status: 'loading' }).returning();
  const [stop] = await db.insert(stops).values({ tripId: trip!.id, seq: 1, outletId: 'OUT076' }).returning();
  await db.insert(stopOrders).values({ stopId: stop!.id, orderId: order!.id });
  return { plan: plan!, trip: trip!, stop: stop!, line: line! };
}

// Every row a loader write or an answer could change, so a test can show that a refused one changed none.
export async function heldRows() {
  return {
    plans: await db.select().from(plans).orderBy(plans.id),
    trips: await db.select().from(trips).orderBy(trips.id),
    stops: await db.select().from(stops).orderBy(stops.id),
    orders: await db.select().from(orders).orderBy(orders.id),
    lines: await db.select().from(orderLines).orderBy(orderLines.id),
    issues: await db.select().from(issues).orderBy(issues.id),
    issueLines: await db.select().from(issueLines).orderBy(issueLines.issueId, issueLines.orderLineId),
    audits: await db.select().from(auditLog).orderBy(auditLog.id),
  };
}
