import type { LoadingLine } from '@wayfinder/contracts';
import { whole } from './words';

// What a flag's count box stands for (Q-17): a whole number from 0 to the line's count, written in digits, with an
// empty box as 0, or null for anything else, such as a minus, a fraction or more than the line holds. Nothing is
// rounded, cut or turned round, so a typed -3 never becomes 3. As the shop's quantity box does (Q-01).
export function wholeCount(text: string, most: number): number | null {
  const digits = text.trim();
  if (digits === '') return 0;
  if (!/^[0-9]+$/.test(digits)) return null;
  const count = Number(digits);
  return count <= most ? count : null;
}

// The flag form's counts: each line's count at the dock (its quantity until the loader lowers it), what each box holds
// while it is not that count, and from them the lines it lowers, the boxes that hold a wrong number, and whether Send
// can go. A wrong box keeps Send off even once another line is picked, and its line is listed with what was typed.
export function flagCounts(lines: LoadingLine[], flagged: Set<string>, counts: Record<string, number>, typed: Record<string, string>) {
  const open = lines.filter((line) => !flagged.has(line.lineId));
  const countAt = (line: LoadingLine) => counts[line.lineId] ?? line.quantity;
  const isWrong = (line: LoadingLine) => typed[line.lineId] !== undefined && wholeCount(typed[line.lineId]!, line.quantity) === null;
  const wrong = open.filter(isWrong);
  const lowered = open.filter((line) => countAt(line) < line.quantity);
  return {
    countAt,
    wrong,
    lowered,
    canSend: wrong.length === 0 && lowered.length > 0,
    // A line's count in the list: what its box holds when that is wrong, or its count.
    shownOf: (line: LoadingLine) => (isWrong(line) ? { count: typed[line.lineId]!, wrong: true } : { count: whole(countAt(line)), wrong: false }),
  };
}
