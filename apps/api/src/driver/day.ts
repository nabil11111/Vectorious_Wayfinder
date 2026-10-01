import { PlanCheck, type DriverDay, type DriverProblem, type DriverTrip } from '@wayfinder/contracts';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { depots, issues, orderLines, orders, outlets, plans, products, stopOrders, stops, trips, users, vehicles } from '../db/schema';
import { issuesOf } from '../issues/read';
import { depotDate, depotInstant, depotMinutes, dueBackWords } from '../lib/clock';
import { appliedWriteIdsOf } from '../lib/phone-writes';
import { byLoadOrder, loaderDay } from '../loading/loader-day';
import type { DepotCaller } from '../middleware/auth';
import { snapshot } from '../orders/store-orders';
import { toClock, toMinutes } from '../planning';
import { operatingDays, readMoment } from '../plans/board';

type TripPlan = { trip: typeof trips.$inferSelect; plan: typeof plans.$inferSelect };

// Shared by the day read and a write holding its trip lock. Historical closed attempts read their own counts,
// so clearing or loading the orders for tomorrow does not change what the driver recorded today.
export async function driverTripsOf(tx: Tx, rows: TripPlan[], at: Date): Promise<DriverTrip[]> {
  if (!rows.length) return [];
  const tripIds = rows.map(row => row.trip.id);
  const fleet = await tx.select().from(vehicles).where(inArray(vehicles.id, rows.map(row => row.trip.vehicleId)));
  const stopRows = await tx.select({ stop: stops, shop: outlets }).from(stops).innerJoin(outlets, eq(outlets.id, stops.outletId)).where(inArray(stops.tripId, tripIds));
  const lines = stopRows.length ? await tx.select({ stopId: stopOrders.stopId, lineId: orderLines.id, orderId: orders.id, temp: orders.temp,
    placedAt: orders.placedAt, note: orders.driverNote, productId: products.id, name: products.name, unit: products.unit,
    quantity: orderLines.quantity, loaded: orderLines.loadedQty, delivered: orderLines.deliveredQty })
    .from(stopOrders).innerJoin(orders, eq(orders.id, stopOrders.orderId)).innerJoin(orderLines, eq(orderLines.orderId, orders.id))
    .innerJoin(products, eq(products.id, orderLines.productId)).where(inArray(stopOrders.stopId, stopRows.map(row => row.stop.id))) : [];
  // The driver's own problems only: a loader's flag stays at the dock, and a shop's report is the dispatcher's to answer.
  // Read with the loader's flags, for the lines the loader found would not fit on the truck, which the driver reads as
  // "won't fit", not short (L-09).
  const read = await issuesOf(tx, and(inArray(trips.id, tripIds), inArray(issues.kind, ['refused', 'closed', 'loading'])));
  const problems = read.filter(problem => problem.kind !== 'loading');
  const notFitting = new Set(read.filter(problem => problem.kind === 'loading' && problem.reason === 'wont_fit')
    .flatMap(problem => problem.lines.map(line => `${problem.trip.id}:${line.lineId}`)));
  return rows.map(({ trip, plan }) => {
    const vehicle = fleet.find(vehicle => vehicle.id === trip.vehicleId);
    if (!vehicle) throw new Error(`No vehicle ${trip.vehicleId}.`);
    const check = plan.sentCheck === null ? null : PlanCheck.parse(plan.sentCheck);
    const times = check?.trips.find(t => t.vehicleId === trip.vehicleId && t.tripNo === trip.tripNo)?.times;
    if (!times) throw new Error(`The sent plan for ${plan.date} keeps no times for ${trip.vehicleId} trip ${trip.tripNo}.`);
    const own = stopRows.filter(row => row.stop.tripId === trip.id).sort((a, b) => a.stop.seq - b.stop.seq);
    const brands = [...new Set(own.map(row => row.shop.brand))];
    const tripProblems: DriverProblem[] = problems.filter(problem => problem.trip.id === trip.id).map(problem => ({
      id: problem.id, kind: problem.kind as DriverProblem['kind'], stopId: problem.stop.id, reason: problem.reason as DriverProblem['reason'],
      note: problem.note, raisedAt: problem.raisedAt, hasPhoto: problem.hasPhoto, lines: problem.lines.map(line => ({ lineId: line.lineId, counted: line.counted })),
      decision: problem.decision, decidedBy: problem.decidedBy, decidedAt: problem.decidedAt,
    }));
    return {
      tripId: trip.id, revision: trip.revision, vehicleId: trip.vehicleId, vehicleType: vehicle.type, vehicleTemp: vehicle.temp,
      tripNo: trip.tripNo, brand: brands.length === 1 ? brands[0]! : null, district: times.district, status: trip.status,
      leavesAt: depotInstant(plan.date, times.leaveAt).toISOString(), backBy: depotInstant(plan.date, times.backAt).toISOString(),
      backByWords: dueBackWords(depotInstant(plan.date, times.backAt), at),
      readyAt: trip.readyAt?.toISOString() ?? null, leftAt: trip.leftAt?.toISOString() ?? null, backAt: trip.backAt?.toISOString() ?? null,
      stops: own.map(({ stop, shop }) => {
        const ownLines = lines.filter(line => line.stopId === stop.id).sort(byLoadOrder);
        const notes = [...new Set([...ownLines].sort((a, b) => (a.placedAt?.getTime() ?? Infinity) - (b.placedAt?.getTime() ?? Infinity) || a.orderId.localeCompare(b.orderId))
          .flatMap(line => line.note ? [line.note] : []))];
        const closed = stop.outcome === 'closed' ? tripProblems.find(problem => problem.stopId === stop.id && problem.kind === 'closed' && problem.decision !== 'try_again') : undefined;
        if (stop.outcome === 'closed' && !closed) throw new Error(`Closed stop ${stop.id} has no closed attempt.`);
        const mall = shop.mallWindow?.split('-');
        const open = Math.max(toMinutes(shop.windowOpen.slice(0, 5)), mall ? toMinutes(mall[0]!) : 0);
        const close = Math.min(toMinutes(shop.windowClose.slice(0, 5)), mall ? toMinutes(mall[1]!) : 24 * 60);
        return { id: stop.id, seq: stop.seq, revision: stop.revision, retriedAt: stop.retriedAt?.toISOString() ?? null,
          outletId: stop.outletId, shopName: shop.name, district: shop.district, dockType: shop.dockType, windowOpen: toClock(open), windowClose: toClock(close),
          note: notes.length ? notes.join('\n') : null, arrivedAt: stop.arrivedAt?.toISOString() ?? null, doneAt: stop.doneAt?.toISOString() ?? null, outcome: stop.outcome,
          lines: ownLines.map(({ lineId, orderId, temp, productId, name, unit, quantity, loaded, delivered }) => {
            const attempt = closed?.lines.find(line => line.lineId === lineId);
            if (closed && !attempt) throw new Error(`Closed attempt ${closed.id} has no count for ${lineId}.`);
            // A closed attempt keeps its own count, which a bring-back leaves as it was while it clears the live one, so
            // the loaded count and what would not fit both come from the attempt.
            const counted = attempt ? attempt.counted : loaded;
            const wontFit = notFitting.has(`${trip.id}:${lineId}`) && counted !== null ? quantity - counted : 0;
            return { lineId, orderId, temp, productId, name, unit, quantity, loaded: counted, wontFit, delivered: closed ? null : delivered };
          }) };
      }), problems: tripProblems,
    };
  });
}

export async function driverDayOf(tx: Tx, caller: DepotCaller, at: Date): Promise<DriverDay> {
  const day = loaderDay(depotDate(at), depotMinutes(at), await operatingDays(tx));
  const [plan] = day ? await tx.select().from(plans).where(and(eq(plans.depotId, caller.depotId), eq(plans.date, day), eq(plans.status, 'published'))) : [];
  const [driver] = await tx.select().from(users).where(eq(users.id, caller.userId));
  const [depot] = await tx.select().from(depots).where(eq(depots.id, caller.depotId));
  if (!driver || !depot) throw new Error('The driver account or its depot no longer exists.');
  const rows = await tx.select({ trip: trips, plan: plans }).from(trips).innerJoin(plans, eq(plans.id, trips.planId))
    .where(and(eq(plans.depotId, caller.depotId), eq(trips.driverId, caller.userId), or(eq(trips.status, 'out'), plan ? eq(plans.id, plan.id) : undefined)));
  const shown = await driverTripsOf(tx, rows, at);
  const earlier = (id: string) => rows.find(row => row.trip.id === id)!.plan.date !== day ? 0 : 1;
  shown.sort((a, b) => earlier(a.tripId) - earlier(b.tripId) || a.leavesAt.localeCompare(b.leavesAt) || a.vehicleId.localeCompare(b.vehicleId) || a.tripNo - b.tripNo);
  return { depot: depot.name, driver: driver.displayName, driverId: caller.userId, day, planSent: Boolean(plan), appliedWriteIds: await appliedWriteIdsOf(tx, caller.userId), trips: shown };
}

export function getDriverDay(caller: DepotCaller): Promise<DriverDay> {
  return snapshot(async tx => driverDayOf(tx, caller, (await readMoment(tx)).at));
}
