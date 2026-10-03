import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { auditLog, trips } from '../db/schema';
import { DEFAULT_SETTINGS } from '../planning';

type Trip = typeof trips.$inferSelect;

// The preceding trip belongs to the vehicle and plan, even when another driver was assigned to it. A write holds
// it for share until commit: a return in progress is seen whole, and cannot be changed underneath a load or start.
export async function previousTripOf(tx: Tx, trip: Trip, locked = false): Promise<Trip | null> {
  if (trip.tripNo === 1) return null;
  const query = tx.select().from(trips).where(and(eq(trips.planId, trip.planId), eq(trips.vehicleId, trip.vehicleId), eq(trips.tripNo, trip.tripNo - 1)));
  const [previous] = await (locked ? query.for('share') : query);
  return previous ?? null;
}

// Equal app timestamps need proof of the return actually observed under the predecessor lock. Audit at uses
// transaction start time, which cannot establish action order when requests overlap.
export async function returnFactsOf(tx: Tx, trip: Trip, previous: Trip | null) {
  const countedAfterReturn = new Set<string>();
  if (trip.tripNo === 1 || previous?.status !== 'done' || !previous.backAt) return { readyAfterReturn: false, countedAfterReturn };
  const returnedAt = previous.backAt.toISOString();
  const facts = await tx.select().from(auditLog).where(and(inArray(auditLog.action, ['trip.ready', 'stop.loaded']),
    or(eq(auditLog.entityId, trip.id), sql`${auditLog.after}->>'tripId' = ${trip.id}`),
    sql`${auditLog.after}->>'previousTripId' = ${previous.id}`,
    sql`${auditLog.after}->>'returnedAt' = ${returnedAt}`));
  let readyAfterReturn = false;
  for (const fact of facts) {
    const after = fact.after as { revision?: number; readyAt?: string; loadedAt?: string } | null;
    if (fact.action === 'trip.ready' && after?.revision === trip.revision && after.readyAt === trip.readyAt?.toISOString()) readyAfterReturn = true;
    if (fact.action === 'stop.loaded' && after?.loadedAt === returnedAt) countedAfterReturn.add(fact.entityId);
  }
  return { readyAfterReturn, countedAfterReturn };
}

// New audit facts carry the locked return they relied on; unknown historical equal-time facts stay unproven.
export const returnProvenance = (previous: Trip | null) => previous?.status === 'done' && previous.backAt
  ? { previousTripId: previous.id, returnedAt: previous.backAt.toISOString() } : {};

export function tripGate(trip: Trip, previous: Trip | null, readyAfterReturn = false) {
  if (trip.tripNo === 1) return { loadingBlocked: null, reloadRequired: false, startBlocked: null, startAfter: null, returnedAt: null };
  const returnedAt = previous?.status === 'done' ? previous.backAt : null;
  const loadingBlocked = returnedAt ? null : `Wait for ${trip.vehicleId} trip ${trip.tripNo - 1} to return before loading trip ${trip.tripNo}.`;
  const reloadRequired = trip.status === 'ready' && (!returnedAt || !trip.readyAt || trip.readyAt < returnedAt
    || (trip.readyAt.getTime() === returnedAt.getTime() && !readyAfterReturn));
  const startBlocked = loadingBlocked ?? (reloadRequired ? `Ask the loader to reload ${trip.vehicleId} trip ${trip.tripNo}. It was marked ready before trip ${trip.tripNo - 1} returned.` : null);
  return { loadingBlocked, reloadRequired, startBlocked,
    startAfter: returnedAt ? new Date(returnedAt.getTime() + DEFAULT_SETTINGS.reloadMin * 60_000) : null, returnedAt };
}

// Old second-trip counts recorded while the vehicle was away were staging, not a physical load. Keep the audit
// facts, but require a count made after return before calling a stop loaded or allowing ready.
export const physicallyLoaded = (trip: Trip, previous: Trip | null, loadedAt: Date | null, countedAfterReturn = false) => {
  if (!loadedAt) return false;
  if (trip.tripNo === 1) return true;
  const returnedAt = previous?.status === 'done' ? previous.backAt : null;
  return returnedAt !== null && (loadedAt > returnedAt || (loadedAt.getTime() === returnedAt.getTime() && countedAfterReturn));
};
