import { OperationsDay, PlanCheck, type OperationsTrip } from '@wayfinder/contracts';
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { auditLog, calendarDays, deferrals, depots, fuelLog, orders, outlets, plans, stops, stopOrders, trips, users, vehicles } from '../db/schema';
import { driverTripsOf } from '../driver/day';
import { issuesOf } from '../issues/read';
import { depotDate, depotInstant, depotMinutes } from '../lib/clock';
import { trucksOf } from '../loading/day';
import { loaderDay } from '../loading/loader-day';
import type { DepotCaller } from '../middleware/auth';
import { CUTOFF_MINUTES } from '../orders/orderable-day';
import { snapshot } from '../orders/store-orders';
import { toMinutes } from '../planning';
import { operatingDays, readMoment } from '../plans/board';
import { percent } from '../plans/board-day';
import { attentionOf, compareOut, outRowOf, timelineOf } from './attention';
import { eventsOf } from './events';
import { districtMap, figuresOf, groupTrips, nextDemand, progress, stopCounts } from './figures';

// Every source, including the clock and reset generation, belongs to this one read-only snapshot.
export function getOperationsDay(caller: DepotCaller): Promise<OperationsDay> {
  return snapshot(tx => operationsDayOf(tx, caller));
}
async function operationsDayOf(tx: Tx, caller: DepotCaller): Promise<OperationsDay> {
  const moment = await readMoment(tx), readAt = moment.at.toISOString(), today = depotDate(moment.at);
  const dates = await operatingDays(tx), day = loaderDay(today, depotMinutes(moment.at), dates);
  const [depot] = await tx.select().from(depots).where(eq(depots.id, caller.depotId));
  if (!depot) throw new Error('The dispatcher depot no longer exists.');
  const [plan] = day ? await tx.select().from(plans).where(and(eq(plans.depotId, caller.depotId), eq(plans.date, day), eq(plans.status, 'published'))) : [];
  const rows = await tx.select({ trip: trips, plan: plans }).from(trips).innerJoin(plans, eq(plans.id, trips.planId))
    .where(and(eq(plans.depotId, caller.depotId), eq(plans.status, 'published'), or(plan ? eq(plans.id, plan.id) : undefined, and(eq(trips.status, 'out'), day ? lt(plans.date, day) : undefined))));
  const shownPlans = [...new Map([...(plan ? [plan] : []), ...rows.map(row => row.plan)].map(row => [row.id, row])).values()];
  for (const sent of shownPlans) {
    if (!sent.publishedAt) throw new Error(`Published plan ${sent.id} has no publication time.`);
    if (sent.sentCheck !== null) {
      if (!PlanCheck.safeParse(sent.sentCheck).success) throw new Error(`Publication ${sent.id} has a malformed kept check.`);
      continue;
    }
    const [publication] = await tx.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.entity, 'plan'), eq(auditLog.entityId, sent.id), eq(auditLog.action, 'plan.sent'), sql`${auditLog.after}->>'revision' = ${String(sent.revision)}`)).limit(1);
    if (publication) throw new Error(`New publication ${sent.id} has no kept check.`);
  }
  const fleet = await tx.select().from(vehicles).where(eq(vehicles.depotId, caller.depotId));
  const ids = rows.map(row => row.trip.id);
  const people = ids.length ? await tx.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, rows.flatMap(row => row.trip.driverId ? [row.trip.driverId] : []))) : [];
  const members = ids.length ? await tx.select({ stop: stops, shop: outlets }).from(stops).innerJoin(outlets, eq(outlets.id, stops.outletId)).where(inArray(stops.tripId, ids)) : [];
  const recorded = await driverTripsOf(tx, rows.filter(row => row.plan.sentCheck !== null));
  const problems = ids.length ? await issuesOf(tx, inArray(trips.id, ids)) : [];
  const dock = (await Promise.all(shownPlans.filter(row => row.sentCheck !== null).map(sent => trucksOf(tx, sent, rows.filter(row => row.plan.id === sent.id && ['planned', 'loading', 'ready'].includes(row.trip.status)).map(row => row.trip))))).flat();
  const shown: OperationsTrip[] = rows.map(({ trip, plan: sent }) => {
    const vehicle = fleet.find(vehicle => vehicle.id === trip.vehicleId);
    if (!vehicle) throw new Error(`No depot vehicle ${trip.vehicleId}.`);
    const own = members.filter(row => row.stop.tripId === trip.id).sort((a, b) => a.stop.seq - b.stop.seq);
    const ownIssues = problems.filter(problem => problem.trip.id === trip.id);
    const driver = trip.driverId ? people.find(person => person.id === trip.driverId) : null;
    if (trip.driverId && !driver) throw new Error(`No driver ${trip.driverId}.`);
    const base = { tripId: trip.id, planId: sent.id, date: sent.date, vehicleId: trip.vehicleId, vehicleType: vehicle.type, vehicleTemp: vehicle.temp, tripNo: trip.tripNo,
      driver: driver ?? null, status: trip.status, openIssueIds: ownIssues.filter(issue => issue.status === 'open').map(issue => issue.id), stopsTotal: own.length,
      action: ownIssues.some(issue => issue.status === 'open') ? 'decide' as const : ownIssues.some(issue => issue.status === 'decided') ? 'decided' as const : 'open' as const };
    if (sent.sentCheck === null) {
      const brands = [...new Set(own.map(row => row.shop.brand))], districts = [...new Set(own.map(row => row.shop.district))].sort();
      return { ...base, detailRecorded: false, reason: 'legacy_plan', brand: brands.length === 1 ? brands[0]! : null, district: districts.join(', '),
        outRow: trip.status === 'out' ? { progress: progress(null, own.length), nextStop: null, plannedArrival: null, arrivalIsOriginal: false, plannedReturn: null, status: { kind: 'unrecorded' } } : null,
        stops: own.map(({ stop, shop }) => ({ id: stop.id, seq: stop.seq, outletId: shop.id, shopName: shop.name })) };
    }
    const facts = recorded.find(row => row.tripId === trip.id)!;
    const figures = figuresOf(facts);
    const times = PlanCheck.parse(sent.sentCheck).trips.find(row => row.vehicleId === trip.vehicleId && row.tripNo === trip.tripNo)?.times;
    if (!times) throw new Error(`No times for ${trip.id}.`);
    const stopDetails = own.map(({ stop, shop }) => {
      const kept = times.stops.find(time => time.seq === stop.seq && time.outletId === shop.id);
      const fact = facts.stops.find(row => row.id === stop.id)!;
      if (!kept || stop.plannedArrival === null || stop.plannedDepart === null) throw new Error(`No kept time for stop ${stop.id}.`);
      // PostgreSQL time has no date; the kept check supplies its day offset past midnight.
      const stopInstant = (clock: string, minutes: number) => depotInstant(sent.date, Math.floor(minutes / 1440) * 1440 + toMinutes(clock.slice(0, 5)) % 1440).toISOString();
      const windowOpen = depotInstant(sent.date, toMinutes(fact.windowOpen)).toISOString(), windowClose = depotInstant(sent.date, toMinutes(fact.windowClose)).toISOString();
      return { id: stop.id, seq: stop.seq, outletId: shop.id, shopName: shop.name, plannedArrival: stopInstant(stop.plannedArrival, kept.arriveAt), plannedDeparture: stopInstant(stop.plannedDepart, kept.leaveAt),
        windowOpen, windowClose, loadedAt: stop.loadedAt?.toISOString() ?? null, arrivedAt: fact.arrivedAt, doneAt: fact.doneAt, outcome: fact.outcome,
        arrivedAfterWindow: fact.arrivedAt === null ? null : fact.arrivedAt > windowClose, figures: figures.byStop.find(row => row.stopId === stop.id)!, issueIds: ownIssues.filter(issue => issue.stop.id === stop.id).map(issue => issue.id) };
    });
    const arrivals = new Map(stopDetails.map(stop => [stop.id, stop.plannedArrival]));
    const atDock = dock.find(row => row.tripId === trip.id);
    return { ...base, detailRecorded: true, brand: facts.brand, district: facts.district, trip: facts, figures, onSoFar: atDock?.on ?? null,
      lastReportAt: trip.lastEventAt?.toISOString() ?? null, schedule: { leavesAt: facts.leavesAt, backAt: facts.backBy }, stopDetails,
      attention: attentionOf(facts, arrivals, readAt, atDock ? { on: atDock.on.units, units: atDock.units } : null), outRow: trip.status === 'out' ? outRowOf(facts, arrivals, ownIssues, readAt) : null };
  });
  const current = shown.filter(row => row.date === day), out = shown.filter(row => row.status === 'out');
  const timeline = (date: string, section: OperationsTrip[]) => timelineOf(date, section.flatMap(row => row.detailRecorded ? [row.schedule.leavesAt, row.schedule.backAt,
    ...[row.trip.readyAt, row.trip.leftAt, row.trip.backAt].filter((at): at is string => at !== null),
    ...row.stopDetails.flatMap(stop => [stop.plannedArrival, stop.plannedDeparture, ...[stop.loadedAt, stop.arrivedAt, stop.doneAt].filter((at): at is string => at !== null)])] : []), readAt);
  const earlierOut = [...new Set(out.filter(row => row.date !== day).map(row => row.date))].sort().map(date => {
    const section = out.filter(row => row.date === date);
    return { date, ...groupTrips(section), timeline: timeline(date, section) };
  });
  const deferred = plan ? await tx.select({ id: deferrals.orderId }).from(deferrals).innerJoin(orders, eq(orders.id, deferrals.orderId)).where(and(eq(deferrals.planId, plan.id), sql`${orders.status} not in ('split', 'cancelled', 'draft')`)) : [];
  const nextDate = day ? dates.find(date => date > day) : undefined;
  let nextRun: OperationsDay['nextRun'] = null;
  if (day && nextDate) {
    const demand = await tx.select({ id: orders.id, deliveryDate: orders.deliveryDate, status: orders.status }).from(orders).innerJoin(outlets, eq(outlets.id, orders.outletId)).where(eq(outlets.depotId, caller.depotId));
    const membership = await tx.select({ id: stopOrders.orderId }).from(stopOrders).innerJoin(stops, eq(stops.id, stopOrders.stopId)).innerJoin(trips, eq(trips.id, stops.tripId)).innerJoin(plans, eq(plans.id, trips.planId))
      .where(and(eq(plans.depotId, caller.depotId), eq(plans.date, nextDate), eq(plans.status, 'published')));
    nextRun = { date: nextDate, cutoffAt: depotInstant(day, CUTOFF_MINUTES).toISOString(), orders: nextDemand(demand, new Set(membership.map(row => row.id)), day, nextDate, Boolean(plan)) };
  }
  const [calendar] = await tx.select().from(calendarDays).where(eq(calendarDays.date, day ?? today));
  let fuel: OperationsDay['fuel'] = null;
  if (calendar) {
    const fuelRows = await tx.select({ litres: fuelLog.litres }).from(fuelLog).innerJoin(vehicles, eq(vehicles.id, fuelLog.vehicleId)).innerJoin(calendarDays, eq(calendarDays.date, fuelLog.date))
      .where(and(eq(vehicles.depotId, caller.depotId), eq(calendarDays.isoYear, calendar.isoYear), eq(calendarDays.isoWeek, calendar.isoWeek)));
    const litres = fuelRows.reduce((n, row) => n + Math.round(Number(row.litres) * 10), 0) / 10, quotaLitres = fleet.reduce((n, row) => n + row.weeklyFuelQuotaL, 0);
    fuel = { isoYear: calendar.isoYear, isoWeek: calendar.isoWeek, litres, quotaLitres, percent: quotaLitres === 0 ? null : percent(litres, quotaLitres) };
  }
  const counts = stopCounts(current), vehiclesOut = new Set(out.map(row => row.vehicleId)).size;
  // The map's shops are the depot's active ones; their stops are the watched day's, as the delivered tile counts them.
  const shops = await tx.select({ id: outlets.id, district: outlets.district }).from(outlets).where(and(eq(outlets.depotId, caller.depotId), isNull(outlets.archivedAt)));
  return OperationsDay.parse({ depot: { id: depot.id, name: depot.name }, demoDay: moment.demoDay, day, dayChangesAt: day ? depotInstant(day, CUTOFF_MINUTES).toISOString() : null, readAt,
    plan: plan ? { id: plan.id, revision: plan.revision, publishedAt: plan.publishedAt!.toISOString(), detailRecorded: plan.sentCheck !== null } : null,
    counts: { ...counts, tripsTotal: current.length, vehiclesOut, vehiclesTotal: fleet.length, deferredOrders: new Set(deferred.map(row => row.id)).size,
      deliveryProgress: progress(counts.stopsDelivered, counts.stopsTotal), truckProgress: progress(vehiclesOut, fleet.length) }, map: districtMap(shops, current), nextRun, fuel,
    ...groupTrips(current), timeline: day ? timeline(day, current) : null, earlierOut, outTripIds: [...out].sort(compareOut).map(row => row.tripId), ...await eventsOf(tx, { currentPlan: plan, plans: shownPlans, trips: shown, issues: problems }) });
}
