import { JoinOrderRequest, SplitOrderRequest, type PlanBoard } from '@wayfinder/contracts';
import { and, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import { db, type Tx } from '../db/client';
import { auditLog, deferrals, orderLines, orders, outlets, plans, stopOrders, stops, trips } from '../db/schema';
import { HttpError } from '../lib/errors';
import { announce } from '../lib/live';
import type { Planner } from '../routes/plans';
import { boardOf } from './board';
import { finishPlan, openPlan, replaceDraft, unknownRecord } from './draft';

const cannotSplit = () => new HttpError(409, 'cannot_split', 'A part or an order deferred in this draft cannot be split.');
const cannotJoin = () => new HttpError(409, 'cannot_join', 'Both parts must still be placed and belong to no other plan.');
const invalidSplit = () => new HttpError(400, 'invalid_input', 'Choose each product once, within its quantity, and leave at least one unit in each part.');

// Parts must preserve every product, not just the original's total weight or unit count. Send repeats this
// check under the depot lock, so a draft cannot publish parts that stopped adding up after they were made.
export async function partsAddUp(tx: Tx, originalId: string): Promise<boolean> {
  const [original] = await tx.select().from(orders).where(eq(orders.id, originalId));
  if (!original || original.status !== 'split') return false;
  const children = await tx.select({ id: orders.id }).from(orders).where(eq(orders.splitFrom, originalId));
  if (children.length !== 2) return false;
  const originals = await tx.select().from(orderLines).where(eq(orderLines.orderId, originalId));
  const lines = await tx.select().from(orderLines).where(inArray(orderLines.orderId, children.map((c) => c.id)));
  if (!originals.length || children.some((c) => !lines.some((l) => l.orderId === c.id)) || lines.some((l) => l.quantity <= 0)) return false;
  const remaining = new Map(originals.map((l) => [l.productId, l.quantity]));
  for (const line of lines) {
    const quantity = remaining.get(line.productId);
    if (quantity === undefined) return false;
    remaining.set(line.productId, quantity - line.quantity);
  }
  return [...remaining.values()].every((quantity) => quantity === 0);
}

// A join's original is no longer one of the board's eligible orders. Scope it directly, including its wanted
// day, before reading its parts. The board provides the eligible placed/deferred orders for splitting.
async function originalOf(tx: Tx, caller: Planner, date: string, id: string) {
  const [row] = await tx.select({ order: orders }).from(orders).innerJoin(outlets, eq(outlets.id, orders.outletId))
    .where(and(eq(orders.id, id), eq(outlets.depotId, caller.depotId), lte(orders.deliveryDate, date)));
  if (!row) throw unknownRecord(id);
  return row.order;
}

export async function splitOrder(caller: Planner, date: string, body: SplitOrderRequest): Promise<PlanBoard> {
  const request = SplitOrderRequest.parse(body);
  const result = await db.transaction(async (tx) => {
    const opened = await openPlan(tx, caller, date, request);
    const original = await originalOf(tx, caller, date, request.orderId);
    const board = await boardOf(tx, caller.depotId, date, opened.moment);
    if (!board.orders.some((o) => o.id === original.id)) throw unknownRecord(original.id);
    if (original.splitFrom || board.plan.deferrals.some((d) => d.orderId === original.id)) throw cannotSplit();
    const occurrences = board.plan.trips.flatMap((t) => t.stops.flatMap((s) => s.orderIds)).filter((id) => id === original.id);
    if (occurrences.length > 1) throw new HttpError(400, 'invalid_input', 'An order on two stops cannot be split.');
    const originalLines = await tx.select().from(orderLines).where(eq(orderLines.orderId, original.id));
    const kept = new Map<string, number>();
    for (const line of request.keep) {
      const source = originalLines.find((l) => l.productId === line.productId);
      if (!source || kept.has(line.productId) || line.quantity > source.quantity) throw invalidSplit();
      kept.set(line.productId, line.quantity);
    }
    const firstLines = originalLines.map((line) => ({ productId: line.productId, quantity: kept.get(line.productId) ?? 0 })).filter((line) => line.quantity > 0);
    const secondLines = originalLines.map((line) => ({ productId: line.productId, quantity: line.quantity - (kept.get(line.productId) ?? 0) })).filter((line) => line.quantity > 0);
    if (!firstLines.length || !secondLines.length) throw invalidSplit();

    await tx.update(orders).set({ status: 'split', revision: sql`${orders.revision} + 1` }).where(eq(orders.id, original.id));
    const child = { outletId: original.outletId, temp: original.temp, deliveryDate: original.deliveryDate,
      status: 'placed' as const, driverNote: original.driverNote, placedAt: original.placedAt, placedBy: original.placedBy,
      createdBy: original.createdBy, savedAt: original.savedAt, splitFrom: original.id };
    const [first] = await tx.insert(orders).values(child).returning();
    const [second] = await tx.insert(orders).values(child).returning();
    await tx.insert(orderLines).values([
      ...firstLines.map((line) => ({ ...line, orderId: first!.id })),
      ...secondLines.map((line) => ({ ...line, orderId: second!.id })),
    ]);
    await replaceDraft(tx, opened.plan.id, { ...board.plan, trips: board.plan.trips.map((trip) => ({ ...trip,
      stops: trip.stops.map((stop) => ({ ...stop, orderIds: stop.orderIds.map((id) => id === original.id ? first!.id : id) })),
    })) });
    if (!await partsAddUp(tx, original.id)) throw new HttpError(409, 'split_mismatch', 'The parts do not add up to their original.', { orderId: original.id });
    await tx.insert(auditLog).values({ actorId: caller.userId, action: 'order.split', entity: 'order', entityId: original.id,
      before: { ...original, lines: originalLines }, after: { status: 'split', revision: original.revision + 1, parts: [{ ...first, lines: firstLines }, { ...second, lines: secondLines }] } });
    return { board: await finishPlan(tx, opened), outletId: original.outletId };
  });
  announce({ topic: 'plans', depotId: caller.depotId });
  announce({ topic: 'orders', depotId: caller.depotId, outletId: result.outletId });
  return result.board;
}

export async function joinOrder(caller: Planner, date: string, body: JoinOrderRequest): Promise<PlanBoard> {
  const request = JoinOrderRequest.parse(body);
  const result = await db.transaction(async (tx) => {
    const opened = await openPlan(tx, caller, date, request);
    const original = await originalOf(tx, caller, date, request.orderId);
    if (original.status !== 'split' || original.splitFrom) throw cannotJoin();
    const children = await tx.select().from(orders).where(eq(orders.splitFrom, original.id));
    if (children.length !== 2 || children.some((c) => c.status !== 'placed')) throw cannotJoin();
    const ids = children.map((c) => c.id);
    const otherStops = await tx.select({ id: stopOrders.orderId }).from(stopOrders)
      .innerJoin(stops, eq(stops.id, stopOrders.stopId)).innerJoin(trips, eq(trips.id, stops.tripId))
      .where(and(inArray(stopOrders.orderId, ids), ne(trips.planId, opened.plan.id))).limit(1);
    const otherDeferrals = await tx.select({ id: deferrals.orderId }).from(deferrals)
      .where(and(inArray(deferrals.orderId, ids), ne(deferrals.planId, opened.plan.id))).limit(1);
    if (otherStops.length || otherDeferrals.length) throw cannotJoin();
    const board = await boardOf(tx, caller.depotId, date, opened.moment);
    await replaceDraft(tx, opened.plan.id, { ...board.plan,
      trips: board.plan.trips.map((trip) => ({ ...trip, stops: trip.stops.map((stop) => ({ ...stop,
        orderIds: stop.orderIds.filter((id) => !ids.includes(id)),
      })).filter((stop) => stop.orderIds.length > 0) })),
      deferrals: board.plan.deferrals.filter((d) => !ids.includes(d.orderId)),
    });
    await tx.delete(orders).where(inArray(orders.id, ids));
    const oldDeferrals = await tx.select({ id: deferrals.id }).from(deferrals).innerJoin(plans, eq(plans.id, deferrals.planId))
      .where(and(eq(deferrals.orderId, original.id), eq(plans.status, 'published'))).limit(1);
    const status = oldDeferrals.length ? 'deferred' : 'placed';
    await tx.update(orders).set({ status, revision: sql`${orders.revision} + 1` }).where(eq(orders.id, original.id));
    await tx.insert(auditLog).values({ actorId: caller.userId, action: 'order.joined', entity: 'order', entityId: original.id,
      before: { ...original, parts: children }, after: { status, revision: original.revision + 1 } });
    return { board: await finishPlan(tx, opened), outletId: original.outletId };
  });
  announce({ topic: 'plans', depotId: caller.depotId });
  announce({ topic: 'orders', depotId: caller.depotId, outletId: result.outletId });
  return result.board;
}
