import { deliveryFigures, type ReceiptWrite, type ShortReason, type StoreDelivery } from '@wayfinder/contracts';
import { wholeCount } from '@/features/loader/count';

// What a receipt's count box stands for (Q-38), with the loader's flag box's helper (Q-17): a whole number from 0 to
// what was handed over is the count, and anything else is wrong and stays as typed. "whole" is a minus, a fraction or
// anything but digits; "over" is a whole number above what was handed over, which the shop may well have counted, so
// the line says so rather than calling it a typing mistake.
export type CountWrong = 'whole' | 'over';
export function receiptBox(text: string, most: number): { count: number; wrong: null } | { count: null; wrong: CountWrong } {
  const count = wholeCount(text, most);
  if (count !== null) return { count, wrong: null };
  return { count: null, wrong: /^[0-9]+$/.test(text.trim()) ? 'over' : 'whole' };
}

// The form's counts: each line's count (what was handed over until the shop changes it), what each box holds while it
// is not that count, and from them whether a line is short, which box is wrong, and whether Confirm can go. A wrong box
// keeps Confirm off and leaves the count the form holds as it was, so nothing typed wrong is ever sent.
export function receiptCounts(lines: { lineId: string; expected: number }[], counts: Record<string, number>, typed: Record<string, string>) {
  const countAt = (i: number) => counts[lines[i]!.lineId] ?? lines[i]!.expected;
  const wrongOf = (lineId: string): CountWrong | null => {
    const text = typed[lineId];
    const line = lines.find((each) => each.lineId === lineId);
    return text === undefined || !line ? null : receiptBox(text, line.expected).wrong;
  };
  const anyWrong = lines.some((line) => wrongOf(line.lineId) !== null);
  return {
    countAt,
    wrongOf,
    // A line whose box is wrong is not short: its count is what was typed on the way, "1" on the way to "15" (L-12).
    short: lines.some((line, i) => wrongOf(line.lineId) === null && countAt(i) < line.expected),
    canConfirm: !anyWrong,
  };
}

// The receipt as it is sent (spec 015, rule 3, Q-40): every line once at its count, a line handed over at 0 at 0, each
// short line with its own reason (Missing until the shop picks another) and a full one with none, the cold answer only
// when chilled goods came, and the photo and the note only with a report. The receipt's one reason is for phones that
// saved receipts before lines had their own, so a new receipt leaves it empty. A note of only spaces is no note.
export function receiptRequest(delivery: StoreDelivery, input: {
  writeId: string; at: string; counts: number[]; reasons: Record<string, ShortReason>; cold: boolean; note: string; photo: string | null;
}): ReceiptWrite {
  const figures = deliveryFigures(delivery);
  const lines = delivery.lines.map((line, i) => {
    const short = input.counts[i]! < figures.byLine[i]!.expected;
    return { lineId: line.lineId, received: input.counts[i]!, reason: short ? input.reasons[line.lineId] ?? 'missing' : null };
  });
  const reports = lines.some((line) => line.reason !== null) || (figures.chilled && !input.cold);
  const note = input.note.trim();
  return {
    kind: 'receipt',
    writeId: input.writeId,
    stopId: delivery.stopId,
    at: input.at,
    revision: delivery.revision,
    lines,
    cold: figures.chilled ? input.cold : null,
    reason: null,
    ...(reports && input.photo ? { photo: input.photo } : {}),
    ...(reports && note ? { note } : {}),
  };
}
