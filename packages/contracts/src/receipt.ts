import { z } from 'zod';
import { MAX_LINE_UNITS, MAX_ORDER_LINES, MAX_STOP_ORDERS, PhotoDataUrl, ReceiptDecision, ReceiptReason, RefusalReason, ShortReason, Temp } from './basics';
import { StoreOutlet } from './store';

// The shop's receipt (spec 015): the deliveries a shop confirms, one stop's orders at once (D-56), the receipt it saves
// on its phone first and sends once (D-57), and the report it makes when something is short, damaged or not cold
// (D-58, D-60). Every count on the receipt screens comes from deliveryFigures over the deliveries the server last sent
// with the waiting receipts applied by receiptView, which a test holds the server to (D-50's way). Days are YYYY-MM-DD
// and moments ISO strings.

const Day = z.iso.date();
const Moment = z.iso.datetime();
const Count = z.number().int().min(0);
const Id = z.uuid().transform((id) => id.toLowerCase());

// The most lines a receipt can name: every line a stop can hold.
export const MAX_STOP_LINES = MAX_STOP_ORDERS * MAX_ORDER_LINES;

// A line of a delivery, in spec 012's order: what was ordered, loaded, handed over by the driver, and what the shop
// counted, null until it confirms.
export const StoreDeliveryLine = z.object({
  lineId: z.uuid(),
  orderId: z.uuid(),
  temp: Temp,
  productId: z.string(),
  name: z.string(),
  unit: z.string(),
  ordered: Count,
  loaded: Count,
  delivered: Count,
  received: Count.nullable(),
});
export type StoreDeliveryLine = z.infer<typeof StoreDeliveryLine>;

// The most a receipt's note holds, as the shop's note for the driver (Q-40).
export const RECEIPT_NOTE_MOST = 200;

// The shop's report (rule 5): a problem of kind receipt whose id is the receipt's. It counts each short line at the
// units short, with the shop's own reason for it, and when the chilled goods were not cold each chilled line that came
// too, at 0 and with no reason when nothing is short on it (Q-40). Its reason is its first short line's, or not_cold.
// A report kept before lines had reasons has none on them, and lineReason reads each short one as the report's. note is
// what the shop wrote, null when it wrote nothing. decision and decidedAt are null while it is open; replacement is what
// an answer of "Send N replacements" placed.
export const ReceiptReport = z.object({
  id: z.uuid(),
  reason: ReceiptReason,
  lines: z.array(z.object({ lineId: z.uuid(), counted: Count, reason: ShortReason.nullable().optional() })),
  note: z.string().nullable().optional(),
  decision: ReceiptDecision.nullable(),
  decidedAt: Moment.nullable(),
  replacement: z.object({ day: Day, units: z.number().int().min(1) }).nullable(),
});
export type ReceiptReport = z.infer<typeof ReceiptReport>;

// A delivery's receipt (D-61): when the shop confirmed, as the time rule kept it; when it reached the depot, null while
// it waits on the phone; whether the chilled goods arrived cold, null when no chilled line came; and its report.
export const StoreReceipt = z.object({ at: Moment, sentAt: Moment.nullable(), cold: z.boolean().nullable(), report: ReceiptReport.nullable() });
export type StoreReceipt = z.infer<typeof StoreReceipt>;

// One delivery (rule 1): a stop of a sent plan at the shop that the driver saved as delivered or refused.
export const StoreDelivery = z.object({
  stopId: z.uuid(),
  // The stop's revision, which a receipt names.
  revision: Count,
  // The sent plan's date.
  day: Day,
  vehicleId: z.string(),
  // The driver's name, or null when the trip had none.
  driver: z.string().nullable(),
  arrivedAt: Moment,
  // The handover.
  doneAt: Moment,
  outcome: z.enum(['delivered', 'refused']),
  // The truck arrived after the shop's window closed, its mall slot as spec 007 times it.
  late: z.boolean(),
  // The driver's reason when the shop refused some, else null.
  refusalReason: RefusalReason.nullable(),
  lines: z.array(StoreDeliveryLine),
  receipt: StoreReceipt.nullable(),
});
export type StoreDelivery = z.infer<typeof StoreDelivery>;

// GET /store/deliveries, and the answer to a receipt.
export const StoreDeliveries = z.object({
  outlet: StoreOutlet,
  // The signed-in account the deliveries were read for, so a phone holding one account's receipts never sends them
  // under another, even one at the same shop.
  userId: z.uuid(),
  // The app clock's day.
  today: Day,
  // Every phone write the account had applied, or answered again, in the last 48 hours (D-45, D-57).
  appliedWriteIds: z.array(z.uuid()),
  // Those to confirm, oldest handover first, then those confirmed today, latest first.
  deliveries: z.array(StoreDelivery),
});
export type StoreDeliveries = z.infer<typeof StoreDeliveries>;

// POST /store/receipts: one receipt, saved on the phone first as this exact request (D-57). It names the stop's
// revision and counts every line of the delivery once. cold is set exactly when a chilled line came with something on
// it. Each short line says what is wrong with it, and only a short line does (Q-40). A receipt saved before lines had
// reasons says it once in reason instead, which stands for every short line that names none. A photo and a note of up
// to 200 characters may go with a report.
export const ReceiptWrite = z.object({
  kind: z.literal('receipt'),
  writeId: Id,
  stopId: Id,
  // The app clock on the phone.
  at: Moment,
  revision: Count,
  lines: z.array(z.object({ lineId: Id, received: z.number().int().min(0).max(MAX_LINE_UNITS), reason: ShortReason.nullable().optional() })).min(1).max(MAX_STOP_LINES)
    .refine((lines) => new Set(lines.map((line) => line.lineId)).size === lines.length, 'Name each line once.'),
  cold: z.boolean().nullable(),
  reason: ShortReason.nullable(),
  photo: PhotoDataUrl.optional(),
  note: z.string().trim().max(RECEIPT_NOTE_MOST).optional(),
});
export type ReceiptWrite = z.infer<typeof ReceiptWrite>;

// The numbers of a delivery (rule 13): per line what the shop counts against, the units handed over (expected), what it
// received, null until it confirms, the units short of that (0 until it confirms), the units the depot sent short
// (ordered less loaded) and the units refused at the door (loaded less handed over); the totals; and whether a chilled
// line came with something on it, which decides the cold check on the phone and on the server.
export function deliveryFigures(delivery: StoreDelivery) {
  const byLine = delivery.lines.map((line) => ({
    lineId: line.lineId, orderId: line.orderId, temp: line.temp,
    expected: line.delivered,
    received: line.received,
    short: line.received === null ? 0 : line.delivered - line.received,
    shortFromDepot: line.ordered - line.loaded,
    refused: line.loaded - line.delivered,
  }));
  const total = (key: 'expected' | 'short' | 'shortFromDepot' | 'refused') => byLine.reduce((sum, line) => sum + line[key], 0);
  return {
    byLine,
    expected: total('expected'),
    received: delivery.receipt === null ? null : byLine.reduce((sum, line) => sum + (line.received ?? 0), 0),
    short: total('short'),
    shortFromDepot: total('shortFromDepot'),
    refused: total('refused'),
    chilled: delivery.lines.some((line) => line.temp === 'chilled' && line.delivered > 0),
  };
}
export type DeliveryFigures = ReturnType<typeof deliveryFigures>;

// What a receipt says is wrong with one of its lines (Q-40): the line's own reason, else the one reason a receipt saved
// before lines had reasons gave for all of them.
export const writtenReason = (write: Pick<ReceiptWrite, 'reason'>, line: { reason?: ShortReason | null }): ShortReason | null => line.reason ?? write.reason;

// What a report says is wrong with a line it counts (Q-40): the line's own reason, else, for a report kept before lines
// had reasons, the report's when the line is short. A chilled line counted only because the goods came warm has none.
export function lineReason(report: Pick<ReceiptReport, 'reason'>, line: { counted: number; reason?: ShortReason | null }): ShortReason | null {
  if (line.reason) return line.reason;
  return line.counted > 0 && report.reason !== 'not_cold' ? report.reason : null;
}

// The reasons of a report's short lines, each once, in the order of its lines: ['damaged', 'missing'].
export const reportReasons = (report: Pick<ReceiptReport, 'reason' | 'lines'>): ShortReason[] =>
  [...new Set(report.lines.flatMap((line) => lineReason(report, line) ?? []))];

// The server's order of deliveries (rule 1): those to confirm, oldest handover first, then those confirmed, latest
// first. Moments are compared as the ISO strings the server writes, to the millisecond.
export function byDeliveryOrder(a: StoreDelivery, b: StoreDelivery): number {
  return (a.receipt ? 1 : 0) - (b.receipt ? 1 : 0)
    || (a.receipt && b.receipt ? b.receipt.at.localeCompare(a.receipt.at) : a.doneAt.localeCompare(b.doneAt))
    || a.stopId.localeCompare(b.stopId);
}

// The deliveries as the server answers once the receipt is applied, on plain values (rules 4 and 5), with the phone's
// time and no time sent, which only the server knows: each line's received count, the receipt, its report when a line
// is short or the chilled goods were not cold, the stop's revision up by one and the write's id listed. A receipt whose
// id is listed, or whose delivery is not in the list, changes nothing, and so does a short one that says nothing about
// what is wrong, which the server refuses (rule 3). Validation is the server's.
export function applyReceipt(deliveries: StoreDeliveries, write: ReceiptWrite): StoreDeliveries {
  if (deliveries.appliedWriteIds.includes(write.writeId)) return deliveries;
  const own = deliveries.deliveries.find((delivery) => delivery.stopId === write.stopId);
  if (!own) return deliveries;
  const counted = own.lines.map((line) => ({ line, received: write.lines.find((named) => named.lineId === line.lineId)?.received ?? null }));
  const shortOf = ({ line, received }: (typeof counted)[number]) => (received === null ? 0 : line.delivered - received);
  const short = counted.some((entry) => shortOf(entry) > 0);
  const reasonOf = (lineId: string) => writtenReason(write, write.lines.find((named) => named.lineId === lineId) ?? {});
  if (counted.some((entry) => shortOf(entry) > 0 && reasonOf(entry.line.lineId) === null)) return deliveries;
  const notCold = write.cold === false;
  const result = structuredClone(deliveries);
  const delivery = result.deliveries.find((each) => each.stopId === write.stopId)!;
  result.appliedWriteIds.push(write.writeId);
  result.appliedWriteIds.sort();
  delivery.revision += 1;
  delivery.lines.forEach((line, i) => { line.received = counted[i]!.received; });
  delivery.receipt = {
    // The API stores instants to millisecond precision. Keep the phone's projection in that same ISO form.
    at: new Date(write.at).toISOString(),
    sentAt: null,
    cold: write.cold,
    report: short || notCold ? {
      id: write.writeId,
      reason: short ? reasonOf(counted.find((entry) => shortOf(entry) > 0)!.line.lineId)! : 'not_cold',
      lines: counted.flatMap((entry) => {
        const units = shortOf(entry);
        return units > 0 || (notCold && entry.line.temp === 'chilled' && entry.line.delivered > 0)
          ? [{ lineId: entry.line.lineId, counted: units, reason: units > 0 ? reasonOf(entry.line.lineId) : null }] : [];
      }),
      note: write.note ? write.note : null,
      decision: null, decidedAt: null, replacement: null,
    } : null,
  };
  result.deliveries.sort(byDeliveryOrder);
  return result;
}

// What the shop's phone shows and still has to send (D-50, D-57): the receipts the deliveries do not list as applied,
// in the order they were saved, and the deliveries with them applied. Refused receipts never enter it.
export function receiptView(deliveries: StoreDeliveries, writes: readonly ReceiptWrite[]): { deliveries: StoreDeliveries; writes: ReceiptWrite[] } {
  const waiting = writes.filter((write) => !deliveries.appliedWriteIds.includes(write.writeId));
  return { deliveries: waiting.reduce(applyReceipt, deliveries), writes: waiting };
}

// The code the receipt adds to the shared error shape, beside the store's and the driver's codes it uses again.
//   not_delivered  409  The stop was not handed over, delivered or refused.
export const RECEIPT_ERROR_CODES = ['not_delivered'] as const;
export type ReceiptErrorCode = (typeof RECEIPT_ERROR_CODES)[number];
