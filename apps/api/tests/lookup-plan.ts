import { LookupFleet, LookupHistory, LookupOrders, PlanBoard, type DraftTrip } from '@wayfinder/contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { demoDay, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { resetDay, signIn, WED } from './loading-plan';
import { journey } from './operations-plan';
import { serve, stop } from './serve';

export async function lookupHarness(clock: { at: string }) {
  const server = await serve(createApp());
  const ruwan = request.agent(server), nadeesha = request.agent(server), kasun = request.agent(server), dilshan = request.agent(server);
  const freeze = (date: string, minute: number) => { const at = depotInstant(date, minute); clock.at = at.toISOString(); setClockForTests(at); };
  const walk = { ruwan, nadeesha, kasun, dilshan, freeze };
  let originalClock: typeof demoDay.$inferSelect;
  beforeAll(async () => {
    originalClock = (await db.select().from(demoDay))[0]!;
    for (const [agent, name] of [[ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [kasun, 'kasun'], [dilshan, 'dilshan']] as const) await signIn(agent, name);
  });
  beforeEach(async () => { await resetDay(); await initClock(); freeze(WED, 900); });
  afterAll(async () => { await resetDay(); await db.update(demoDay).set(originalClock); clock.at = ''; setClockForTests(null); await stop(server); await pool.end(); });
  const read = async (path: string) => {
    const res = await ruwan.get(`/api/v1/lookup/${path}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body;
  };
  return { ...walk, server, road: journey(walk),
    orders: async (query = '') => LookupOrders.parse(await read(`orders${query}`)),
    fleet: async () => LookupFleet.parse(await read('fleet')),
    history: async (query = '') => LookupHistory.parse(await read(`history${query}`)),
    // Publish another day's real board without placing Nadeesha's draft a second time.
    async publish(date: string, outletIds = ['OUT001', 'OUT002']) {
      const board = PlanBoard.parse((await ruwan.get('/api/v1/plans')).body);
      expect(board.day?.date).toBe(date);
      const [driver] = await db.select().from(users).where(eq(users.username, 'dilshan'));
      const trips: DraftTrip[] = [{ vehicleId: 'VEH035', tripNo: 1, leaveAt: null, driverId: driver!.id,
        stops: outletIds.map(outletId => ({ outletId, orderIds: board.orders.filter(order => order.outletId === outletId).map(order => order.id) })) }];
      const on = new Set(trips.flatMap(trip => trip.stops.flatMap(stop => stop.orderIds)));
      const saved = await ruwan.put(`/api/v1/plans/${date}/draft`).send({ planId: board.plan.id, demoDay: board.demoDay,
        ...(board.plan.id ? { revision: board.plan.revision } : {}), plan: { mixBrands: false, trips,
          deferrals: board.orders.filter(order => !on.has(order.id)).map(order => ({ orderId: order.id, code: 'dispatcher_choice', reason: 'Scheduled for a later run.' })) } });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      const draft = PlanBoard.parse(saved.body);
      expect(draft.check!.ok, JSON.stringify(draft.check)).toBe(true);
      const sent = await ruwan.post(`/api/v1/plans/${date}/send`).send({ planId: draft.plan.id, revision: draft.plan.revision });
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
      return PlanBoard.parse(sent.body);
    },
  };
}
