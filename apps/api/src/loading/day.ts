import { PlanCheck, LoadingIssue, type Issue, type LoadingDay, type LoadingTruck } from '@wayfinder/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { auditLog, orderLines, orders, outlets, plans, products, stopOrders, stops, trips, users, vehicles } from '../db/schema';
import { issuesOf } from '../issues/read';
import { depotDate, depotMinutes } from '../lib/clock';
import type { DepotCaller } from '../middleware/auth';
import { snapshot } from '../orders/store-orders';
import { computeLoad } from '../planning';
import { operatingDays, readMoment, type BoardMoment } from '../plans/board';
import { goingOf, type LineFlag } from './going';
import { byLoadOrder, loaderDay, sentTrip } from './loader-day';

// The loader's day (spec 012): the day's sent trucks in leaving order, each with its stops last stop first, what goes
// out of every line, what is on so far and its problems. GET /loading answers it, and so does every loader write, from
// inside its transaction. Every count, kilo and cubic metre is worked out here, and the screen only formats them.

type PlanRow = typeof plans.$inferSelect;
type TripRow = typeof trips.$inferSelect;

// A truck on the list has not left the dock (rule 2). Out and done are the driver's (A4).
const ON_THE_LIST = ['planned', 'loading', 'ready'] as const;
function listed(trip: TripRow): LoadingTruck['status'] {
  if (trip.status === 'out' || trip.status === 'done') throw new Error(`${trip.vehicleId} trip ${trip.tripNo} has left the dock.`);
  return trip.status;
}

const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);
// The open problems first, then the answered ones, latest first.
const openThenLatest = (a: Issue, b: Issue) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1)
  || (b.decidedAt ?? b.raisedAt).localeCompare(a.decidedAt ?? a.raisedAt) || a.id.localeCompare(b.id);

// The trucks of these trips of one sent plan, in leaving order, then by vehicle and trip number. out holds the plan's
// trips on the road, so a trip whose vehicle is still out on an earlier one says so, with when it is due back (Q-26).
export async function trucksOf(tx: Tx, plan: PlanRow, tripRows: TripRow[], out: TripRow[] = []): Promise<LoadingTruck[]> {
  if (!tripRows.length) return [];
  const check = plan.sentCheck === null ? null : PlanCheck.parse(plan.sentCheck);
  const tripIds = tripRows.map((trip) => trip.id);
  const fleet = await tx.select().from(vehicles).where(inArray(vehicles.id, tripRows.map((trip) => trip.vehicleId)));
  const driverIds = tripRows.flatMap((trip) => (trip.driverId ? [trip.driverId] : []));
  const drivers = driverIds.length ? await tx.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, driverIds)) : [];
  const stopRows = await tx.select({ stop: stops, shopName: outlets.name, brand: outlets.brand }).from(stops)
    .innerJoin(outlets, eq(outlets.id, stops.outletId)).where(inArray(stops.tripId, tripIds));
  const lineRows = stopRows.length ? await tx.select({
    stopId: stopOrders.stopId, lineId: orderLines.id, quantity: orderLines.quantity, productId: orderLines.productId,
    orderId: orders.id, temp: orders.temp, placedAt: orders.placedAt,
  }).from(stopOrders)
    .innerJoin(orders, eq(orders.id, stopOrders.orderId))
    .innerJoin(orderLines, eq(orderLines.orderId, orders.id))
    .where(inArray(stopOrders.stopId, stopRows.map((row) => row.stop.id))) : [];
  const items = (await tx.select().from(products)).map((p) => ({ ...p, kgPerUnit: Number(p.kgPerUnit), m3PerUnit: Number(p.m3PerUnit) }));
  const problems = (await issuesOf(tx, inArray(trips.id, tripIds))).filter(problem => problem.kind === 'loading').map(problem => LoadingIssue.parse(problem));
  // A line is flagged once while its truck loads, so it has one flag at most.
  const flags = new Map<string, LineFlag>(problems.flatMap((problem) => problem.lines.map((line) => [`${problem.trip.id}:${line.lineId}`, { counted: line.counted, decision: problem.decision }] as const)));

  const trucks = tripRows.map((trip): LoadingTruck => {
    const vehicle = fleet.find((v) => v.id === trip.vehicleId);
    if (!vehicle) throw new Error(`No vehicle ${trip.vehicleId}.`);
    const { leavesAt, district } = sentTrip(plan.date, check, trip.vehicleId, trip.tripNo);
    const own = stopRows.filter((row) => row.stop.tripId === trip.id).sort((a, b) => b.stop.seq - a.stop.seq);
    const truckStops = own.map(({ stop, shopName }) => {
      const lines = lineRows.filter((line) => line.stopId === stop.id).sort(byLoadOrder).map((line) => {
        const item = items.find((p) => p.id === line.productId);
        if (!item) throw new Error(`No product ${line.productId}.`);
        const going = goingOf(line.quantity, flags.get(`${trip.id}:${line.lineId}`) ?? null);
        return { lineId: line.lineId, orderId: line.orderId, temp: line.temp, productId: item.id, name: item.name, unit: item.unit, quantity: line.quantity, going, short: line.quantity - going };
      });
      return { id: stop.id, seq: stop.seq, outletId: stop.outletId, shopName, loaded: stop.loadedAt !== null,
        units: total(lines.map((l) => l.quantity)), going: total(lines.map((l) => l.going)), short: total(lines.map((l) => l.short)), lines };
    });
    // What is on so far: the loaded stops' lines at their counts, from the one load calculator. A line at 0 adds nothing.
    const on = computeLoad(truckStops.filter((s) => s.loaded).flatMap((s) => s.lines).filter((l) => l.going > 0).map((l) => ({ productId: l.productId, quantity: l.going })), items);
    const brands = [...new Set(own.map((row) => row.brand))];
    const away = out.filter((t) => t.vehicleId === trip.vehicleId && t.tripNo < trip.tripNo && t.status === 'out').sort((a, b) => b.tripNo - a.tripNo)[0];
    return {
      tripId: trip.id, revision: trip.revision, vehicleId: trip.vehicleId, vehicleType: vehicle.type, vehicleTemp: vehicle.temp, tripNo: trip.tripNo,
      brand: brands.length === 1 ? brands[0]! : null, district, status: listed(trip), leavesAt: leavesAt.toISOString(), readyAt: trip.readyAt?.toISOString() ?? null,
      driver: drivers.find((d) => d.id === trip.driverId)?.name ?? null, weightCapKg: vehicle.weightCapKg, volumeCapM3: Number(vehicle.volumeCapM3),
      units: total(truckStops.map((s) => s.units)), on: { units: on.units, kg: on.kg, m3: on.m3 }, short: total(truckStops.map((s) => s.short)),
      stops: truckStops, issues: problems.filter((problem) => problem.trip.id === trip.id).sort(openThenLatest),
      outOn: away ? { tripNo: away.tripNo, backBy: sentTrip(plan.date, check, away.vehicleId, away.tripNo).backBy.toISOString() } : null,
    };
  });
  return trucks.sort((a, b) => a.leavesAt.localeCompare(b.leavesAt) || a.vehicleId.localeCompare(b.vehicleId) || a.tripNo - b.tripNo);
}

// The loading day of a depot at an instant: the loader's day, its plan while it is sent, and its trucks.
export async function loadingDayOf(tx: Tx, depotId: string, moment: BoardMoment): Promise<LoadingDay> {
  const day = loaderDay(depotDate(moment.at), depotMinutes(moment.at), await operatingDays(tx));
  const [plan] = day ? await tx.select().from(plans).where(and(eq(plans.depotId, depotId), eq(plans.date, day), eq(plans.status, 'published'))) : [];
  if (!plan) return { depot: depotId, demoDay: moment.demoDay, day, plan: null, trucks: [] };
  if (!plan.publishedAt) throw new Error(`Sent plan ${plan.id} has no publication time.`);
  // The exact publication's sender, not its creator or a later audit's wall time. The older seed has no send audit.
  const [sent] = await tx.select({ name: users.displayName }).from(auditLog).leftJoin(users, eq(users.id, auditLog.actorId))
    .where(and(eq(auditLog.entity, 'plan'), eq(auditLog.entityId, plan.id), eq(auditLog.action, 'plan.sent'),
      sql`${auditLog.after}->>'revision' = ${String(plan.revision)}`));
  if (plan.sentCheck !== null && !sent?.name) throw new Error(`Sent plan ${plan.id} has no sender for revision ${plan.revision}.`);
  const onTheList = await tx.select().from(trips).where(and(eq(trips.planId, plan.id), inArray(trips.status, [...ON_THE_LIST])));
  const out = await tx.select().from(trips).where(and(eq(trips.planId, plan.id), eq(trips.status, 'out')));
  return { depot: depotId, demoDay: moment.demoDay, day,
    plan: { id: plan.id, revision: plan.revision, publishedAt: plan.publishedAt.toISOString(), publishedBy: sent?.name ?? null },
    trucks: await trucksOf(tx, plan, onTheList, out) };
}

// GET /loading, in one read-only snapshot that a reset waits behind.
export function getLoadingDay(caller: DepotCaller): Promise<LoadingDay> {
  return snapshot(async (tx) => loadingDayOf(tx, caller.depotId, await readMoment(tx)));
}
