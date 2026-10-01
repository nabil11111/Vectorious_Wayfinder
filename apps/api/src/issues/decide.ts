import { DECISIONS_BY_KIND, type DecideIssueRequest, type DecideIssueResponse } from '@wayfinder/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { auditLog, depots, issueLines, issues, orderLines, orders, outlets, plans, stopOrders, stops, trips } from '../db/schema';
import { lockDay } from '../lib/day-lock';
import { HttpError } from '../lib/errors';
import { announce, type Announcement } from '../lib/live';
import type { DepotCaller } from '../middleware/auth';
import { issueListOf, issuesOf } from './read';
import { placeReplacements } from './replace';

// Driver answers, and the answers to a shop's report, take the trip before the issue, as driver writes and receipts do.
// Loader answers still take only the issue: they change no trip column, and ready sees their counts whole. Returning
// orders or placing replacements also takes the depot first, so a plan send cannot see them half written.
export async function decideIssue(caller: DepotCaller, issueId: string, body: DecideIssueRequest): Promise<DecideIssueResponse> {
  const answer = await db.transaction(async (tx) => {
    const locked = await lockDay(tx);
    if (body.decision === 'bring_back' || body.decision === 'send_replacements') await tx.select({ id: depots.id }).from(depots).where(eq(depots.id, caller.depotId)).for('share');
    const readIssue = () => tx.select({ issue: issues, stop: stops, trip: trips, shopName: outlets.name }).from(issues)
      .innerJoin(stops, eq(stops.id, issues.stopId))
      .innerJoin(outlets, eq(outlets.id, stops.outletId))
      .innerJoin(trips, eq(trips.id, stops.tripId))
      .innerJoin(plans, eq(plans.id, trips.planId))
      .where(and(eq(issues.id, issueId), eq(plans.depotId, caller.depotId)));
    const [known] = await readIssue();
    if (!known) throw new HttpError(400, 'unknown_record', 'That problem is not on this depot\'s list.', { id: issueId });
    if (known.issue.kind !== 'loading') await tx.select({ id: trips.id }).from(trips).where(eq(trips.id, known.trip.id)).for('update');
    const [row] = await readIssue().for('update', { of: issues });
    if (!row) throw new HttpError(400, 'unknown_record', 'That problem is not on this depot\'s list.', { id: issueId });
    const { issue, trip, stop } = row;
    const moment = issue.kind === 'loading' ? locked : locked.read();
    if (issue.status !== 'open' || issue.revision !== body.revision) throw new HttpError(409, 'stale', 'This problem was already answered.');
    if (!DECISIONS_BY_KIND[issue.kind].includes(body.decision)) throw new HttpError(400, 'invalid_input', 'That answer does not fit this problem.');
    // N is the units the problem counts, and "Send N replacements" needs at least one (spec 015, rule 9).
    if (body.decision === 'send_replacements') {
      const [counted] = await tx.select({ units: sql<number>`coalesce(sum(${issueLines.counted}), 0)::int` }).from(issueLines).where(eq(issueLines.issueId, issue.id));
      if (!counted?.units) throw new HttpError(400, 'invalid_input', 'Nothing is short, so there is nothing to replace.');
    }
    if (body.decision === 'try_again' && trip.status !== 'out') throw new HttpError(409, 'trip_not_out',
      `${trip.vehicleId} is back at the depot, so it cannot go back to ${row.shopName}.`, { vehicleId: trip.vehicleId, tripNo: trip.tripNo });
    const told: Announcement[] = [{ topic: 'issues', depotId: caller.depotId }];
    if (issue.kind === 'loading') told.push({ topic: 'loading', depotId: caller.depotId });
    if (issue.kind === 'refused' || issue.kind === 'closed') told.push({ topic: 'driver', depotId: caller.depotId });
    const before: { status: string; revision: number; lines?: { lineId: string; loaded: number | null; delivered: number | null }[] } = { status: issue.status, revision: issue.revision };
    let replacements: string[] = [];
    if (body.decision === 'try_again') {
      // The trip lock keeps retries in answer order even when the app clock pauses or moves backward.
      const retries = await tx.select({ retriedAt: stops.retriedAt }).from(stops).where(eq(stops.tripId, trip.id));
      let retryTime = moment.at.getTime();
      for (const previous of retries) {
        if (previous.retriedAt) retryTime = Math.max(retryTime, previous.retriedAt.getTime() + 1);
      }
      await tx.update(stops).set({ arrivedAt: null, doneAt: null, outcome: null, retriedAt: new Date(retryTime), revision: stop.revision + 1 }).where(eq(stops.id, stop.id));
    } else if (issue.kind === 'closed' && body.decision === 'bring_back') {
      const lines = await tx.select({ lineId: orderLines.id, orderId: orders.id, loaded: orderLines.loadedQty, delivered: orderLines.deliveredQty })
        .from(stopOrders).innerJoin(orders, eq(orders.id, stopOrders.orderId)).innerJoin(orderLines, eq(orderLines.orderId, orders.id)).where(eq(stopOrders.stopId, stop.id));
      before.lines = lines.map(({ lineId, loaded, delivered }) => ({ lineId, loaded, delivered }));
      await tx.update(orderLines).set({ loadedQty: null, deliveredQty: null }).where(inArray(orderLines.id, lines.map(line => line.lineId)));
      await tx.update(orders).set({ status: 'placed', revision: sql`${orders.revision} + 1`, updatedAt: sql`now()` }).where(inArray(orders.id, [...new Set(lines.map(line => line.orderId))]));
    } else if (body.decision === 'send_replacements') {
      // A refusal's cartons still come back on the truck; the shop gets its replacements on the next run (D-59).
      replacements = await placeReplacements(tx, { id: issue.id, outletId: stop.outletId }, caller, moment.at);
    }
    // The shop's order cards show every answer to a problem at its stop (spec 015, rule 11).
    if (issue.kind !== 'loading') told.push({ topic: 'orders', outletId: stop.outletId, depotId: caller.depotId });
    await tx.update(issues).set({ status: 'decided', decision: body.decision, decidedBy: caller.userId, decidedAt: moment.at, revision: issue.revision + 1 })
      .where(eq(issues.id, issue.id));
    await tx.insert(auditLog).values({ actorId: caller.userId, action: 'issue.decided', entity: 'issue', entityId: issue.id,
      before,
      after: { status: 'decided', decision: body.decision, revision: issue.revision + 1, decidedAt: moment.at.toISOString(), ...(body.decision === 'send_replacements' ? { replacements } : {}) } });
    const [decided] = await issuesOf(tx, eq(issues.id, issue.id));
    if (!decided) throw new Error(`Problem ${issue.id} could not be read after its answer.`);
    return { day: { ...(await issueListOf(tx, caller.depotId, moment.at)), decided }, told };
  });
  for (const change of answer.told) announce(change);
  return answer.day;
}
