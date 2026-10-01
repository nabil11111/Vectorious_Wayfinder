import { Brand as BrandOf, IssueDecision, lineReason, ReceiptReason, RefusalReason, ShortReason, type OrderDelivery, type OrderProblem, type OrderReceipt } from '@wayfinder/contracts';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db, Tx } from '../db/client';
import { issueLines, issues, orderLines, orders, outlets, plans, stopOrders, stops, trips, users } from '../db/schema';
import { depotInstant } from '../lib/clock';
import { toMinutes } from '../planning';
import { problemLineOf } from './card-lines';

// What a shop's card says about each of its orders (spec 015, rule 11): what happened at the order's latest stop on a
// sent plan, its receipt, the problems of that stop that count it, and, for a replacement or either part of one, the
// day of the delivery it replaces. One query per kind of fact, for every order of a list at once.

type Reader = Db | Tx;
const driver = alias(users, 'driver');
const original = alias(orders, 'original');

// The minute a shop's window closes, narrowed to its mall slot, as spec 007 times it and spec 013's stops show it.
export function windowCloseOf(shop: { windowClose: string; mallWindow: string | null }): number {
  const mall = shop.mallWindow?.split('-');
  return Math.min(toMinutes(shop.windowClose.slice(0, 5)), mall ? toMinutes(mall[1]!) : 24 * 60);
}

// The truck arrived after the shop's window closed on the plan's day.
export const arrivedLate = (planDate: string, arrivedAt: Date, shop: { windowClose: string; mallWindow: string | null }) =>
  arrivedAt.getTime() > depotInstant(planDate, windowCloseOf(shop)).getTime();

export interface OrderFacts {
  delivery: OrderDelivery | null;
  receipt: OrderReceipt | null;
  problems: OrderProblem[];
  replacementFor: string | null;
  broughtBack: boolean;
}

// The replacements an answer of "Send N replacements" placed (D-59), by the problem they answer: the day they are for
// and their units. They are read from the orders that point at the problem whatever their status, so a replacement the
// plan splits still counts whole: a split original keeps its lines (D-30).
export async function replacementsOf(on: Reader, issueIds: string[]): Promise<Map<string, { day: string; units: number }>> {
  if (!issueIds.length) return new Map();
  const rows = await on.select({ issueId: orders.replacesIssueId, day: orders.deliveryDate, units: sql<number>`sum(${orderLines.quantity})::int` })
    .from(orders).innerJoin(orderLines, eq(orderLines.orderId, orders.id))
    .where(and(isNotNull(orders.replacesIssueId), inArray(orders.replacesIssueId, issueIds)))
    .groupBy(orders.replacesIssueId, orders.deliveryDate);
  const found = new Map<string, { day: string; units: number }>();
  for (const row of rows) {
    const held = found.get(row.issueId!);
    // One answer places its orders for one day, so a problem's replacements never span two.
    if (held && held.day !== row.day) throw new Error(`The replacements of problem ${row.issueId} are for two days.`);
    found.set(row.issueId!, { day: row.day, units: (held?.units ?? 0) + row.units });
  }
  return found;
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

// The order lines the loader flagged at each stop as not fitting on the truck, as `${stopId}:${lineId}`. What such a line
// is short did not fit, as the driver's day reads it, not short of stock (L-09, L-21).
export async function notFittingAt(on: Reader, stopIds: string[]): Promise<Set<string>> {
  if (!stopIds.length) return new Set();
  const rows = await on.select({ stopId: issues.stopId, lineId: issueLines.orderLineId }).from(issues).innerJoin(issueLines, eq(issueLines.issueId, issues.id))
    .where(and(inArray(issues.stopId, stopIds), eq(issues.kind, 'loading'), eq(issues.reason, 'wont_fit')));
  return new Set(rows.map((row) => `${row.stopId}:${row.lineId}`));
}

// A line's units short at the depot, split into those that did not fit on the truck and those short of stock.
export const shortOf = (flagged: boolean, ordered: number, loaded: number) => {
  const wontFit = flagged ? ordered - loaded : 0;
  return { wontFit, shortFromDepot: ordered - loaded - wontFit };
};

export async function factsOf(on: Reader, outletId: string, orderIds: string[]): Promise<Map<string, OrderFacts>> {
  const facts = new Map<string, OrderFacts>();
  if (!orderIds.length) return facts;
  const [shop] = await on.select().from(outlets).where(eq(outlets.id, outletId));
  if (!shop) throw new Error(`No outlet ${outletId}.`);
  const rows = await on.select({ id: orders.id, status: orders.status, temp: orders.temp, cold: orders.arrivedCold, receivedAt: orders.receivedAt, sentAt: orders.receiptSentAt,
    replacesIssueId: orders.replacesIssueId, originalReplaces: original.replacesIssueId })
    .from(orders).leftJoin(original, eq(original.id, orders.splitFrom)).where(inArray(orders.id, orderIds));
  const lines = await on.select({ orderId: orderLines.orderId, lineId: orderLines.id, quantity: orderLines.quantity, loaded: orderLines.loadedQty,
    delivered: orderLines.deliveredQty, received: orderLines.receivedQty }).from(orderLines).where(inArray(orderLines.orderId, orderIds));

  // Each order's latest stop on a sent plan: the plan with the latest date.
  const visits = await on.select({ orderId: stopOrders.orderId, stop: stops, vehicleId: trips.vehicleId, driver: driver.displayName, day: plans.date })
    .from(stopOrders).innerJoin(stops, eq(stops.id, stopOrders.stopId)).innerJoin(trips, eq(trips.id, stops.tripId))
    .innerJoin(plans, eq(plans.id, trips.planId)).leftJoin(driver, eq(driver.id, trips.driverId))
    .where(and(inArray(stopOrders.orderId, orderIds), eq(plans.status, 'published'))).orderBy(desc(plans.date), stops.id);
  const latest = new Map<string, (typeof visits)[number]>();
  for (const visit of visits) if (!latest.has(visit.orderId)) latest.set(visit.orderId, visit);
  const stopIds = [...new Set([...latest.values()].map((visit) => visit.stop.id))];

  // The problems of those stops that a card shows, with the lines they count, oldest first.
  const problems = stopIds.length ? await on.select().from(issues)
    .where(and(inArray(issues.stopId, stopIds), inArray(issues.kind, ['refused', 'closed', 'receipt']))).orderBy(issues.raisedAt, issues.id) : [];
  const counted = problems.length ? await on.select().from(issueLines).where(inArray(issueLines.issueId, problems.map((problem) => problem.id))) : [];
  const replacements = await replacementsOf(on, problems.map((problem) => problem.id));
  const notFitting = await notFittingAt(on, stopIds);

  // The day of the delivery each replacement replaces: its problem's plan. A part reaches it through its original.
  const answered = [...new Set(rows.flatMap((row) => row.replacesIssueId ?? row.originalReplaces ?? []))];
  const replaced = answered.length ? await on.select({ id: issues.id, day: plans.date }).from(issues).innerJoin(stops, eq(stops.id, issues.stopId))
    .innerJoin(trips, eq(trips.id, stops.tripId)).innerJoin(plans, eq(plans.id, trips.planId)).where(inArray(issues.id, answered)) : [];

  for (const row of rows) {
    const own = lines.filter((line) => line.orderId === row.id);
    const visit = latest.get(row.id);
    const atStop = visit ? problems.filter((problem) => problem.stopId === visit.stop.id) : [];
    const countedHere = (problemId: string) => counted.filter((line) => line.issueId === problemId && own.some((mine) => mine.lineId === line.orderLineId));
    const issueId = row.replacesIssueId ?? row.originalReplaces;
    facts.set(row.id, {
      delivery: visit ? deliveryOf(visit, own, atStop, counted, shop, notFitting) : null,
      receipt: row.status === 'received' && row.receivedAt && own.length && own.every((line) => line.received !== null) ? {
        at: row.receivedAt.toISOString(), sentAt: row.sentAt?.toISOString() ?? null,
        units: sum(own.map((line) => line.received!)), short: sum(own.map((line) => line.quantity - line.received!)),
      } : null,
      problems: atStop.filter((problem) => countedHere(problem.id).length > 0).map((problem) => {
        const kind = problem.kind as OrderProblem['kind'];
        const decision = problem.decision === null ? null : IssueDecision.parse(problem.decision);
        const replacementDay = replacements.get(problem.id)?.day ?? null;
        const here = countedHere(problem.id);
        // A report's lines with the shop's own reason, and one kept before lines had reasons its one (Q-40).
        const lines = here.map((line) => ({ counted: line.counted, reason: kind === 'receipt'
          ? lineReason({ reason: ReceiptReason.parse(problem.reason) }, { counted: line.counted, reason: line.reason === null ? null : ShortReason.parse(line.reason) }) : null }));
        const line = problemLineOf({ kind, brand: BrandOf.parse(shop.brand), temp: row.temp, lines, refusalReason: kind === 'refused' ? RefusalReason.parse(problem.reason) : null,
          warm: kind === 'receipt' && row.temp === 'chilled' && row.cold === false, decision, replacementDay });
        return { id: problem.id, kind, units: sum(here.map((each) => each.counted)), decision, replacementDay, line };
      }),
      replacementFor: issueId ? replaced.find((problem) => problem.id === issueId)?.day ?? null : null,
      // Placed again by "Bring them back" at a closed shop, and on no later sent plan yet (Q-41).
      broughtBack: row.status === 'placed' && visit?.stop.outcome === 'closed' && atStop.some((problem) => problem.kind === 'closed' && problem.decision === 'bring_back'),
    });
  }
  return facts;
}

type Visit = { stop: typeof stops.$inferSelect; vehicleId: string; driver: string | null; day: string };
type Line = { lineId: string; quantity: number; loaded: number | null; delivered: number | null };

// What happened at the stop, once it is done. A closed stop's counts are its attempt's, from its problem, as spec
// 013's day reads them, whatever later happened to the order.
function deliveryOf(visit: Visit, own: Line[], atStop: (typeof issues.$inferSelect)[], counted: (typeof issueLines.$inferSelect)[], shop: { windowClose: string; mallWindow: string | null }, notFitting: Set<string>): OrderDelivery | null {
  const { stop } = visit;
  if (stop.outcome === null) return null;
  if (!stop.arrivedAt || !stop.doneAt) throw new Error(`Stop ${stop.id} is done with no arrival.`);
  const base = { stopId: stop.id, vehicleId: visit.vehicleId, driver: visit.driver, arrivedAt: stop.arrivedAt.toISOString(), doneAt: stop.doneAt.toISOString(),
    outcome: stop.outcome, late: arrivedLate(visit.day, stop.arrivedAt, shop) };
  if (stop.outcome === 'closed') {
    const attempt = atStop.find((problem) => problem.kind === 'closed' && problem.decision !== 'try_again');
    if (!attempt) throw new Error(`Closed stop ${stop.id} has no closed attempt.`);
    const loaded = own.map((line) => {
      const found = counted.find((each) => each.issueId === attempt.id && each.orderLineId === line.lineId);
      if (!found) throw new Error(`Closed attempt ${attempt.id} has no count for ${line.lineId}.`);
      return shortOf(notFitting.has(`${stop.id}:${line.lineId}`), line.quantity, found.counted);
    });
    return { ...base, delivered: null, shortFromDepot: sum(loaded.map((line) => line.shortFromDepot)), wontFit: sum(loaded.map((line) => line.wontFit)), refused: 0, refusalReason: null };
  }
  const handed = own.map((line) => {
    if (line.loaded === null || line.delivered === null) throw new Error(`Line ${line.lineId} of stop ${stop.id} has no handed over count.`);
    return { loaded: line.loaded, delivered: line.delivered, ...shortOf(notFitting.has(`${stop.id}:${line.lineId}`), line.quantity, line.loaded) };
  });
  const refusal = atStop.find((problem) => problem.kind === 'refused');
  return {
    ...base, delivered: sum(handed.map((line) => line.delivered)), shortFromDepot: sum(handed.map((line) => line.shortFromDepot)), wontFit: sum(handed.map((line) => line.wontFit)),
    refused: sum(handed.map((line) => line.loaded - line.delivered)),
    refusalReason: stop.outcome === 'refused' && refusal ? RefusalReason.parse(refusal.reason) : null,
  };
}
