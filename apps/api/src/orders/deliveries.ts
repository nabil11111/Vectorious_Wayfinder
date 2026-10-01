import { byDeliveryOrder, lineReason, ReceiptDecision, ReceiptReason, RefusalReason, ShortReason, type StoreDeliveries, type StoreDelivery } from '@wayfinder/contracts';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db, Tx } from '../db/client';
import { issueLines, issues, orderLines, orders, outlets, plans, products, stopOrders, stops, trips, users } from '../db/schema';
import { depotDate } from '../lib/clock';
import { HttpError } from '../lib/errors';
import { appliedWriteIdsOf } from '../lib/phone-writes';
import { byLoadOrder } from '../loading/loader-day';
import { readMoment } from '../plans/board';
import { arrivedLate, notFittingAt, replacementsOf, shortOf } from './order-facts';
import { readShop, snapshot, type Caller, type Shop } from './store-orders';

// The deliveries a shop confirms (spec 015, rules 1 and 2, D-56): the stops of sent plans at the shop that the driver
// saved as delivered or refused, each with its lines in spec 012's order, what the shop counts against, and its receipt
// once the shop confirmed it.

type Reader = Db | Tx;
const driver = alias(users, 'driver');

export const notOnYourList = (id: string) => new HttpError(400, 'unknown_record', 'That delivery is not on your list.', { id });

// The shop's deliveries that `where` picks, whatever their day: its stops on sent plans saved as delivered or refused,
// in the server's order. Each delivery's receipt is read from the orders it covers (D-61), its report from the stop's
// problem of kind receipt with the replacements its answer placed, and its refusal's reason from the stop's problem of
// kind refused.
export async function deliveriesAt(on: Reader, outletId: string, where?: SQL): Promise<StoreDelivery[]> {
  const [shop] = await on.select().from(outlets).where(eq(outlets.id, outletId));
  if (!shop) throw new Error(`No outlet ${outletId}.`);
  const rows = await on.select({ stop: stops, vehicleId: trips.vehicleId, day: plans.date, driver: driver.displayName })
    .from(stops).innerJoin(trips, eq(trips.id, stops.tripId)).innerJoin(plans, eq(plans.id, trips.planId)).leftJoin(driver, eq(driver.id, trips.driverId))
    .where(and(eq(stops.outletId, outletId), eq(plans.status, 'published'), inArray(stops.outcome, ['delivered', 'refused']), where));
  if (!rows.length) return [];
  const stopIds = rows.map((row) => row.stop.id);
  const lines = await on.select({
    stopId: stopOrders.stopId, lineId: orderLines.id, orderId: orders.id, temp: orders.temp, placedAt: orders.placedAt, status: orders.status,
    receivedAt: orders.receivedAt, sentAt: orders.receiptSentAt, cold: orders.arrivedCold, productId: products.id, name: products.name, unit: products.unit,
    ordered: orderLines.quantity, loaded: orderLines.loadedQty, delivered: orderLines.deliveredQty, received: orderLines.receivedQty,
  }).from(stopOrders).innerJoin(orders, eq(orders.id, stopOrders.orderId)).innerJoin(orderLines, eq(orderLines.orderId, orders.id))
    .innerJoin(products, eq(products.id, orderLines.productId)).where(inArray(stopOrders.stopId, stopIds));
  const problems = await on.select().from(issues).where(and(inArray(issues.stopId, stopIds), inArray(issues.kind, ['refused', 'receipt'])));
  const reports = problems.filter((problem) => problem.kind === 'receipt');
  const counted = reports.length ? await on.select().from(issueLines).where(inArray(issueLines.issueId, reports.map((report) => report.id))) : [];
  const replacements = await replacementsOf(on, reports.map((report) => report.id));
  const notFitting = await notFittingAt(on, stopIds);

  return rows.map(({ stop, vehicleId, day, driver: driverName }): StoreDelivery => {
    const own = lines.filter((line) => line.stopId === stop.id).sort(byLoadOrder);
    if (!stop.arrivedAt || !stop.doneAt || (stop.outcome !== 'delivered' && stop.outcome !== 'refused')) throw new Error(`Stop ${stop.id} is not handed over.`);
    const order = own.map((line) => line.lineId);
    const refusal = problems.find((problem) => problem.stopId === stop.id && problem.kind === 'refused');
    const report = reports.find((problem) => problem.stopId === stop.id);
    const confirmed = own.length > 0 && own.every((line) => line.status === 'received');
    const first = own[0];
    if (confirmed && (!first?.receivedAt || own.some((line) => line.received === null))) throw new Error(`The received orders of stop ${stop.id} have no counts.`);
    return {
      stopId: stop.id, revision: stop.revision, day, vehicleId, driver: driverName, arrivedAt: stop.arrivedAt.toISOString(), doneAt: stop.doneAt.toISOString(),
      outcome: stop.outcome, late: arrivedLate(day, stop.arrivedAt, shop), refusalReason: refusal ? RefusalReason.parse(refusal.reason) : null,
      lines: own.map(({ lineId, orderId, temp, productId, name, unit, ordered, loaded, delivered, received }) => {
        if (loaded === null || delivered === null) throw new Error(`Line ${lineId} of stop ${stop.id} has no handed over count.`);
        return { lineId, orderId, temp, productId, name, unit, ordered, loaded, wontFit: shortOf(notFitting.has(`${stop.id}:${lineId}`), ordered, loaded).wontFit, delivered, received };
      }),
      receipt: confirmed && first?.receivedAt ? {
        at: first.receivedAt.toISOString(),
        sentAt: first.sentAt?.toISOString() ?? null,
        // A receipt keeps the cold check on its chilled orders, and none when no chilled line came.
        cold: own.find((line) => line.temp === 'chilled')?.cold ?? null,
        report: report ? {
          id: report.id, reason: ReceiptReason.parse(report.reason),
          // Each line with its own reason; a report kept before lines had reasons gives its short lines its own (Q-40).
          lines: counted.filter((line) => line.issueId === report.id).sort((a, b) => order.indexOf(a.orderLineId) - order.indexOf(b.orderLineId))
            .map((line) => ({ lineId: line.orderLineId, counted: line.counted,
              reason: lineReason({ reason: ReceiptReason.parse(report.reason) }, { counted: line.counted, reason: line.reason === null ? null : ShortReason.parse(line.reason) }) })),
          note: report.note,
          decision: report.decision === null ? null : ReceiptDecision.parse(report.decision), decidedAt: report.decidedAt?.toISOString() ?? null,
          replacement: replacements.get(report.id) ?? null,
        } : null,
      } : null,
    };
  }).sort(byDeliveryOrder);
}

// The shop's deliveries as GET /store/deliveries and a receipt answer them (rule 1): those to confirm, oldest handover
// first, and those confirmed on the app clock's today, latest first, with every phone write the account had applied in
// the last 48 hours, whatever deliveries are listed.
export async function deliveriesOf(tx: Tx, caller: Caller, shop: Shop, at: Date): Promise<StoreDeliveries> {
  const today = depotDate(at);
  const deliveries = (await deliveriesAt(tx, shop.outlet.id)).filter((delivery) => delivery.receipt === null || depotDate(new Date(delivery.receipt.at)) === today);
  return { outlet: shop.outlet, userId: caller.userId, today, appliedWriteIds: await appliedWriteIdsOf(tx, caller.userId), deliveries };
}

// GET /store/deliveries, in one read-only snapshot that a reset waits behind.
export function getDeliveries(caller: Caller): Promise<StoreDeliveries> {
  return snapshot(async (tx) => deliveriesOf(tx, caller, await readShop(tx, caller.outletId), (await readMoment(tx)).at));
}

// GET /store/deliveries/:stopId: one delivery of the caller's shop whatever its day, else unknown_record.
export function getDelivery(caller: Caller, stopId: string): Promise<StoreDelivery> {
  return snapshot(async (tx) => {
    const [delivery] = await deliveriesAt(tx, caller.outletId, eq(stops.id, stopId));
    if (!delivery) throw notOnYourList(stopId);
    return delivery;
  });
}
