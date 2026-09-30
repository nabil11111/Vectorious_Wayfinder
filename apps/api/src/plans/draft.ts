import { DraftPlan, type PlanBoard, type PlanRef, type SavePlanRequest } from '@wayfinder/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { db, type Tx } from '../db/client';
import { deferrals, demoDay, depots, plans, stopOrders, stops, trips } from '../db/schema';
import { demoClockAt, depotDate, depotInstant, depotMinutes, now, realNow } from '../lib/clock';
import { config } from '../lib/config';
import { HttpError } from '../lib/errors';
import { announce } from '../lib/live';
import { CUTOFF_MINUTES } from '../orders/orderable-day';
import { toClock } from '../planning';
import type { Planner } from '../routes/plans';
import { boardOf, operatingDays, type BoardMoment } from './board';
import { boardDay, dayLabel } from './board-day';

export interface OpenPlan { plan: typeof plans.$inferSelect; moment: BoardMoment }
export const unknownRecord = (id: string) => new HttpError(400, 'unknown_record', 'That record does not belong to this depot and planning day.', { id });
const stale = () => new HttpError(409, 'stale', 'The plan was changed in another tab, so it was loaded again.');

// Every planning write takes exactly these locks, in this order. The instant is read only after waiting.
export async function openPlan(tx: Tx, caller: Planner, date: string, ref: PlanRef, published = false): Promise<OpenPlan> {
  const [clock] = config.DEMO_MODE ? await tx.select().from(demoDay).for('share') : [];
  if (config.DEMO_MODE && !clock) throw new Error('The demo day has no clock row. Run the seed first.');
  const [depot] = await tx.select().from(depots).where(eq(depots.id, caller.depotId)).for('no key update');
  if (!depot) throw unknownRecord(caller.depotId);
  const moment: BoardMoment = clock ? { at: new Date(demoClockAt(clock, realNow()).now), demoDay: clock.day } : { at: now(), demoDay: 1 };
  const [existing] = await tx.select().from(plans).where(and(eq(plans.depotId, caller.depotId), eq(plans.date, date)));
  // A reset reopens orders at 15:00. Its old references must still be stale (AC-13/16), so identity is
  // checked before the open-day refusals; a current reference still receives the day's precise refusal.
  if (ref.planId === null ? ref.demoDay !== moment.demoDay : !existing || existing.id !== ref.planId) throw stale();
  const day = boardDay(depotDate(moment.at), depotMinutes(moment.at), await operatingDays(tx));
  if (!day) throw new HttpError(409, 'no_plan_day', 'No delivery day is left to plan.');
  if (day.date !== date) throw new HttpError(409, 'day_moved', `Trucks for ${dayLabel(date)} leave from 03:30, so its plan can no longer be sent.`, { date: day.date });
  if (!day.open) throw new HttpError(409, 'orders_open', 'Orders for this day are still open.', { date, cutoffAt: depotInstant(day.cutoffDate, CUTOFF_MINUTES).toISOString() });
  if (ref.planId !== null) {
    if (!existing || existing.id !== ref.planId) throw stale();
    if (published) {
      if (existing.status !== 'published') throw stale();
    } else if (existing.status !== 'draft') throw new HttpError(409, 'plan_sent', `This plan was sent${existing.publishedAt ? ` at ${toClock(depotMinutes(existing.publishedAt))}` : ''}.`);
    if (existing.revision !== ref.revision) throw stale();
    return { plan: existing, moment };
  }
  if (published || existing || ref.demoDay !== moment.demoDay) throw stale();
  const [created] = await tx.insert(plans).values({ date, depotId: caller.depotId, createdBy: caller.userId }).returning();
  return { plan: created!, moment };
}

export function validateDraft(draft: DraftPlan, board: PlanBoard): void {
  const invalid = () => new HttpError(400, 'invalid_input', 'The draft repeats an order or trip, or gives a vehicle different drivers.');
  const numbered = new Set<string>();
  const assigned = new Set<string>();
  const drivers = new Map<string, string | null>();
  for (const trip of draft.trips) {
    const key = `${trip.vehicleId}:${trip.tripNo}`;
    if (numbered.has(key)) throw invalid();
    numbered.add(key);
    if (drivers.has(trip.vehicleId) && drivers.get(trip.vehicleId) !== trip.driverId) throw invalid();
    drivers.set(trip.vehicleId, trip.driverId);
    for (const stop of trip.stops) for (const id of stop.orderIds) {
      if (assigned.has(id)) throw invalid();
      assigned.add(id);
    }
  }
  for (const deferral of draft.deferrals) {
    if (assigned.has(deferral.orderId)) throw invalid();
    assigned.add(deferral.orderId);
  }
  for (const trip of draft.trips) {
    if (!board.vehicles.some((v) => v.id === trip.vehicleId)) throw unknownRecord(trip.vehicleId);
    if (trip.driverId && !board.drivers.some((d) => d.id === trip.driverId)) throw unknownRecord(trip.driverId);
    for (const stop of trip.stops) if (!board.shops.some((s) => s.id === stop.outletId)) throw unknownRecord(stop.outletId);
  }
  for (const id of assigned) if (!board.orders.some((o) => o.id === id)) throw unknownRecord(id);
  const people = [...drivers.values()].filter((id): id is string => id !== null);
  if (new Set(people).size !== people.length) throw new HttpError(400, 'driver_taken', 'A driver can drive only one vehicle on this day.');
}

// The same replacement is used by save, split/join cleanup, and send. Stops always receive fresh sequences.
export async function replaceDraft(tx: Tx, planId: string, draft: DraftPlan): Promise<void> {
  await tx.delete(trips).where(eq(trips.planId, planId));
  await tx.delete(deferrals).where(eq(deferrals.planId, planId));
  await tx.update(plans).set({ mixBrands: draft.mixBrands }).where(eq(plans.id, planId));
  for (const trip of draft.trips) {
    const alone = draft.trips.filter((t) => t.vehicleId === trip.vehicleId).length === 1;
    const [inserted] = await tx.insert(trips).values({ planId, vehicleId: trip.vehicleId, tripNo: alone ? 1 : trip.tripNo, driverId: trip.driverId,
      departAt: trip.leaveAt === null ? null : toClock(trip.leaveAt) }).returning();
    for (const [index, stop] of trip.stops.entries()) {
      const [row] = await tx.insert(stops).values({ tripId: inserted!.id, outletId: stop.outletId, seq: index + 1 }).returning();
      await tx.insert(stopOrders).values(stop.orderIds.map((orderId) => ({ stopId: row!.id, orderId })));
    }
  }
  if (draft.deferrals.length) await tx.insert(deferrals).values(draft.deferrals.map((d) => ({ ...d, planId })));
}

export async function finishPlan(tx: Tx, opened: OpenPlan): Promise<PlanBoard> {
  await tx.update(plans).set({ revision: sql`${plans.revision} + 1`, savedAt: opened.moment.at }).where(eq(plans.id, opened.plan.id));
  return boardOf(tx, opened.plan.depotId, opened.plan.date, opened.moment);
}

export async function saveDraft(caller: Planner, date: string, body: SavePlanRequest): Promise<PlanBoard> {
  const draft = DraftPlan.parse(body.plan);
  const board = await db.transaction(async (tx) => {
    const opened = await openPlan(tx, caller, date, body);
    validateDraft(draft, await boardOf(tx, caller.depotId, date, opened.moment));
    await replaceDraft(tx, opened.plan.id, draft);
    return finishPlan(tx, opened);
  });
  announce({ topic: 'plans', depotId: caller.depotId });
  return board;
}
