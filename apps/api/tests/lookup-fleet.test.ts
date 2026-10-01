import { PlanCheck } from '@wayfinder/contracts';
import { eq } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';
import { db } from '../src/db/client';
import { fuelLog, plans, trips, vehicles } from '../src/db/schema';
import { depotInstant } from '../src/lib/clock';
import { heldDriverRows } from './driver-plan';
import { code, kandyTrip, sendWalkthroughPlan, THU, WED } from './loading-plan';
import { lookupHarness } from './lookup-plan';
import { FRI } from './operations-plan';
const clock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async original => {
  const actual = await original<typeof import('../src/lib/clock')>();
  return { ...actual, demoClockAt: (...args: Parameters<typeof actual.demoClockAt>) => ({ ...actual.demoClockAt(...args), now: clock.at || actual.demoClockAt(...args).now }) };
});
const h = await lookupHarness(clock);

it('AC-20 fleet uses the calendar day and counts active reefers, vans and days off', async () => {
  h.freeze(THU, 600);
  const day = await h.fleet();
  expect(day).toMatchObject({ today: THU, summary: { active: 38, reefers: 9, vans: 4, recordedOut: 0, notRecordedOut: 38, activeOffToday: 3, activeWithoutOffToday: 35 } });
  expect(day.vehicles.filter(row => row.offReason).map(row => row.id).sort()).toEqual(['VEH003', 'VEH005', 'VEH036']);
  expect(day.vehicles.filter(row => row.type === 'van').every(row => row.group === 'vans')).toBe(true);
  expect(day.vehicles.every(row => row.selectedTrip === null && row.recentTrips.length === 0)).toBe(true);
  const groups = day.vehicles.map(row => row.group);
  expect(groups).toEqual([...groups].sort((a, b) => ['reefer_trucks', 'dry_trucks', 'vans'].indexOf(a) - ['reefer_trucks', 'dry_trucks', 'vans'].indexOf(b)));
});
it('AC-21 recorded departure and return select the second ready trip and older out trips take priority', async () => {
  let trip = await h.road.started();
  const [plan] = await db.select().from(plans).where(eq(plans.date, THU));
  const check = PlanCheck.parse(plan!.sentCheck), first = check.trips[0]!;
  check.trips.push({ ...first, tripNo: 2, times: { ...first.times!, leaveAt: 500, backAt: 600 } });
  await db.update(plans).set({ sentCheck: check }).where(eq(plans.id, plan!.id));
  const [second] = await db.insert(trips).values({ planId: plan!.id, vehicleId: 'VEH035', tripNo: 2, status: 'ready', readyAt: depotInstant(THU, 211) }).returning();
  let day = await h.fleet();
  expect(day.summary.recordedOut).toBe(1);
  expect(day.vehicles.find(row => row.id === 'VEH035')!.selectedTrip!.tripId).toBe(trip.tripId);
  trip = await h.road.write(trip, 'arrive', 214, 1);
  trip = await h.road.write(trip, 'closed', 218, 1);
  trip = await h.road.write(trip, 'arrive', 225, 2);
  trip = await h.road.write(trip, 'closed', 228, 2);
  await h.road.write(trip, 'finish', 240);
  day = await h.fleet();
  expect(day.summary.recordedOut).toBe(0);
  expect(day.vehicles.find(row => row.id === 'VEH035')!.selectedTrip!.tripId).toBe(second!.id);
  // A retained older out report outranks today's ready trip even beyond midnight.
  await db.update(trips).set({ status: 'out', backAt: null }).where(eq(trips.id, trip.tripId));
  h.freeze(FRI, 100);
  const [next] = await db.insert(plans).values({ depotId: 'Peliyagoda', date: FRI, status: 'published', publishedAt: depotInstant(THU, 960), sentCheck: plan!.sentCheck }).returning();
  await db.insert(trips).values({ planId: next!.id, vehicleId: 'VEH035', tripNo: 1, status: 'ready' });
  const vehicle = (await h.fleet()).vehicles.find(row => row.id === 'VEH035')!;
  expect(vehicle).toMatchObject({ recordedOut: true, selectedTrip: { tripId: trip.tripId, date: THU }, todayTrips: [{ date: FRI }], outTrips: [{ tripId: trip.tripId }] });
});
it('AC-22 archiving excludes only the header while keeping the vehicles fuel and out trip', async () => {
  const trip = await h.road.started();
  const [plan] = await db.select().from(plans).where(eq(plans.date, THU));
  const check = PlanCheck.parse(plan!.sentCheck);
  check.trips[0]!.vehicleId = 'VEH003';
  await db.update(plans).set({ sentCheck: check }).where(eq(plans.id, plan!.id));
  await db.update(trips).set({ vehicleId: 'VEH003' }).where(eq(trips.id, trip.tripId));
  try {
    await db.update(vehicles).set({ archivedAt: depotInstant(THU, 600) }).where(eq(vehicles.id, 'VEH003'));
    const day = await h.fleet();
    expect(day.summary).toMatchObject({ active: 37, reefers: 8, vans: 4, activeOffToday: 2, activeWithoutOffToday: 35, recordedOut: 0, notRecordedOut: 37, fuel: { recordedCommitted: 6871.7, quota: 18120 } });
    expect(day.vehicles.find(row => row.id === 'VEH003')).toMatchObject({ archivedAt: depotInstant(THU, 600).toISOString(), recordedOut: true, selectedTrip: { tripId: trip.tripId }, fuel: { recordedCommitted: 76, quota: 480, remaining: 404 } });
  } finally { await db.update(vehicles).set({ archivedAt: null }).where(eq(vehicles.id, 'VEH003')); }
});
it('AC-23 ledger fuel includes the full ISO week once and sent trips only supply km and links', async () => {
  h.freeze(THU, 150);
  const seed = await h.fleet();
  expect(seed.summary.fuel).toMatchObject({ recordedCommitted: 6945, quota: 18600, remaining: 11655, recordedCommittedPct: 37, sentTrips: 0, plannedKm: 0 });
  expect(seed.vehicles.find(row => row.id === 'VEH001')!.fuel).toMatchObject({ recordedCommitted: 300, quota: 340, remaining: 40, sentTrips: 0, plannedKm: 0 });
  expect(seed.summary.fuel!.days.map(row => row.dow)).toEqual([0, 1, 2, 3, 4, 5]);
  const sent = await sendWalkthroughPlan(h);
  const after = await h.fleet();
  expect(after.summary.fuel).toMatchObject({ recordedCommitted: 6947.7, sentTrips: 1 });
  expect(after.summary.fuel!.plannedKm).toBeGreaterThan(0);
  expect((await h.fleet()).summary.fuel).toEqual(after.summary.fuel);
  expect((await h.ruwan.post(`/api/v1/plans/${THU}/unsend`).send({ planId: sent.plan.id, revision: sent.plan.revision })).status).toBe(200);
  expect((await h.fleet()).summary.fuel).toEqual(seed.summary.fuel);
  await db.insert(fuelLog).values({ vehicleId: 'VEH001', date: FRI, litres: '1.1' });
  expect((await h.fleet()).vehicles.find(row => row.id === 'VEH001')!.fuel).toMatchObject({ recordedCommitted: 301.1, remaining: 38.9 });
});
it('AC-24 zero quota has null percentages, over-quota stays negative and an unknown week is unavailable', async () => {
  try {
    await db.update(vehicles).set({ weeklyFuelQuotaL: 0 }).where(eq(vehicles.id, 'VEH001'));
    expect((await h.fleet()).vehicles.find(row => row.id === 'VEH001')!.fuel).toMatchObject({ remaining: -300, recordedCommittedPct: null, remainingPct: null });
    await db.update(vehicles).set({ weeklyFuelQuotaL: 100 }).where(eq(vehicles.id, 'VEH001'));
    expect((await h.fleet()).vehicles.find(row => row.id === 'VEH001')!.fuel).toMatchObject({ remaining: -200, recordedCommittedPct: 300, remainingPct: -200 });
    h.freeze('2026-06-29', 600);
    const day = await h.fleet();
    expect(day.summary.fuel).toBeNull();
    expect(day.vehicles.every(row => row.fuel === null)).toBe(true);
  } finally { await db.update(vehicles).set({ weeklyFuelQuotaL: 340 }).where(eq(vehicles.id, 'VEH001')); }
});
it('AC-2 and AC-3 fleet is depot scoped, read only and accepts no alternative date or scope', async () => {
  await kandyTrip();
  const before = await heldDriverRows();
  for (const query of ['?date=2026-06-25', '?depotId=Kandy', '?range=next_six_weeks']) expect(code(await h.ruwan.get(`/api/v1/lookup/fleet${query}`))).toEqual([400, 'invalid_input']);
  expect((await h.fleet()).vehicles.some(row => row.id === 'VEH044')).toBe(false);
  expect(await heldDriverRows()).toEqual(before);
});
it('AC-21 and AC-23 latest five sent links are bounded and the last returned trip remains selected', async () => {
  await sendWalkthroughPlan(h);
  const [plan] = await db.select().from(plans).where(eq(plans.date, THU));
  const expected: string[] = [];
  for (const date of ['2026-06-18', '2026-06-19', '2026-06-20']) {
    const check = PlanCheck.parse(plan!.sentCheck);
    check.trips.push({ ...check.trips[0]!, tripNo: 2 });
    const [past] = await db.insert(plans).values({ depotId: 'Peliyagoda', date, status: 'published', publishedAt: depotInstant(date, 120), sentCheck: check }).returning();
    for (const tripNo of [1, 2]) {
      const [trip] = await db.insert(trips).values({ planId: past!.id, vehicleId: 'VEH035', tripNo, status: 'done', backAt: depotInstant(date, 600 + tripNo) }).returning();
      expected.unshift(trip!.id);
    }
  }
  const today = (await h.fleet()).vehicles.find(row => row.id === 'VEH035')!.selectedTrip!;
  await db.update(trips).set({ status: 'done', backAt: depotInstant(THU, 600) }).where(eq(trips.id, today.tripId));
  const vehicle = (await h.fleet()).vehicles.find(row => row.id === 'VEH035')!;
  expect(vehicle.recentTrips.map(row => row.tripId)).toEqual([today.tripId, ...expected].slice(0, 5));
  expect(vehicle.selectedTrip).toMatchObject({ tripId: today.tripId, status: 'done', backAt: depotInstant(THU, 600).toISOString() });
  expect(vehicle.fuel!.sentTrips).toBe(1);
});
