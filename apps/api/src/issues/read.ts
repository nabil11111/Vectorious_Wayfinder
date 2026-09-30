import { FlagReason, LoadingDecision, PlanCheck, type Issue, type IssueList } from '@wayfinder/contracts';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from '../db/client';
import { issueLines, issues, orderLines, orders, outlets, plans, products, stops, trips, users } from '../db/schema';
import { depotDate, depotMinutes } from '../lib/clock';
import { byLoadOrder, loaderDay, sentTrip } from '../loading/loader-day';
import type { DepotCaller } from '../middleware/auth';
import { snapshot } from '../orders/store-orders';
import { operatingDays, readMoment } from '../plans/board';

// Problems as the screens show them (spec 012, D-36): each with its truck and when it leaves, its stop and shop, the
// people who raised and answered it by name, and the lines it counts in the loader's order.

const raiser = alias(users, 'raiser');
const decider = alias(users, 'decider');

// The problems `where` picks, oldest first. It may name the problem, its stop, its trip or its plan.
export async function issuesOf(tx: Tx, where: SQL | undefined): Promise<Issue[]> {
  const rows = await tx.select({
    issue: issues, stop: { id: stops.id, seq: stops.seq, outletId: stops.outletId }, shopName: outlets.name,
    trip: { id: trips.id, vehicleId: trips.vehicleId, tripNo: trips.tripNo }, planId: plans.id, raisedBy: raiser.displayName, decidedBy: decider.displayName,
  }).from(issues)
    .innerJoin(stops, eq(stops.id, issues.stopId))
    .innerJoin(outlets, eq(outlets.id, stops.outletId))
    .innerJoin(trips, eq(trips.id, stops.tripId))
    .innerJoin(plans, eq(plans.id, trips.planId))
    .innerJoin(raiser, eq(raiser.id, issues.raisedBy))
    .leftJoin(decider, eq(decider.id, issues.decidedBy))
    .where(where)
    .orderBy(issues.raisedAt, issues.id);
  if (!rows.length) return [];
  // Each plan's kept check once, however many of its problems there are.
  const sent = await tx.select({ id: plans.id, date: plans.date, check: plans.sentCheck }).from(plans).where(inArray(plans.id, [...new Set(rows.map((r) => r.planId))]));
  const checks = new Map(sent.map((plan) => [plan.id, { date: plan.date, check: plan.check === null ? null : PlanCheck.parse(plan.check) }]));
  const counted = await tx.select({
    issueId: issueLines.issueId, counted: issueLines.counted, lineId: orderLines.id, quantity: orderLines.quantity, orderId: orders.id, temp: orders.temp,
    placedAt: orders.placedAt, productId: products.id, name: products.name, unit: products.unit,
  }).from(issueLines)
    .innerJoin(orderLines, eq(orderLines.id, issueLines.orderLineId))
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .innerJoin(products, eq(products.id, orderLines.productId))
    .where(inArray(issueLines.issueId, rows.map((r) => r.issue.id)));

  return rows.map(({ issue, stop, shopName, trip, planId, raisedBy, decidedBy }) => {
    const plan = checks.get(planId)!;
    const lines = counted.filter((line) => line.issueId === issue.id).sort(byLoadOrder)
      .map(({ lineId, orderId, temp, productId, name, unit, quantity, counted: good }) => ({ lineId, orderId, temp, productId, name, unit, quantity, counted: good }));
    return {
      id: issue.id, revision: issue.revision, kind: issue.kind, reason: FlagReason.parse(issue.reason), status: issue.status,
      raisedBy, raisedAt: issue.raisedAt.toISOString(), note: issue.note,
      decision: issue.decision === null ? null : LoadingDecision.parse(issue.decision), decidedBy, decidedAt: issue.decidedAt?.toISOString() ?? null,
      short: lines.reduce((units, line) => units + line.quantity - line.counted, 0),
      trip: { ...trip, leavesAt: sentTrip(plan.date, plan.check, trip.vehicleId, trip.tripNo).leavesAt.toISOString() },
      stop: { ...stop, shopName },
      lines,
    };
  });
}

// What needs the dispatcher (rule 9, D-39): the depot's open problems, oldest first, whatever day their truck is on,
// and the loader's day for the title.
export async function issueListOf(tx: Tx, depotId: string, at: Date): Promise<IssueList> {
  return {
    day: loaderDay(depotDate(at), depotMinutes(at), await operatingDays(tx)),
    issues: await issuesOf(tx, and(eq(plans.depotId, depotId), eq(issues.status, 'open'))),
  };
}

// GET /issues, in one read-only snapshot that a reset waits behind.
export function listIssues(caller: DepotCaller): Promise<IssueList> {
  return snapshot(async (tx) => issueListOf(tx, caller.depotId, (await readMoment(tx)).at));
}
