import type { Issue, IssueDecision } from '@wayfinder/contracts';
import { brandOfShop, clockTime, sentLine as loaderSentLine, truckName, unitsWords, whole } from '@/features/loader/words';

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
