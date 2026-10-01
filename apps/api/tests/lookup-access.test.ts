import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, expect, it, vi } from 'vitest';
import { db } from '../src/db/client';
import { photos, plans, users } from '../src/db/schema';
import { depotInstant } from '../src/lib/clock';
import { driverStop, heldDriverRows } from './driver-plan';
import { code, kandyTrip, signIn, THU } from './loading-plan';
import { lookupHarness } from './lookup-plan';
import { jpeg, photo } from './receipt-plan';
import { decide, photo as driverProof } from './operations-plan';
const clock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async original => {
  const actual = await original<typeof import('../src/lib/clock')>();
  return { ...actual, demoClockAt: (...args: Parameters<typeof actual.demoClockAt>) => ({ ...actual.demoClockAt(...args), now: clock.at || actual.demoClockAt(...args).now }) };
});
const h = await lookupHarness(clock), admin = request.agent(h.server);

it.each(['orders?date=0000-01-01', 'history?date=0000-06-01',
  'orders?date=0001-01-10&range=four_weeks', 'orders?date=0001-01-10'])(
  'AC-3 refuses dates outside the database calendar including the skipped-shop window: %s', async path => {
    const before = await heldDriverRows();
    expect(code(await h.ruwan.get('/api/v1/lookup/' + path))).toEqual([400, 'invalid_input']);
    expect(await heldDriverRows()).toEqual(before);
  });
it('AC-3 accepts the first supported history day and complete 28-day order window', async () => {
  expect(await h.history('?date=0001-01-01')).toMatchObject({ date: '0001-01-01', publication: null, counts: null, trips: [] });
  for (const range of ['day', 'four_weeks']) {
    expect(await h.orders('?date=0001-01-28&range=' + range)).toMatchObject({ date: '0001-01-28',
      from: range === 'day' ? '0001-01-28' : '0001-01-01', rows: [], skippedLately: { from: '0001-01-01', to: '0001-01-28', rows: [] } });
  }
});

beforeAll(async () => { await signIn(admin, 'admin'); });

it('AC-1 lookup requires dispatcher and depot checks on every GET without writes', async () => {
  const before = await heldDriverRows();
  for (const path of ['orders', 'history', 'fleet', 'stops/' + randomUUID() + '/photo']) {
    const url = '/api/v1/lookup/' + path;
    expect(code(await request(h.server).get(url))).toEqual([401, 'signed_out']);
    for (const agent of [h.nadeesha, h.kasun, h.dilshan]) expect(code(await agent.get(url))).toEqual([403, 'forbidden']);
    expect(code(await admin.get(url))).toEqual([403, 'no_depot']);
  }
  expect(await heldDriverRows()).toEqual(before);
});
it('AC-2 lists inline details and proof stay inside the depot, with absent and decided problem photos', async () => {
  let trip = await h.road.wellawatte();
  const own = driverStop(trip, 1).id, absent = driverStop(trip, 2).id;
  const foreign = await kandyTrip(), [driver] = await db.select().from(users).where(eq(users.username, 'dilshan'));
  await db.insert(photos).values({ id: randomUUID(), stopId: foreign.stop.id, takenBy: driver!.id, takenAt: depotInstant(THU, 220), jpeg });
  const before = await heldDriverRows();
  expect((await h.orders('?date=' + THU)).rows.some(row => row.outlet.id === 'OUT076')).toBe(false);
  expect((await h.history('?date=' + THU)).trips.some(row => row.tripId === foreign.trip.id)).toBe(false);
  expect((await h.fleet()).vehicles.some(row => row.id === 'VEH044')).toBe(false);
  for (const id of [foreign.stop.id, randomUUID()]) expect(code(await h.ruwan.get('/api/v1/lookup/stops/' + id + '/photo'))).toEqual([400, 'unknown_record']);
  expect(code(await h.ruwan.get('/api/v1/lookup/stops/' + absent + '/photo'))).toEqual([404, 'not_found']);
  const proof = await h.ruwan.get('/api/v1/lookup/stops/' + own + '/photo');
  expect(proof.status).toBe(200);
  // Journey's proof bytes are checked against its metadata's fixed route, without a public URL.
  expect(proof.type).toBe('image/jpeg');
  expect(proof.body).toEqual(Buffer.from(driverProof.split(',')[1]!, 'base64'));
  expect(await heldDriverRows()).toEqual(before);
  trip = await h.road.write(trip, 'closed', 228, 2, { photo });
  const problem = trip.problems.find(row => row.kind === 'closed')!;
  await decide(h.ruwan, problem.id, 'bring_back');
  const image = await h.ruwan.get('/api/v1/issues/' + problem.id + '/photo');
  expect(image.status).toBe(200);
  expect(image.body).toEqual(jpeg);
  const [plan] = await db.select().from(plans).where(and(eq(plans.date, THU), eq(plans.depotId, 'Peliyagoda')));
  await db.update(plans).set({ status: 'draft' }).where(eq(plans.id, plan!.id));
  expect(code(await h.ruwan.get('/api/v1/lookup/stops/' + own + '/photo'))).toEqual([400, 'unknown_record']);
  expect(await h.history('?date=' + THU)).toMatchObject({ publication: null, counts: null, trips: [] });
});
it('AC-3 lookup validates dates ranges proof ids and every unknown or repeated query without writes', async () => {
  const before = await heldDriverRows();
  for (const path of ['orders?date=bad', 'orders?date=2026-02-30', 'orders?range=week', 'orders?date=2026-06-25&date=2026-06-26',
    'orders?depot=Kandy', 'history?date=2026-02-30', 'history?date=2026-06-25&date=2026-06-26', 'history?planId=' + randomUUID(),
    'history?depotId=Kandy', 'fleet?depotId=Kandy', 'fleet?date=2026-06-25', 'stops/not-a-uuid/photo', 'stops/' + randomUUID() + '/photo?depot=Kandy']) {
    expect(code(await h.ruwan.get('/api/v1/lookup/' + path))).toEqual([400, 'invalid_input']);
  }
  expect(await h.history('?date=2025-02-28')).toMatchObject({ publication: null, counts: null, trips: [] });
  expect((await h.orders('?date=2025-02-28')).rows).toEqual([]);
  expect(await h.orders('?date=9999-12-31')).toMatchObject({ date: '9999-12-31', summary: { orders: 102, carriedOver: 102 } });
  expect(await heldDriverRows()).toEqual(before);
});
