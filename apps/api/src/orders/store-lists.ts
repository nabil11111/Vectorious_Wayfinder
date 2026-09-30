import { Temp, type OrderStatus, type StoreOrder, type StoreOrderList, type StoreOrdersQuery } from '@wayfinder/contracts';
import { and, desc, eq, gt, inArray, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { orders } from '../db/schema';
import { depotDate, now } from '../lib/clock';
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
    const answer = (list: StoreOrder[], nextCursor: string | null = null): StoreOrderList => ({ outlet: shop.outlet, today, orders: list, openCount, nextCursor });

    if (query.list === 'today') return answer(await readOrders(tx, shop, and(inArray(orders.status, COMING), eq(countsFor, today))));
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
