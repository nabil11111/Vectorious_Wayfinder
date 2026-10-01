import { PlanBoard } from '@wayfinder/contracts';
import { eq } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';
import { db } from '../src/db/client';
import { deferrals, orders, plans } from '../src/db/schema';
import { heldDriverRows } from './driver-plan';
import { code, kandyTrip, sendWalkthroughPlan, THU, WED } from './loading-plan';
import { lookupHarness } from './lookup-plan';
import { FRI, photo } from './operations-plan';
const clock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async original => {
  const actual = await original<typeof import('../src/lib/clock')>();
  return { ...actual, demoClockAt: (...args: Parameters<typeof actual.demoClockAt>) => ({ ...actual.demoClockAt(...args), now: clock.at || actual.demoClockAt(...args).now }) };
});
const h = await lookupHarness(clock);

it('AC-4 AC-5 and AC-35 keep all five loaded orders through delivery and an unanswered closed stop', async () => {
  let trip = await h.road.ready();
  const check = async (loaded: number, delivered: number) => {
    const day = await h.orders('?date=' + THU);
    expect(day.summary).toEqual({ orders: 104, planned: 5, deferred: 99, carriedOver: 4, split: 0 });
    expect(day.rows.filter(row => row.status === 'loaded')).toHaveLength(loaded);
    expect(day.rows.filter(row => row.status === 'delivered')).toHaveLength(delivered);
    const onTruck = day.rows.filter(row => row.days[0]!.assignment);
    expect(onTruck).toHaveLength(5);
    for (const row of onTruck) {
      expect(row.days[0]!.assignment).toMatchObject({ tripId: trip.tripId, vehicleId: 'VEH035',
        stopId: trip.stops.find(stop => stop.outletId === row.outlet.id)!.id });
    }
    const range = await h.orders('?date=' + THU + '&range=four_weeks');
    expect(range.summary).toMatchObject({ orders: 129, planned: 5, deferred: 100 });
    expect(range.rows.filter(row => row.days.some(day => day.date === THU && day.assignment))).toHaveLength(5);
  };
  await check(5, 0);
  trip = await h.road.write(trip, 'start', 211);
  trip = await h.road.write(trip, 'arrive', 214, 1);
  trip = await h.road.write(trip, 'deliver', 218, 1, { photo });
  await check(2, 3);
  trip = await h.road.write(trip, 'arrive', 225, 2);
  trip = await h.road.write(trip, 'closed', 228, 2, { photo });
  expect(trip.problems.find(problem => problem.kind === 'closed')!.decision).toBeNull();
  await check(2, 3);
});

it.each([
  { name: 'carried over', outletId: 'OUT030', wanted: WED, carriedOver: 5 },
  { name: 'wanted that day', outletId: 'OUT003', wanted: THU, carriedOver: 4 },
])('AC-4 AC-7 and AC-8 keep a deferred $name original through parts split on Fridays board', async ({ outletId, wanted, carriedOver }) => {
  const sent = await sendWalkthroughPlan(h), before = await h.orders('?date=' + THU);
  const original = before.rows.find(row => row.outlet.id === outletId && row.wantedDate === wanted)!;
  const oldDay = original.days[0]!;
  expect(oldDay.deferral).not.toBeNull();
  h.freeze(THU, 960);
  const board = PlanBoard.parse((await h.ruwan.get('/api/v1/plans')).body);
  expect(board.day!.date).toBe(FRI);
  const split = await h.ruwan.post(`/api/v1/plans/${FRI}/split`).send({ planId: board.plan.id, demoDay: board.demoDay,
    orderId: original.id, keep: [{ productId: original.lines[0]!.productId, quantity: Math.floor(original.lines[0]!.quantity / 2) }] });
  expect(split.status, JSON.stringify(split.body)).toBe(200);
  const day = await h.orders('?date=' + THU), parts = day.rows.filter(row => row.splitFrom === original.id);
  expect(day.summary).toEqual({ orders: 105, planned: 5, deferred: 99, carriedOver, split: 2 });
  expect(day.rows.some(row => row.id === original.id)).toBe(false);
  expect(parts).toHaveLength(2);
  // Two leaves keep the one original publication deferral; the header counts its stored order id once.
  expect(day.rows.filter(row => row.days[0]!.deferral)).toHaveLength(100);
  for (const part of parts) {
    expect(part.days).toEqual([oldDay]);
    expect(part.original).toMatchObject({ id: original.id, status: 'split', lines: original.lines, load: original.load });
    expect(part.parts).toHaveLength(2);
    expect(part.deferralHistory.filter(row => row.planId === sent.plan.id)).toEqual([{ ...oldDay.deferral!, planId: sent.plan.id, date: THU }]);
  }
  const range = await h.orders('?date=' + THU + '&range=four_weeks');
  expect(range.summary).toMatchObject({ orders: 130, planned: 5, deferred: 100 });
  for (const part of parts) expect(range.rows.find(row => row.id === part.id)!.days.find(day => day.date === THU)).toEqual(oldDay);
});


it('AC-4 seeded delivery day keeps wanted and carried orders and its own publication counts', async () => {
  expect(await h.orders()).toMatchObject({ date: THU, summary: { orders: 102, planned: 0, deferred: 0, carriedOver: 4, split: 0 } });
  const sent = await sendWalkthroughPlan(h);
  const before = await heldDriverRows(), day = await h.orders();
  expect(day.summary).toEqual({ orders: 104, planned: 5, deferred: 99, carriedOver: 4, split: 0 });
  expect(day.rows.filter(row => row.days[0]!.assignment)).toHaveLength(5);
  expect(day.rows.find(row => row.outlet.id === 'OUT001' && row.wantedDate === WED)).toMatchObject({ days: [{ carriedOver: true, publication: { id: sent.plan.id, date: THU } }] });
  expect(day.rows.every(row => row.status !== 'draft' && row.status !== 'split')).toBe(true);
  expect(await heldDriverRows()).toEqual(before);
  expect((await h.ruwan.post(`/api/v1/plans/${THU}/unsend`).send({ planId: sent.plan.id, revision: sent.plan.revision })).status).toBe(200);
  expect((await h.orders()).summary).toEqual({ orders: 104, planned: 0, deferred: 0, carriedOver: 4, split: 0 });
  h.freeze(THU, 210);
  expect((await h.orders()).date).toBe(FRI);
  expect((await h.orders(`?date=${THU}`)).summary!.orders).toBe(104);
  h.freeze('2026-06-29', 600);
  expect(await h.orders()).toMatchObject({ date: null, from: null, summary: null, rows: [], skippedLately: null });
});
it('AC-5 four weeks unions delivery memberships once and includes received seed history', async () => {
  const before = await h.orders('?range=four_weeks');
  expect(before).toMatchObject({ date: THU, from: '2026-05-29', summary: { orders: 127 } });
  expect(before.rows.filter(row => row.status === 'received')).toHaveLength(25);
  await sendWalkthroughPlan(h);
  const after = await h.orders('?range=four_weeks');
  expect(after.summary).toMatchObject({ orders: 129, planned: 5, deferred: 100 });
  expect(new Set(after.rows.map(row => row.id)).size).toBe(129);
  expect(after.rows.find(row => row.wantedDate === WED && row.outlet.id === 'OUT001')!.days.map(day => day.date)).toEqual([WED, THU]);
});
it('AC-7 splitting counts leaves with original detail and one inherited deferral per plan, joining restores the original', async () => {
  h.freeze(WED, 960);
  let board = PlanBoard.parse((await h.ruwan.get('/api/v1/plans')).body);
  const original = board.orders.find(row => row.outletId === 'OUT001' && row.deliveryDate === WED)!;
  const split = await h.ruwan.post(`/api/v1/plans/${THU}/split`).send({ planId: null, demoDay: board.demoDay, orderId: original.id, keep: [{ productId: original.lines[0]!.productId, quantity: 6 }] });
  expect(split.status, JSON.stringify(split.body)).toBe(200);
  board = PlanBoard.parse(split.body);
  const day = await h.orders(), parts = day.rows.filter(row => row.splitFrom === original.id);
  expect(day.summary).toMatchObject({ orders: 103, split: 2 });
  expect(day.rows.some(row => row.id === original.id)).toBe(false);
  expect(parts).toHaveLength(2);
  // Leaf totals omit the parent; the old publication still deferred its stored order id once.
  expect((await h.orders('?range=four_weeks')).summary!.deferred).toBe(4);
  for (const part of parts) {
    expect(part.original).toMatchObject({ id: original.id, status: 'split', load: { units: 12 } });
    expect(part.parts).toHaveLength(2);
    expect(part.timesDeferred).toBe(1);
    expect(part.deferralHistory).toHaveLength(1);
  }
  const [past] = await db.select().from(plans).where(eq(plans.date, WED));
  await db.insert(deferrals).values({ planId: past!.id, orderId: parts[0]!.id, code: 'dispatcher_choice', reason: 'Own reason wins.' });
  const inherited = (await h.orders()).rows.find(row => row.id === parts[0]!.id)!;
  expect(inherited.timesDeferred).toBe(1);
  expect(inherited.deferralHistory[0]!.reason).toBe('Own reason wins.');
  expect((await h.orders()).skippedLately!.rows.find(row => row.outlet.id === 'OUT001')!.count).toBe(1);
  await db.delete(deferrals).where(eq(deferrals.orderId, parts[0]!.id));
  const joined = await h.ruwan.post(`/api/v1/plans/${THU}/join`).send({ planId: board.plan.id, revision: board.plan.revision, orderId: original.id });
  expect(joined.status, JSON.stringify(joined.body)).toBe(200);
  expect((await h.orders()).summary).toMatchObject({ orders: 102, split: 0 });
});
it('AC-8 later publication keeps Thursdays own links and deferrals', async () => {
  const sent = await sendWalkthroughPlan(h);
  const before = await h.orders(`?date=${THU}`);
  h.freeze(THU, 960);
  await h.publish(FRI, ['OUT030']);
  const after = await h.orders(`?date=${THU}`);
  expect(after.rows.map(row => ({ id: row.id, days: row.days }))).toEqual(before.rows.map(row => ({ id: row.id, days: row.days })));
  expect(after.summary).toEqual(before.summary);
  expect(after.rows.every(row => row.days[0]!.publication?.id === sent.plan.id)).toBe(true);
  const range = await h.orders(`?date=${FRI}&range=four_weeks`);
  const repeated = range.rows.find(row => row.outlet.id === 'OUT030' && row.wantedDate === WED)!;
  expect(repeated.days.filter(day => [THU, FRI].includes(day.date)).map(day => [day.date, Boolean(day.assignment), Boolean(day.deferral)])).toEqual([[THU, false, true], [FRI, true, false]]);
});
it('AC-37 skipped shops count each published plan once across temperatures and split parts', async () => {
  const initial = (await h.orders()).skippedLately!;
  expect(initial.rows.map(row => [row.outlet.id, row.count])).toEqual([['OUT060', 2], ['OUT001', 1], ['OUT030', 1], ['OUT054', 1]]);
  const sent = await sendWalkthroughPlan(h);
  const skipped = (await h.orders()).skippedLately!;
  expect(skipped.rows.find(row => row.outlet.id === 'OUT060')!.count).toBe(3);
  expect(skipped.rows.find(row => row.outlet.id === 'OUT003')!.count).toBe(1);
  expect((await h.orders('?range=four_weeks')).skippedLately).toEqual(skipped);
  await db.update(orders).set({ status: 'received' }).where(eq(orders.outletId, 'OUT060'));
  expect((await h.orders()).skippedLately).toEqual(skipped);
  expect((await h.ruwan.post(`/api/v1/plans/${THU}/unsend`).send({ planId: sent.plan.id, revision: sent.plan.revision })).status).toBe(200);
  expect((await h.orders()).skippedLately).toEqual(initial);
});
it('AC-2 and AC-3 orders reject alternate scopes and malformed ranges and keep foreign details out', async () => {
  await kandyTrip();
  const before = await heldDriverRows();
  for (const query of ['?date=2026-02-30', '?date=bad', '?range=year', '?date=2026-06-25&date=2026-06-26', '?depotId=Kandy', '?search=Fresh', '?filter=split']) {
    expect(code(await h.ruwan.get(`/api/v1/lookup/orders${query}`))).toEqual([400, 'invalid_input']);
  }
  const day = await h.orders();
  expect(day.rows.some(row => row.outlet.id === 'OUT076')).toBe(false);
  expect((await h.orders('?date=2025-01-01')).rows).toEqual([]);
  expect(await heldDriverRows()).toEqual(before);
});
