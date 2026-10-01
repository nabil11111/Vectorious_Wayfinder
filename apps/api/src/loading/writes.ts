import type { LoadingDay, MarkReadyRequest, RaiseFlagRequest, StartLoadingRequest, StopLoadedRequest } from '@wayfinder/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, type Tx } from '../db/client';
import { auditLog, issueLines, issues, orderLines, orders, outlets, plans, products, stopOrders, stops, trips } from '../db/schema';
import { depotDate, depotMinutes } from '../lib/clock';
import { lockDay, lockDepotDay, type DayMoment } from '../lib/day-lock';
import { HttpError } from '../lib/errors';
import { announce, type Announcement } from '../lib/live';
import type { DepotCaller } from '../middleware/auth';
import { operatingDays } from '../plans/board';
import { dayLabel } from '../plans/board-day';
import { loadingDayOf, trucksOf } from './day';
import { loaderDay } from './loader-day';

// The loader's writes (spec 012): starting a truck, marking a stop loaded or taking it off again (Q-16), flagging lines
// and marking the truck ready. Each is one transaction that answers the loading day, and is announced once it has
// committed.

type TripRow = typeof trips.$inferSelect;
interface OpenTrip { moment: DayMoment; trip: TripRow; plan: typeof plans.$inferSelect }

// The refusals, each with the sentence the screen shows as it is (plan.md, Contracts).
const unknownRecord = (id: string, message: string) => new HttpError(400, 'unknown_record', message, { id });
const stale = (trip: TripRow) => new HttpError(409, 'stale', `${trip.vehicleId} changed on another screen.`);
const notLoading = (trip: TripRow) => new HttpError(409, 'not_loading', `${trip.vehicleId} is not being loaded.`, { vehicleId: trip.vehicleId, tripNo: trip.tripNo });
// "1", "1 and 2", "1, 2 and 3".
const inWords = (numbers: number[]) => numbers.length === 1 ? `${numbers[0]}` : `${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;

// A line's units as a sentence names them: "4 dry cartons" for Fresh, and "10 boxes · Folded clothing" with the item's
// name for Style and Tech, as the loader's screen writes a line.
interface Units { quantity: number; temp: string; brand: string; name: string; unit: string }
const plural = (unit: string) => {
  const [head, ...rest] = unit.split(' of ');
  const words = head!.split(' ');
  const last = words.pop()!;
  return [[...words, last.endsWith('x') ? `${last}es` : `${last}s`].join(' '), ...rest].join(' of ');
};
const unitsOf = (line: Units) => {
  const unit = line.quantity === 1 ? line.unit : plural(line.unit);
  return line.brand === 'Fresh' ? `${line.quantity} ${line.temp} ${unit}` : `${line.quantity} ${unit} · ${line.name}`;
};

// Steps 1 and 2 of every loader write (plan.md): the day's lock and the clock instant read under it, then the trip with
// its plan and the trip's row locked for update. A start takes the depot's row as well, as every plan write does, so a
// start and a plan's back to edit queue one behind the other (D-33). A trip of another depot is not there.
async function openTrip(tx: Tx, caller: DepotCaller, tripId: string, withDepot: boolean): Promise<OpenTrip> {
  const moment = withDepot ? await lockDepotDay(tx, caller.depotId) : await lockDay(tx);
  if (!moment) throw unknownRecord(caller.depotId, 'This account\'s depot is not on the list.');
  const [row] = await tx.select({ trip: trips, plan: plans }).from(trips).innerJoin(plans, eq(plans.id, trips.planId))
    .where(and(eq(trips.id, tripId), eq(plans.depotId, caller.depotId))).for('update', { of: trips });
  if (!row) throw unknownRecord(tripId, 'That truck is not on this depot\'s list.');
  return { moment, ...row };
}

// One loader write. The same id as the last write applied to the trip is a retry, answered with the day as it is and
// told to nobody, so nothing counts twice (rule 10). The database keeps an id in small letters, whatever case the phone
// sent it in. Otherwise the work checks and writes, and says who hears of it.
async function loaderWrite(caller: DepotCaller, tripId: string, writeId: string, withDepot: boolean,
  work: (tx: Tx, open: OpenTrip) => Promise<Announcement[]>): Promise<LoadingDay> {
  const done = await db.transaction(async (tx) => {
    const open = await openTrip(tx, caller, tripId, withDepot);
    const told = open.trip.lastWriteId === writeId.toLowerCase() ? [] : await work(tx, open);
    return { day: await loadingDayOf(tx, caller.depotId, open.moment), told };
  });
  for (const change of done.told) announce(change);
  return done.day;
}

// Every write that changes a trip names this write's id and raises the trip's revision.
async function writeTrip(tx: Tx, trip: TripRow, writeId: string, changes: Partial<typeof trips.$inferInsert> = {}): Promise<void> {
  await tx.update(trips).set({ ...changes, revision: trip.revision + 1, lastWriteId: writeId }).where(eq(trips.id, trip.id));
}

// The writes after a start need the trip loading, at the revision the screen saw.
function requireLoading(trip: TripRow, revision: number): void {
  if (trip.status !== 'loading') throw notLoading(trip);
  if (trip.revision !== revision) throw stale(trip);
}

// "Start loading" (rule 3): a planned trip of the loader's day becomes loading, and its plan can no longer go back to
// edit (D-33).
export function startLoading(caller: DepotCaller, tripId: string, body: StartLoadingRequest): Promise<LoadingDay> {
  return loaderWrite(caller, tripId, body.writeId, true, async (tx, { moment, trip, plan }) => {
    if (plan.id !== body.plan.id || plan.status !== 'published' || plan.revision !== body.plan.revision) {
      throw new HttpError(409, 'plan_changed', `The plan for ${dayLabel(plan.date)} changed after this screen loaded it.`);
    }
    const day = loaderDay(depotDate(moment.at), depotMinutes(moment.at), await operatingDays(tx));
    if (!day) throw new HttpError(409, 'no_plan_day', 'No delivery day is left.');
    if (day !== plan.date) throw new HttpError(409, 'day_moved', `Loading has moved on to ${dayLabel(day)}.`, { date: day });
    if (trip.status !== 'planned' || trip.revision !== body.revision) throw stale(trip);
    await writeTrip(tx, trip, body.writeId, { status: 'loading' });
    await tx.insert(auditLog).values({ actorId: caller.userId, action: 'trip.loading_started', entity: 'trip', entityId: trip.id,
      before: { status: trip.status, revision: trip.revision }, after: { status: 'loading', revision: trip.revision + 1 } });
    return [{ topic: 'loading', depotId: caller.depotId }, { topic: 'plans', depotId: caller.depotId }];
  });
}

// A stop is loaded whole, and only once every stop after it is (rule 4, D-35).
export function markStopLoaded(caller: DepotCaller, tripId: string, body: StopLoadedRequest): Promise<LoadingDay> {
  return loaderWrite(caller, tripId, body.writeId, false, async (tx, { moment, trip }) => {
    requireLoading(trip, body.revision);
    const tripStops = await tx.select().from(stops).where(eq(stops.tripId, trip.id)).orderBy(stops.seq);
    const stop = tripStops.find((s) => s.id === body.stopId);
    if (!stop) throw unknownRecord(body.stopId, 'That stop is not on this truck.');
    if (stop.loadedAt) throw stale(trip);
    const first = tripStops.filter((s) => s.seq > stop.seq && !s.loadedAt).at(-1);
    if (first) throw new HttpError(409, 'load_order', `Load stop ${first.seq} first. The last stop goes in first.`, { stopSeq: first.seq });
    await tx.update(stops).set({ loadedAt: moment.at }).where(eq(stops.id, stop.id));
    await writeTrip(tx, trip, body.writeId);
    await tx.insert(auditLog).values({ actorId: caller.userId, action: 'stop.loaded', entity: 'stop', entityId: stop.id,
      before: { loadedAt: null }, after: { tripId: trip.id, seq: stop.seq, loadedAt: moment.at.toISOString() } });
    return [{ topic: 'loading', depotId: caller.depotId }];
  });
}

// A stop marked loaded by mistake comes off again until the truck is ready (Q-16). Only the last stop loaded can, as it
// went in last and sits in front of the others, so the stops on the truck stay the ones after the first not loaded.
// Its lines and flags stay as they are, and its cartons are no longer counted on.
export function undoStopLoaded(caller: DepotCaller, tripId: string, body: StopLoadedRequest): Promise<LoadingDay> {
  return loaderWrite(caller, tripId, body.writeId, false, async (tx, { trip }) => {
    requireLoading(trip, body.revision);
    const tripStops = await tx.select().from(stops).where(eq(stops.tripId, trip.id)).orderBy(stops.seq);
    const stop = tripStops.find((s) => s.id === body.stopId);
    if (!stop) throw unknownRecord(body.stopId, 'That stop is not on this truck.');
    if (!stop.loadedAt) throw stale(trip);
    // The stop loaded last is the loaded one with the lowest number.
    const later = tripStops.find((s) => s.seq < stop.seq && s.loadedAt);
    if (later) throw new HttpError(409, 'load_order', `Undo stop ${later.seq} first. The last stop loaded comes off first.`, { stopSeq: later.seq });
    await tx.update(stops).set({ loadedAt: null }).where(eq(stops.id, stop.id));
    await writeTrip(tx, trip, body.writeId);
    await tx.insert(auditLog).values({ actorId: caller.userId, action: 'stop.load_undone', entity: 'stop', entityId: stop.id,
      before: { loadedAt: stop.loadedAt.toISOString() }, after: { tripId: trip.id, seq: stop.seq, loadedAt: null } });
    return [{ topic: 'loading', depotId: caller.depotId }];
  });
}

// A flag on lines of one stop (rule 6, D-36): an open problem with the good units counted at the dock for each line.
// A line is flagged once while its truck loads, so the answer about it is never in doubt.
export function raiseFlag(caller: DepotCaller, tripId: string, body: RaiseFlagRequest): Promise<LoadingDay> {
  return loaderWrite(caller, tripId, body.writeId, false, async (tx, { moment, trip }) => {
    requireLoading(trip, body.revision);
    const [stop] = await tx.select({ id: stops.id, shopName: outlets.name }).from(stops).innerJoin(outlets, eq(outlets.id, stops.outletId))
      .where(and(eq(stops.id, body.stopId), eq(stops.tripId, trip.id)));
    if (!stop) throw unknownRecord(body.stopId, 'That stop is not on this truck.');
    const onStop = await tx.select({ id: orderLines.id, quantity: orderLines.quantity, temp: orders.temp, brand: products.brand, name: products.name, unit: products.unit })
      .from(stopOrders)
      .innerJoin(orders, eq(orders.id, stopOrders.orderId))
      .innerJoin(orderLines, eq(orderLines.orderId, orders.id))
      .innerJoin(products, eq(products.id, orderLines.productId))
      .where(eq(stopOrders.stopId, stop.id));
    const named = body.lines.map(({ lineId, counted }) => {
      const line = onStop.find((l) => l.id === lineId);
      if (!line) throw unknownRecord(lineId, 'That line is not on this stop.');
      return { ...line, counted };
    });
    const taken = new Set((await tx.select({ lineId: issueLines.orderLineId }).from(issueLines).innerJoin(issues, eq(issues.id, issueLines.issueId)).innerJoin(stops, eq(stops.id, issues.stopId))
      .where(and(eq(stops.tripId, trip.id), eq(issues.kind, 'loading'), inArray(issueLines.orderLineId, named.map((l) => l.id))))).map((row) => row.lineId));
    const flagged = named.find((l) => taken.has(l.id));
    if (flagged) {
      throw new HttpError(409, 'already_flagged', `The ${unitsOf(flagged)} for ${stop.shopName} ${flagged.quantity === 1 ? 'is' : 'are'} already flagged.`, { lineId: flagged.id });
    }
    const over = named.find((l) => l.counted >= l.quantity);
    if (over) throw new HttpError(400, 'invalid_input', `Count at most ${over.quantity - 1} of the ${unitsOf(over)} for ${stop.shopName}.`);
    const [problem] = await tx.insert(issues).values({ kind: 'loading', reason: body.reason, stopId: stop.id, raisedBy: caller.userId, raisedAt: moment.at, note: body.note || null }).returning();
    await tx.insert(issueLines).values(named.map((l) => ({ issueId: problem!.id, orderLineId: l.id, counted: l.counted })));
    await writeTrip(tx, trip, body.writeId);
    await tx.insert(auditLog).values({ actorId: caller.userId, action: 'issue.raised', entity: 'issue', entityId: problem!.id,
      after: { tripId: trip.id, stopId: stop.id, reason: body.reason, note: problem!.note, lines: body.lines, raisedAt: moment.at.toISOString() } });
    return [{ topic: 'loading', depotId: caller.depotId }, { topic: 'issues', depotId: caller.depotId }];
  });
}

// "Mark ready" (rule 8): with every stop loaded and no flag open, each line gets the count that left the dock, each order
// on the truck becomes loaded, even one whose lines all went out at 0, and the truck is ready.
export function markReady(caller: DepotCaller, tripId: string, body: MarkReadyRequest): Promise<LoadingDay> {
  return loaderWrite(caller, tripId, body.writeId, false, async (tx, { moment, trip, plan }) => {
    requireLoading(trip, body.revision);
    // The problems are read under the trip's lock, so an answer is seen whole or not at all.
    const [truck] = await trucksOf(tx, plan, [trip]);
    if (!truck) throw new Error(`${trip.vehicleId} trip ${trip.tripNo} could not be read.`);
    const left = truck.stops.filter((s) => !s.loaded).map((s) => s.seq).sort((a, b) => a - b);
    if (left.length) {
      throw new HttpError(409, 'stops_left', `${left.length === 1 ? 'Stop' : 'Stops'} ${inWords(left)} ${left.length === 1 ? 'is' : 'are'} not loaded yet.`, { stopSeqs: left });
    }
    const open = truck.issues.filter((problem) => problem.status === 'open').map((problem) => problem.id);
    if (open.length) {
      throw new HttpError(409, 'flag_open', `The dispatcher has not answered ${open.length === 1 ? 'the flag' : `${open.length} flags`} on ${trip.vehicleId} yet.`, { issueIds: open });
    }
    const lines = truck.stops.flatMap((s) => s.lines);
    for (const line of lines) await tx.update(orderLines).set({ loadedQty: line.going }).where(eq(orderLines.id, line.lineId));
    await tx.update(orders).set({ status: 'loaded', revision: sql`${orders.revision} + 1`, updatedAt: sql`now()` })
      .where(inArray(orders.id, [...new Set(lines.map((l) => l.orderId))]));
    await writeTrip(tx, trip, body.writeId, { status: 'ready', readyAt: moment.at });
    await tx.insert(auditLog).values({ actorId: caller.userId, action: 'trip.ready', entity: 'trip', entityId: trip.id,
      before: { status: trip.status, revision: trip.revision },
      after: { status: 'ready', revision: trip.revision + 1, readyAt: moment.at.toISOString(), lines: lines.map((l) => ({ lineId: l.lineId, loadedQty: l.going })) } });
    // Each shop on the truck hears of its orders with its depot, as a shop's place does.
    const shops = [...new Set(truck.stops.map((s) => s.outletId))];
    return [{ topic: 'loading', depotId: caller.depotId }, { topic: 'driver', depotId: caller.depotId }, ...shops.map((outletId) => ({ topic: 'orders', outletId, depotId: caller.depotId }))];
  });
}
