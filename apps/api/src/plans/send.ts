import type { PlanBoard, SendPlanRequest, UnsendPlanRequest } from '@wayfinder/contracts';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { auditLog, deferrals, fuelLog, orders, plans, stops, trips } from '../db/schema';
import { depotDate, depotInstant } from '../lib/clock';
import { HttpError } from '../lib/errors';
import { announce } from '../lib/live';
import { toClock } from '../planning';
import type { Planner } from '../routes/plans';
import { boardOf } from './board';
import { finishPlan, openPlan, replaceDraft } from './draft';
import { partsAddUp } from './split';

const tellPlanAndShops = (board: PlanBoard) => {
  announce({ topic: 'plans', depotId: board.depot });
  announce({ topic: 'orders', depotId: board.depot });
  for (const outletId of new Set(board.orders.map((o) => o.outletId))) announce({ topic: 'orders', outletId });
};

export async function sendPlan(caller: Planner, date: string, body: SendPlanRequest): Promise<PlanBoard> {
  const result = await db.transaction(async (tx) => {
    const opened = await openPlan(tx, caller, date, body);
    // Re-read eligibility under the depot lock, store the cleaned draft, and check that exact stored plan.
    const cleaned = await boardOf(tx, caller.depotId, date, opened.moment);
    await replaceDraft(tx, opened.plan.id, cleaned.plan);
    const board = await boardOf(tx, caller.depotId, date, opened.moment);
    const check = board.check;
    if (!check) throw new Error('A draft has no plan check.');
    if (!check.ok) throw new HttpError(409, 'not_ready', 'This plan still has checks to resolve.', { blocks: check.problems.filter((p) => p.level === 'block') });
    for (const originalId of new Set(board.orders.flatMap((o) => o.splitFrom ? [o.splitFrom] : []))) {
      if (!await partsAddUp(tx, originalId)) throw new HttpError(409, 'split_mismatch', 'The split parts no longer add up to the original order.', { orderId: originalId });
    }
    if (depotDate(opened.moment.at) === date) {
      const departed = check.trips.find((t) => t.times && depotInstant(date, t.times.leaveAt) < opened.moment.at);
      if (departed) throw new HttpError(409, 'departed_already', 'This trip has already reached its leaving time.', { vehicleId: departed.vehicleId, tripNo: departed.tripNo });
    }
    await tx.update(plans).set({ status: 'published', publishedAt: opened.moment.at, sentCheck: check }).where(eq(plans.id, opened.plan.id));
    const storedTrips = await tx.select().from(trips).where(eq(trips.planId, opened.plan.id)).orderBy(trips.vehicleId, trips.tripNo);
    const writtenLitres = new Map<string, number>();
    for (const trip of storedTrips) {
      const checked = check.trips.find((t) => t.vehicleId === trip.vehicleId && t.tripNo === trip.tripNo);
      if (!checked?.times) throw new Error(`A sent trip has no times: ${trip.vehicleId} trip ${trip.tripNo}.`);
      const times = checked.times;
      for (const stop of times.stops) await tx.update(stops).set({ plannedArrival: toClock(stop.arriveAt), plannedDepart: toClock(stop.leaveAt) })
        .where(and(eq(stops.tripId, trip.id), eq(stops.seq, stop.seq)));
      const vehicle = check.vehicles.find((v) => v.vehicleId === trip.vehicleId);
      if (!vehicle) throw new Error(`A sent vehicle has no fuel figures: ${trip.vehicleId}.`);
      const written = writtenLitres.get(trip.vehicleId) ?? 0;
      const last = storedTrips.filter((t) => t.vehicleId === trip.vehicleId).at(-1)!.id === trip.id;
      const litres = last ? Math.round((vehicle.litresPlan - written) * 10) / 10 : times.litres;
      await tx.insert(fuelLog).values({ vehicleId: trip.vehicleId, date, tripId: trip.id, litres: litres.toFixed(1), note: 'Sent plan' });
      writtenLitres.set(trip.vehicleId, written + litres);
    }
    const onTrips = board.plan.trips.flatMap((t) => t.stops.flatMap((s) => s.orderIds));
    const deferred = board.plan.deferrals.map((d) => d.orderId);
    if (onTrips.length) await tx.update(orders).set({ status: 'planned', revision: sql`${orders.revision} + 1`, updatedAt: sql`now()` }).where(inArray(orders.id, onTrips));
    if (deferred.length) await tx.update(orders).set({ status: 'deferred', revision: sql`${orders.revision} + 1`, updatedAt: sql`now()` }).where(inArray(orders.id, deferred));
    await tx.insert(auditLog).values({ actorId: caller.userId, action: 'plan.sent', entity: 'plan', entityId: opened.plan.id,
      before: { revision: opened.plan.revision, status: 'draft' }, after: { revision: opened.plan.revision + 1, status: 'published', sentAt: opened.moment.at.toISOString() } });
    return finishPlan(tx, opened);
  });
  tellPlanAndShops(result);
  return result;
}

export async function unsendPlan(caller: Planner, date: string, body: UnsendPlanRequest): Promise<PlanBoard> {
  const result = await db.transaction(async (tx) => {
    const opened = await openPlan(tx, caller, date, body, true);
    const storedTrips = await tx.select().from(trips).where(eq(trips.planId, opened.plan.id)).orderBy(trips.vehicleId, trips.tripNo);
    const loading = storedTrips.find((t) => t.status !== 'planned');
    if (loading) throw new HttpError(409, 'loading_started', 'Loading has started, so this plan cannot go back to edit.', { vehicleId: loading.vehicleId, tripNo: loading.tripNo });
    const board = await boardOf(tx, caller.depotId, date, opened.moment);
    const ids = board.orders.flatMap((o) => [o.id, ...(o.splitFrom ? [o.splitFrom] : [])]);
    const earlier = ids.length ? await tx.select({ orderId: deferrals.orderId }).from(deferrals).innerJoin(plans, eq(plans.id, deferrals.planId))
      .where(and(inArray(deferrals.orderId, ids), eq(plans.status, 'published'), lt(plans.date, date))) : [];
    const wasDeferred = new Set(earlier.map((d) => d.orderId));
    for (const order of board.orders) await tx.update(orders).set({ status: wasDeferred.has(order.id) || (order.splitFrom !== null && wasDeferred.has(order.splitFrom)) ? 'deferred' : 'placed',
      revision: sql`${orders.revision} + 1`, updatedAt: sql`now()` }).where(eq(orders.id, order.id));
    if (storedTrips.length) {
      const tripIds = storedTrips.map((t) => t.id);
      await tx.delete(fuelLog).where(inArray(fuelLog.tripId, tripIds));
      await tx.update(stops).set({ plannedArrival: null, plannedDepart: null }).where(inArray(stops.tripId, tripIds));
    }
    await tx.update(plans).set({ status: 'draft', publishedAt: null, sentCheck: null }).where(eq(plans.id, opened.plan.id));
    await tx.insert(auditLog).values({ actorId: caller.userId, action: 'plan.unsent', entity: 'plan', entityId: opened.plan.id,
      before: { revision: opened.plan.revision, status: 'published' }, after: { revision: opened.plan.revision + 1, status: 'draft' } });
    return finishPlan(tx, opened);
  });
  tellPlanAndShops(result);
  return result;
}
