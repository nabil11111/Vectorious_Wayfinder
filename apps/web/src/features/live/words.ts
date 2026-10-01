import { DEPOT_TIME_ZONE, type Brand, type Issue, type IssueDecision, type IssueKind, type OperationsCounts, type OperationsDay, type OperationsEvent, type OperationsStatus } from '@wayfinder/contracts';
import { brandOfShop, clockTime, issueTitle, reportTitle, sentLine as loaderSentLine, shortDay, truckName, unitsWords, whole } from '@/features/loader/words';
import { countOf } from '@/features/plan/words';
import { inDepot } from '@/lib/clock';

// The words of a driver's problem on Live day (spec 013, the screen states' Live day rows): a shop that refused some
// and a shop that was closed. Every number is the API's, as spec 012's problem words take them; this only writes them
// down. A loader's flag keeps spec 012's words.

const brandOf = (issue: Pick<Issue, 'stop'>) => brandOfShop(issue.stop.shopName);

// The cartons a problem counts: "2 chilled cartons" when its lines are of one temperature at a Fresh shop, and the
// brand's units otherwise, "94 cartons".
export function countedGoods(issue: Pick<Issue, 'stop' | 'lines' | 'short'>) {
  const temps = new Set(issue.lines.map((line) => line.temp));
  const brand = brandOf(issue);
  const units = unitsWords(brand, issue.short);
  return brand === 'Fresh' && temps.size === 1 ? units.replace(' ', ` ${[...temps][0]} `) : units;
}

const REASON: Record<string, string> = { damaged: 'damaged', expired: 'expired', not_ordered: 'not ordered' };

// "2 chilled cartons refused", "Nobody at Fresh Wellawatte"
export const driverIssueTitle = (issue: Issue) => (issue.kind === 'refused' ? `${countedGoods(issue)} refused` : `Nobody at ${issue.stop.shopName}`);

// "Fresh Wellawatte · stop 2 · VEH035 · Dilshan · damaged, the shop took 46 of 48 chilled", and for a closed shop
// "stop 2 · VEH035 · Dilshan · arrived 03:45, saved 03:48".
export function driverIssuePlace(issue: Issue) {
  const who = [`stop ${issue.stop.seq}`, truckName(issue.trip), issue.trip.driver ?? issue.raisedBy];
  if (issue.kind === 'closed') {
    const times = [issue.stop.arrivedAt && `arrived ${clockTime(issue.stop.arrivedAt)}`, `saved ${clockTime(issue.raisedAt)}`].filter(Boolean).join(', ');
    return [...who, times].join(' · ');
  }
  const fresh = brandOf(issue) === 'Fresh';
  const took = issue.lines.map((line) => `${whole(line.delivered ?? 0)} of ${whole(line.loaded ?? 0)} ${fresh ? line.temp : line.name}`).join(' and ');
  return [issue.stop.shopName, ...who, `${REASON[issue.reason] ?? issue.reason}, the shop took ${took}`].join(' · ');
}

// "Dilshan · 03:48"
export const driverRaised = (issue: Issue) => `${issue.raisedBy} · ${clockTime(issue.raisedAt)}`;

// "loaded 02:31, nothing flagged"
export const atTheDock = (issue: Issue) =>
  `${issue.stop.loadedAt ? `loaded ${clockTime(issue.stop.loadedAt)}` : 'not loaded'}, ${issue.stop.flaggedAtDock ? 'flagged at the dock' : 'nothing flagged'}`;

// "Still on VEH035" and "2 chilled cartons · no stops left"
export const stillOnLabel = (issue: Issue) => `Still on ${truckName(issue.trip)}`;
export function stillOnValue(issue: Issue) {
  const left = issue.trip.stopsLeft;
  const stops = left === 0 ? 'no stops left' : `${whole(left)} ${left === 1 ? 'stop' : 'stops'} left`;
  return `${issue.kind === 'refused' ? countedGoods(issue) : unitsWords(brandOf(issue), issue.short)} · ${stops}`;
}

export const driverQuestion = (issue: Issue) => (issue.kind === 'refused' ? 'What should the driver do with them?' : 'What should the driver do?');

// The dispatcher's answers to a driver's problem (D-48): a refusal's one, and a closed shop's two. "Try again on this
// trip" is not offered once the trip is back.
export function driverAnswers(issue: Issue, depot: string): { decision: IssueDecision; title: string; line: string }[] {
  if (issue.kind === 'refused') return [{ decision: 'bring_back', title: `Bring them back to ${depot}`, line: 'The driver hands them in at the depot.' }];
  return [
    ...(issue.trip.status === 'out' ? [{ decision: 'try_again' as const, title: 'Try again on this trip', line: 'The driver goes back after the other stops.' }] : []),
    { decision: 'bring_back', title: 'Bring them back', line: 'The orders wait for the next plan.' },
  ];
}

// The green card once an answer is sent: "VEH035 · 2 cartons back to Peliyagoda, Dilshan told", "VEH035 · tries Fresh
// Wellawatte again, Dilshan told", and a loader's flag in spec 012's words.
export function answeredLine(issue: Issue, depot: string) {
  if (issue.kind === 'loading') return loaderSentLine(issue);
  const driver = issue.trip.driver ?? issue.raisedBy;
  const truck = truckName(issue.trip);
  if (issue.decision === 'try_again') return `${truck} · tries ${issue.stop.shopName} again, ${driver} told`;
  return `${truck} · ${unitsWords(brandOf(issue), issue.short)} back to ${depot}, ${driver} told`;
}

// ── Watching the day (spec 016, plan.md "Screens and layout") ──────────────────────────────────────────────────
// Every number below is the operations read's or an open problem's, and these only write it down. Nothing here adds
// counts up: a stop's delivered or refused units are the server's figures for that stop.

const DATE = new Intl.DateTimeFormat('en-CA', { timeZone: DEPOT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
// The depot day an instant falls on: "2026-06-25".
export const depotDay = (moment: string | number) => DATE.format(typeof moment === 'string' ? Date.parse(moment) : moment);

// A time on a day, "04:36", with its weekday when it falls on another day: "Wed 16:00", "Fri 00:10".
export function timeOn(moment: string, day: string | null) {
  return day === null || depotDay(moment) === day ? clockTime(moment) : `${inDepot(Date.parse(moment)).weekday} ${clockTime(moment)}`;
}

// "1 / 38", and "– / 2" when the numerator was not recorded.
export const ratio = (numerator: number | null, denominator: number) => `${numerator === null ? '–' : whole(numerator)} / ${whole(denominator)}`;

// What the delivered count leaves out, said beside it: "1 partial", "1 with none delivered", "1 closed".
export function deliveredExtras(counts: OperationsCounts) {
  return [
    counts.partialStops ? `${whole(counts.partialStops)} partial` : null,
    counts.noGoodsStops ? `${whole(counts.noGoodsStops)} with none delivered` : null,
    counts.closedStops ? `${whole(counts.closedStops)} closed` : null,
  ].filter((part): part is string => part !== null);
}
// Under the dashboard's delivered tile: "stops delivered · 1 partial", and "· no plan out" when no plan is out.
export function deliveredNote(counts: OperationsCounts, planOut: boolean) {
  if (!planOut) return 'stops delivered · no plan out';
  if (counts.stopsDelivered === null) return 'stops delivered · not recorded';
  return ['stops delivered', ...deliveredExtras(counts)].join(' · ');
}

export type Fuel = NonNullable<OperationsDay['fuel']>;
// The fuel tile: "37%" and "6,947.7 / 18,600 L", or what stands in for them.
export const FUEL_UNAVAILABLE = 'Fuel week unavailable';
export const NO_QUOTA = 'No quota recorded';
const LITRES = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
export const fuelLitres = (fuel: Fuel) => `${LITRES.format(fuel.litres)} / ${LITRES.format(fuel.quotaLitres)} L`;

// The next run: "Next run · Fri 26 Jun" and "Orders close Thu 16:00".
export const nextRunTitle = (date: string) => `Next run · ${shortDay(date)}`;
export const ordersClose = (cutoffAt: string) => `Orders close ${inDepot(Date.parse(cutoffAt)).weekday} ${clockTime(cutoffAt)}`;
export const NO_NEXT_DAY = 'No next delivery day.';

// The day's sentences when there is less to show (the spec's No frame states).
export const NO_DAY = 'No delivery day is left.';
export const noPlanOut = (date: string) => `No plan is out for ${shortDay(date)}.`;
export const NOTHING_NEEDS_YOU = 'Nothing needs you right now.';
export const NO_TRUCK_OUT = 'No truck is out right now.';
export const NO_TRIPS = 'No trips on this plan.';
export const NO_MATCH = 'No truck needs attention in this view.';
export const NO_EVENTS = 'No events recorded for these trips yet.';
export const NOT_RECORDED_PLAN = 'Movement details were not recorded for this plan.';
export const NOT_RECORDED = 'Not recorded';
export const NOT_RECORDED_YET = 'Not recorded yet';
export const TRIP_GONE = 'That trip is no longer in this view.';
export const ANSWERED_ALREADY = 'That problem was already answered.';
export const LOAD_FAILED = 'Could not load the day.';
// On both depots together the line names the depot whose read it is (spec 021).
export const staleLine = (readAt: string, depot?: string) => `Could not update${depot ? ` ${depot}'s day` : ''}. Showing the last read at ${clockTime(readAt)}.`;
export const stillOutFrom = (date: string) => `Still out from ${shortDay(date)}`;

// A truck's place: "Fresh · Colombo", "Mixed · Colombo".
export const brandName = (brand: Brand | null) => brand ?? 'Mixed';
export const placeLine = (trip: { brand: Brand | null; district: string }) => `${brandName(trip.brand)} · ${trip.district}`;
// A group's line: "Colombo · 1 truck", and its trips when a truck goes twice: "Colombo · 1 truck · 2 trips".
export function groupLine(group: { district: string; vehiclesTotal: number; tripsTotal: number }) {
  const trucks = `${group.district} · ${countOf(group.vehiclesTotal, 'truck')}`;
  return group.tripsTotal === group.vehiclesTotal ? trucks : `${trucks} · ${countOf(group.tripsTotal, 'trip')}`;
}
// A brand's header from its own server totals: "1 truck · 1 of 2 stops done".
export function brandLine(total: { vehiclesTotal: number; tripsTotal: number; stopsTotal: number; stopsDone: number | null }) {
  const trucks = total.tripsTotal === total.vehiclesTotal ? countOf(total.vehiclesTotal, 'truck') : `${countOf(total.vehiclesTotal, 'truck')} · ${countOf(total.tripsTotal, 'trip')}`;
  const done = total.stopsDone === null ? `${countOf(total.stopsTotal, 'stop')}, progress not recorded` : `${whole(total.stopsDone)} of ${countOf(total.stopsTotal, 'stop')} done`;
  return `${trucks} · ${done}`;
}

// Rule 4's sentences: what was recorded, or which report is missing. Nothing predicts a time or a place.
export const departureNotReported = (plannedAt: string) => `Departure not reported · planned ${clockTime(plannedAt)}`;
export const arrivalNotReported = (plannedAt: string) => `Arrival not reported · planned ${clockTime(plannedAt)}`;
export const retryRequested = (requestedAt: string) => `Retry requested ${clockTime(requestedAt)}`;
export const atShop = (shop: string, arrivedAt: string) => `At ${shop} · arrived ${clockTime(arrivedAt)}`;
export const RETURNING = 'Returning';
export const backAtDepot = (backAt: string) => `Back at depot ${clockTime(backAt)}`;
export const ARRIVED_AFTER_WINDOW = 'Arrived after window';

// A row's sentence for each recorded state, with the planned times it is set against.
export function statusSentence(status: OperationsStatus, problem: string | null) {
  switch (status.kind) {
    case 'open_problem': return problem ?? status.summary;
    case 'departure_unreported': return departureNotReported(status.plannedAt);
    case 'arrival_unreported': return arrivalNotReported(status.plannedAt);
    case 'retry_requested': return retryRequested(status.requestedAt);
    case 'at_stop': return atShop(status.shopName, status.arrivedAt);
    case 'returning': return RETURNING;
    case 'back': return backAtDepot(status.backAt);
    case 'unrecorded': return NOT_RECORDED;
    default: return null;
  }
}

// The short word in a row's status column.
const PROBLEM_WORD: Record<IssueKind, string> = { loading: 'short at the dock', refused: 'refused', closed: 'nobody there', receipt: 'reported by the shop' };
export function problemWord(kind: IssueKind, issue: Issue | undefined) {
  if (issue?.kind === 'refused') return `${whole(issue.short)} refused`;
  // A truck that cannot take it all (Q-20) is not short of stock.
  if (issue?.kind === 'loading') return issue.reason === 'wont_fit' ? `${whole(issue.short)} won't fit` : `${whole(issue.short)} short`;
  return PROBLEM_WORD[kind];
}
export function problemLine(issue: Issue) {
  if (issue.kind === 'loading') return `${issue.stop.shopName} · ${issueTitle(issue)}`;
  if (issue.kind === 'receipt') return `${issue.stop.shopName} · ${reportTitle(issue)}`;
  return `${issue.stop.shopName} · ${driverIssueTitle(issue)}`;
}

// The dispatcher's answers, as Drops and events names them.
export const DECISION_WORDS: Record<IssueDecision, string> = {
  go_short: 'Go short', load_all: 'Load it all', bring_back: 'Bring them back', try_again: 'Try again on this trip',
  send_replacements: 'Send replacements', no_replacement: 'No replacement',
};

// One event of Drops and events, as short as the frame's: "VEH035 · Nugegoda · 23 delivered". A stop's delivered or
// refused units come from that stop's own figures in the read, never from adding the event's lines up.
const placeName = (shopName: string) => { const brand = brandOfShop(shopName); return brand ? shopName.slice(brand.length + 1) : shopName; };
export function eventLine(event: OperationsEvent, figures: { delivered: number; refused: number } | undefined) {
  const where = [event.vehicleId, event.shop ? placeName(event.shop.name) : null].filter(Boolean).join(' · ');
  const fresh = event.shop ? brandOfShop(event.shop.name) === 'Fresh' : false;
  switch (event.kind) {
    case 'plan_sent': return event.actor ? `Plan sent by ${event.actor}` : 'Plan sent';
    case 'stop_loaded': return `${where} · loaded`;
    case 'truck_ready': return `${where} · ready`;
    case 'left': return `${where} · left the depot`;
    case 'arrived': return `${where} · arrived`;
    case 'back': return `${where} · back at the depot`;
    case 'delivered': return figures ? `${where} · ${whole(figures.delivered)} delivered` : `${where} · delivered`;
    case 'problem_raised': {
      if (event.issueKind === 'closed') return `${where} · nobody there`;
      if (event.issueKind === 'refused') return figures ? `${where} · ${whole(figures.refused)} refused` : `${where} · refused some`;
      if (event.issueKind === 'receipt') return `${where} · reported by the shop`;
      const counted = event.lines.filter((line) => line.counted !== null).map((line) => `${whole(line.counted!)} of ${whole(line.quantity)} ${fresh ? line.temp : line.name}`);
      return counted.length ? `${where} · flagged ${counted.join(', ')}` : `${where} · flagged at the dock`;
    }
    case 'answer_sent': return [where, event.decision ? DECISION_WORDS[event.decision] : 'Answered', event.actor].filter(Boolean).join(' · ');
  }
}
