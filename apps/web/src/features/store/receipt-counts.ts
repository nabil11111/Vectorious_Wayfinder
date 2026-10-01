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
    short: lines.some((line, i) => countAt(i) < line.expected),
    canConfirm: !anyWrong,
  };
}
