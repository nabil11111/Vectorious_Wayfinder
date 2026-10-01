import type { HistoryCounts, HistoryMeasure, HistoryStages, LookupFleet, LookupFuel, LookupOrders } from '@wayfinder/contracts';
import { percentOf } from '@/features/live/sums';

// The look-up pages on both depots together (spec 021, rule 1): the header's figures are the depots' own added up, never
// one depot's standing for both. A stage one depot did not record leaves the sum unknown. One depot's figures pass
// through as they came.

const added = (values: number[]) => values.reduce((sum, value) => sum + value, 0);
// Litres and kilometres are kept to the tenth, as the server adds them up.
const tenths = (values: number[]) => added(values.map((value) => Math.round(value * 10))) / 10;

type OrdersSummary = NonNullable<LookupOrders['summary']>;
export function sumOrders(all: OrdersSummary[]): OrdersSummary {
  if (all.length === 1) return all[0]!;
  const sum = (key: keyof OrdersSummary) => added(all.map((summary) => summary[key]));
  return { orders: sum('orders'), planned: sum('planned'), deferred: sum('deferred'), carriedOver: sum('carriedOver'), split: sum('split') };
}

const sumMeasure = (all: HistoryMeasure[]): HistoryMeasure => ({
  units: all.some((measure) => measure.units === null) ? null : added(all.map((measure) => measure.units!)),
  known: added(all.map((measure) => measure.known)), total: added(all.map((measure) => measure.total)),
  missing: added(all.map((measure) => measure.missing)), soFar: added(all.map((measure) => measure.soFar)),
});
export function sumHistory(all: HistoryCounts[]): HistoryCounts {
  if (all.length === 1) return all[0]!;
  const sum = (key: Exclude<keyof HistoryCounts, 'stages'>) => added(all.map((counts) => counts[key]));
  const stage = (key: Exclude<keyof HistoryStages, 'ordered'>) => sumMeasure(all.map((counts) => counts.stages[key]));
  return {
    trips: sum('trips'), stops: sum('stops'), orders: sum('orders'), delivered: sum('delivered'), finished: sum('finished'), partial: sum('partial'),
    late: sum('late'), short: sum('short'), returned: sum('returned'), deferred: sum('deferred'), confirmations: sum('confirmations'), receivedOrders: sum('receivedOrders'),
    stages: {
      ordered: added(all.map((counts) => counts.stages.ordered)), loaded: stage('loaded'), handedOver: stage('handedOver'), received: stage('received'),
      depotShort: stage('depotShort'), refused: stage('refused'), receiptShort: stage('receiptShort'), notDelivered: stage('notDelivered'),
    },
  };
}

// Both fleets' week of fuel, recorded and committed over both quotas, when both read the same week.
function sumFuel(all: (LookupFuel | null)[]): LookupFuel | null {
  if (all.length === 1) return all[0]!;
  if (all.some((fuel) => fuel === null)) return null;
  const fuels = all as LookupFuel[];
  const [first] = fuels;
  if (fuels.some((fuel) => fuel.isoYear !== first!.isoYear || fuel.isoWeek !== first!.isoWeek)) return null;
  const recordedCommitted = tenths(fuels.map((fuel) => fuel.recordedCommitted));
  const quota = tenths(fuels.map((fuel) => fuel.quota));
  const remaining = tenths(fuels.map((fuel) => fuel.remaining));
  const byDate = new Map<string, { date: string; dow: number; litres: number }>();
  for (const day of fuels.flatMap((fuel) => fuel.days)) {
    const held = byDate.get(day.date);
    byDate.set(day.date, held ? { ...held, litres: tenths([held.litres, day.litres]) } : day);
  }
  return {
    isoYear: first!.isoYear, isoWeek: first!.isoWeek, recordedCommitted, quota, remaining,
    recordedCommittedPct: quota === 0 ? null : percentOf(recordedCommitted, quota), remainingPct: quota === 0 ? null : percentOf(remaining, quota),
    sentTrips: added(fuels.map((fuel) => fuel.sentTrips)), plannedKm: tenths(fuels.map((fuel) => fuel.plannedKm)),
    days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

type FleetSummary = LookupFleet['summary'];
export function sumFleet(all: FleetSummary[]): FleetSummary {
  if (all.length === 1) return all[0]!;
  const sum = (key: Exclude<keyof FleetSummary, 'fuel'>) => added(all.map((summary) => summary[key]));
  return {
    active: sum('active'), reefers: sum('reefers'), vans: sum('vans'), recordedOut: sum('recordedOut'), notRecordedOut: sum('notRecordedOut'),
    activeOffToday: sum('activeOffToday'), activeWithoutOffToday: sum('activeWithoutOffToday'), fuel: sumFuel(all.map((summary) => summary.fuel)),
  };
}

// The newest reset generation any of the page's reads answered for, which the clock should catch up with.
export const newestDemoDay = (reads: { data?: { demoDay: number | null } }[]) =>
  reads.reduce<number | null>((newest, read) => (read.data?.demoDay != null && (newest === null || read.data.demoDay > newest) ? read.data.demoDay : newest), null);
