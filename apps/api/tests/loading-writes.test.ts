import { StoreOrderList, type LoadingTruck } from '@wayfinder/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { clearDemoDay, seedDemoDay } from '../src/db/demo-day';
import { auditLog, demoDay, issueLines, issues, orderLines, orders, stops, trips, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import {
  answeredTruck, answerFlag, code, dryLine, heldRows, loaderScreen, resetDay, sendWalkthroughPlan, signIn, stopOf, THU, truckOf, WED, type Walkthrough,
} from './loading-plan';
import { serve, stop } from './serve';

const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at || clock.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async (original) => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const freeze = (date: string, minute: number) => { const at = depotInstant(date, minute); testClock.at = at.toISOString(); setClockForTests(at); };

const server = await serve(createApp());
const kasun = request.agent(server);
const ruwan = request.agent(server);
const nadeesha = request.agent(server);
const walk: Walkthrough = { nadeesha, ruwan, freeze };
const loader = loaderScreen(kasun);
let originalClock: typeof demoDay.$inferSelect;
let kasunId: string;

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, username] of [[kasun, 'kasun'], [ruwan, 'ruwan'], [nadeesha, 'nadeesha']] as const) await signIn(agent, username);
  kasunId = (await db.select().from(users).where(eq(users.username, 'kasun')))[0]!.id;
});
beforeEach(async () => {
  await resetDay();
  await initClock();
  freeze(WED, 16 * 60);
  vi.mocked(announce).mockReset();
});
afterAll(async () => {
  await resetDay();
  await db.update(demoDay).set(originalClock);
  testClock.at = '';
  setClockForTests(null);
  await stop(server);
  await pool.end();
});

// A truck of the walkthrough's plan, started by Kasun at Thu 02:30.
async function loading(vehicleId: string, { withVeh004 = false } = {}): Promise<LoadingTruck> {
  await sendWalkthroughPlan(walk, { withVeh004 });
  const day = await loader.read();
  return answeredTruck(await loader.start(truckOf(day, vehicleId), day.plan!), vehicleId);
}
// VEH035 as the walkthrough loads it: stop 2 on, Nugegoda's dry line flagged at this count, then stop 1 on.
async function flaggedAndLoaded(counted: number): Promise<LoadingTruck> {
  let truck = await loading('VEH035');
  truck = answeredTruck(await loader.stopLoaded(truck, 2), 'VEH035');
  freeze(THU, 2 * 60 + 33);
  truck = answeredTruck(await loader.flag(truck, 1, [{ lineId: dryLine(truck).lineId, counted }], { note: 'Only 3 dry cartons in the store' }), 'VEH035');
  return answeredTruck(await loader.stopLoaded(truck, 1), 'VEH035');
}
const auditsOf = (entityId: string, action: string) => db.select().from(auditLog).where(and(eq(auditLog.entityId, entityId), eq(auditLog.action, action)));
const told = () => vi.mocked(announce).mock.calls.map(([change]) => change);

it("AC-14 marks VEH004's stop 2 loaded at the app clock's time, raises the revision and counts its 99 cartons as on", async () => {
  const truck = await loading('VEH004', { withVeh004: true });
  freeze(THU, 2 * 60 + 40);
  vi.mocked(announce).mockClear();
  const loaded = answeredTruck(await loader.stopLoaded(truck, 2), 'VEH004');
  expect(loaded).toMatchObject({ status: 'loading', revision: truck.revision + 1, units: 210, short: 0, on: { units: 99, kg: 683.1, m3: 3.663 } });
  expect(loaded.stops.map((s) => [s.seq, s.shopName, s.loaded])).toEqual([[2, 'Fresh Kandana', true], [1, 'Fresh Gampaha', false]]);
  expect((await db.select().from(stops).where(eq(stops.id, stopOf(truck, 2).id)))[0]!.loadedAt).toEqual(depotInstant(THU, 2 * 60 + 40));
  expect(await auditsOf(stopOf(truck, 2).id, 'stop.loaded')).toHaveLength(1);
  expect(told()).toEqual([{ topic: 'loading', depotId: 'Peliyagoda' }]);
});

it("AC-15 refuses VEH004's stop 1 before stop 2 with load_order, a stop on a truck not loading with not_loading, and a loaded stop again as stale", async () => {
  await sendWalkthroughPlan(walk, { withVeh004: true });
  const day = await loader.read();
  const planned = truckOf(day, 'VEH004');
  let before = await heldRows();
  const early = await loader.stopLoaded(planned, 2);
  expect(code(early)).toEqual([409, 'not_loading']);
  expect(early.body.error).toMatchObject({ message: 'VEH004 is not being loaded.', details: { vehicleId: 'VEH004', tripNo: 1 } });
  expect(await heldRows()).toEqual(before);

  const truck = answeredTruck(await loader.start(planned, day.plan!), 'VEH004');
  before = await heldRows();
  const outOfOrder = await loader.stopLoaded(truck, 1);
  expect(code(outOfOrder)).toEqual([409, 'load_order']);
  expect(outOfOrder.body.error).toMatchObject({ message: 'Load stop 2 first. The last stop goes in first.', details: { stopSeq: 2 } });
  expect(await heldRows()).toEqual(before);

  const loaded = answeredTruck(await loader.stopLoaded(truck, 2), 'VEH004');
  before = await heldRows();
  expect(code(await loader.stopLoaded(loaded, 2))).toEqual([409, 'stale']);
  expect(await heldRows()).toEqual(before);
});

it("AC-16 flags VEH035's dry line short at 3 of 4 with a note: an open problem, and the line going out at 3 with its stop 23 of 24", async () => {
  const truck = await loading('VEH035');
  const line = dryLine(truck);
  freeze(THU, 2 * 60 + 33);
  vi.mocked(announce).mockClear();
  const flagged = answeredTruck(await loader.flag(truck, 1, [{ lineId: line.lineId, counted: 3 }], { reason: 'short', note: 'Only 3 dry cartons in the store' }), 'VEH035');

  const [problem, ...others] = await db.select().from(issues);
  expect(others).toEqual([]);
  expect(problem).toMatchObject({ kind: 'loading', reason: 'short', status: 'open', revision: 0, stopId: stopOf(truck, 1).id, raisedBy: kasunId,
    raisedAt: depotInstant(THU, 2 * 60 + 33), note: 'Only 3 dry cartons in the store', decision: null, decidedBy: null, decidedAt: null });
  expect(await db.select().from(issueLines)).toEqual([{ issueId: problem!.id, orderLineId: line.lineId, counted: 3 }]);
  expect((await db.select().from(trips).where(eq(trips.id, truck.tripId)))[0]!.revision).toBe(truck.revision + 1);
  expect(await auditsOf(problem!.id, 'issue.raised')).toHaveLength(1);
  expect(told()).toEqual([{ topic: 'loading', depotId: 'Peliyagoda' }, { topic: 'issues', depotId: 'Peliyagoda' }]);

  expect(flagged).toMatchObject({ revision: truck.revision + 1, units: 118, short: 1, on: { units: 0, kg: 0, m3: 0 } });
  expect(stopOf(flagged, 1)).toMatchObject({ loaded: false, units: 24, going: 23, short: 1 });
  expect(dryLine(flagged)).toMatchObject({ quantity: 4, going: 3, short: 1 });
  expect(flagged.issues).toEqual([{
    id: problem!.id, revision: 0, kind: 'loading', reason: 'short', status: 'open', raisedBy: 'Kasun', raisedAt: depotInstant(THU, 2 * 60 + 33).toISOString(),
    note: 'Only 3 dry cartons in the store', hasPhoto: false, decision: null, decidedBy: null, decidedAt: null, short: 1, cold: null, replacement: null,
    trip: { id: truck.tripId, vehicleId: 'VEH035', tripNo: 1, status: 'loading', driver: 'Dilshan', stopsLeft: 2, leavesAt: depotInstant(THU, 4 * 60 + 36).toISOString() },
    stop: { id: stopOf(truck, 1).id, seq: 1, outletId: 'OUT001', shopName: 'Fresh Nugegoda', arrivedAt: null, doneAt: null, loadedAt: null, flaggedAtDock: true },
    lines: [{ lineId: line.lineId, orderId: line.orderId, temp: 'dry', productId: 'fresh-dry-carton', name: 'Dry carton', unit: 'carton', quantity: 4, counted: 3, loaded: null, delivered: null, received: null }],
  }]);
});

it('AC-17 refuses a flag that lowers no count, counts below 0 or not below its quantity, names a line off its stop or twice, or has a bad reason or note, writing nothing', async () => {
  const truck = await loading('VEH035');
  const line = dryLine(truck);
  const wellawatte = stopOf(truck, 2).lines[0]!;
  const before = await heldRows();
  const refusals: [lines: { lineId: string; counted: number }[], more: object, error: string][] = [
    [[], {}, 'invalid_input'],
    [[{ lineId: line.lineId, counted: 4 }], {}, 'invalid_input'],
    [[{ lineId: line.lineId, counted: 5 }], {}, 'invalid_input'],
    [[{ lineId: line.lineId, counted: -1 }], {}, 'invalid_input'],
    [[{ lineId: wellawatte.lineId, counted: 40 }], {}, 'unknown_record'],
    [[{ lineId: line.lineId, counted: 3 }, { lineId: line.lineId, counted: 2 }], {}, 'invalid_input'],
    [[{ lineId: line.lineId, counted: 3 }], { reason: 'lost' }, 'invalid_input'],
    [[{ lineId: line.lineId, counted: 3 }], { note: 'x'.repeat(201) }, 'invalid_input'],
  ];
  for (const [lines, more, error] of refusals) expect(code(await loader.flag(truck, 1, lines, more))).toEqual([400, error]);
  expect(await heldRows()).toEqual(before);
});

it('AC-17 refuses a line already flagged, open or answered, with already_flagged, and a flag on a truck not loading with not_loading', async () => {
  await sendWalkthroughPlan(walk);
  const day = await loader.read();
  const planned = truckOf(day, 'VEH035');
  let before = await heldRows();
  expect(code(await loader.flag(planned, 1, [{ lineId: dryLine(planned).lineId, counted: 3 }]))).toEqual([409, 'not_loading']);
  expect(await heldRows()).toEqual(before);

  let truck = answeredTruck(await loader.start(planned, day.plan!), 'VEH035');
  truck = answeredTruck(await loader.flag(truck, 1, [{ lineId: dryLine(truck).lineId, counted: 3 }]), 'VEH035');
  before = await heldRows();
  const again = await loader.flag(truck, 1, [{ lineId: dryLine(truck).lineId, counted: 2 }]);
  expect(code(again)).toEqual([409, 'already_flagged']);
  expect(again.body.error).toMatchObject({ message: 'The 4 dry cartons for Fresh Nugegoda are already flagged.', details: { lineId: dryLine(truck).lineId } });
  expect(await heldRows()).toEqual(before);

  freeze(THU, 2 * 60 + 35);
  await answerFlag(ruwan, truck.issues[0]!.id, 'go_short');
  before = await heldRows();
  expect(code(await loader.flag(truck, 1, [{ lineId: dryLine(truck).lineId, counted: 2 }]))).toEqual([409, 'already_flagged']);
  expect(await heldRows()).toEqual(before);
});

it('AC-22 refuses ready with stops not loaded, naming them, and with a flag open, naming it, changing nothing', async () => {
  let truck = await loading('VEH035');
  let before = await heldRows();
  const none = await loader.ready(truck);
  expect(code(none)).toEqual([409, 'stops_left']);
  expect(none.body.error).toMatchObject({ message: 'Stops 1 and 2 are not loaded yet.', details: { stopSeqs: [1, 2] } });
  expect(await heldRows()).toEqual(before);

  truck = answeredTruck(await loader.stopLoaded(truck, 2), 'VEH035');
  truck = answeredTruck(await loader.flag(truck, 1, [{ lineId: dryLine(truck).lineId, counted: 3 }]), 'VEH035');
  before = await heldRows();
  const oneLeft = await loader.ready(truck);
  expect(code(oneLeft)).toEqual([409, 'stops_left']);
  expect(oneLeft.body.error).toMatchObject({ message: 'Stop 1 is not loaded yet.', details: { stopSeqs: [1] } });
  expect(await heldRows()).toEqual(before);

  truck = answeredTruck(await loader.stopLoaded(truck, 1), 'VEH035');
  before = await heldRows();
  const open = await loader.ready(truck);
  expect(code(open)).toEqual([409, 'flag_open']);
  expect(open.body.error).toMatchObject({ message: 'The dispatcher has not answered the flag on VEH035 yet.', details: { issueIds: [truck.issues[0]!.id] } });
  expect(await heldRows()).toEqual(before);
});

it('AC-23 marks VEH035 ready after "Go short": ready at the clock, the counts that left, its five orders loaded and the shops told after the commit', async () => {
  let truck = await flaggedAndLoaded(3);
  freeze(THU, 2 * 60 + 35);
  await answerFlag(ruwan, truck.issues[0]!.id, 'go_short');
  truck = truckOf(await loader.read(), 'VEH035');
  const lines = truck.stops.flatMap((s) => s.lines);
  const orderIds = [...new Set(lines.map((l) => l.orderId))];
  const ordersBefore = await db.select().from(orders).where(inArray(orders.id, orderIds));
  freeze(THU, 2 * 60 + 36);
  vi.mocked(announce).mockClear();
  let committed = false;
  const transaction = db.transaction.bind(db);
  const spy = vi.spyOn(db, 'transaction').mockImplementation((async (...args: Parameters<typeof db.transaction>) => {
    const answer = await transaction(...args); committed = true; return answer;
  }) as typeof db.transaction);
  vi.mocked(announce).mockImplementation(() => { expect(committed).toBe(true); });
  let res: request.Response;
  try { res = await loader.ready(truck); } finally { spy.mockRestore(); }

  const ready = answeredTruck(res!, 'VEH035');
  expect(ready).toMatchObject({ status: 'ready', readyAt: depotInstant(THU, 2 * 60 + 36).toISOString(), revision: truck.revision + 1, units: 118, short: 1,
    on: { units: 117, kg: 807.3, m3: 4.329 } });
  expect((await db.select().from(trips).where(eq(trips.id, truck.tripId)))[0]).toMatchObject({ status: 'ready', readyAt: depotInstant(THU, 2 * 60 + 36) });
  const stored = await db.select().from(orderLines).where(inArray(orderLines.id, lines.map((l) => l.lineId)));
  expect(lines.map((l) => stored.find((s) => s.id === l.lineId)!.loadedQty)).toEqual([48, 46, 12, 8, 3]);
  const ordersAfter = await db.select().from(orders).where(inArray(orders.id, orderIds));
  expect(ordersAfter).toHaveLength(5);
  for (const order of ordersAfter) {
    expect(order.status).toBe('loaded');
    expect(order.revision).toBe(ordersBefore.find((o) => o.id === order.id)!.revision + 1);
  }
  const audits = await auditsOf(truck.tripId, 'trip.ready');
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ actorId: kasunId, after: { status: 'ready', lines: lines.map((l) => ({ lineId: l.lineId, loadedQty: l.going })) } });
  expect(told()).toHaveLength(4);
  expect(told()).toEqual(expect.arrayContaining([
    { topic: 'loading', depotId: 'Peliyagoda' }, { topic: 'driver', depotId: 'Peliyagoda' },
    { topic: 'orders', outletId: 'OUT001', depotId: 'Peliyagoda' }, { topic: 'orders', outletId: 'OUT002', depotId: 'Peliyagoda' },
  ]));

  const list = StoreOrderList.parse((await nadeesha.get('/api/v1/store/orders?list=open')).body);
  const hers = list.orders.filter((o) => orderIds.includes(o.id));
  expect(hers.map((o) => [o.temp, o.units, o.status])).toEqual([['chilled', 12, 'loaded'], ['chilled', 8, 'loaded'], ['dry', 4, 'loaded']]);
});

it('AC-23 sends the dry order out empty when its line is counted at 0 and goes short: loaded with 0 on, and 114 cartons on the truck', async () => {
  let truck = await flaggedAndLoaded(0);
  freeze(THU, 2 * 60 + 35);
  await answerFlag(ruwan, truck.issues[0]!.id, 'go_short');
  truck = truckOf(await loader.read(), 'VEH035');
  const ready = answeredTruck(await loader.ready(truck), 'VEH035');
  expect(ready).toMatchObject({ status: 'ready', short: 4, on: { units: 114, kg: 786.6, m3: 4.218 } });
  const dry = dryLine(truck);
  expect((await db.select().from(orderLines).where(eq(orderLines.id, dry.lineId)))[0]!.loadedQty).toBe(0);
  expect((await db.select().from(orders).where(eq(orders.id, dry.orderId)))[0]!.status).toBe('loaded');
});

it('AC-24 lets a loader write and a demo reset that arrive at once both finish', async () => {
  await sendWalkthroughPlan(walk);
  const day = await loader.read();
  const [reset, started] = await Promise.all([kasun.post('/api/v1/demo/reset').send({}), loader.start(truckOf(day, 'VEH035'), day.plan!)]);
  expect(reset.status).toBe(200);
  expect([200, 400]).toContain(started.status);
  if (started.status === 400) expect(started.body.error.code).toBe('unknown_record');
});

it('AC-24 refuses a loader write caught behind a reset with unknown_record once the reset has committed', async () => {
  const truck = await loading('VEH035');
  let release!: () => void;
  let resetting!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const cleared = new Promise<void>((resolve) => { resetting = resolve; });
  // The reset's own steps: the clock row for update first, then the day cleared and written again.
  const reset = db.transaction(async (tx) => {
    await tx.select().from(demoDay).for('update');
    await clearDemoDay(tx);
    await seedDemoDay(tx);
    resetting();
    await held;
  });
  await cleared;
  const writing = loader.stopLoaded(truck, 2).then((r) => r);
  try {
    await vi.waitFor(async () => {
      const { rows } = await db.execute(sql`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%demo_day%'`);
      expect(rows).toHaveLength(1);
    });
  } finally { release(); await reset; }
  const refused = await writing;
  expect(code(refused)).toEqual([400, 'unknown_record']);
  expect(refused.body.error.details).toEqual({ id: truck.tripId });
});

it('driver AC-7 allows a line flagged on an earlier trip to be flagged on this trip', async () => {
  let truck = await loading('VEH035');
  const [current] = await db.select().from(trips).where(eq(trips.id, truck.tripId));
  const [earlier] = await db.insert(trips).values({ planId: current!.planId, vehicleId: 'VEH035', tripNo: 2, status: 'done' }).returning();
  const [oldStop] = await db.insert(stops).values({ tripId: earlier!.id, seq: 1, outletId: 'OUT001' }).returning();
  const [problem] = await db.insert(issues).values({ kind: 'loading', reason: 'short', stopId: oldStop!.id, raisedBy: kasunId, raisedAt: depotInstant(THU, 2 * 60) }).returning();
  await db.insert(issueLines).values({ issueId: problem!.id, orderLineId: dryLine(truck).lineId, counted: 3 });
  truck = answeredTruck(await loader.flag(truck, 1, [{ lineId: dryLine(truck).lineId, counted: 2 }]), 'VEH035');
  expect(truck.issues).toHaveLength(1);
  expect(dryLine(truck).going).toBe(2);
});
