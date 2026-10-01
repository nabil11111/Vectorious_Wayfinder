import { Temp, type Brand, type OrderStatus, type StoreOrder, type StoreOrderList, type StoreOrdersQuery } from '@wayfinder/contracts';
import { and, desc, eq, gt, inArray, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from '../db/client';
import { issueLines, issues, orderLines, orders, plans, stopOrders, stops, trips } from '../db/schema';
import { depotDate, now } from '../lib/clock';
import { broughtBackLine, toConfirmOf } from './card-lines';
import { deliveriesAt } from './deliveries';
import { countsFor, readOrders, readShop, snapshot, type Caller } from './store-orders';

// The lists of a shop's orders (spec 009): what is coming today, what is open and what is past. An order
// counts for the day of the sent plan it is on, and until then for the day the shop wanted. A draft is in no
// list.

// Open is every order the shop still waits for or has yet to confirm.
const OPEN: OrderStatus[] = ['placed', 'planned', 'deferred', 'loaded', 'delivered'];
// Coming today leaves out an order that has to wait, and keeps one the shop has already received.
const COMING: OrderStatus[] = ['placed', 'planned', 'loaded', 'delivered', 'received'];

// Only the past list is paged. It is in the order newest day first, chilled before dry, then by id.
const PAGE = 20;
// Where a page ended: the day its last order counts for, that order's temperature and its id.
const Cursor = z.tuple([z.iso.date(), Temp, z.uuid()]);
// The orders that come after that one in the list's order. Starting there, and not at a count of orders to
// skip, means an order received since the last page was read repeats nothing and hides nothing.
const after = ([day, temp, id]: z.infer<typeof Cursor>) =>
  or(lt(countsFor, day), and(eq(countsFor, day), or(gt(orders.temp, temp), and(eq(orders.temp, temp), gt(orders.id, id)))));

export function listOrders(caller: Caller, query: StoreOrdersQuery): Promise<StoreOrderList> {
  const cursor = query.list === 'past' && query.cursor ? Cursor.parse(query.cursor.split(',')) : null;

  return snapshot(async (tx) => {
    const today = depotDate(now());
    const shop = await readShop(tx, caller.outletId);
    const openCount = await tx.$count(orders, and(eq(orders.outletId, shop.outlet.id), inArray(orders.status, OPEN)));
    const answer = (list: StoreOrder[], nextCursor: string | null = null, toConfirm: StoreOrderList['toConfirm'] = null, broughtBack: StoreOrderList['broughtBack'] = null): StoreOrderList =>
      ({ outlet: shop.outlet, today, orders: list, openCount, nextCursor, toConfirm, broughtBack });

    // An order brought back from a closed shop is not coming today, whatever day it was for (Q-41), and Today says what
    // happened to it (L-14). Today also lists the deliveries still to confirm when the shop has more than one (Q-35).
    if (query.list === 'today') {
      const list = (await readOrders(tx, shop, and(inArray(orders.status, COMING), eq(countsFor, today)))).filter((order) => !order.broughtBack);
      return answer(list, null, toConfirmOf(await deliveriesAt(tx, shop.outlet.id), shop.outlet.brand, today), await broughtBackOf(tx, shop.outlet, today));
    }
    if (query.list === 'open') {
      return answer(await readOrders(tx, shop, inArray(orders.status, OPEN), { orderBy: [countsFor, orders.temp, orders.placedAt, orders.id] }));
    }

    // One order more than a page is read, to know whether another page follows.
    const found = await readOrders(tx, shop, and(eq(orders.status, 'received'), cursor ? after(cursor) : undefined), {
      orderBy: [desc(countsFor), orders.temp, orders.id], limit: PAGE + 1,
    });
    const page = found.slice(0, PAGE);
    const last = page.at(-1);
    return answer(page, last && found.length > PAGE ? [last.scheduledDate ?? last.deliveryDate, last.temp, last.id].join(',') : null);
  });
}

// The shop's orders a driver brought back from it on today's plan, when it was closed and the depot answered "Bring them
// back" (L-14), each with the cartons its closed attempt counted on the truck and the day of the later sent plan that
// takes it or a part of it, if one has. An order the shop has since cancelled is gone, so it has no line.
async function broughtBackOf(tx: Tx, outlet: { id: string; brand: Brand }, today: string): Promise<StoreOrderList['broughtBack']> {
  const counted = await tx.select({ orderId: orderLines.orderId, counted: issueLines.counted }).from(issues)
    .innerJoin(stops, eq(stops.id, issues.stopId)).innerJoin(trips, eq(trips.id, stops.tripId)).innerJoin(plans, eq(plans.id, trips.planId))
    .innerJoin(issueLines, eq(issueLines.issueId, issues.id)).innerJoin(orderLines, eq(orderLines.id, issueLines.orderLineId))
    .where(and(eq(stops.outletId, outlet.id), eq(issues.kind, 'closed'), eq(issues.decision, 'bring_back'), eq(plans.status, 'published'), eq(plans.date, today)));
  if (!counted.length) return null;
  const ids = [...new Set(counted.map((row) => row.orderId))];
  const found = await tx.select({ id: orders.id, temp: orders.temp, status: orders.status, splitFrom: orders.splitFrom }).from(orders)
    .where(and(eq(orders.outletId, outlet.id), or(inArray(orders.id, ids), inArray(orders.splitFrom, ids))));
  // The later sent plans each order or a part of it is on.
  const planned = await tx.select({ orderId: stopOrders.orderId, day: plans.date }).from(stopOrders)
    .innerJoin(stops, eq(stops.id, stopOrders.stopId)).innerJoin(trips, eq(trips.id, stops.tripId)).innerJoin(plans, eq(plans.id, trips.planId))
    .where(and(inArray(stopOrders.orderId, found.map((row) => row.id)), eq(plans.status, 'published'), gt(plans.date, today)));
  const shown = found.filter((row) => ids.includes(row.id) && row.status !== 'cancelled')
    .sort((a, b) => a.temp.localeCompare(b.temp) || ids.indexOf(a.id) - ids.indexOf(b.id));
  if (!shown.length) return null;
  return {
    title: 'Not coming today',
    orders: shown.map((row) => {
      const own = new Set([row.id, ...found.filter((part) => part.splitFrom === row.id).map((part) => part.id)]);
      const day = planned.filter((visit) => own.has(visit.orderId)).map((visit) => visit.day).sort()[0] ?? null;
      const units = counted.filter((line) => line.orderId === row.id).reduce((total, line) => total + line.counted, 0);
      return { orderId: row.id, line: broughtBackLine(outlet.brand, row.temp, units, day) };
    }),
  };
}
