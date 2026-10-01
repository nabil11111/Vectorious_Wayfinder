// One vehicle on two trips in two districts: counted once in its brand's header, and each trip in its own group.
import { OperationsDay, PlanBoard, type DraftPlan, type DraftTrip } from '@wayfinder/contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { demoDay, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { answeredTruck, loaderScreen, resetDay, signIn, THU, truckOf, WED } from './loading-plan';
import { serve, stop } from './serve';
const clock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async original => {
  const actual = await original<typeof import('../src/lib/clock')>();
  return { ...actual, demoClockAt: (...args: Parameters<typeof actual.demoClockAt>) => ({ ...actual.demoClockAt(...args), now: clock.at || actual.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async original => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const freeze = (date: string, min: number) => { const at = depotInstant(date, min); clock.at = at.toISOString(); setClockForTests(at); };
const server = await serve(createApp());
const ruwan = request.agent(server), nadeesha = request.agent(server), kasun = request.agent(server), anura = request.agent(server);
let originalClock: typeof demoDay.$inferSelect;
beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, name] of [[ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [kasun, 'kasun'], [anura, 'anura']] as const) await signIn(agent, name);
});
beforeEach(async () => { await resetDay(); await initClock(); freeze(WED, 960); });
afterAll(async () => { await resetDay(); await db.update(demoDay).set(originalClock); clock.at = ''; setClockForTests(null); await stop(server); await pool.end(); });
const read = async () => { const res = await ruwan.get('/api/v1/operations'); expect(res.status).toBe(200); return OperationsDay.parse(res.body); };

// AC-15 through the real endpoints: VEH004 runs trip 1 in Gampaha and trip 2 in Colombo, both Fresh.
it('AC-15 one vehicle on two trips in two districts of one brand', async () => {
  const board = PlanBoard.parse((await ruwan.get('/api/v1/plans')).body);
  const [driver] = await db.select({ id: users.id }).from(users).where(eq(users.username, 'anura'));
  const stopAt = (outletId: string) => ({ outletId, orderIds: board.orders.filter(o => o.outletId === outletId).map(o => o.id) });
  const planned: DraftTrip[] = [
    { vehicleId: 'VEH004', tripNo: 1, leaveAt: null, driverId: driver!.id, stops: [stopAt('OUT026'), stopAt('OUT028')] },
    { vehicleId: 'VEH004', tripNo: 2, leaveAt: null, driverId: driver!.id, stops: [stopAt('OUT006')] },
  ];
  const on = new Set(planned.flatMap(t => t.stops.flatMap(s => s.orderIds)));
  const draft: DraftPlan = { mixBrands: false, trips: planned, deferrals: board.orders.filter(o => !on.has(o.id)).map(o => ({ orderId: o.id, code: 'dispatcher_choice', reason: 'Later.' })) };
  const saved = PlanBoard.parse((await ruwan.put(`/api/v1/plans/${THU}/draft`).send({ planId: null, demoDay: board.demoDay, plan: draft })).body);
  expect(saved.check!.problems.filter(p => p.level === 'block')).toEqual([]);
  expect((await ruwan.post(`/api/v1/plans/${THU}/send`).send({ planId: saved.plan.id, revision: saved.plan.revision })).status).toBe(200);
  const day = await read();
  expect(day.brandTotals.map(row => [row.brand, row.tripsTotal, row.vehiclesTotal, row.stopsTotal])).toEqual([['Fresh', 2, 1, 3]]);
  expect(day.groups.map(row => [row.district, row.tripsTotal, row.vehiclesTotal, row.trips.map(t => t.tripNo)])).toEqual([['Colombo', 1, 1, [2]], ['Gampaha', 1, 1, [1]]]);

  // Trip 1 loads and leaves; trip 2 is still at the dock. VEH004 counts once out, trip 2 keeps On so far.
  freeze(THU, 150);
  const loader = loaderScreen(kasun);
  let loading = await loader.read();
  const first = loading.trucks.find(t => t.vehicleId === 'VEH004' && t.tripNo === 1)!;
  let truck = answeredTruck(await loader.start(first, loading.plan!), 'VEH004');
  truck = (await loader.read()).trucks.find(t => t.tripId === first.tripId)!;
  for (const seq of [2, 1]) { const res = await loader.stopLoaded(truck, seq); expect(res.status).toBe(200); truck = (await loader.read()).trucks.find(t => t.tripId === first.tripId)!; }
  expect((await loader.ready(truck)).status).toBe(200);
  freeze(THU, 210);
  const phone = (await anura.get('/api/v1/driver')).body;
  const mine = phone.trips.find((t: { tripId: string }) => t.tripId === first.tripId);
  const started = await anura.post('/api/v1/driver/writes').send({ writeId: crypto.randomUUID(), tripId: first.tripId, kind: 'start', at: depotInstant(THU, 210).toISOString(), revision: mine.revision });
  expect(started.status).toBe(200);
  const out = await read();
  expect(out.counts).toMatchObject({ vehiclesOut: 1, tripsTotal: 2, stopsTotal: 3 });
  expect(out.outTripIds).toEqual([first.tripId]);
  expect(out.brandTotals[0]).toMatchObject({ vehiclesTotal: 1, tripsTotal: 2 });
  void truckOf;
});
