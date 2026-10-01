import type { Issue, OperationsDay, OperationsGroup, OperationsStatus, OperationsTrip, TripAttention } from '@wayfinder/contracts';
import { clockTime, whole } from '@/features/loader/words';
import { ARRIVED_AFTER_WINDOW, NOT_RECORDED, backAtDepot, problemLine, problemWord, statusSentence } from '../words';
import type { Tone } from './ui';

// A trip row's facts on the dashboard and Live day (spec 016, rule 4 and rule 5). The status comes from the read: an
// out trip's row status, or the trip's attention and recorded times otherwise. An open problem is the oldest of the
// trip's open issues in the depot's list. Nothing here estimates a time or works a count out.

export type RecordedTrip = Extract<OperationsTrip, { detailRecorded: true }>;
export const isRecorded = (trip: OperationsTrip): trip is RecordedTrip => trip.detailRecorded;

// The trip's oldest open problem in the open list, which is oldest first.
export const openIssueOf = (trip: OperationsTrip, issues: Issue[] | undefined) => issues?.find((issue) => trip.openIssueIds.includes(issue.id));

export function statusOf(trip: OperationsTrip, issues: Issue[] | undefined): OperationsStatus {
  if (trip.outRow) return trip.outRow.status;
  if (!isRecorded(trip)) return { kind: 'unrecorded' };
  const open = openIssueOf(trip, issues);
  if (open) return { kind: 'open_problem', issueId: open.id, issueKind: open.kind, summary: problemLine(open), raisedAt: open.raisedAt };
  if (trip.attention.kind !== 'none') return trip.attention;
  if (trip.status === 'done' && trip.trip.backAt) return { kind: 'back', backAt: trip.trip.backAt };
  if (trip.status === 'out') return { kind: 'out' };
  return { kind: trip.status === 'done' ? 'out' : trip.status };
}

// A trip past its planned leave and not out, or past a stop's planned arrival with no arrival (rule 4).
export const isWatched = (attention: TripAttention): attention is Extract<TripAttention, { plannedAt: string }> => 'plannedAt' in attention;

// Rule 5: Problems only shows trips with an open problem, a trip past its leave and not out, or a missing arrival report.
export const needsAttention = (trip: OperationsTrip) => trip.openIssueIds.length > 0 || (isRecorded(trip) && isWatched(trip.attention));

export interface RowFacts {
  status: OperationsStatus;
  // The sentence beside the truck, and the short word in the status column.
  sentence: string;
  word: string;
  tone: Tone;
  // The row's tint: red with an open problem, yellow while a report is missing.
  tint: 'bad' | 'warn' | null;
}

const WORD: Partial<Record<OperationsStatus['kind'], string>> = {
  retry_requested: 'retry', at_stop: 'at a stop', returning: 'returning', back: 'done', planned: 'not left', loading: 'loading', ready: 'ready', out: 'out', unrecorded: '–',
};

// The recorded facts of a trip that is waiting, loading or out with nothing else to say.
function factsOf(trip: RecordedTrip) {
  const leaves = `leaves ${clockTime(trip.schedule.leavesAt)}`;
  const t = trip.trip;
  if (trip.status === 'planned') return `Not loaded yet · ${leaves}`;
  if (trip.status === 'loading') return trip.onSoFar ? `Loading · ${whole(trip.onSoFar.units)} on so far · ${leaves}` : `Loading · ${leaves}`;
  if (trip.status === 'ready') {
    const on = trip.figures.loaded === null ? null : `${whole(trip.figures.loaded)} of ${whole(trip.figures.ordered)} on`;
    return [t.readyAt ? `Ready ${clockTime(t.readyAt)}` : 'Ready', on].filter(Boolean).join(' · ');
  }
  if (trip.status === 'done') return t.backAt ? backAtDepot(t.backAt) : 'Done';
  const next = trip.outRow?.nextStop ?? trip.figures.next;
  const planned = next ? trip.stopDetails.find((stop) => stop.id === next.id)?.plannedArrival : null;
  return [t.leftAt ? `Left ${clockTime(t.leftAt)}` : 'Out', next ? `next ${next.shopName}${planned ? ` · planned ${clockTime(planned)}` : ''}` : null].filter(Boolean).join(' · ');
}

export function rowFacts(trip: OperationsTrip, issues: Issue[] | undefined): RowFacts {
  const status = statusOf(trip, issues);
  if (status.kind === 'open_problem') {
    const issue = issues?.find((i) => i.id === status.issueId);
    return { status, sentence: issue ? problemLine(issue) : status.summary, word: problemWord(status.issueKind, issue), tone: 'bad', tint: 'bad' };
  }
  // Past its leaving time the server says what the dock recorded, a sentence and a word (Q-24).
  if ('word' in status) return { status, sentence: status.sentence, word: status.word, tone: 'warn', tint: 'warn' };
  if (status.kind === 'arrival_unreported') return { status, sentence: statusSentence(status, null)!, word: 'watching', tone: 'warn', tint: 'warn' };
  // A trip whose problem is not in the open list yet still says it has one, until the list catches up.
  const tint = trip.openIssueIds.length > 0 ? 'bad' : null;
  if (!isRecorded(trip)) return { status, sentence: NOT_RECORDED, word: WORD.unrecorded!, tone: 'plain', tint };
  const said = statusSentence(status, null);
  // An arrival recorded after the shop's window closed says so beside it (rule 4).
  const late = status.kind === 'at_stop' && trip.stopDetails.find((stop) => stop.id === status.stopId)?.arrivedAfterWindow ? ` · ${ARRIVED_AFTER_WINDOW}` : '';
  // A returning trip's planned return, as the server words it: "was due back 06:38" once that time has passed.
  const sentence = status.kind === 'returning' ? status.sentence : said ? `${said}${late}` : factsOf(trip);
  return { status, sentence, word: WORD[status.kind] ?? trip.status, tone: 'plain', tint };
}

// Every trip of the read: the watched day's groups, then the earlier days still out.
export const tripsOfGroups = (groups: OperationsGroup[]) => groups.flatMap((group) => group.trips);
export const allTrips = (day: OperationsDay) => [...tripsOfGroups(day.groups), ...day.earlierOut.flatMap((section) => tripsOfGroups(section.groups))];

export type Filter = 'all' | 'problems';

// The groups a filter leaves: Problems only keeps the rows that need attention. Totals never change with it.
export const shownGroups = (groups: OperationsGroup[], filter: Filter) =>
  groups.map((group) => ({ group, trips: filter === 'all' ? group.trips : group.trips.filter(needsAttention) })).filter((g) => g.trips.length > 0);
