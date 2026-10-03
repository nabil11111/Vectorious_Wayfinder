import { ReceivingList, ReceivingState, StoreReceiving, type SaveReceivingRequest } from '@wayfinder/contracts';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db, type Tx } from '../db/client';
import { auditLog, outlets, outletReceiving, plans, stops, trips, users } from '../db/schema';
import { depotDate } from '../lib/clock';
import { lockDay } from '../lib/day-lock';
import { HttpError } from '../lib/errors';
import { announce } from '../lib/live';
import type { DepotCaller } from '../middleware/auth';
import { snapshot, type Caller } from '../orders/store-orders';
import { operatingDays, readMoment } from '../plans/board';

export const unconfirmed = (outletId: string, date: string): ReceivingState => ({ outletId, date, status: 'unconfirmed', note: null, updatedAt: null, revision: 0 });
export const stateOf = (row: typeof outletReceiving.$inferSelect): ReceivingState => ReceivingState.parse({ ...row, updatedAt: row.updatedAt.toISOString() });
async function currentDate(tx: Tx, at: Date) { const date = depotDate(at); return (await operatingDays(tx)).includes(date) ? date : null; }
async function stateAt(tx: Tx, outletId: string, date: string) {
  const [row] = await tx.select().from(outletReceiving).where(and(eq(outletReceiving.outletId, outletId), eq(outletReceiving.date, date)));
  return row ? stateOf(row) : unconfirmed(outletId, date);
}
export function getStoreReceiving(caller: Caller): Promise<StoreReceiving> {
  return snapshot(async tx => { const moment = await readMoment(tx); const date = await currentDate(tx, moment.at);
    return { date, demoDay: moment.demoDay, state: date ? await stateAt(tx, caller.outletId, date) : null }; });
}
export function getReceivingList(caller: DepotCaller): Promise<ReceivingList> {
  return snapshot(async tx => {
    const date = await currentDate(tx, (await readMoment(tx)).at);
    if (!date) return { date, depot: caller.depotId, states: [] };
    const shops = await tx.select().from(outlets).where(and(eq(outlets.depotId, caller.depotId), isNull(outlets.archivedAt))).orderBy(outlets.name);
    const rows = shops.length ? await tx.select().from(outletReceiving).where(and(eq(outletReceiving.date, date), inArray(outletReceiving.outletId, shops.map(shop => shop.id)))) : [];
    const held = new Map(rows.map(row => [row.outletId, stateOf(row)]));
    return { date, depot: caller.depotId, states: shops.map(shop => ({ ...(held.get(shop.id) ?? unconfirmed(shop.id, date)), shopName: shop.name })) };
  });
}
// Assignment is checked against published plans for the declaration's calendar date, never every driver in the depot.
export async function assignedOutlets(tx: Tx, driverId: string, date: string): Promise<string[]> {
  const rows = await tx.select({ outletId: stops.outletId }).from(stops).innerJoin(trips, eq(trips.id, stops.tripId)).innerJoin(plans, eq(plans.id, trips.planId))
    .where(and(eq(trips.driverId, driverId), eq(plans.date, date), eq(plans.status, 'published')));
  return [...new Set(rows.map(row => row.outletId))];
}
export async function saveReceiving(caller: Caller, request: SaveReceivingRequest): Promise<StoreReceiving> {
  const saved = await db.transaction(async tx => {
    const locked = await lockDay(tx);
    // The outlet lock also serializes two inserts when no dated declaration exists yet.
    const [shop] = await tx.select().from(outlets).where(eq(outlets.id, caller.outletId)).for('no key update');
    if (!shop || shop.archivedAt) throw new HttpError(403, 'no_outlet', 'This shop is no longer active.');
    const moment = locked.read(); const date = await currentDate(tx, moment.at);
    if (request.demoDay !== moment.demoDay) throw new HttpError(409, 'demo_reset', 'The day was reset. Read receiving readiness again.');
    if (!date || request.date !== date) throw new HttpError(409, 'day_moved', 'The receiving day changed. Read it again.');
    const before = await stateAt(tx, caller.outletId, date);
    if (before.revision !== request.revision) throw new HttpError(409, 'stale', 'Another manager updated readiness. Read it again.');
    const values = { outletId: caller.outletId, date, status: request.status, note: request.note || null, revision: before.revision + 1, updatedBy: caller.userId, updatedAt: moment.at };
    const [row] = await tx.insert(outletReceiving).values(values).onConflictDoUpdate({ target: [outletReceiving.outletId, outletReceiving.date], set: values }).returning();
    const state = stateOf(row!);
    await tx.insert(auditLog).values({ actorId: caller.userId, action: 'receiving.updated', entity: 'outlet', entityId: shop.id, before, after: { ...state, demoDay: moment.demoDay }, at: moment.at });
    const assignments = await tx.select({ driverId: trips.driverId }).from(stops).innerJoin(trips, eq(trips.id, stops.tripId)).innerJoin(plans, eq(plans.id, trips.planId))
      .where(and(eq(stops.outletId, shop.id), eq(plans.date, date), eq(plans.status, 'published')));
    const ids = assignments.flatMap(row => row.driverId ? [row.driverId] : []);
    // Dispatchers may switch away from their home depot. Live's existing scope check still filters their actual session.
    const recipients = await tx.select({ id: users.id }).from(users).where(and(eq(users.active, true), or(eq(users.role, 'dispatcher'), and(eq(users.role, 'store_manager'), eq(users.outletId, shop.id)), ids.length ? inArray(users.id, ids) : undefined)));
    return { value: { date, demoDay: moment.demoDay, state }, depotId: shop.depotId, recipientIds: recipients.map(row => row.id) };
  });
  announce({ topic: 'receiving', id: caller.outletId, outletId: caller.outletId, depotId: saved.depotId, recipientIds: saved.recipientIds });
  return saved.value;
}
