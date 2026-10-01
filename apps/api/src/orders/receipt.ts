import { deliveryFigures, writtenReason, type ReceiptWrite, type StoreDeliveries } from '@wayfinder/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { auditLog, issueLines, issues, orders, photos, plans, stops, trips } from '../db/schema';
import { lockDay } from '../lib/day-lock';
import { HttpError } from '../lib/errors';
import { jpegOf } from '../lib/jpeg';
import { keptTime } from '../lib/kept-time';
import { announce, type Announcement } from '../lib/live';
import { reserveWrite } from '../lib/phone-writes';
import { deliveriesAt, deliveriesOf, notOnYourList } from './deliveries';
import { readShop, type Caller } from './store-orders';

// The shop's receipt (spec 015, rules 3 to 8, D-56 to D-61): one delivery confirmed whole, once, with each line's count,
// the cold check, and a report when a line is short or the chilled goods were not cold. It is saved on the phone first
// and sent once (D-57), so the server keeps its id with the account, the trip, kind receipt and a hash of its body.

const invalid = (message: string) => new HttpError(400, 'invalid_input', message);
const stale = (message: string) => new HttpError(409, 'stale', message);

// POST /store/receipts, in one transaction (plan.md "A receipt", steps 1 to 12). It answers the deliveries as GET
// /store/deliveries reads them, from inside the transaction, and announces once it has committed.
export async function confirmDelivery(caller: Caller, write: ReceiptWrite): Promise<StoreDeliveries> {
  const done = await db.transaction(async (tx) => {
    // 1. The day's lock, so a receipt and a reset take turns.
    const locked = await lockDay(tx);
    // 2. The trip of the named stop, at the caller's shop on a sent plan, locked for update: the lock every driver write
    // and every answer on that trip takes. This statement reads nothing else of the stop.
    const [held] = await tx.select({ id: trips.id }).from(trips).innerJoin(stops, eq(stops.tripId, trips.id)).innerJoin(plans, eq(plans.id, trips.planId))
      .where(and(eq(stops.id, write.stopId), eq(stops.outletId, caller.outletId), eq(plans.status, 'published'))).for('update', { of: trips });
    if (!held) throw notOnYourList(write.stopId);
    // 3. Only now the clock, so a receipt that waited behind another write is judged at the moment it got the trip.
    const now = locked.read().at;
    // 4. Only now the stop and the delivery it holds, in statements of their own: in read committed a statement sees
    // what was committed before it started, so a receipt that waited for the lock judges what the write before it left.
    const [stop] = await tx.select().from(stops).where(eq(stops.id, write.stopId));
    if (!stop) throw new Error(`Stop ${write.stopId} went while its trip was locked.`);
    const [delivery] = await deliveriesAt(tx, caller.outletId, eq(stops.id, stop.id));
    const shop = await readShop(tx, caller.outletId);
    const answer = () => deliveriesOf(tx, caller, shop, now);

    // 5. The receipt's id: the same receipt again is answered as done, and the id with anything else is write_reused.
    if (await reserveWrite(tx, { writeId: write.writeId, userId: caller.userId, tripId: held.id, kind: 'receipt', body: write }) === 'repeat') {
      return { deliveries: await answer(), told: [] as Announcement[] };
    }
    // 6. A delivery is confirmed once, whatever revision a later receipt names (rule 7).
    if (delivery?.receipt) throw stale('This delivery was already confirmed.');
    // 7. The revision the phone read.
    if (write.revision !== stop.revision) throw stale('This delivery changed after this phone read it.');
    // 8. Only a stop handed over, delivered or refused, is a delivery (rule 1).
    if (!delivery || !stop.doneAt) throw new HttpError(409, 'not_delivered', 'This delivery has not been handed over.');

    // 9. The checks, in the order of the spec's table.
    for (const named of write.lines) {
      if (!delivery.lines.some((line) => line.lineId === named.lineId)) throw new HttpError(400, 'unknown_record', 'That line is not on this delivery.', { id: named.lineId });
    }
    if (write.lines.length !== delivery.lines.length) throw invalid('Count every line of the delivery once.');
    const counted = delivery.lines.map((line) => {
      const named = write.lines.find((each) => each.lineId === line.lineId)!;
      if (named.received > line.delivered) throw invalid('Count no more than was handed over on each line.');
      return { ...line, received: named.received, short: line.delivered - named.received, said: named.reason ?? null, reason: writtenReason(write, named) };
    });
    const { chilled } = deliveryFigures(delivery);
    if (chilled && write.cold === null) throw invalid('Say whether the chilled goods were still cold.');
    if (!chilled && write.cold !== null) throw invalid('Answer the cold check only when chilled goods came.');
    // Each short line says what is wrong with it, by its own reason or, from a phone that saved it before lines had
    // reasons, the receipt's one reason (Q-40); a full line says nothing.
    const short = counted.some((line) => line.short > 0);
    if (counted.some((line) => line.short > 0 && line.reason === null)) throw invalid('Say what is wrong with the cartons that are short.');
    if (counted.some((line) => line.short === 0 && line.said !== null) || (!short && write.reason !== null)) throw invalid('Say what is wrong only when a line is short.');
    const notCold = write.cold === false;
    const reported = short || notCold;
    if (write.photo !== undefined && !reported) throw invalid('Add a photo only to a report.');
    // A note goes with a report, as the photo does; one of only spaces is no note.
    const note = write.note ? write.note : null;
    if (note !== null && !reported) throw invalid('Add a note only to a report.');
    const jpeg = write.photo === undefined ? undefined : jpegOf(write.photo);

    // 10. The time kept lies between the handover and the server's clock (rule 8). The trip's last event time is the
    // driver's, and a receipt leaves it alone.
    const at = keptTime(new Date(write.at), stop.doneAt, now);

    // 11. Each line's count in one statement, every order of the delivery received, the stop's revision up, the report
    // with its lines and photo, and the audit row.
    await tx.execute(sql`update order_lines set received_qty = counted.received from (values ${sql.join(counted.map((line) => sql`(${line.lineId}::uuid, ${line.received}::int)`), sql`, `)}) as counted(id, received) where order_lines.id = counted.id`);
    await tx.update(orders).set({
      status: 'received', receivedAt: at, receiptSentAt: now, arrivedCold: sql`case when ${orders.temp} = 'chilled' then ${write.cold}::boolean end`,
      revision: sql`${orders.revision} + 1`, updatedAt: sql`now()`,
    }).where(inArray(orders.id, [...new Set(delivery.lines.map((line) => line.orderId))]));
    await tx.update(stops).set({ revision: stop.revision + 1 }).where(eq(stops.id, stop.id));
    if (reported) {
      // Rule 5: each short line at the units short, and when the chilled goods were not cold each chilled line that
      // came too, at 0 when nothing is short on it.
      // The problem's own reason is its first short line's, or not_cold; each short line keeps its own (Q-40).
      const first = counted.find((line) => line.short > 0);
      await tx.insert(issues).values({ id: write.writeId, kind: 'receipt', stopId: stop.id, reason: first ? first.reason! : 'not_cold', raisedBy: caller.userId, raisedAt: at, note });
      await tx.insert(issueLines).values(counted.filter((line) => line.short > 0 || (notCold && line.temp === 'chilled' && line.delivered > 0))
        .map((line) => ({ issueId: write.writeId, orderLineId: line.lineId, counted: line.short, reason: line.short > 0 ? line.reason : null })));
      if (jpeg) await tx.insert(photos).values({ id: write.writeId, stopId: stop.id, issueId: write.writeId, jpeg, takenBy: caller.userId, takenAt: at });
    }
    await tx.insert(auditLog).values({ actorId: caller.userId, action: 'stop.received', entity: 'stop', entityId: stop.id,
      before: { revision: stop.revision },
      after: { writeId: write.writeId, tripId: held.id, revision: stop.revision + 1, counts: counted.map((line) => ({ lineId: line.lineId, received: line.received })),
        cold: write.cold, reason: write.reason, claimedAt: write.at, keptAt: at.toISOString(),
        ...(short && write.reason === null ? { reasons: counted.filter((line) => line.short > 0).map((line) => ({ lineId: line.lineId, reason: line.reason })) } : {}),
        ...(note !== null ? { note } : {}) } });

    // 12. The answer, and what to announce once the change has committed.
    const told: Announcement[] = [{ topic: 'orders', outletId: caller.outletId, depotId: shop.depotId }];
    if (reported) told.push({ topic: 'issues', depotId: shop.depotId });
    return { deliveries: await answer(), told };
  });
  for (const change of done.told) announce(change);
  return done.deliveries;
}
