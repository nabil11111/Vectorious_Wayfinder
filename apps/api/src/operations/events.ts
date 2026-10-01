import type { Issue, OperationsEvent, OperationsTrip } from '@wayfinder/contracts';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { auditLog, photos, plans, users } from '../db/schema';

type Plan = typeof plans.$inferSelect;
interface Sources { currentPlan: Plan | undefined; plans: Plan[]; trips: OperationsTrip[]; issues: Issue[] }

// This is a view of kept business records, not the surviving audit log. In particular, an old closed
// issue keeps its own counts after a retry clears its stop or Friday loads those orders again.
export async function eventsOf(tx: Tx, source: Sources): Promise<{ events: OperationsEvent[]; eventsTruncated: boolean }> {
  const events: OperationsEvent[] = [];
  const base = (plan: Plan): Omit<OperationsEvent, 'key' | 'kind' | 'at'> => ({ planId: plan.id, planRevision: plan.revision,
    tripId: null, stopId: null, issueId: null, vehicleId: null, shop: null, actor: null, issueKind: null, decision: null, hasPhoto: false, lines: [] });
  const current = source.currentPlan;
  if (current) {
    if (!current.publishedAt) throw new Error(`Published plan ${current.id} has no publication time.`);
    // The audit identifies only the sender of this exact publication; its wall time is never an event time.
    const [sender] = await tx.select({ name: users.displayName }).from(auditLog).leftJoin(users, eq(users.id, auditLog.actorId))
      .where(and(eq(auditLog.entity, 'plan'), eq(auditLog.entityId, current.id), eq(auditLog.action, 'plan.sent'), sql`${auditLog.after}->>'revision' = ${String(current.revision)}`)).limit(1);
    if (current.sentCheck !== null && !sender?.name) throw new Error(`Publication ${current.id} has no sender.`);
    events.push({ ...base(current), key: `plan_sent:${current.id}:${current.revision}`, kind: 'plan_sent', at: current.publishedAt.toISOString(), actor: sender?.name ?? null });
  }
  const stopIds = source.trips.flatMap(trip => trip.detailRecorded ? trip.stopDetails.map(stop => stop.id) : []);
  // Read existence and taken time, never JPEG bytes. Issue photos already have their boolean in issuesOf.
  const proofs = stopIds.length ? await tx.select({ stopId: photos.stopId, takenAt: photos.takenAt }).from(photos).where(and(inArray(photos.stopId, stopIds), isNull(photos.issueId))) : [];
  for (const row of source.trips) {
    const plan = source.plans.find(plan => plan.id === row.planId);
    if (!plan) throw new Error(`No event plan ${row.planId}.`);
    if (!row.detailRecorded) continue;
    const trip = { ...base(plan), tripId: row.tripId, vehicleId: row.vehicleId };
    for (const [kind, at] of [['truck_ready', row.trip.readyAt], ['left', row.trip.leftAt], ['back', row.trip.backAt]] as const) {
      if (at) events.push({ ...trip, key: `${kind}:${row.tripId}`, kind, at, actor: kind === 'truck_ready' ? null : row.driver?.name ?? null });
    }
    for (const stop of row.stopDetails) {
      const identity = { ...trip, stopId: stop.id, shop: { id: stop.outletId, name: stop.shopName } };
      for (const [kind, at] of [['stop_loaded', stop.loadedAt], ['arrived', stop.arrivedAt]] as const) {
        if (at) events.push({ ...identity, key: `${kind}:${stop.id}`, kind, at, actor: kind === 'stop_loaded' ? null : row.driver?.name ?? null });
      }
      if (stop.outcome === 'delivered') {
        const facts = row.trip.stops.find(facts => facts.id === stop.id);
        if (!facts || !stop.doneAt) throw new Error(`Delivered stop ${stop.id} has no outcome record.`);
        events.push({ ...identity, key: `delivered:${stop.id}`, kind: 'delivered', at: stop.doneAt, actor: row.driver?.name ?? null,
          hasPhoto: proofs.some(proof => proof.stopId === stop.id && proof.takenAt.toISOString() === stop.doneAt),
          lines: facts.lines.map(line => ({ ...line, counted: null })) });
      }
    }
  }
  // No kind switch: every joined IssueKind, including the receipt kind at its join, retains its own source.
  for (const issue of source.issues) {
    const row = source.trips.find(trip => trip.tripId === issue.trip.id);
    const plan = source.plans.find(plan => plan.id === row?.planId);
    if (!row || !plan) throw new Error(`Problem ${issue.id} has no shown trip.`);
    const identity = { ...base(plan), tripId: row.tripId, vehicleId: row.vehicleId, stopId: issue.stop.id, issueId: issue.id,
      shop: { id: issue.stop.outletId, name: issue.stop.shopName }, issueKind: issue.kind, hasPhoto: issue.hasPhoto, lines: issue.lines };
    events.push({ ...identity, key: `problem_raised:${issue.id}`, kind: 'problem_raised', at: issue.raisedAt, actor: issue.raisedBy });
    if (issue.status === 'decided') {
      if (!issue.decidedAt || !issue.decidedBy || !issue.decision) throw new Error(`Problem ${issue.id} has no complete answer.`);
      events.push({ ...identity, key: `answer_sent:${issue.id}`, kind: 'answer_sent', at: issue.decidedAt, actor: issue.decidedBy, decision: issue.decision });
    }
  }
  events.sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
  return { events: events.slice(0, 50), eventsTruncated: events.length > 50 };
}
