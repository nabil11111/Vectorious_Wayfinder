import type { Issue, IssueList, OperationsCounts, OperationsDay, OperationsProgress } from '@wayfinder/contracts';

// Both depots together (spec 021, rule 1): a figure on a page that shows both is the two depots' own figures added up,
// never one depot's standing for both. A count one depot did not record, or a read that is not there, leaves the sum
// unknown. One depot's read passes through as it came. The bars keep the server's rounding of a share.

export const percentOf = (value: number, total: number) => (total ? Math.round(Number(((value * 100) / total).toFixed(6))) : 0);
const progressOf = (numerator: number | null, denominator: number): OperationsProgress =>
  ({ numerator, denominator, percent: numerator === null ? null : percentOf(numerator, denominator) });

const added = (values: number[]) => values.reduce((sum, value) => sum + value, 0);
const addedIfKnown = (values: (number | null)[]) => (values.some((value) => value === null) ? null : added(values as number[]));

export function sumCounts(all: OperationsCounts[]): OperationsCounts {
  if (all.length === 1) return all[0]!;
  const sum = (key: 'stopsTotal' | 'tripsTotal' | 'vehiclesOut' | 'vehiclesTotal' | 'deferredOrders') => added(all.map((counts) => counts[key]));
  const sumKnown = (key: 'stopsDelivered' | 'stopsDone' | 'partialStops' | 'noGoodsStops' | 'closedStops') => addedIfKnown(all.map((counts) => counts[key]));
  const stopsTotal = sum('stopsTotal'), stopsDelivered = sumKnown('stopsDelivered'), vehiclesOut = sum('vehiclesOut'), vehiclesTotal = sum('vehiclesTotal');
  return {
    stopsTotal, stopsDelivered, stopsDone: sumKnown('stopsDone'), partialStops: sumKnown('partialStops'), noGoodsStops: sumKnown('noGoodsStops'),
    closedStops: sumKnown('closedStops'), tripsTotal: sum('tripsTotal'), vehiclesOut, vehiclesTotal, deferredOrders: sum('deferredOrders'),
    deliveryProgress: progressOf(stopsDelivered, stopsTotal), truckProgress: progressOf(vehiclesOut, vehiclesTotal),
  };
}

type Fuel = NonNullable<OperationsDay['fuel']>;
// The week's fuel used over the quota of both fleets. Litres are kept to the tenth, as the server adds them up.
export function sumFuel(fuels: (Fuel | null)[]): Fuel | null {
  if (fuels.length === 1) return fuels[0]!;
  if (fuels.length === 0 || fuels.some((fuel) => fuel === null)) return null;
  const [first, ...rest] = fuels as Fuel[];
  if (rest.some((fuel) => fuel.isoYear !== first!.isoYear || fuel.isoWeek !== first!.isoWeek)) return null;
  const litres = added((fuels as Fuel[]).map((fuel) => Math.round(fuel.litres * 10))) / 10;
  const quotaLitres = added((fuels as Fuel[]).map((fuel) => fuel.quotaLitres));
  return { isoYear: first!.isoYear, isoWeek: first!.isoWeek, litres, quotaLitres, percent: quotaLitres === 0 ? null : percentOf(litres, quotaLitres) };
}

type NextRun = NonNullable<OperationsDay['nextRun']>;
// The next run's orders at both depots, when both run on the same day with the same cutoff; 'differ' when they do not.
export function sumNextRun(runs: (NextRun | null)[]): NextRun | null | 'differ' {
  if (runs.length === 1) return runs[0]!;
  if (runs.every((run) => run === null)) return null;
  const [first] = runs;
  if (runs.some((run) => run === null || run.date !== first!.date || run.cutoffAt !== first!.cutoffAt)) return 'differ';
  return { date: first!.date, cutoffAt: first!.cutoffAt, orders: added((runs as NextRun[]).map((run) => run.orders)) };
}

// The open problems of every depot on show, or null while any list is not read or its last read failed.
export function openCount(lists: { data?: IssueList; isError: boolean }[]): number | null {
  if (lists.some((list) => !list.data || list.isError)) return null;
  return added(lists.map((list) => list.data!.issues.length));
}

// Every depot's open problems in one list, oldest first as each depot's own list is, each with its depot. One depot's
// list keeps the order it came in.
export function openOf(lists: { depot: string; list: IssueList }[]): { depot: string; issue: Issue }[] {
  const all = lists.flatMap(({ depot, list }) => list.issues.map((issue) => ({ depot, issue })));
  if (lists.length < 2) return all;
  return all.sort((a, b) => a.issue.raisedAt.localeCompare(b.issue.raisedAt) || a.issue.id.localeCompare(b.issue.id));
}

// The value every depot's read gives, such as the watched day, or undefined when they differ or there is none.
export function agreed<T>(values: T[]): T | undefined {
  if (values.length === 0) return undefined;
  return values.every((value) => value === values[0]) ? values[0] : undefined;
}
