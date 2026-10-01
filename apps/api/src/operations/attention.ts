import { nextStop, type DriverTrip, type Issue, type IssueReason, type OperationsStatus, type OperationsTimeline, type OperationsTrip, type TripAttention } from '@wayfinder/contracts';
import { depotDate, depotInstant } from '../lib/clock';
import { progress } from './figures';

// An open problem's reason as a truck's row says it, "Won't fit" (Q-20) as well as "Wrong item".
const REASON_SUMMARY: Record<IssueReason, string> = {
  short: 'Short', damaged: 'Damaged', wrong_item: 'Wrong item', wont_fit: 'Won\'t fit', expired: 'Expired', not_ordered: 'Not ordered',
  nobody_there: 'Nobody there', missing: 'Missing', not_cold: 'Not cold',
};

// A shop's report says each of its lines' reasons once, "Damaged, missing" (Q-40); every other problem its own reason.
function summaryOf(problem: Issue) {
  const reasons = problem.kind === 'receipt' ? [...new Set(problem.lines.flatMap((line) => line.reason ?? []))] : [];
  if (reasons.length === 0) return REASON_SUMMARY[problem.reason];
  return reasons.map((reason, i) => (i === 0 ? REASON_SUMMARY[reason] : REASON_SUMMARY[reason].toLowerCase())).join(', ');
}

export function attentionOf(trip: DriverTrip, arrivals: Map<string, string>, at: string): TripAttention {
  if (['planned', 'loading', 'ready'].includes(trip.status) && at > trip.leavesAt) return { kind: 'departure_unreported', plannedAt: trip.leavesAt };
  const next = nextStop(trip);
  if (trip.status !== 'out' || !next || next.arrivedAt) return { kind: 'none' };
  if (next.retriedAt) return { kind: 'retry_requested', stopId: next.id, requestedAt: next.retriedAt };
  const plannedAt = arrivals.get(next.id);
  if (!plannedAt) throw new Error(`No planned arrival for stop ${next.id}.`);
  return at > plannedAt ? { kind: 'arrival_unreported', stopId: next.id, plannedAt } : { kind: 'none' };
}

export function outRowOf(trip: DriverTrip, arrivals: Map<string, string>, issues: Issue[], at: string) {
  const next = nextStop(trip);
  const problem = issues.filter(issue => issue.status === 'open').sort((a, b) => a.raisedAt.localeCompare(b.raisedAt) || a.id.localeCompare(b.id))[0];
  const attention = attentionOf(trip, arrivals, at);
  const status: OperationsStatus = problem ? { kind: 'open_problem', issueId: problem.id, issueKind: problem.kind, summary: summaryOf(problem), raisedAt: problem.raisedAt }
    : trip.status === 'done' && trip.backAt ? { kind: 'back', backAt: trip.backAt }
    : next?.arrivedAt ? { kind: 'at_stop', stopId: next.id, shopName: next.shopName, arrivedAt: next.arrivedAt }
    : attention.kind !== 'none' ? attention : !next && trip.status === 'out' ? { kind: 'returning' }
    : { kind: trip.status === 'done' ? 'unrecorded' : trip.status };
  return { progress: progress(trip.stops.filter(stop => stop.outcome !== null).length, trip.stops.length),
    nextStop: next ? { id: next.id, outletId: next.outletId, shopName: next.shopName } : null,
    plannedArrival: next ? arrivals.get(next.id) ?? null : null, arrivalIsOriginal: Boolean(next?.retriedAt), plannedReturn: trip.backBy, status };
}

const priority = (row: OperationsTrip) => {
  const status = row.outRow?.status;
  if (status?.kind === 'open_problem') return [0, status.raisedAt, status.issueId] as const;
  if (status?.kind === 'departure_unreported' || status?.kind === 'arrival_unreported') return [1, status.plannedAt, ''] as const;
  return [2, row.detailRecorded ? row.schedule.leavesAt : '~', ''] as const;
};
export function compareOut(a: OperationsTrip, b: OperationsTrip) {
  const aa = priority(a), bb = priority(b);
  return aa[0] - bb[0] || aa[1].localeCompare(bb[1]) || aa[2].localeCompare(bb[2]) || a.date.localeCompare(b.date) || a.vehicleId.localeCompare(b.vehicleId) || a.tripNo - b.tripNo;
}

export function timelineOf(date: string, marks: string[], at: string): OperationsTimeline {
  const midnight = depotInstant(date, 0).getTime();
  const now = depotDate(new Date(at)) === date ? at : null;
  const minutes = [...marks, ...(now ? [now] : [])].map(mark => (new Date(mark).getTime() - midnight) / 60_000);
  const start = Math.floor(Math.min(120, ...minutes) / 120) * 120, end = Math.ceil(Math.max(1320, ...minutes) / 120) * 120;
  const instant = (minute: number) => new Date(midnight + minute * 60_000).toISOString();
  return { start: instant(start), end: instant(end), now, ticks: Array.from({ length: (end - start) / 120 + 1 }, (_, n) => instant(start + n * 120)) };
}
