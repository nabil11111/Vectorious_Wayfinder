import { eq } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';
import { db } from '../src/db/client';
import { auditLog, users } from '../src/db/schema';
import { depotInstant } from '../src/lib/clock';
import { driverStop, driverTrip } from './driver-plan';
import { answeredTruck, answerFlag, loaderScreen, sendWalkthroughPlan, THU, truckOf } from './loading-plan';
import { lookupHarness } from './lookup-plan';
import { decide, FRI, photo } from './operations-plan';
import { jpeg, receiptOf, shopScreen } from './receipt-plan';
const clock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async original => {
  const actual = await original<typeof import('../src/lib/clock')>();
  return { ...actual, demoClockAt: (...args: Parameters<typeof actual.demoClockAt>) => ({ ...actual.demoClockAt(...args), now: clock.at || actual.demoClockAt(...args).now }) };
});
const h = await lookupHarness(clock), read = () => h.history('?date=' + THU);

it('AC-14 a Thursdays loading problem keeps its own counts after Fridays reload delivery and receipt', async () => {
  await sendWalkthroughPlan(h);
  const loader = loaderScreen(h.kasun), day = await loader.read();
  let truck = answeredTruck(await loader.start(truckOf(day, 'VEH035'), day.plan!), 'VEH035');
  const chilled = truck.stops.find(stop => stop.seq === 2)!.lines.find(line => line.temp === 'chilled')!;
  expect(chilled.quantity).toBe(48);
  truck = answeredTruck(await loader.flag(truck, 2, [{ lineId: chilled.lineId, counted: 47 }]), 'VEH035');
  const loadingProblemId = truck.issues[0]!.id;
  await answerFlag(h.ruwan, loadingProblemId, 'go_short');
  truck = truckOf(await loader.read(), 'VEH035');
  truck = answeredTruck(await loader.stopLoaded(truck, 2), 'VEH035');
  truck = answeredTruck(await loader.stopLoaded(truck, 1), 'VEH035');
  answeredTruck(await loader.ready(truck), 'VEH035');
  let trip = driverTrip(await h.road.driver.read());
  trip = await h.road.write(trip, 'start', 211);
  trip = await h.road.write(trip, 'arrive', 214, 1);
  trip = await h.road.write(trip, 'deliver', 218, 1, { photo });
  trip = await h.road.write(trip, 'arrive', 225, 2);
  trip = await h.road.write(trip, 'closed', 228, 2, { photo });
  await decide(h.ruwan, trip.problems.find(row => row.kind === 'closed')!.id, 'bring_back');
  await h.road.write(driverTrip(await h.road.driver.read()), 'finish', 235);
  const old = (await read()).trips[0]!.stops[1]!;
  expect(old.lines.find(row => row.lineId === chilled.lineId)).toMatchObject({ loaded: 47, delivered: null, received: null });

  h.freeze(THU, 960);
  await h.publish(FRI, ['OUT002']);
  h.freeze(FRI, 150);
  const friday = await loader.read();
  truck = answeredTruck(await loader.start(truckOf(friday, 'VEH035'), friday.plan!), 'VEH035');
  truck = answeredTruck(await loader.stopLoaded(truck, 1), 'VEH035');
  answeredTruck(await loader.ready(truck), 'VEH035');
  trip = driverTrip(await h.road.driver.read());
  trip = await h.road.write(trip, 'start', 211, undefined, {}, FRI);
  trip = await h.road.write(trip, 'arrive', 214, 1, {}, FRI);
  trip = await h.road.write(trip, 'deliver', 218, 1, { photo }, FRI);
  const [manager] = await db.select().from(users).where(eq(users.username, 'nadeesha'));
  try {
    await db.update(users).set({ outletId: 'OUT002' }).where(eq(users.id, manager!.id));
    h.freeze(FRI, 513);
    const shop = shopScreen(h.nadeesha), delivery = await shop.one(driverStop(trip, 1).id);
    const result = await shop.send(receiptOf(delivery, [40, 46], { reason: 'missing', at: depotInstant(FRI, 511).toISOString() }));
    expect(result.status, JSON.stringify(result.body)).toBe(200);
  } finally { await db.update(users).set({ outletId: manager!.outletId }).where(eq(users.id, manager!.id)); }
  const current = (await h.history('?date=' + FRI)).trips[0]!.stops[0]!;
  expect(current.lines.find(row => row.lineId === chilled.lineId)).toMatchObject({ loaded: 48, delivered: 48, received: 40 });
  const historical = (await read()).trips[0]!.stops[1]!;
  expect(historical.problems.find(row => row.id === loadingProblemId)!.lines).toMatchObject([
    { lineId: chilled.lineId, counted: 47, loaded: 47, delivered: null, received: null },
  ]);
  expect(historical).toEqual(old);
});


it('AC-14 and AC-8 Fridays reload and receipt cannot rewrite Thursdays 94 closed cartons or membership', async () => {
  let trip = await h.road.write(await h.road.wellawatte(), 'closed', 228, 2, { photo });
  const oldStop = driverStop(trip, 2), problem = trip.problems.find(row => row.kind === 'closed')!;
  await decide(h.ruwan, problem.id, 'bring_back');
  trip = driverTrip(await h.road.driver.read());
  await h.road.write(trip, 'finish', 235);
  const old = (await read()).trips[0]!.stops[1]!, oldOrders = await h.orders('?date=' + THU);
  h.freeze(THU, 960);
  await h.publish(FRI, ['OUT002']);
  const membership = await h.orders('?date=' + THU);
  expect(membership.summary).toEqual(oldOrders.summary);
  expect(membership.rows.map(row => [row.id, row.days])).toEqual(oldOrders.rows.map(row => [row.id, row.days]));
  const range = await h.orders('?date=' + FRI + '&range=four_weeks');
  for (const id of new Set(oldStop.lines.map(line => line.orderId))) {
    expect(range.rows.find(row => row.id === id)!.days.filter(day => day.assignment).map(day => day.date)).toEqual([THU, FRI]);
  }

  h.freeze(FRI, 150);
  const loader = loaderScreen(h.kasun), day = await loader.read();
  let truck = answeredTruck(await loader.start(truckOf(day, 'VEH035'), day.plan!), 'VEH035');
  const chilled = truck.stops[0]!.lines.find(line => line.temp === 'chilled')!;
  truck = answeredTruck(await loader.flag(truck, 1, [{ lineId: chilled.lineId, counted: 47 }]), 'VEH035');
  await answerFlag(h.ruwan, truck.issues[0]!.id, 'go_short');
  truck = truckOf(await loader.read(), 'VEH035');
  truck = answeredTruck(await loader.stopLoaded(truck, 1), 'VEH035');
  answeredTruck(await loader.ready(truck), 'VEH035');
  trip = driverTrip(await h.road.driver.read());
  trip = await h.road.write(trip, 'start', 211, undefined, {}, FRI);
  trip = await h.road.write(trip, 'arrive', 214, 1, {}, FRI);
  trip = await h.road.write(trip, 'deliver', 218, 1, { photo }, FRI);
  // A test-only account assignment supplies the seeded outlet without a second sign-in.
  const [manager] = await db.select().from(users).where(eq(users.username, 'nadeesha'));
  try {
    await db.update(users).set({ outletId: 'OUT002' }).where(eq(users.id, manager!.id));
    h.freeze(FRI, 513);
    const shop = shopScreen(h.nadeesha), delivery = await shop.one(driverStop(trip, 1).id);
    const write = receiptOf(delivery, [47, 46], { at: depotInstant(FRI, 511).toISOString() });
    expect((await shop.send(write)).status).toBe(200);
  } finally { await db.update(users).set({ outletId: manager!.outletId }).where(eq(users.id, manager!.id)); }
  const current = await h.history('?date=' + FRI);
  expect(current.trips[0]!.stops[0]!.receipt).toMatchObject({ received: 93, orderCount: 2 });
  const historical = (await read()).trips[0]!.stops[1]!;
  expect(historical).toEqual(old);
  expect(historical).toMatchObject({ receipt: null, stages: { loaded: { units: 94 }, handedOver: { units: null }, received: { units: null }, notDelivered: { units: 94 } }, attempts: [{ notDelivered: 94, decision: 'bring_back' }] });
});
it('AC-15 retry keeps each issues own time counts photo and answer without audit arrival recovery', async () => {
  const different = Buffer.from(jpeg); different[different.length - 3] = 1;
  const secondPhoto = 'data:image/jpeg;base64,' + different.toString('base64');
  let trip = await h.road.write(await h.road.wellawatte(), 'closed', 228, 2, { photo, note: 'First visit' });
  const first = trip.problems.find(row => row.kind === 'closed')!;
  h.freeze(THU, 229); await decide(h.ruwan, first.id, 'try_again');
  trip = driverTrip(await h.road.driver.read());
  trip = await h.road.write(trip, 'arrive', 230, 2);
  trip = await h.road.write(trip, 'closed', 232, 2, { photo: secondPhoto, note: 'Second visit' });
  const second = trip.problems.find(row => row.kind === 'closed' && row.id !== first.id)!;
  h.freeze(THU, 233); await decide(h.ruwan, second.id, 'try_again');
  trip = driverTrip(await h.road.driver.read());
  trip = await h.road.write(trip, 'arrive', 234, 2);
  trip = await h.road.write(trip, 'deliver', 238, 2, { photo });
  await db.delete(auditLog).where(eq(auditLog.entityId, driverStop(trip, 2).id));
  const day = await read(), stop = day.trips[0]!.stops[1]!;
  expect(stop.attempts.map(attempt => ({ id: attempt.issueId, at: attempt.raisedAt, note: attempt.note, units: attempt.notDelivered, answer: attempt.decidedAt, photo: attempt.photo }))).toEqual([
    { id: first.id, at: depotInstant(THU, 228).toISOString(), note: 'First visit', units: 94, answer: depotInstant(THU, 229).toISOString(), photo: { kind: 'issue', issueId: first.id, takenAt: depotInstant(THU, 228).toISOString() } },
    { id: second.id, at: depotInstant(THU, 232).toISOString(), note: 'Second visit', units: 94, answer: depotInstant(THU, 233).toISOString(), photo: { kind: 'issue', issueId: second.id, takenAt: depotInstant(THU, 232).toISOString() } },
  ]);
  expect(stop).toMatchObject({ arrivedAt: depotInstant(THU, 234).toISOString(), doneAt: depotInstant(THU, 238).toISOString(), outcome: 'delivered', flags: { returned: false } });
  expect(day.counts).toMatchObject({ stops: 2, delivered: 2, returned: 0 });
  for (const attempt of stop.attempts) {
    expect(attempt.lines.map(line => line.counted)).toEqual([48, 46]);
    expect(stop.problems.find(problem => problem.id === attempt.issueId)!.lines.map(line => ({
      counted: line.counted, loaded: line.loaded, delivered: line.delivered, received: line.received,
    }))).toEqual([48, 46].map(counted => ({ counted, loaded: counted, delivered: null, received: null })));
    expect(attempt).not.toHaveProperty('arrivedAt');
    expect(attempt).not.toHaveProperty('receipt');
  }
  const answer = await h.ruwan.get('/api/v1/issues/' + second.id + '/photo');
  expect(answer.status).toBe(200);
  expect(answer.body).toEqual(different);
});
