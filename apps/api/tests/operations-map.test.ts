import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { demoDay, outlets, stops, trips } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { driverStop } from './driver-plan';
import { resetDay, signIn, THU, WED } from './loading-plan';
import { journey, operations } from './operations-plan';
import { serve, stop } from './serve';
const clock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async original => {
  const actual = await original<typeof import('../src/lib/clock')>();
  return { ...actual, demoClockAt: (...args: Parameters<typeof actual.demoClockAt>) => ({ ...actual.demoClockAt(...args), now: clock.at || actual.demoClockAt(...args).now }) };
});
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

// Spec 019's table (AC-2): Peliyagoda's 75 shops in its 7 districts, by name. Fresh Nugegoda (OUT001) and Fresh
// Wellawatte (OUT002) are two of Colombo's 24.
const PELIYAGODA = [['Colombo', 24], ['Galle', 9], ['Gampaha', 15], ['Kalutara', 10], ['Kurunegala', 8], ['Matara', 6], ['Puttalam', 3]] as const;
const mapWith = (colombo: number | null, others: number | null = 0, shopsIn: Partial<Record<string, number>> = {}) => {
  const districts = PELIYAGODA.map(([district, shops]) => ({ district, shops: shopsIn[district] ?? shops, shopsDelivered: district === 'Colombo' ? colombo : others }));
  return { shops: districts.reduce((n, row) => n + row.shops, 0), districts };
};

it('AC-2 the seeded day at Trucks leave has 75 Peliyagoda shops in 7 districts and none delivered', async () => {
  freeze(THU, 210);
  const seeded = await read();
  expect(seeded.plan).toBeNull();
  expect(seeded.map).toEqual(mapWith(0));
});

it('AC-2 the walkthrough truck ready at Trucks leave delivers no shop yet', async () => {
  await road.ready();
  const day = await read();
  expect(day.readAt).toBe(depotInstant(THU, 210).toISOString());
  expect(day.counts).toMatchObject({ stopsTotal: 2, stopsDelivered: 0 });
  expect(day.map).toEqual(mapWith(0));
});

it('AC-1 AC-2 Nugegoda delivered and Wellawatte refusing part of its drop make two Colombo shops delivered', async () => {
  const trip = await road.wellawatte();
  const arrived = await read();
  expect(arrived.counts.stopsDelivered).toBe(1);
  expect(arrived.map).toEqual(mapWith(1));
  const chilled = driverStop(trip, 2).lines.find(line => line.temp === 'chilled')!;
  await road.write(trip, 'refuse', 228, 2, { reason: 'damaged', note: '', lines: [{ lineId: chilled.lineId, refused: 2 }] });
  const day = await read();
  // The tile and the map count the same stops: each of these shops had one stop today.
  expect(day.counts).toMatchObject({ stopsDelivered: 2, partialStops: 1 });
  expect(day.map).toEqual(mapWith(2));
});

it('AC-2 a drop refused in full does not count', async () => {
  const trip = await road.wellawatte();
  await road.write(trip, 'refuse', 228, 2, { reason: 'damaged', note: '', lines: driverStop(trip, 2).lines.map(line => ({ lineId: line.lineId, refused: line.loaded })) });
  const day = await read();
  expect(day.counts).toMatchObject({ stopsDelivered: 1, noGoodsStops: 1 });
  expect(day.map).toEqual(mapWith(1));
});

it('AC-1 a closed shop does not count', async () => {
  await road.write(await road.wellawatte(), 'closed', 228, 2);
  const day = await read();
  expect(day.counts).toMatchObject({ stopsDelivered: 1, closedStops: 1 });
  expect(day.map).toEqual(mapWith(1));
});

it('AC-1 a plan whose stop details were not recorded leaves every district delivered count unknown', async () => {
  freeze(WED, 900);
  const legacyDay = await read();
  expect(legacyDay.plan).toMatchObject({ detailRecorded: false });
  expect(legacyDay.map).toEqual(mapWith(0));
  const [trip] = await db.insert(trips).values({ planId: legacyDay.plan!.id, vehicleId: 'VEH035', tripNo: 1 }).returning();
  await db.insert(stops).values({ tripId: trip!.id, seq: 1, outletId: 'OUT001' });
  const day = await read();
  expect(day.counts.stopsDelivered).toBeNull();
  expect(day.map).toEqual(mapWith(null, null));
});

it('AC-1 the map counts only the depot active shops', async () => {
  const trip = await road.wellawatte();
  const chilled = driverStop(trip, 2).lines.find(line => line.temp === 'chilled')!;
  await road.write(trip, 'refuse', 228, 2, { reason: 'damaged', note: '', lines: [{ lineId: chilled.lineId, refused: 2 }] });
  try {
    // Kotahena has no stop today; Wellawatte was delivered before it was archived.
    await db.update(outlets).set({ archivedAt: depotInstant(THU, 229) }).where(eq(outlets.id, 'OUT003'));
    expect((await read()).map).toEqual(mapWith(2, 0, { Colombo: 23 }));
    await db.update(outlets).set({ archivedAt: depotInstant(THU, 229) }).where(eq(outlets.id, 'OUT002'));
    expect((await read()).map).toEqual(mapWith(1, 0, { Colombo: 22 }));
  } finally {
    for (const id of ['OUT002', 'OUT003']) await db.update(outlets).set({ archivedAt: null }).where(eq(outlets.id, id));
  }
});
