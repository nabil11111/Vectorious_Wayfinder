import { DECISIONS_BY_KIND, type DecideIssueRequest, type DecideIssueResponse } from '@wayfinder/contracts';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { auditLog, issues, plans, stops, trips } from '../db/schema';
import { lockDay } from '../lib/day-lock';
import { HttpError } from '../lib/errors';
import { announce } from '../lib/live';
import type { DepotCaller } from '../middleware/auth';
import { issueListOf, issuesOf } from './read';

// The dispatcher's answer to a loader's flag (rule 7, D-37): "Go short" or "Load it all", once, from Live day. The
// plan, the stops and the lines stay as they are. It changes no column of the trip, so it locks none: a ready reads the
// problems under the trip's lock, and sees the answer whole or not at all.
export async function decideIssue(caller: DepotCaller, issueId: string, body: DecideIssueRequest): Promise<DecideIssueResponse> {
  const answer = await db.transaction(async (tx) => {
    // The day's lock and its clock instant, then the problem's row with its stop, trip and plan.
    const moment = await lockDay(tx);
    const [row] = await tx.select({ issue: issues }).from(issues)
      .innerJoin(stops, eq(stops.id, issues.stopId))
      .innerJoin(trips, eq(trips.id, stops.tripId))
      .innerJoin(plans, eq(plans.id, trips.planId))
      .where(and(eq(issues.id, issueId), eq(plans.depotId, caller.depotId))).for('update', { of: issues });
    if (!row) throw new HttpError(400, 'unknown_record', 'That problem is not on this depot\'s list.', { id: issueId });
    const { issue } = row;
    if (issue.status !== 'open' || issue.revision !== body.revision) throw new HttpError(409, 'stale', 'This problem was already answered.');
    if (!DECISIONS_BY_KIND[issue.kind].includes(body.decision)) throw new HttpError(400, 'invalid_input', 'That answer does not fit this problem.');
    await tx.update(issues).set({ status: 'decided', decision: body.decision, decidedBy: caller.userId, decidedAt: moment.at, revision: issue.revision + 1 })
      .where(eq(issues.id, issue.id));
    await tx.insert(auditLog).values({ actorId: caller.userId, action: 'issue.decided', entity: 'issue', entityId: issue.id,
      before: { status: issue.status, revision: issue.revision },
      after: { status: 'decided', decision: body.decision, revision: issue.revision + 1, decidedAt: moment.at.toISOString() } });
    const [decided] = await issuesOf(tx, eq(issues.id, issue.id));
    if (!decided) throw new Error(`Problem ${issue.id} could not be read after its answer.`);
    return { ...(await issueListOf(tx, caller.depotId, moment.at)), decided };
  });
  announce({ topic: 'issues', depotId: caller.depotId });
  announce({ topic: 'loading', depotId: caller.depotId });
  return answer;
}
