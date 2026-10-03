import { z } from 'zod';
import { Brand, CLOSED_REASONS, IssueDecision, PhotoDataUrl, RefusalReason, StopOutcome, Temp } from './basics';
import { DockType } from './store';
import { ReceivingState } from './receiving';
import { TripStatus } from './plans';

const Moment = z.iso.datetime();
const Count = z.number().int().min(0);
export const DRIVER_WRITE_KINDS = ['start', 'arrive', 'deliver', 'refuse', 'closed', 'finish'] as const;
export const DriverWriteKind = z.enum(DRIVER_WRITE_KINDS);
export type DriverWriteKind = z.infer<typeof DriverWriteKind>;
// wontFit: of what the loader went short on, the units the truck could not take (a "won't fit" flag), not short of stock (L-09).
// A day a phone kept from before it was told has none, so it reads as 0.
export const DriverLine = z.object({ lineId: z.uuid(), orderId: z.uuid(), temp: Temp, productId: z.string(), name: z.string(), unit: z.string(), quantity: Count, loaded: Count.nullable(), wontFit: Count.default(0), delivered: Count.nullable() });
export type DriverLine = z.infer<typeof DriverLine>;
export const DriverStop = z.object({
  id: z.uuid(), seq: z.number().int().min(1), revision: Count, retriedAt: Moment.nullable(), outletId: z.string(), shopName: z.string(), district: z.string(), dockType: DockType,
  receiving: ReceivingState.nullable().optional(),
  windowOpen: z.string(), windowClose: z.string(), note: z.string().nullable(), arrivedAt: Moment.nullable(), doneAt: Moment.nullable(), outcome: StopOutcome.nullable(), lines: z.array(DriverLine),
});
export type DriverStop = z.infer<typeof DriverStop>;
export const DriverProblem = z.object({
  id: z.uuid(), kind: z.enum(['refused', 'closed']), stopId: z.uuid(), reason: z.enum([...RefusalReason.options, ...CLOSED_REASONS]), note: z.string().nullable(), raisedAt: Moment, hasPhoto: z.boolean(),
  lines: z.array(z.object({ lineId: z.uuid(), counted: Count })), decision: IssueDecision.nullable(), decidedBy: z.string().nullable(), decidedAt: Moment.nullable(),
});
export type DriverProblem = z.infer<typeof DriverProblem>;
export const DriverTrip = z.object({
  tripId: z.uuid(), revision: Count, vehicleId: z.string(), vehicleType: z.enum(['truck', 'van']), vehicleTemp: z.enum(['reefer', 'ambient']), tripNo: z.number().int(), brand: Brand.nullable(), district: z.string(), status: TripStatus,
  // backByWords is the server's wording of backBy against the app clock: "back by 06:10", or "was due back 06:10" once
  // it has passed, as a planned time is the plan's and not a promise.
  leavesAt: Moment, backBy: Moment, backByWords: z.string(), readyAt: Moment.nullable(), leftAt: Moment.nullable(), backAt: Moment.nullable(), stops: z.array(DriverStop), problems: z.array(DriverProblem),
  // Server gates based on this vehicle's preceding actual return and configured reload interval. Older cached
  // second trips without these fields must refresh before departure.
  startAfter: Moment.nullable().optional(), startBlocked: z.string().nullable().optional(),
});
export type DriverTrip = z.infer<typeof DriverTrip>;
// driverId is the signed-in account, so a phone holding one driver's writes can tell another account apart even when
// the two share a display name.
export const DriverDay = z.object({ depot: z.string(), driver: z.string(), driverId: z.uuid(), day: z.iso.date().nullable(), planSent: z.boolean(), appliedWriteIds: z.array(z.uuid()), trips: z.array(DriverTrip) });
export type DriverDay = z.infer<typeof DriverDay>;
const Photo = PhotoDataUrl;
const BaseWrite = z.object({ writeId: z.uuid().transform(id => id.toLowerCase()), tripId: z.uuid().transform(id => id.toLowerCase()), at: Moment, revision: Count });
const StopWrite = BaseWrite.extend({ stopId: z.uuid().transform(id => id.toLowerCase()) });
const Note = z.string().trim().max(200);
export const DriverWrite = z.discriminatedUnion('kind', [
  BaseWrite.extend({ kind: z.literal('start') }), BaseWrite.extend({ kind: z.literal('finish') }),
  StopWrite.extend({ kind: z.literal('arrive') }), StopWrite.extend({ kind: z.literal('deliver'), photo: Photo }),
  StopWrite.extend({ kind: z.literal('refuse'), reason: RefusalReason, note: Note, photo: Photo.optional(),
    lines: z.array(z.object({ lineId: z.uuid().transform(id => id.toLowerCase()), refused: z.number().int().min(1).max(999) })).min(1).max(20)
      .refine(lines => new Set(lines.map(line => line.lineId)).size === lines.length, 'Name each line once.') }),
  StopWrite.extend({ kind: z.literal('closed'), note: Note.optional(), photo: Photo.optional() }),
]);
export type DriverWrite = z.infer<typeof DriverWrite>;
export const DRIVER_ERROR_CODES = ['trip_not_ready', 'other_trip_out', 'trip_not_out', 'not_next', 'not_arrived', 'stop_done', 'write_reused', 'previous_trip_not_returned', 'reload_wait', 'reload_required'] as const;
export type DriverErrorCode = (typeof DRIVER_ERROR_CODES)[number];
export const DriverStopDetails = z.object({ stopSeq: z.number().int().min(1) });
export const WriteReusedDetails = z.object({ writeId: z.uuid() });

// Both the phone and server use this order. Reopening a stop sends it behind the untouched stops and earlier retries.
export function nextStop(trip: DriverTrip): DriverStop | null {
  return [...trip.stops].filter(stop => stop.outcome === null).sort((a, b) =>
    (a.retriedAt === null ? 0 : 1) - (b.retriedAt === null ? 0 : 1)
    || (a.retriedAt ?? '').localeCompare(b.retriedAt ?? '') || a.seq - b.seq)[0] ?? null;
}

// On plain values, with the time already kept by the server or claimed by the phone. Validation belongs to writes.
export function applyDriverWrite(day: DriverDay, write: DriverWrite): DriverDay {
  if (day.appliedWriteIds.includes(write.writeId)) return day;
  const own = day.trips.find(trip => trip.tripId === write.tripId);
  if (!own || ('stopId' in write && !own.stops.some(stop => stop.id === write.stopId))) return day;
  const result = structuredClone(day);
  const trip = result.trips.find(trip => trip.tripId === write.tripId)!;
  result.appliedWriteIds.push(write.writeId);
  result.appliedWriteIds.sort();
  // The API stores instants to millisecond precision. Keep the phone's projection in that same ISO form.
  const at = new Date(write.at).toISOString();
  if (write.kind === 'start' || write.kind === 'finish') {
    trip.revision += 1;
    if (write.kind === 'start') { trip.status = 'out'; trip.leftAt = at; }
    else { trip.status = 'done'; trip.backAt = at; }
    return result;
  }
  const stop = trip.stops.find(stop => stop.id === write.stopId)!;
  stop.revision += 1;
  if (write.kind === 'arrive') { stop.arrivedAt = at; return result; }
  stop.doneAt = at;
  stop.outcome = write.kind === 'deliver' ? 'delivered' : write.kind === 'refuse' ? 'refused' : 'closed';
  for (const line of stop.lines) {
    const refused = write.kind === 'refuse' ? write.lines.find(named => named.lineId === line.lineId)?.refused ?? 0 : 0;
    line.delivered = write.kind === 'closed' ? null : line.loaded === null ? null : line.loaded - refused;
  }
  if (write.kind === 'refuse' || write.kind === 'closed') {
    trip.problems.push({ id: write.writeId, kind: write.kind === 'refuse' ? 'refused' : 'closed', stopId: stop.id,
      reason: write.kind === 'refuse' ? write.reason : 'nobody_there', note: write.note || null, raisedAt: at, hasPhoto: write.photo !== undefined,
      lines: write.kind === 'refuse' ? stop.lines.flatMap(line => {
        const named = write.lines.find(named => named.lineId === line.lineId);
        return named ? [{ lineId: line.lineId, counted: named.refused }] : [];
      }) : stop.lines.map(line => ({ lineId: line.lineId, counted: line.loaded ?? 0 })),
      decision: null, decidedBy: null, decidedAt: null });
    trip.problems.sort((a, b) => a.raisedAt.localeCompare(b.raisedAt) || a.id.localeCompare(b.id));
  }
  return result;
}

// Counts stay with the attempt: a closed stop already has its historical loaded counts from its problem.
export function tripFigures(trip: DriverTrip) {
  // short is all the loader did not load, and wontFit the part of it the truck could not take (L-09).
  const zero = () => ({ ordered: 0, loaded: 0, delivered: 0, refused: 0, notDelivered: 0, short: 0, wontFit: 0, onTruck: 0 });
  type Counts = ReturnType<typeof zero>;
  const add = (counts: Counts[]) => counts.reduce((total, value) => {
    for (const key of Object.keys(total) as (keyof Counts)[]) total[key] += value[key];
    return total;
  }, zero());
  const byStop = trip.stops.map(stop => {
    const byLine = stop.lines.map(line => {
      const loaded = line.loaded ?? 0;
      const delivered = line.delivered ?? 0;
      const refused = stop.outcome === 'refused' ? loaded - delivered : 0;
      const notDelivered = stop.outcome === 'closed' ? loaded : 0;
      const wontFit = line.loaded === null ? 0 : Math.min(line.wontFit, line.quantity - line.loaded);
      // countTo is what the unload counter counts against (L-19): what was ordered, less what did not fit on the truck,
      // which never went on it. A line short of stock still counts against the order, as "3 /4" (spec 013).
      return { lineId: line.lineId, temp: line.temp, ordered: line.quantity, loaded, delivered, refused, notDelivered,
        short: line.loaded === null ? 0 : line.quantity - line.loaded, wontFit, onTruck: refused + notDelivered, countTo: line.quantity - wontFit };
    });
    return { stopId: stop.id, seq: stop.seq, ...add(byLine), byLine,
      byTemp: { chilled: add(byLine.filter(line => line.temp === 'chilled')), dry: add(byLine.filter(line => line.temp === 'dry')) } };
  });
  return { stops: trip.stops.length, stopsDone: trip.stops.filter(stop => stop.outcome !== null).length, ...add(byStop), byStop,
    byTemp: { chilled: add(byStop.map(stop => stop.byTemp.chilled)), dry: add(byStop.map(stop => stop.byTemp.dry)) }, next: nextStop(trip) };
}

// The driver's whole day, for Day done after more than one trip: each trip's figures in the day's order, and the day's
// sums of them. Every number on a driver screen comes from these two functions.
const DAY_SUMS = ['stops', 'stopsDone', 'ordered', 'loaded', 'delivered', 'refused', 'notDelivered', 'short', 'wontFit', 'onTruck'] as const;
export function dayFigures(trips: readonly DriverTrip[]) {
  const byTrip = trips.map(trip => ({ tripId: trip.tripId, tripNo: trip.tripNo, figures: tripFigures(trip) }));
  const sums = Object.fromEntries(DAY_SUMS.map(key => [key, byTrip.reduce((total, each) => total + each.figures[key], 0)])) as Record<(typeof DAY_SUMS)[number], number>;
  return { trips: trips.length, ...sums, byTrip };
}

// Only still-waiting writes enter this function; refused ones are kept separately by the phone.
export function phoneView(day: DriverDay, writes: readonly DriverWrite[]): { day: DriverDay; writes: DriverWrite[] } {
  const waiting = writes.filter(write => !day.appliedWriteIds.includes(write.writeId));
  return { day: waiting.reduce(applyDriverWrite, day), writes: waiting };
}
