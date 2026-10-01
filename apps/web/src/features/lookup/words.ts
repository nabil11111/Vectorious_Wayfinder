import { ZodError } from 'zod';
import {
  lineReason, type Brand, type DeferralCode, type HistoryLine, type HistoryMeasure, type HistoryTrip, type IssueDecision, type IssueKind, type IssueReason, type Load,
  type LookupFuel, type LookupOrderRow, type LookupOrders, type LookupTripRef, type LookupVehicle, type OrderStatus, type ReceiptReport,
} from '@wayfinder/contracts';
type HistoryReport = Pick<ReceiptReport, 'reason' | 'lines'>;
import { DECISION_WORDS, depotDay } from '@/features/live/words';
import { clockTime, shortDay, unitsWords, whole } from '@/features/loader/words';
import { DEFERRAL, litres, tonnes } from '@/features/plan/words';
import { cubic, kilos } from '@/features/store/words';
import { ApiRequestError } from '@/lib/api';

// The words and formats of the dispatcher's look-up pages (spec 017, "Screen states"). Every figure comes from the read
// the page holds; these only write it down. Times are depot time.

export { clockTime, shortDay, unitsWords, whole };

// "Thu 25", the frame's short day in a table cell.
export const dayOfMonth = (date: string) => shortDay(date).split(' ').slice(0, 2).join(' ');
// The depot day of an instant, "2026-06-25".
export const depotDate = (moment: string) => depotDay(moment);

// What to say when a read fails: the API's own sentence, or that the answer was not one this page can read.
export function reasonOf(error: unknown) {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof ZodError) return 'Wayfinder answered with records this page cannot read.';
  return 'Could not reach Wayfinder. Check the connection and try again.';
}

// The states every page shares (the No frame rows).
export const CONNECTION_LOST = 'Connection lost · these records may be out of date.';
export const staleLine = (readAt: string) => `Could not update. These are the last records loaded, read at ${clockTime(readAt)}.`;
export const NOT_A_DATE = 'That is not a calendar date. Choose another day.';
export const NO_CONNECTION = 'No connection. These records load once the connection is back.';

// ── Orders ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const ordersFor = (date: string) => `Orders for ${shortDay(date)}`;
// The page's title, from the read when it has one and from the asked-for day while it loads: "Orders for Thu 25 Jun",
// "Orders for Fri 29 May to Thu 25 Jun". A day nobody chose and the server has not named yet is just "Orders".
export function ordersTitle(read: Pick<LookupOrders, 'date' | 'from' | 'range'> | null, asked: { date?: string; range: 'day' | 'four_weeks' } | null) {
  const date = read ? read.date : asked?.date ?? null;
  const range = read ? read.range : asked?.range ?? 'day';
  if (!date) return 'Orders';
  if (range === 'day') return ordersFor(date);
  return read?.from ? `Orders for ${rangeWords(read.from, date)}` : `Orders for 4 weeks to ${shortDay(date)}`;
}
export const ORDERS_FAILED = 'Could not load orders.';
export const CHOOSE_DAY = 'Choose a delivery day';
export const CHOOSE_DAY_LINE = 'There is no delivery day on the board right now, so pick the day to look up.';
export const NO_ORDERS = 'No orders for this delivery day.';
export const NO_ORDERS_IN_RANGE = 'No orders in these four weeks.';
export const NO_MATCH = 'No orders match these filters.';
export const NO_SKIPS = 'No shops skipped in these four weeks.';
export const NO_SENT_PLAN = 'No sent plan';
export const NO_SENT_PLANS = 'No sent plans';
export const PICK_ORDER = 'Choose an order to see its lines and its sent plans.';
export const showing = (shown: number, total: number) => `Showing ${whole(shown)} of ${whole(total)}`;
// The range a Last 4 weeks read covers: "29 May to Thu 25 Jun".
export const rangeWords = (from: string, to: string) => `${shortDay(from)} to ${shortDay(to)}`;

export const STATUS_WORDS: Record<OrderStatus, string> = {
  draft: 'Draft', placed: 'Placed', planned: 'Planned', deferred: 'Deferred', loaded: 'Loaded', delivered: 'Delivered', received: 'Received',
  cancelled: 'Cancelled', split: 'Split',
};
// The current status, said as now: "Now planned", which a dated sent plan never is.
export const nowWords = (status: OrderStatus) => `Now ${STATUS_WORDS[status].toLowerCase()}`;

// A deferral's short name, as the plan board writes the six reasons: "No fridge truck".
export const deferralName = (code: DeferralCode) => DEFERRAL[code].label;
// "1×", "3×" in the Deferred column, and "deferred 3 times" on the detail.
export const timesShort = (n: number) => `${whole(n)}×`;
export const timesLong = (n: number) => (n === 1 ? 'deferred once' : `deferred ${whole(n)} times`);

// The frame's load: "4 ct · 27 kg · 0.2 m³" for Fresh cartons and "130 u · 1,950 kg · 31 m³" for Style and Tech units.
export const loadWords = (brand: Brand, load: Pick<Load, 'units' | 'kg' | 'm3'>) =>
  `${whole(load.units)} ${brand === 'Fresh' ? 'ct' : 'u'} · ${kilos(Math.round(load.kg))} · ${cubic(load.m3)}`;
// A time the database keeps as 05:00:00, written 05:00.
const hhmm = (time: string) => /^\d{2}:\d{2}/.exec(time)?.[0] ?? time;
// "05:00–07:30", and a mall's own slot on the detail: "mall 10:30–12:30".
export const windowWords = (outlet: { windowOpen: string; windowClose: string }) => `${hhmm(outlet.windowOpen)}–${hhmm(outlet.windowClose)}`;
export const mallWords = (mallWindow: string) => `mall ${mallWindow.split('-').map(hhmm).join('–')}`;
// "VEH035 · 1": the truck and the stop's place on it, and "VEH035 trip 2 · 1" for a second trip.
export const truckStop = (assignment: { vehicleId: string; tripNo: number; seq: number }) =>
  `${assignment.tripNo > 1 ? `${assignment.vehicleId} trip ${assignment.tripNo}` : assignment.vehicleId} · ${assignment.seq}`;
// A line of an order: "55 cartons · Chilled carton".
export const lineWords = (line: { quantity: number; unit: string; name: string }) =>
  `${whole(line.quantity)} ${line.quantity === 1 ? line.unit : plural(line.unit)} · ${line.name}`;
const plural = (unit: string) => {
  const [head = '', ...rest] = unit.split(' of ');
  return [/(s|x|ch|sh)$/.test(head) ? `${head}es` : `${head}s`, ...rest].join(' of ');
};
// "placed Wed 24 Jun 08:40", or that the time was not recorded.
export const placedWords = (placedAt: string | null) => (placedAt ? `placed ${shortDay(depotDate(placedAt))} ${clockTime(placedAt)}` : 'placed time not recorded');
// "wanted Thu 25 Jun"
export const wantedWords = (date: string) => `wanted ${shortDay(date)}`;
// A split part's share of its original: "split · 6 of 12 cartons".
export const partOf = (row: Pick<LookupOrderRow, 'load' | 'original'>) => (row.original ? `split · ${whole(row.load.units)} of ${whole(row.original.load.units)}` : null);
export const historyLink = (date: string) => `Open ${shortDay(date)} in History`;
export const historyHref = (date: string, tripId?: string) => `/dispatcher/history?${new URLSearchParams(tripId ? { date, trip: tripId } : { date }).toString()}`;

// ── History ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const historyTitle = (date: string | null) => (date ? `History · ${shortDay(date)}` : 'History');
export const HISTORY_FAILED = 'Could not load history.';
export const NO_SENT_PLANS_YET = 'No sent plans yet.';
// A depot whose sent plans are all for days after today (Q-14): History opens on none, so it says so and names one of
// them, the soonest the chips list.
export const sentLater = (date: string) => `No plan is sent for today or earlier yet. The plan for ${shortDay(date)} is sent.`;
export const openDay = (date: string) => `Open ${shortDay(date)}`;
export const NO_SENT_PLAN_ON = 'No sent plan for this date.';
export const NO_TRIPS_SENT = 'No trips recorded on this sent plan.';
export const NO_TRIP_MATCH = 'No trips match these filters.';
export const NO_DEFERRALS = 'No orders were deferred on this sent plan.';
export const TRIP_NOT_ON_PLAN = 'That trip is not on this sent plan.';
export const PICK_TRIP = 'Choose a trip to see its stops, its loading, its problems and its proof.';
export const NO_PHOTO = 'No photo recorded';
export const PHOTO_FAILED = 'Could not load the photo';
export const NOT_CONFIRMED = 'Not confirmed by the shop yet';
export const NOTHING_NOT_DELIVERED = 'No closed or refused stops on this sent plan.';
export const NO_CONFIRMATIONS = 'No shop has confirmed a delivery on this plan yet.';
export const RETURN_INSTRUCTED = 'Return instructed';
export const showingTrips = (shown: number, total: number) => `Showing ${whole(shown)} of ${whole(total)} ${total === 1 ? 'trip' : 'trips'}`;

export const TRIP_STATUS_WORDS: Record<LookupTripRef['status'], string> = { planned: 'Not loaded', loading: 'Loading', ready: 'Ready', out: 'Out', done: 'Back' };
export const OUTCOME_WORDS = { delivered: 'delivered', refused: 'refused some', closed: 'nobody there' } as const;

// A stage's units, or that it was not recorded with how many lines were: "117", "not recorded (2 of 5 lines)".
export const measureWords = (measure: HistoryMeasure) =>
  (measure.units === null ? `not recorded (${whole(measure.known)} of ${whole(measure.total)} lines)` : whole(measure.units));
// The stages not recorded yet, grouped by how many lines each has: "Not recorded yet: loaded, handed over and received
// (0 of 5 lines)", or null when every stage is recorded.
export function unrecordedWords(stages: [string, HistoryMeasure][]) {
  const groups = new Map<string, string[]>();
  for (const [label, measure] of stages) {
    if (measure.units !== null) continue;
    const coverage = `${whole(measure.known)} of ${whole(measure.total)} lines`;
    groups.set(coverage, [...(groups.get(coverage) ?? []), label]);
  }
  if (groups.size === 0) return null;
  const listed = (labels: string[]) => (labels.length === 1 ? labels[0]! : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`);
  return `Not recorded yet: ${[...groups].map(([coverage, labels]) => `${listed(labels)} (${coverage})`).join('; ')}`;
}

// A line's count, or a dash when that stage was not recorded for it.
export const countWords = (count: number | null) => (count === null ? '–' : whole(count));

// A trip in its group: "trip 1 · 2 stops · back 06:30", or the planned return while it is not back.
export const tripLine = (trip: HistoryTrip) =>
  [`trip ${trip.tripNo}`, `${whole(trip.stops.length)} ${trip.stops.length === 1 ? 'stop' : 'stops'}`, trip.backAt ? `back ${clockTime(trip.backAt)}` : `planned back ${clockTime(trip.schedule.backAt)}`].join(' · ');
// "VEH035 · Dilshan", "VEH035 trip 2 · Dilshan"
export const tripName = (trip: Pick<HistoryTrip, 'vehicleId' | 'tripNo' | 'driver'>) =>
  [trip.tripNo > 1 ? `${trip.vehicleId} trip ${trip.tripNo}` : trip.vehicleId, trip.driver?.name].filter(Boolean).join(' · ');
// "Fresh · Colombo", "Mixed · Colombo"
export const tripPlace = (trip: Pick<HistoryTrip, 'brand' | 'district'>) => `${trip.brand ?? 'Mixed'} · ${trip.district}`;

const ISSUE_WORDS: Record<IssueKind, string> = { loading: 'Flagged at the dock', refused: 'Refused at the shop', closed: 'Nobody at the shop', receipt: 'Shop report' };
export const issueWords = (kind: IssueKind) => ISSUE_WORDS[kind];
const REASON_WORDS: Record<IssueReason, string> = {
  short: 'short', damaged: 'damaged', wrong_item: 'wrong item', wont_fit: 'won\'t fit', expired: 'expired', not_ordered: 'not ordered', nobody_there: 'nobody there',
  missing: 'missing', not_cold: 'not cold',
};
export const reasonWords = (reason: IssueReason) => REASON_WORDS[reason];
// A shop's report by its lines, each with its own reason (Q-40): "1 chilled carton damaged, 1 dry carton missing", and
// "1 crate of 2 · Refrigerators damaged" for Style and Tech. A report kept before lines had reasons reads its one reason
// on each short line, and one of warm goods only says "not cold".
export function reportWords(report: HistoryReport, lines: HistoryLine[], brand: Brand) {
  const said = report.lines.flatMap((counted) => {
    const reason = lineReason(report, counted);
    const line = lines.find((each) => each.lineId === counted.lineId);
    if (!reason || !line) return [];
    const goods = brand === 'Fresh' ? `${whole(counted.counted)} ${line.temp} ${counted.counted === 1 ? line.unit : plural(line.unit)}` : `${whole(counted.counted)} ${counted.counted === 1 ? line.unit : plural(line.unit)} · ${line.name}`;
    return [`${goods} ${REASON_WORDS[reason]}`];
  });
  return said.length ? said.join(', ') : REASON_WORDS[report.reason];
}
// "answered Go short · Ruwan 02:35", or that it waits for an answer in Live day.
export const answerWords = (decision: IssueDecision | null, decidedBy: string | null, decidedAt: string | null) =>
  (decision ? [`answered ${DECISION_WORDS[decision]}`, [decidedBy, decidedAt && clockTime(decidedAt)].filter(Boolean).join(' ')].filter(Boolean).join(' · ') : 'not answered yet');
// "Sent 08:32", or for a receipt that never travelled (the seeded history) that its sending was not recorded.
export const sentWords = (sentAt: string | null) => (sentAt ? `reached the depot ${clockTime(sentAt)}` : 'time sent not recorded');
export const coldWords = (cold: boolean | null) => (cold === null ? null : cold ? 'chilled goods arrived cold' : 'chilled goods arrived warm');

// ── Fleet ────────────────────────────────────────────────────────────────────────────────────────────────────────

export const fleetTitle = (depot: string) => `Fleet · ${depot}`;
export const FLEET_FAILED = 'Could not load fleet.';
export const NO_VEHICLES = 'No vehicles at this depot.';
export const NO_VEHICLE_MATCH = 'No vehicles match these filters.';
export const PICK_VEHICLE = 'Choose a vehicle to see its limits, its fuel this week and its latest sent trips.';
export const NO_TRIP_TODAY = 'No trip recorded today';
export const NO_SENT_TRIPS = 'No sent trips recorded.';
export const WEEK_UNAVAILABLE = 'Week not available';
export const NO_QUOTA = 'No quota recorded';
export const ARCHIVED = 'Archived';

export const GROUP_WORDS: Record<LookupVehicle['group'], string> = { reefer_trucks: 'Reefer trucks', dry_trucks: 'Dry trucks', vans: 'Vans' };
// "reefer truck", "dry truck", "reefer van", "van".
export const kindWords = (vehicle: Pick<LookupVehicle, 'type' | 'temp'>) =>
  (vehicle.type === 'van' ? (vehicle.temp === 'reefer' ? 'reefer van' : 'van') : vehicle.temp === 'reefer' ? 'reefer truck' : 'dry truck');
const ECONOMY = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
export const economyWords = (kmPerL: number) => `${ECONOMY.format(kmPerL)} km/l`;
// "6.8 t · 33.4 m³ · 4.4 km/l", and "· reefer" on a fridge van, as the frame writes VEH035.
export const limitsWords = (vehicle: LookupVehicle) =>
  [tonnes(vehicle.weightCapKg), cubic(vehicle.volumeCapM3), economyWords(vehicle.kmPerL), vehicle.type === 'van' && vehicle.temp === 'reefer' ? 'reefer' : null].filter(Boolean).join(' · ');
export { cubic, kilos, litres };

// A recorded trip's state as Today shows it, never a place: "out · trip 1 · left 04:40", "out since Wed 24 · trip 1",
// "ready 02:35 · trip 1", "returned 06:30 · trip 1".
export function tripState(trip: LookupTripRef, today: string) {
  const which = `trip ${trip.tripNo}`;
  switch (trip.status) {
    case 'out':
      return trip.date === today
        ? [`out · ${which}`, trip.leftAt && `left ${clockTime(trip.leftAt)}`].filter(Boolean).join(' · ')
        : `out since ${dayOfMonth(trip.date)} · ${which}`;
    case 'planned': return `planned · ${which} · leaves ${clockTime(trip.leavesAt)}`;
    case 'loading': return `loading · ${which}`;
    case 'ready': return [trip.readyAt ? `ready ${clockTime(trip.readyAt)}` : 'ready', which].join(' · ');
    case 'done': return [trip.backAt ? `returned ${clockTime(trip.backAt)}` : 'returned', which].join(' · ');
  }
}

// The fuel left's colour, as the frame draws it: red under a tenth of the quota or past it, yellow under a quarter.
export type FuelTone = 'bad' | 'warn' | 'good' | null;
export function fuelTone(fuel: Pick<LookupFuel, 'remaining' | 'remainingPct'> | null): FuelTone {
  if (!fuel) return null;
  if (fuel.remaining < 0) return 'bad';
  if (fuel.remainingPct === null) return null;
  return fuel.remainingPct < 10 ? 'bad' : fuel.remainingPct < 25 ? 'warn' : 'good';
}

// The fuel left this week: "40 L", or past the quota "Over quota by 2.7 L".
export const fuelLeftWords = (fuel: Pick<LookupFuel, 'remaining'>) => (fuel.remaining < 0 ? `Over quota by ${litres(-fuel.remaining)}` : litres(fuel.remaining));
// This week's sent trips and their planned distance: "1 sent trip · 7.2 km planned".
const KM = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
export const weekWords = (fuel: Pick<LookupFuel, 'sentTrips' | 'plannedKm'>) =>
  `${whole(fuel.sentTrips)} sent ${fuel.sentTrips === 1 ? 'trip' : 'trips'} · ${KM.format(fuel.plannedKm)} km planned`;
export const kmWords = (km: number) => `${KM.format(km)} km`;
// "6,945 / 18,600 L"
export const ledgerWords = (fuel: Pick<LookupFuel, 'recordedCommitted' | 'quota'>) =>
  `${litres(fuel.recordedCommitted).replace(' L', '')} / ${litres(fuel.quota)}`;
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
