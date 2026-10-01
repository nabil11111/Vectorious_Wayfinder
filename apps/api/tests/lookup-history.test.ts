import { PlanCheck, tripFigures } from '@wayfinder/contracts';
import { eq } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';
import { db } from '../src/db/client';
import { orderLines, orders, outlets, plans, stops } from '../src/db/schema';
import { depotInstant } from '../src/lib/clock';
import { driverStop, driverTrip, heldDriverRows } from './driver-plan';
import { sendWalkthroughPlan, THU, WED } from './loading-plan';
import { lookupHarness } from './lookup-plan';
import { decide, FRI, operations, photo, shownTrip } from './operations-plan';
import { deliveredWalkthrough, receiptOf, shopScreen } from './receipt-plan';
const clock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async original => {
  const actual = await original<typeof import('../src/lib/clock')>();
  return { ...actual, demoClockAt: (...args: Parameters<typeof actual.demoClockAt>) => ({ ...actual.demoClockAt(...args), now: clock.at || actual.demoClockAt(...args).now }) };
});
const h = await lookupHarness(clock), read = () => h.history('?date=' + THU);

it('AC-10 history keeps one manual trip and its five orders, 99 deferrals and sent schedule', async () => {
  const sent = await sendWalkthroughPlan(h), before = await heldDriverRows(), day = await read();
  expect(day).toMatchObject({ date: THU, publication: { id: sent.plan.id }, counts: { trips: 1, stops: 2, orders: 5, deferred: 99, delivered: 0, finished: 0, confirmations: 0, receivedOrders: 0,
    stages: { ordered: 118, loaded: { units: null, known: 0, total: 5 }, handedOver: { units: null }, received: { units: null } } } });
  expect(day.trips[0]).toMatchObject({ vehicleId: 'VEH035', schedule: { leavesAt: depotInstant(THU, 276).toISOString(), backAt: depotInstant(THU, 370).toISOString(), load: { units: 118 } } });
  expect(day.trips[0]!.stops.map(stop => stop.plannedArrival)).toEqual([depotInstant(THU, 300).toISOString(), depotInstant(THU, 324).toISOString()]);
  expect(day.deferrals).toHaveLength(99);
  expect(new Set(day.deferrals.map(row => row.orderId)).size).toBe(99);
  expect(await heldDriverRows()).toEqual(before);
});
it('AC-11 loading records 117 of 118 with one depot short and the answered loading flag', async () => {
  await h.road.ready();
  const day = await read();
  expect(day.counts!.stages).toMatchObject({ ordered: 118, loaded: { units: 117, known: 5, total: 5 }, depotShort: { units: 1 },
    handedOver: { units: null, known: 0, total: 5 }, received: { units: null, known: 0, total: 5 } });
  expect(day.trips[0]!.stops[0]!.problems).toEqual([expect.objectContaining({ kind: 'loading', status: 'decided', short: 1, decision: 'go_short', decidedBy: 'Ruwan' })]);
  expect(day.counts).toMatchObject({ delivered: 0, finished: 0, short: 1 });
});
it('AC-12 refusal records 115 handed over and two refused without double-counting the depot shortage', async () => {
  await deliveredWalkthrough(h, { wellawatte: 'refused' });
  const day = await read();
  expect(day.counts).toMatchObject({ delivered: 2, finished: 2, partial: 1, short: 2, confirmations: 0, stages: { handedOver: { units: 115, known: 5, total: 5 }, refused: { units: 2 }, depotShort: { units: 1 }, received: { units: null } } });
  expect(day.trips[0]!.stops[0]!.proof).toMatchObject({ kind: 'proof' });
  expect(day.trips[0]!.stops[1]!.problems).toEqual([expect.objectContaining({ kind: 'refused', short: 2 })]);
});
it.each(['refused', 'closed'] as const)('AC-13 zero handover finishes without delivering for %s', async kind => {
  const trip = await h.road.wellawatte();
  await h.road.write(trip, kind === 'refused' ? 'refuse' : 'closed', 228, 2, kind === 'refused'
    ? { reason: 'damaged', note: '', lines: driverStop(trip, 2).lines.map(line => ({ lineId: line.lineId, refused: line.loaded })) } : {});
  const day = await read(), stop = day.trips[0]!.stops[1]!;
  expect(day.counts).toMatchObject({ stops: 2, delivered: 1, finished: 2, partial: 0 });
  expect(stop.stages).toMatchObject(kind === 'closed'
    ? { handedOver: { units: 0, known: 2, total: 2 }, received: { units: 0 }, receiptShort: { units: 0 }, notDelivered: { units: 94 }, refused: { units: 0 } }
    : { handedOver: { units: 0 }, received: { units: null }, notDelivered: { units: 0 }, refused: { units: 94 } });
  expect(stop.attempts).toHaveLength(kind === 'closed' ? 1 : 0);
});
// Q-45: Kandy's Dashboard and Live day read "8 / 64 stops delivered · 1 partial · 1 closed" and History "8 / 64 stops
// delivered · 1 partial". History's header counts a closed stop, and a stop with none delivered, as Live day does.
it.each(['refused', 'closed'] as const)('Q-45 the header counts a %s stop with nothing handed over the way Live day does', async kind => {
  const trip = await h.road.wellawatte();
  await h.road.write(trip, kind === 'refused' ? 'refuse' : 'closed', 228, 2, kind === 'refused'
    ? { reason: 'damaged', note: '', lines: driverStop(trip, 2).lines.map(line => ({ lineId: line.lineId, refused: line.loaded })) } : {});
  const { counts } = await operations(h.ruwan), day = await read();
  expect(day.counts).toMatchObject({ delivered: 1, partial: 0, noGoods: kind === 'refused' ? 1 : 0, closed: kind === 'closed' ? 1 : 0 });
  expect([day.counts!.delivered, day.counts!.partial, day.counts!.noGoods, day.counts!.closed])
    .toEqual([counts.stopsDelivered, counts.partialStops, counts.noGoodsStops, counts.closedStops]);
});
// L-13: VEH035 with Nugegoda confirmed and Wellawatte closed read "Handed over · not recorded · 2 of 3 lines", although
// nothing more can be recorded for Wellawatte's lines. A closed shop was handed nothing, so the trip's figures are whole.
it('L-13 counts a closed shop as nothing handed over, received or short on the receipt, so the trip reads whole figures', async () => {
  const trip = await deliveredWalkthrough(h, { wellawatte: 'closed' });
  const shop = shopScreen(h.nadeesha), delivery = await shop.one(driverStop(trip, 1).id);
  h.freeze(THU, 513);
  expect((await shop.send(receiptOf(delivery, [11, 8, 3], { reason: 'missing', photo }))).status).toBe(200);
  const day = await read(), closed = day.trips[0]!.stops[1]!;
  expect(closed.outcome).toBe('closed');
  expect(closed.lines.map(line => [line.delivered, line.received, line.receiptShort])).toEqual([[0, 0, 0], [0, 0, 0]]);
  const whole = { loaded: { units: 117, known: 5, total: 5 }, handedOver: { units: 23, known: 5, total: 5 }, received: { units: 22, known: 5, total: 5 },
    receiptShort: { units: 1, known: 5, total: 5 }, notDelivered: { units: 94, known: 5, total: 5 } };
  expect(day.trips[0]!.stages).toMatchObject(whole);
  expect(day.counts).toMatchObject({ delivered: 1, finished: 2, confirmations: 1, stages: whole });
  // The closed shop is still not delivered, and has no receipt or proof to wait for.
  expect(closed).toMatchObject({ receipt: null, proof: null, flags: { short: false } });
});
// Q-43: Kandy's VEH057 trip 1, with Mulgampola closed and its cartons brought back, read "Handed over not recorded · 4 of
// 5 lines" in History while the driver's Trip done said 105 of 148 delivered. A closed stop counts as nothing handed
// over on every page, so History, Live day and the driver's phone read the same whole figure for the trip and the day.
it('Q-43 a trip with a closed shop brought back reads the same whole handed over in History, Live day and on the phone', async () => {
  let trip = await h.road.write(await h.road.wellawatte(), 'closed', 228, 2, { photo });
  await decide(h.ruwan, trip.problems.find(row => row.kind === 'closed')!.id, 'bring_back');
  trip = await h.road.write(driverTrip(await h.road.driver.read()), 'finish', 235);
  const phone = tripFigures(trip), live = shownTrip(await operations(h.ruwan)).figures, day = await read();
  expect([phone.delivered, live.delivered]).toEqual([23, 23]);
  expect(day.trips[0]!.stages.handedOver).toEqual({ units: 23, known: 5, total: 5, missing: 0, soFar: 23 });
  expect(day.counts!.stages.handedOver).toEqual(day.trips[0]!.stages.handedOver);
  expect(day.trips[0]!.stages.notDelivered.units).toBe(phone.notDelivered);
  // The closed shop's lines read nothing handed over, never a dash, beside its not-delivered cartons.
  const closed = day.trips[0]!.stops[1]!;
  expect(closed.lines.map(line => [line.loaded, line.delivered, line.notDelivered])).toEqual([[48, 0, 48], [46, 0, 46]]);
  expect(closed.attempts).toMatchObject([{ notDelivered: 94, decision: 'bring_back' }]);
});
// Q-44: "Not recorded yet … (33 of 163 lines)" gave the lines that were recorded, and read as the ones missing; and with
// one trip still to run the day showed no loaded or handed over total at all. Each stage says how many lines it is
// still missing and what its recorded lines add up to so far.
it('Q-44 a stage not recorded on every line says the lines it is missing and the units so far', async () => {
  // Nugegoda's three lines are handed over; the driver has only reached Wellawatte.
  await h.road.wellawatte();
  const day = await read();
  expect(day.counts!.stages).toMatchObject({ ordered: 118, loaded: { units: 117, known: 5, total: 5, missing: 0, soFar: 117 },
    handedOver: { units: null, known: 3, total: 5, missing: 2, soFar: 23 }, received: { units: null, known: 0, total: 5, missing: 5, soFar: 0 } });
  expect(day.trips[0]!.stages.handedOver).toEqual(day.counts!.stages.handedOver);
});
it('AC-16 three received orders make one confirmation, 22 cartons and separate receipt and depot shortages', async () => {
  const trip = await deliveredWalkthrough(h, { wellawatte: 'refused' });
  const shop = shopScreen(h.nadeesha), delivery = await shop.one(driverStop(trip, 1).id);
  h.freeze(THU, 513);
  const write = receiptOf(delivery, [11, 8, 3], { reason: 'missing', photo });
  expect((await shop.send(write)).status).toBe(200);
  const day = await read(), stop = day.trips[0]!.stops[0]!;
  expect(day.counts).toMatchObject({ confirmations: 1, receivedOrders: 3, stages: { received: { units: null, known: 3, total: 5 } } });
  expect(stop.stages).toMatchObject({ received: { units: 22, known: 3, total: 3 }, receiptShort: { units: 1 }, depotShort: { units: 1 }, handedOver: { units: 23 } });
  expect(stop.receipt).toMatchObject({ stopId: stop.id, orderCount: 3, received: 22, short: 1, cold: true,
    confirmedAt: depotInstant(THU, 511).toISOString(), sentAt: depotInstant(THU, 513).toISOString(),
    report: { id: write.writeId, reason: 'missing', lines: [{ counted: 1 }], photo: { kind: 'issue', issueId: write.writeId } } });
  await decide(h.ruwan, write.writeId, 'send_replacements');
  const answered = (await read()).trips[0]!.stops[0]!;
  expect(answered.receipt!.report).toMatchObject({ decision: 'send_replacements', replacement: { day: FRI, units: 1 } });
  expect(answered.stages).toEqual(stop.stages);
});
it('AC-16 partial or inconsistent receipt evidence fails visibly instead of claiming a confirmation', async () => {
  const trip = await deliveredWalkthrough(h);
  const own = driverStop(trip, 1).lines;
  await db.update(orders).set({ status: 'received', receivedAt: depotInstant(THU, 511), receiptSentAt: depotInstant(THU, 513), arrivedCold: true }).where(eq(orders.id, own[0]!.orderId));
  await db.update(orderLines).set({ receivedQty: 11 }).where(eq(orderLines.id, own[0]!.lineId));
  expect((await h.ruwan.get('/api/v1/lookup/history?date=' + THU)).status).toBe(500);
});
it('AC-17 seeded Tuesday and Wednesday publications have one and four deferrals with zero trips', async () => {
  expect(await h.history()).toMatchObject({ date: WED, publishedDates: [WED, '2026-06-23'], counts: { trips: 0, stops: 0, deferred: 4, confirmations: 0, receivedOrders: 0, stages: { ordered: 0, loaded: { units: 0, known: 0, total: 0 } } }, trips: [] });
  expect(await h.history('?date=2026-06-23')).toMatchObject({ counts: { trips: 0, deferred: 1 }, trips: [] });
  expect(await read()).toMatchObject({ date: THU, publication: null, counts: null, trips: [], deferrals: [] });
  h.freeze('2026-05-01', 600);
  expect(await h.history()).toMatchObject({ date: null, publication: null, counts: null });
  await sendWalkthroughPlan(h);
  h.freeze(WED, 960);
  expect((await h.history()).date).toBe(WED);
  expect((await h.history()).publishedDates).toEqual([THU, WED, '2026-06-23']);
  expect((await read()).publication).not.toBeNull();
});
it('AC-18 flags use actual arrival and kept windows, return instructions, and one mixed trip', async () => {
  const trip = await deliveredWalkthrough(h, { wellawatte: 'refused' });
  const original = await read(), refusal = original.trips[0]!.stops[1]!.problems[0]!;
  await decide(h.ruwan, refusal.id, 'send_replacements');
  const first = original.trips[0]!.stops[0]!;
  await db.update(stops).set({ arrivedAt: new Date(new Date(first.windowClose).getTime() + 1) }).where(eq(stops.id, first.id));
  const [shop] = await db.select().from(outlets).where(eq(outlets.id, 'OUT002'));
  try {
    await db.update(outlets).set({ brand: 'Style', windowClose: '01:00' }).where(eq(outlets.id, 'OUT002'));
    const day = await read();
    expect(day.counts).toMatchObject({ trips: 1, stops: 2, orders: 5, late: 1, short: 2, returned: 1, deferred: 99 });
    expect(day.groups).toEqual([{ brand: null, district: 'Colombo', tripIds: [trip.tripId] }]);
    expect(day.trips[0]).toMatchObject({ brand: null, brands: ['Fresh', 'Style'], flags: { late: true, short: true, returned: true } });
    expect(day.trips[0]!.stops[1]).toMatchObject({ flags: { late: false, returned: true }, windowClose: original.trips[0]!.stops[1]!.windowClose });
    expect(day.trips[0]!.stops[1]!.problems[0]!.replacement).toEqual({ day: FRI, units: 2 });
    await db.update(stops).set({ arrivedAt: new Date(first.windowClose) }).where(eq(stops.id, first.id));
    expect((await read()).counts!.late).toBe(0);
  } finally { await db.update(outlets).set({ brand: shop!.brand, windowClose: shop!.windowClose }).where(eq(outlets.id, 'OUT002')); }
});
it('AC-10 and AC-18 kept minute offsets survive midnight and invalid trip checks fail', async () => {
  await sendWalkthroughPlan(h);
  const [plan] = await db.select().from(plans).where(eq(plans.date, THU));
  const check = PlanCheck.parse(plan!.sentCheck), kept = check.trips[0]!.times!;
  kept.stops[1] = { ...kept.stops[1]!, arriveAt: 1445, leaveAt: 1460, windowOpen: 1440, windowClose: 1450 };
  kept.backAt = 1500;
  await db.update(plans).set({ sentCheck: check }).where(eq(plans.id, plan!.id));
  expect((await read()).trips[0]!.stops[1]).toMatchObject({ plannedArrival: depotInstant(FRI, 5).toISOString(), plannedDeparture: depotInstant(FRI, 20).toISOString(), windowOpen: depotInstant(FRI, 0).toISOString(), windowClose: depotInstant(FRI, 10).toISOString(), flags: { late: null } });
  for (const sentCheck of [null, {}, { ...check, trips: [] }]) {
    await db.update(plans).set({ sentCheck }).where(eq(plans.id, plan!.id));
    expect((await h.ruwan.get('/api/v1/lookup/history?date=' + THU)).status).toBe(500);
  }
});
