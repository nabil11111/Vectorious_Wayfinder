import { IssueReason, IssueDecision, PlanCheck, type Issue, type IssueList } from '@wayfinder/contracts';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, type Tx } from '../db/client';
import { depots, issueLines, issues, orderLines, orders, outlets, plans, products, stopOrders, stops, trips, users, photos } from '../db/schema';
import { depotDate, depotMinutes } from '../lib/clock';
import { HttpError } from '../lib/errors';
import { byLoadOrder, loaderDay, sentTrip } from '../loading/loader-day';
import type { DepotCaller } from '../middleware/auth';
import { replacementsOf } from '../orders/order-facts';
import { openDayAt, snapshot } from '../orders/store-orders';
import { operatingDays, readMoment } from '../plans/board';

// Problems as the screens show them (spec 012, D-36): each with its truck and when it leaves, its stop and shop, the
// people who raised and answered it by name, and the lines it counts in the loader's order.

const raiser = alias(users, 'raiser');
const decider = alias(users, 'decider');
const driver = alias(users, 'driver');

// The problems `where` picks, oldest first. It may name the problem, its stop, its trip or its plan.
export async function issuesOf(tx: Tx, where: SQL | undefined): Promise<Issue[]> {
  const rows = await tx.select({
    issue: issues, stop: { id: stops.id, seq: stops.seq, outletId: stops.outletId, arrivedAt: stops.arrivedAt, doneAt: stops.doneAt, loadedAt: stops.loadedAt }, shopName: outlets.name,
    trip: { id: trips.id, vehicleId: trips.vehicleId, tripNo: trips.tripNo, status: trips.status, driver: driver.displayName }, planId: plans.id, raisedBy: raiser.displayName, decidedBy: decider.displayName,
  }).from(issues)
    .innerJoin(stops, eq(stops.id, issues.stopId))
    .innerJoin(outlets, eq(outlets.id, stops.outletId))
    .innerJoin(trips, eq(trips.id, stops.tripId))
    .innerJoin(plans, eq(plans.id, trips.planId))
    .innerJoin(raiser, eq(raiser.id, issues.raisedBy))
    .leftJoin(decider, eq(decider.id, issues.decidedBy))
    .leftJoin(driver, eq(driver.id, trips.driverId))
    .where(where)
    .orderBy(issues.raisedAt, issues.id);
  if (!rows.length) return [];
  // Each plan's kept check once, however many of its problems there are.
  const sent = await tx.select({ id: plans.id, date: plans.date, check: plans.sentCheck }).from(plans).where(inArray(plans.id, [...new Set(rows.map((r) => r.planId))]));
  const checks = new Map(sent.map((plan) => [plan.id, { date: plan.date, check: plan.check === null ? null : PlanCheck.parse(plan.check) }]));
  const counted = await tx.select({
    issueId: issueLines.issueId, counted: issueLines.counted, lineId: orderLines.id, quantity: orderLines.quantity, orderId: orders.id, temp: orders.temp,
    loaded: orderLines.loadedQty, delivered: orderLines.deliveredQty, received: orderLines.receivedQty, placedAt: orders.placedAt, productId: products.id, name: products.name, unit: products.unit,
  }).from(issueLines)
    .innerJoin(orderLines, eq(orderLines.id, issueLines.orderLineId))
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .innerJoin(products, eq(products.id, orderLines.productId))
    .where(inArray(issueLines.issueId, rows.map((r) => r.issue.id)));

  const tripStops = await tx.select().from(stops).where(inArray(stops.tripId, rows.map(row => row.trip.id)));
  const dockFlags = await tx.select({ stopId: issues.stopId }).from(issues).where(and(eq(issues.kind, 'loading'), inArray(issues.stopId, rows.map(row => row.stop.id))));
  const pictures = await tx.select({ issueId: photos.issueId }).from(photos).where(inArray(photos.issueId, rows.map(row => row.issue.id)));
  // A shop's report keeps its cold check on the chilled orders of its delivery (D-61), and an answer's replacements
  // point at the problem they answer (D-59).
  const reportStops = rows.filter((row) => row.issue.kind === 'receipt').map((row) => row.stop.id);
  const colds = reportStops.length ? await tx.select({ stopId: stopOrders.stopId, cold: orders.arrivedCold }).from(stopOrders).innerJoin(orders, eq(orders.id, stopOrders.orderId))
    .where(and(inArray(stopOrders.stopId, reportStops), eq(orders.temp, 'chilled'))) : [];
  const replacements = await replacementsOf(tx, rows.map((row) => row.issue.id));

  return rows.map(({ issue, stop, shopName, trip, planId, raisedBy, decidedBy }) => {
    const plan = checks.get(planId)!;
    const lines = counted.filter((line) => line.issueId === issue.id).sort(byLoadOrder)
      .map(({ lineId, orderId, temp, productId, name, unit, quantity, counted: good, loaded, delivered, received }) => ({ lineId, orderId, temp, productId, name, unit, quantity, counted: good,
        loaded: issue.kind === 'closed' ? good : loaded, delivered: issue.kind === 'closed' ? null : delivered, received: issue.kind === 'closed' ? null : received }));
    return {
      id: issue.id, revision: issue.revision, kind: issue.kind, reason: IssueReason.parse(issue.reason), status: issue.status,
      raisedBy, raisedAt: issue.raisedAt.toISOString(), note: issue.note,
      decision: issue.decision === null ? null : IssueDecision.parse(issue.decision), decidedBy, decidedAt: issue.decidedAt?.toISOString() ?? null,
      hasPhoto: pictures.some(photo => photo.issueId === issue.id),
      short: lines.reduce((units, line) => units + (issue.kind === 'loading' ? line.quantity - line.counted : line.counted), 0),
      cold: issue.kind === 'receipt' ? colds.find((order) => order.stopId === stop.id)?.cold ?? null : null,
      replacement: replacements.get(issue.id) ?? null,
      trip: { ...trip, stopsLeft: tripStops.filter(stop => stop.tripId === trip.id && stop.outcome === null).length, leavesAt: sentTrip(plan.date, plan.check, trip.vehicleId, trip.tripNo).leavesAt.toISOString() },
      stop: { ...stop, arrivedAt: stop.arrivedAt?.toISOString() ?? null, doneAt: stop.doneAt?.toISOString() ?? null, loadedAt: stop.loadedAt?.toISOString() ?? null, flaggedAtDock: dockFlags.some(flag => flag.stopId === stop.id), shopName },
      lines,
    };
  });
}

// What needs the dispatcher (rule 9, D-39): the depot's open problems, oldest first, whatever day their truck is on,
// the loader's day for the title, and the day a replacement placed now would be for (spec 015).
export async function issueListOf(tx: Tx, depotId: string, at: Date): Promise<IssueList> {
  return {
    day: loaderDay(depotDate(at), depotMinutes(at), await operatingDays(tx)),
    replaceOn: (await openDayAt(tx, at))?.deliveryDate ?? null,
    issues: await issuesOf(tx, and(eq(plans.depotId, depotId), eq(issues.status, 'open'))),
  };
}

// GET /issues, in one read-only snapshot that a reset waits behind.
export function listIssues(caller: DepotCaller): Promise<IssueList> {
  return snapshot(async (tx) => issueListOf(tx, caller.depotId, (await readMoment(tx)).at));
}

// The depot a problem belongs to, for an answer given on both depots together (spec 021): the depot of the plan its
// truck is on, which must be on the depots' list. A problem on no depot's list is unknown, as one on another depot's is
// on one depot.
export async function issueDepotOf(issueId: string): Promise<string> {
  const [row] = await db.select({ depotId: depots.id }).from(issues)
    .innerJoin(stops, eq(stops.id, issues.stopId)).innerJoin(trips, eq(trips.id, stops.tripId)).innerJoin(plans, eq(plans.id, trips.planId))
    .innerJoin(depots, eq(depots.id, plans.depotId)).where(eq(issues.id, issueId));
  if (!row) throw new HttpError(400, 'unknown_record', 'That problem is not on either depot\'s list.', { id: issueId });
  return row.depotId;
}

// Photos belong to a problem in the caller's depot, including after the dispatcher has answered it.
export function issuePhoto(caller: DepotCaller, issueId: string): Promise<Buffer> {
  return snapshot(async tx => {
    const [row] = await tx.select({ id: issues.id, jpeg: photos.jpeg }).from(issues)
      .innerJoin(stops, eq(stops.id, issues.stopId)).innerJoin(trips, eq(trips.id, stops.tripId)).innerJoin(plans, eq(plans.id, trips.planId))
      .leftJoin(photos, eq(photos.issueId, issues.id)).where(and(eq(issues.id, issueId), eq(plans.depotId, caller.depotId)));
    if (!row) throw new HttpError(400, 'unknown_record', 'That problem is not on this depot\'s list.', { id: issueId });
    if (row.jpeg === null) throw new HttpError(404, 'not_found', 'This problem has no photo.');
    return row.jpeg;
  });
}
