import type { Brand, IssueDecision, OrderProblem, RefusalReason, ShortReason, Temp } from '@wayfinder/contracts';
import { dayLabel } from '../plans/board-day';

// The line a shop's card gives each problem of its order (spec 015, rule 11, Q-36), worded here so the card only lays it
// out: the cartons it is about, then what happens to them. "3 expired chilled cartons: replacements come on Fri 26 Jun"
// and "2 missing chilled cartons: no replacement" sit on one card without reading as one answer taking back the other.

export interface ProblemLineFacts {
  kind: OrderProblem['kind'];
  brand: Brand;
  // The order's temperature: a Fresh order is all chilled or all dry.
  temp: Temp;
  // The problem's lines on this order: the units it counts and, on a shop's report, the shop's reason for them.
  lines: { counted: number; reason: ShortReason | null }[];
  // A refusal's reason, else null.
  refusalReason: RefusalReason | null;
  // A report on a chilled order whose goods came warm.
  warm: boolean;
  decision: IssueDecision | null;
  // The day of the replacements an answer placed.
  replacementDay: string | null;
}

const UNIT: Record<Brand, [string, string]> = { Fresh: ['carton', 'cartons'], Style: ['box', 'boxes'], Tech: ['item', 'items'] };
const WHOLE = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

// "3 expired chilled cartons", "1 missing item", "2 chilled cartons you did not order".
function goods(facts: ProblemLineFacts, units: number, said: string | null) {
  const [one, many] = UNIT[facts.brand];
  const unit = units === 1 ? one : many;
  const temp = facts.brand === 'Fresh' ? `${facts.temp} ` : '';
  if (said === 'not_ordered') return `${WHOLE.format(units)} ${temp}${unit} you did not order`;
  return `${WHOLE.format(units)} ${said ? `${said} ` : ''}${temp}${unit}`;
}

const sum = (lines: ProblemLineFacts['lines']) => lines.reduce((total, line) => total + line.counted, 0);

export function problemLineOf(facts: ProblemLineFacts): string {
  const units = sum(facts.lines);
  const one = units === 1;
  const day = facts.replacementDay ? dayLabel(facts.replacementDay) : null;
  const replaced = day && units > 0 ? (one ? `a replacement comes on ${day}` : `replacements come on ${day}`) : null;
  switch (facts.kind) {
    case 'refused': {
      const what = goods(facts, units, facts.refusalReason);
      if (facts.decision === 'send_replacements' && replaced) return `${what}: ${replaced}`;
      if (facts.decision === 'bring_back') return `${what}: ${one ? 'it goes' : 'they go'} back to the depot`;
      return `${what}: the depot decides what happens to ${one ? 'it' : 'them'}`;
    }
    case 'closed': {
      const what = goods(facts, units, null);
      if (facts.decision === 'try_again') return `${what}: the driver comes back after the other stops`;
      if (facts.decision === 'bring_back') return `${what}: ${one ? 'it goes' : 'they go'} on the next plan`;
      return `${what}: the depot decides, today or another day`;
    }
    case 'receipt': {
      // The units short on this order by the shop's reason, in the order the reasons first come, and warm chilled goods.
      const reasons = [...new Set(facts.lines.flatMap((line) => (line.counted > 0 && line.reason ? [line.reason] : [])))];
      const parts = reasons.map((reason) => goods(facts, sum(facts.lines.filter((line) => line.reason === reason)), reason));
      if (facts.warm) parts.push(`${parts.length ? 'chilled' : 'Chilled'} ${UNIT[facts.brand][1]} that came warm`);
      const what = parts.join(' and ');
      if (facts.decision === 'send_replacements') return `${what}: ${replaced ?? 'no replacement'}`;
      if (facts.decision === 'no_replacement') return `${what}: no replacement`;
      return `${what}: the depot is reviewing your report`;
    }
  }
}
