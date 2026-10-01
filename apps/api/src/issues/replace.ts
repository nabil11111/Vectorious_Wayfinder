import { MAX_LINE_UNITS, TEMPS } from '@wayfinder/contracts';
import { and, eq, gt } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { issueLines, orderLines, orders } from '../db/schema';
import { HttpError } from '../lib/errors';
import type { DepotCaller } from '../middleware/auth';
import { openDayAt } from '../orders/store-orders';

// "Send N replacements" (spec 015, rule 10, D-59), for a shop's report and for a driver's refusal alike: one order per
// temperature for the stop's shop, and another for each 999 units of one item beyond the first, for the day an order
// placed at the answer's instant is for (spec 009, rule 2), with a line per item holding the units the problem counts
// on it, never more than the 999 a receipt can count on a line. The dispatcher places them at the app clock's time and
// they point at the problem they answer. They are then planned, loaded, handed over and confirmed like any other order,
// and the shop's next order never counts them. Spec 009's checks on items do not apply: the items were on an order
// already. It answers the ids of the orders it placed.
export async function placeReplacements(tx: Tx, problem: { id: string; outletId: string }, caller: DepotCaller, at: Date): Promise<string[]> {
  const open = await openDayAt(tx, at);
  if (!open) throw new HttpError(409, 'no_delivery_day', 'No delivery day is open for a replacement.');
  const counted = await tx.select({ temp: orders.temp, productId: orderLines.productId, units: issueLines.counted })
    .from(issueLines).innerJoin(orderLines, eq(orderLines.id, issueLines.orderLineId)).innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(and(eq(issueLines.issueId, problem.id), gt(issueLines.counted, 0)));
  const placed: string[] = [];
  for (const temp of TEMPS) {
    // One line per item, however many of the stop's orders the problem counts it on.
    const items = new Map<string, number>();
    for (const line of counted.filter((each) => each.temp === temp)) items.set(line.productId, (items.get(line.productId) ?? 0) + line.units);
    // Two of the stop's orders can each hold up to 999 of an item, so the item can pass what one line holds. Its rest
    // continues on another order of the same temperature for the same day, so the shop can confirm every line it gets.
    for (let part = 0; [...items.values()].some((units) => units > part * MAX_LINE_UNITS); part += 1) {
      const lines = [...items].flatMap(([productId, units]) => {
        const quantity = Math.min(MAX_LINE_UNITS, units - part * MAX_LINE_UNITS);
        return quantity > 0 ? [{ productId, quantity }] : [];
      });
      const [order] = await tx.insert(orders).values({ outletId: problem.outletId, deliveryDate: open.deliveryDate, temp, status: 'placed', placedAt: at,
        placedBy: caller.userId, createdBy: caller.userId, replacesIssueId: problem.id }).returning({ id: orders.id });
      await tx.insert(orderLines).values(lines.map((line) => ({ ...line, orderId: order!.id })));
      placed.push(order!.id);
    }
  }
  return placed;
}
