import { z } from 'zod';
import { BRANDS, IssueDecision, IssueKind, type Brand } from './basics';
import type { DriverProblem, DriverStop, tripFigures } from './driver';

// A person's updates, the bell's pop-up (spec 025, D-99). Every update is read from a record the app already keeps, at
// that record's own time on the app clock, and the API words its line, so a screen only lays it out. No table holds
// them: the seeded day and a reset give the same updates.

const Moment = z.iso.datetime();

// What an update is about. The screens give each kind its picture from the design's icon sheet.
export const NOTIFICATION_KINDS = [
  // A store manager's: their order placed, their delivery on a sent plan, an order the plan moved to another day, the
  // truck leaving, the driver arriving, delivering, being refused or finding the shop closed, and the depot's answer to
  // their receipt report.
  'order_placed', 'delivery_planned', 'order_moved', 'truck_left', 'driver_arrived', 'delivered', 'refused', 'shop_closed', 'report_answered',
  // A dispatcher's: a new problem, and a truck loaded and ready, leaving (truck_left) and back.
  'problem', 'truck_ready', 'truck_back',
  // A loader's: the plan sent, sent again after a change, taken back to edit, and the dispatcher's answer to a flag.
  'plan_out', 'plan_changed', 'plan_taken_back', 'flag_answered',
  // A driver's: their trip sent, their trip on a plan sent again, their truck ready (truck_ready), and the dispatcher's
  // answer to their problem.
  'trip_sent', 'trip_changed', 'problem_answered',
] as const;
export const NotificationKind = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof NotificationKind>;

// How the row reads: plain news, a good end, something to watch, or something that needs a person.
export const NOTIFICATION_TONES = ['info', 'good', 'warn', 'bad'] as const;
export const NotificationTone = z.enum(NOTIFICATION_TONES);
export type NotificationTone = z.infer<typeof NotificationTone>;

// The most updates a read answers, newest first.
export const MAX_NOTIFICATIONS = 30;

export const Notification = z.object({
  // Stable for the same update on every read, "delivered:<stopId>", so a tab can tell which it has shown.
  id: z.string().min(1).max(200),
  kind: NotificationKind,
  // When it happened on the app clock, and that time as the row shows it: "16:06" today, "Tue 23 Jun 17:00" another day.
  at: Moment,
  time: z.string(),
  line: z.string(),
  // Where the person acts on it, an address in the app.
  link: z.string().startsWith('/'),
  tone: NotificationTone,
  // A problem's kind, on a dispatcher's new problem, for its picture. null otherwise.
  issueKind: IssueKind.nullable(),
  // The dispatcher's answer, on every update that is one, for its picture. On a driver's (problem_answered) also the
  // glanceable card's words (AC-3b): the short form, three words with the count, who answered and the full sentence.
  decision: IssueDecision.nullable(),
  answer: z.object({ short: z.string(), by: z.string(), sentence: z.string() }).nullable(),
});
export type Notification = z.infer<typeof Notification>;

export const NotificationList = z.object({ items: z.array(Notification).max(MAX_NOTIFICATIONS) });
export type NotificationList = z.infer<typeof NotificationList>;

// ── The dispatcher's answer to a driver's problem, in words both sides share ──────────────────────────────────────
// The driver's phone words its own screens, because it works with no signal (spec 013), and the API words the bell's
// row. Both write the answer here, from the same figures (tripFigures), so the card, the trip's top line and the bell's
// row agree: the full sentence, and its short form with the count, "Bring back · 2 chilled".

type StopCounts = ReturnType<typeof tripFigures>['byStop'][number];
type Answered = Pick<DriverProblem, 'kind' | 'decision'>;

const WHOLE = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const UNITS: Record<Brand, [string, string]> = { Fresh: ['carton', 'cartons'], Style: ['box', 'boxes'], Tech: ['item', 'items'] };
const unitsWords = (brand: Brand | null, n: number) => `${WHOLE.format(n)} ${(brand ? UNITS[brand] : ['unit', 'units'])[n === 1 ? 0 : 1]}`;

// The brand a stop's goods are counted in: the trip's, or the shop's own, by its name, when the trip mixes brands.
export const brandOfStop = (tripBrand: Brand | null, shopName: string): Brand | null => tripBrand ?? BRANDS.find((brand) => shopName.startsWith(`${brand} `)) ?? null;

// The units an answer is about: those refused, or for a closed shop all that stayed on the truck.
const answerKey = (problem: Answered) => (problem.kind === 'refused' ? 'refused' : 'notDelivered');

// "2 chilled cartons", "2 chilled cartons and 1 dry carton" for Fresh, the brand's units otherwise.
function goodsWords(brand: Brand | null, counts: StopCounts, key: 'refused' | 'notDelivered') {
  if (brand !== 'Fresh') return unitsWords(brand, counts[key]);
  return (['chilled', 'dry'] as const).filter((temp) => counts.byTemp[temp][key] > 0)
    .map((temp) => { const n = counts.byTemp[temp][key]; return `${WHOLE.format(n)} ${temp} ${n === 1 ? 'carton' : 'cartons'}`; }).join(' and ');
}

// The answer as a sentence: "Bring the 2 chilled cartons back to Peliyagoda.", "Try Fresh Wellawatte again after the
// other stops.", and with replacements (spec 015, D-59) "… back to Peliyagoda. The shop gets 2 replacements on the next
// run." Empty while the problem is open.
export function driverAnswerSentence(problem: Answered, stop: Pick<DriverStop, 'shopName'>, brand: Brand | null, counts: StopCounts, depot: string): string {
  if (problem.decision === null) return '';
  let what: string;
  if (problem.decision === 'try_again') what = `Try ${stop.shopName} again after the other stops.`;
  else if (problem.kind === 'refused') what = `Bring the ${goodsWords(brand, counts, 'refused')} back to ${depot}.`;
  else what = `Bring the ${unitsWords(brand, counts.notDelivered)} back to ${depot}.`;
  if (problem.decision === 'send_replacements') what += ` The shop gets ${WHOLE.format(counts.refused)} ${counts.refused === 1 ? 'replacement' : 'replacements'} on the next run.`;
  return what;
}

// The answer's short form, for a driver who glances (AC-3b): what to do and the count, "Bring back · 2 chilled",
// "Bring back · 94 cartons" when both temperatures stay on the truck, "Bring back · 3 boxes", or "Try again · Fresh
// Wellawatte". Replacements are the shop's news, so for the driver they read as bringing the cartons back. Empty while
// the problem is open.
export function driverAnswerShort(problem: Answered, stop: Pick<DriverStop, 'shopName'>, brand: Brand | null, counts: StopCounts): string {
  if (problem.decision === null) return '';
  if (problem.decision === 'try_again') return `Try again · ${stop.shopName}`;
  const key = answerKey(problem);
  const temps = (['chilled', 'dry'] as const).filter((temp) => counts.byTemp[temp][key] > 0);
  const what = brand === 'Fresh' && temps.length === 1 ? `${WHOLE.format(counts[key])} ${temps[0]}` : unitsWords(brand, counts[key]);
  return `Bring back · ${what}`;
}
