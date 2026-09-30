import type { LoadingDecision } from '@wayfinder/contracts';

// A loader's flag on one line: the good units counted at the dock, and the dispatcher's answer, null while it is open.
export interface LineFlag { counted: number; decision: LoadingDecision | null }

// How many of a line go out (rule 5, D-35): its quantity with no flag, the count at the dock while the flag is open
// or after "Go short", and its quantity again after "Load it all", as the rest comes from stock.
export function goingOf(quantity: number, flag: LineFlag | null): number {
  if (!flag || flag.decision === 'load_all') return quantity;
  return flag.counted;
}
