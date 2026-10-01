import type { BoardOrder, BoardShop, BoardVehicle, Brand, DeferralCode, DockType, Problem, SuggestionDecision, Temp } from '@wayfinder/contracts';
import { clockTime, cubic, kilos, shortDay } from '@/features/store/words';

// The words and formats of the plan board (spec 010, plan.md "Words"). Nothing here works a figure out: every
// time, load, distance, litre and percentage comes from the board the API sent, and this only writes it down.

export { clockTime, cubic, kilos, shortDay };

// "Plan for Thu 25 Jun" and "View plan · Thu 25 Jun".
export const planFor = (date: string) => `Plan for ${shortDay(date)}`;
export const viewPlanOf = (date: string) => `View plan · ${shortDay(date)}`;

// A time of day in minutes after midnight, as the checker sends it, to "03:30". A trip that runs past midnight
// reads 24:10, as the checker writes it.
export const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// "03:15" to 195: a time written HH:MM from 00:00 to 23:59. Anything else is null, and the field says how to write it.
export function readClock(text: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

const TONNES = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const LITRES = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const DECIMAL = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 });
const CUBIC_COUNT = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
const WHOLE = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

// A vehicle's limit in tonnes, "6.8 t". It is the vehicle's own figure in another unit, not a load.
export const tonnes = (kg: number) => `${TONNES.format(kg / 1000)} t`;
// "349 L", "250.7 L".
export const litres = (l: number) => `${LITRES.format(l)} L`;
// A number as the API sent it, with its decimals: "7.77", "140.7", "1,240".
export const figure = (n: number) => DECIMAL.format(n);
// Cubic metres in a count, to two places as the shop's screens write them: "47.25", "140.7".
export const space = (m3: number) => CUBIC_COUNT.format(m3);
export const whole = (n: number) => WHOLE.format(n);

// A vehicle is "reefer" (a fridge truck), "dry" (a truck), "van reefer" or "van".
export const vehicleKind = (v: Pick<BoardVehicle, 'type' | 'temp'>) =>
  v.type === 'van' ? (v.temp === 'reefer' ? 'van reefer' : 'van') : v.temp === 'reefer' ? 'reefer' : 'dry';
// "reefer 6.8 t · 33.4 m³"
export const vehicleSize = (v: BoardVehicle) => `${vehicleKind(v)} ${tonnes(v.weightCapKg)} · ${cubic(v.volumeCapM3)}`;

// Trucks named by their drivers (spec 026, D-100). A truck's kind as the checker's sentences call it: "reefer truck",
// "dry truck", "reefer van" or "van".
type Truck = Pick<BoardVehicle, 'id' | 'type' | 'temp'>;
export const truckKind = (v: Pick<BoardVehicle, 'type' | 'temp'>) =>
  (v.type === 'van' ? (v.temp === 'reefer' ? 'reefer van' : 'van') : v.temp === 'reefer' ? 'reefer truck' : 'dry truck');
// On the plan board's and View plan's cards and headers: "Chaminda · dry truck", "Chaminda · dry truck · trip 2" for its
// second trip, or by its kind and number while it has no driver, "dry truck VEH044". No number beside a driver.
export const crewName = (truck: Truck, driver: string | null, tripNo = 1) =>
  `${driver ? `${driver} · ${truckKind(truck)}` : `${truckKind(truck)} ${truck.id}`}${tripNo === 2 ? ' · trip 2' : ''}`;
// In a sentence: "Chaminda's dry truck", "the second trip of Chaminda's dry truck", or "the dry truck VEH044".
export function truckCalled(truck: Truck, driver: string | null, tripNo = 1) {
  const called = driver ? `${driver}'s ${truckKind(truck)}` : `the ${truckKind(truck)} ${truck.id}`;
  return tripNo === 2 ? `the second trip of ${called}` : called;
}
// A sentence that starts with a truck: "Chaminda's dry truck leaves early", "The dry truck VEH044 leaves early".
export const capital = (sentence: string) => sentence.charAt(0).toUpperCase() + sentence.slice(1);

// "Fresh Nugegoda" to "Nugegoda": a group row already says the brand. A shop's name is its brand and then its
// place (spec 003).
export const placeOf = (shop: Pick<BoardShop, 'name' | 'brand'>) =>
  shop.name.startsWith(`${shop.brand} `) ? shop.name.slice(shop.brand.length + 1) : shop.name;

// What a brand counts in, as the shop's cards do: Fresh cartons, Style boxes, Tech items.
const UNITS: Record<Brand, [string, string]> = { Fresh: ['carton', 'cartons'], Style: ['box', 'boxes'], Tech: ['item', 'items'] };
export const unitsOf = (brand: Brand, units: number) => `${WHOLE.format(units)} ${UNITS[brand][units === 1 ? 0 : 1]}`;

const TEMP_RANK: Record<Temp, number> = { chilled: 0, dry: 1 };
export const chilledFirst = <T extends Pick<BoardOrder, 'temp'>>(orders: T[]) => [...orders].sort((a, b) => TEMP_RANK[a.temp] - TEMP_RANK[b.temp]);

// One order: "53 cartons chilled", "135 boxes", "3 items".
export const orderAmount = (brand: Brand, order: Pick<BoardOrder, 'temp' | 'load'>) =>
  brand === 'Fresh' ? `${unitsOf(brand, order.load.units)} ${order.temp}` : unitsOf(brand, order.load.units);

// A shop's orders on one row, chilled first: "53 cartons chilled, 58 dry".
export function ordersAmount(brand: Brand, orders: Pick<BoardOrder, 'temp' | 'load'>[]) {
  return chilledFirst(orders).map((order, i) => (i > 0 && brand === 'Fresh' ? `${WHOLE.format(order.load.units)} ${order.temp}` : orderAmount(brand, order))).join(', ');
}

export const ENTRANCE: Record<DockType, string> = { street: 'street', rear_dock: 'rear dock', mall_bay: 'mall bay' };

// Under a shop: "window 05:30 to 08:00 · rear dock", "window 05:00 to 07:30 · street · van only", and a mall's
// slot, "mall bay 10:30 to 12:30".
export function shopLine(shop: BoardShop) {
  const parts = shop.mallOpen !== null && shop.mallClose !== null
    ? [`mall bay ${hhmm(shop.mallOpen)} to ${hhmm(shop.mallClose)}`]
    : [`window ${hhmm(shop.windowOpen)} to ${hhmm(shop.windowClose)}`, ENTRANCE[shop.dockType]];
  if (shop.parking === 'van_only') parts.push('van only');
  return parts.join(' · ');
}

// A stop's entrance and window: "rear dock · 05:30 to 08:00". The window is the one the checker timed the stop
// against, which for a mall shop is the part its mall is open.
export const entranceAndWindow = (shop: BoardShop, open: number, close: number) => `${ENTRANCE[shop.dockType]} · ${hhmm(open)} to ${hhmm(close)}`;

// A carried-over order: "wanted Wed 24 Jun · No fridge truck was left for Matara."
export const carriedLine = (order: BoardOrder) =>
  [`wanted ${shortDay(order.deliveryDate)}`, order.lastDeferral?.reason].filter(Boolean).join(' · ');
// "deferred 2×", red from two.
export const deferredTimes = (order: BoardOrder) => `deferred ${order.timesDeferred}×`;
// On a stop, the weekday it was wanted: "deferred Wed".
export const deferredOn = (order: BoardOrder) => `deferred ${shortDay(order.deliveryDate).split(' ')[0]}`;
// A part of a split order: "split · 60 of 135".
export const partLine = (order: BoardOrder) => (order.originalUnits === null ? '' : `split · ${WHOLE.format(order.load.units)} of ${WHOLE.format(order.originalUnits)}`);

// The six reasons an order waits (spec 007) and the sentence the shop reads, which the dispatcher can change.
export const DEFERRAL: Record<DeferralCode, { label: string; sentence: (shop: BoardShop) => string }> = {
  no_reefer: { label: 'No fridge truck', sentence: (shop) => `No fridge truck was left for ${shop.district}.` },
  over_capacity: { label: 'No room on a truck', sentence: (shop) => `The trucks for ${shop.district} were full.` },
  no_van: { label: 'No van free', sentence: () => 'The van that reaches this shop was full.' },
  window: { label: 'Window cannot be met', sentence: (shop) => `No truck could reach the shop before its window closed at ${hhmm(shop.windowClose)}.` },
  fuel: { label: 'Fuel quota', sentence: (shop) => `The trucks for ${shop.district} had used their fuel for the week.` },
  dispatcher_choice: { label: 'Our choice', sentence: () => '' },
};

// The sentence a deferred order's shop reads takes 200 characters at most, as the API checks it (rule 7, Q-11).
export const REASON_MOST = 200;
export const REASON_FULL = 'The sentence is full: 200 characters at most.';
export const REASON_REFUSED = 'The sentence takes 200 characters at most, so that was not added.';

// A change to the sentence is taken whole or not at all: one that would make it longer is refused, never cut.
export const reasonFits = (reason: string) => reason.length <= REASON_MOST;

// The line under the sentence: how many characters are left once 40 or fewer are, that it is full, or that a change
// was refused because it would have made the sentence too long.
export function reasonLine(length: number, refused: boolean): { words: string; refused: boolean } | null {
  if (refused) return { words: REASON_REFUSED, refused: true };
  const left = REASON_MOST - length;
  if (left <= 0) return { words: REASON_FULL, refused: false };
  if (left <= 40) return { words: `${whole(left)} ${left === 1 ? 'character' : 'characters'} left`, refused: false };
  return null;
}

// A problem in one line: its sentence and, when there is one, what would clear it.
export const problemLine = (problem: Problem) => [problem.message, problem.fix].filter(Boolean).join(' ');

// A group's ⋮ menu: "Defer all 3", and "Defer it" for a group of one order (L-08).
export const deferGroup = (n: number) => (n === 1 ? 'Defer it' : `Defer all ${WHOLE.format(n)}`);

// "1 order", "2 orders".
export const countOf = (n: number, one: string, many = `${one}s`) => `${WHOLE.format(n)} ${n === 1 ? one : many}`;

// The line when the board took orders out of a draft because they are no longer the day's (rule 2).
export const droppedLine = (n: number, date: string) =>
  `${countOf(n, 'order was', 'orders were')} taken off the plan: ${n === 1 ? 'it is' : 'they are'} no longer for ${shortDay(date)}.`;

// ── The suggested plan (spec 014, plan.md "Words") ─────────────────────────────────────────────────────────────

export const BUILD = 'Build the suggested plan';
export const BUILDING = 'Building the plan';
// Under Building, the board's counts: "102 orders · 35 trucks".
export const buildingLine = (orders: number, trucks: number) => `${countOf(orders, 'order')} · ${countOf(trucks, 'truck')}`;
// "Suggested plan · 16:00"
export const suggestedAt = (builtAt: string) => `Suggested plan · ${clockTime(builtAt)}`;
// "6 decisions to make", "1 decision to make" and "no decisions to make".
export const toMake = (n: number) => (n === 0 ? 'no decisions to make' : `${countOf(n, 'decision')} to make`);

// Replacing a draft (D-52), with the draft's counts: "Your 1 trip and 99 deferred orders are replaced".
export const REPLACE_TITLE = 'Replace the draft with a suggested plan?';
export function replaceLine(orders: number, trips: number, deferred: number) {
  const yours = [trips > 0 && countOf(trips, 'trip'), deferred > 0 && countOf(deferred, 'deferred order')].filter(Boolean).join(' and ');
  // "is" for one trip or one deferred order alone, "are" for anything more.
  const one = (trips === 1 && deferred === 0) || (trips === 0 && deferred === 1);
  return `The planner plans all ${countOf(orders, 'order')} again. Your ${yours} ${one ? 'is' : 'are'} replaced, and orders split on this draft are joined back first. Vehicles keep their drivers.`;
}
export const KEEP_DRAFT = 'Keep the draft';

// A decision's title by its kind: "Chaminda's dry truck leaves early, at 03:07", "Fresh Dickwella waits again" and
// "Fresh Pannala would be late, so it waits". shop is the shop of the order the decision is about, and truck the trip
// an early departure is about, in a sentence's words (spec 026). An order the board no longer has is called "This
// order".
export function decisionTitle(decision: Pick<SuggestionDecision, 'kind' | 'leaveAt'>, shop: string | null, truck: string | null) {
  if (decision.kind === 'early_leave') return `${capital(truck ?? 'a trip')} leaves early${decision.leaveAt === null ? '' : `, at ${hhmm(decision.leaveAt)}`}`;
  const who = shop ?? 'This order';
  return decision.kind === 'waited_again' ? `${who} waits again` : `${who} would be late, so it waits`;
}
export const TO_DECIDE = 'to decide';
// After an accept: "✓ accepted 16:08" in why?, and "✓ Accepted 16:08" on View plan.
export const acceptedNote = (at: string) => `✓ accepted ${clockTime(at)}`;
export const acceptedLine = (at: string) => `✓ Accepted ${clockTime(at)}`;
export const acceptAll = (n: number) => `Accept all ${whole(n)}`;
export const decisionsTitle = (listed: number, open: number) => (open > 0 ? `Decisions · ${whole(listed)}` : 'Decisions · all made');
export const openCount = (n: number) => `${whole(n)} open`;
export const sendDecisionsOpen = (n: number) => `Send plan · ${countOf(n, 'decision')} open`;
export const READY_WITH_WARNINGS = 'Ready, with warnings';
