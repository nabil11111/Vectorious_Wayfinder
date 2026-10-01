import { createHash } from 'node:crypto';
import { nextStop, type DriverDay, type DriverWrite } from '@wayfinder/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { auditLog, driverWrites, issueLines, issues, orderLines, orders, photos, plans, stops, trips } from '../db/schema';
import { lockDay, lockDepotDay } from '../lib/day-lock';
import { HttpError } from '../lib/errors';
import { announce, type Announcement } from '../lib/live';
import type { DepotCaller } from '../middleware/auth';
import { driverTripsOf, getDriverDay } from './day';
import { keptTime } from './kept-time';
import { jpegOf } from './photo';

const unknown = (id: string, message: string) => new HttpError(400, 'unknown_record', message, { id });
const inWords = (numbers: number[]) => numbers.length === 1 ? `${numbers[0]}` : `${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;

// Object key order is immaterial, while array order and every parsed value (including the photo) are kept.
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, ordered(value)]));
  return value;
}

// The day, depot (starts only), then trip are locked in that order. All six writes use the same clock.
// After commit, announce and read the answer in one snapshot so other trips cannot be read half changed.
export async function applyWrite(caller: DepotCaller, write: DriverWrite): Promise<DriverDay> {
  const told = await db.transaction(async tx => {
    const locked = write.kind === 'start' ? await lockDepotDay(tx, caller.depotId) : await lockDay(tx);
    if (!locked) throw unknown(caller.depotId, 'This account\'s depot is not on the list.');
    const [row] = await tx.select({ trip: trips, plan: plans }).from(trips).innerJoin(plans, eq(plans.id, trips.planId))
      .where(and(eq(trips.id, write.tripId), eq(plans.depotId, caller.depotId), eq(trips.driverId, caller.userId))).for('update', { of: trips });
    if (!row) throw unknown(write.tripId, 'That trip is not on your list.');
    const moment = locked.read();
    const { trip } = row;
    const [view] = await driverTripsOf(tx, [row]);
    if (!view) throw new Error(`Trip ${trip.id} could not be read.`);
    const stop = 'stopId' in write ? view.stops.find(stop => stop.id === write.stopId) : undefined;
    if ('stopId' in write && !stop) throw unknown(write.stopId, 'That stop is not on this trip.');
    if (write.kind === 'refuse') for (const line of write.lines) {
      if (!stop!.lines.some(own => own.lineId === line.lineId)) throw unknown(line.lineId, 'That line is not on this stop.');
    }
    const bodyHash = createHash('sha256').update(JSON.stringify(ordered(write))).digest('hex');
    // Reserving the id also protects different trips racing for the same global id. A failed write rolls the
    // reservation back. After a conflict, a separate read sees the committed winner at READ COMMITTED.
    const [saved] = await tx.insert(driverWrites).values({ id: write.writeId, driverId: caller.userId, tripId: trip.id, kind: write.kind, bodyHash })
      .onConflictDoNothing({ target: driverWrites.id }).returning({ id: driverWrites.id });
    if (!saved) {
      const [previous] = await tx.select().from(driverWrites).where(eq(driverWrites.id, write.writeId));
      if (!previous || previous.driverId !== caller.userId || previous.tripId !== trip.id || previous.kind !== write.kind || previous.bodyHash !== bodyHash) {
        throw new HttpError(409, 'write_reused', 'This record was already sent with other details.', { writeId: write.writeId });
      }
      await tx.update(driverWrites).set({ answeredAt: sql`now()` }).where(eq(driverWrites.id, write.writeId));
      return [];
    }
    if (write.revision !== (stop ? stop.revision : trip.revision)) {
      throw new HttpError(409, 'stale', `${stop ? stop.shopName : trip.vehicleId} was changed on another phone.`);
    }
    const details = { vehicleId: trip.vehicleId, tripNo: trip.tripNo };
    if (write.kind === 'start') {
      if (trip.status !== 'ready') throw new HttpError(409, 'trip_not_ready', `${trip.vehicleId} is not loaded yet.`, details);
      const [other] = await tx.select().from(trips).where(and(eq(trips.vehicleId, trip.vehicleId), eq(trips.status, 'out')));
      if (other) throw new HttpError(409, 'other_trip_out', `${trip.vehicleId} is still out on trip ${other.tripNo}.`, { vehicleId: trip.vehicleId, tripNo: other.tripNo });
    } else if (trip.status !== 'out') throw new HttpError(409, 'trip_not_out', `${trip.vehicleId} is not out on the road.`, details);
    if (stop) {
      if (stop.outcome || (write.kind === 'arrive' && stop.arrivedAt)) {
        throw new HttpError(409, 'stop_done', stop.outcome ? `${stop.shopName} is already done.` : `You already arrived at ${stop.shopName}.`, { stopSeq: stop.seq });
      }
      const next = nextStop(view);
      if (next && next.id !== stop.id) throw new HttpError(409, 'not_next', `${next.shopName} comes first.`, { stopSeq: next.seq });
      if (write.kind !== 'arrive' && !stop.arrivedAt) throw new HttpError(409, 'not_arrived', `Tap I've arrived at ${stop.shopName} first.`, { stopSeq: stop.seq });
    }
    if (write.kind === 'finish') {
      const left = view.stops.filter(stop => !stop.outcome).map(stop => stop.seq);
      if (left.length) throw new HttpError(409, 'stops_left', `${left.length === 1 ? 'Stop' : 'Stops'} ${inWords(left)} ${left.length === 1 ? 'is' : 'are'} not done yet.`, { stopSeqs: left });
    }
    if (write.kind === 'refuse') for (const line of write.lines) {
      const loaded = stop!.lines.find(own => own.lineId === line.lineId)!.loaded;
      if (loaded === null || line.refused > loaded) throw new HttpError(400, 'invalid_input', 'Refuse no more than the loaded count on each line.');
    }
    const jpeg = 'photo' in write && write.photo ? jpegOf(write.photo) : undefined;
    const last = trip.lastEventAt ?? trip.readyAt;
    if (!last) throw new Error(`Trip ${trip.id} has no ready time.`);
    const at = keptTime(new Date(write.at), last, moment.at);
    const told: Announcement[] = [{ topic: 'driver', depotId: caller.depotId }];
    let action: string;
    if (write.kind === 'start' || write.kind === 'finish') {
      const starting = write.kind === 'start';
      await tx.update(trips).set({ status: starting ? 'out' : 'done', revision: trip.revision + 1,
        ...(starting ? { leftAt: at } : { backAt: at }), lastEventAt: at }).where(eq(trips.id, trip.id));
      action = starting ? 'trip.started' : 'trip.finished';
      if (starting) told.push({ topic: 'loading', depotId: caller.depotId });
    } else {
      if (!stop) throw new Error(`Write ${write.writeId} has no stop.`);
      const outcome = write.kind === 'deliver' ? 'delivered' : write.kind === 'refuse' ? 'refused' : 'closed';
      await tx.update(stops).set({ revision: stop.revision + 1,
        ...(write.kind === 'arrive' ? { arrivedAt: at } : { doneAt: at, outcome }) }).where(eq(stops.id, stop.id));
      await tx.update(trips).set({ lastEventAt: at }).where(eq(trips.id, trip.id));
      action = write.kind === 'arrive' ? 'stop.arrived' : `stop.${outcome}`;
      if (write.kind === 'refuse' || write.kind === 'closed') {
        await tx.insert(issues).values({ id: write.writeId, kind: write.kind === 'refuse' ? 'refused' : 'closed', stopId: stop.id,
          reason: write.kind === 'closed' ? 'nobody_there' : write.reason, note: write.note || null, raisedBy: caller.userId, raisedAt: at });
        await tx.insert(issueLines).values(stop.lines.flatMap(line => {
          const refused = write.kind === 'refuse' ? write.lines.find(named => named.lineId === line.lineId)?.refused : undefined;
          if (write.kind === 'refuse' && refused === undefined) return [];
          if (line.loaded === null) throw new Error(`Loaded stop ${stop.id} has no loaded count for ${line.lineId}.`);
          return [{ issueId: write.writeId, orderLineId: line.lineId, counted: refused ?? line.loaded }];
        }));
        told.push({ topic: 'issues', depotId: caller.depotId });
      }
      if (write.kind === 'deliver' || write.kind === 'refuse') {
        for (const line of stop.lines) {
          if (line.loaded === null) throw new Error(`Loaded stop ${stop.id} has no loaded count for ${line.lineId}.`);
          const refused = write.kind === 'refuse' ? write.lines.find(named => named.lineId === line.lineId)?.refused ?? 0 : 0;
          await tx.update(orderLines).set({ deliveredQty: line.loaded - refused }).where(eq(orderLines.id, line.lineId));
        }
        await tx.update(orders).set({ status: 'delivered', revision: sql`${orders.revision} + 1`, updatedAt: sql`now()` })
          .where(inArray(orders.id, [...new Set(stop.lines.map(line => line.orderId))]));
        told.push({ topic: 'orders', outletId: stop.outletId, depotId: caller.depotId });
      }
      if (jpeg) await tx.insert(photos).values({ id: write.writeId, stopId: stop.id,
        issueId: write.kind === 'deliver' ? null : write.writeId, jpeg, takenBy: caller.userId, takenAt: at });
    }
    await tx.insert(auditLog).values({ actorId: caller.userId, action, entity: stop ? 'stop' : 'trip', entityId: stop?.id ?? trip.id,
      before: stop ? { revision: stop.revision, arrivedAt: stop.arrivedAt, outcome: stop.outcome } : { revision: trip.revision, status: trip.status },
      after: { writeId: write.writeId, tripId: trip.id, revision: write.revision + 1, claimedAt: write.at, keptAt: at.toISOString() } });
    return told;
  });
  for (const change of told) announce(change);
  return getDriverDay(caller);
}
