import { DEPOT_TIME_ZONE, type Brand, type DriverDay, type DriverLine, type DriverProblem, type DriverStop, type DriverTrip, type tripFigures } from '@wayfinder/contracts';
import { answeredBy, brandOfShop, clockTime, leaves, shortDay, tripPlace, unitsWords, untilLeaving, whole } from '@/features/loader/words';
import { countOf, ENTRANCE } from '@/features/plan/words';
import { countOf as amountOf } from '@/features/store/words';
import { inDepot } from '@/lib/clock';

// The words and formats of the driver's screens (spec 013, plan.md "Words"). Nothing here works a count out: every
// number comes from tripFigures over the day on the phone, and this only writes it down. The minutes to leaving and
// the minutes waited are counted from the app clock on screen.

export { clockTime, whole };

export type Figures = ReturnType<typeof tripFigures>;
export type StopFigures = Figures['byStop'][number];
export type LineFigures = StopFigures['byLine'][number];

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: DEPOT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
// The day an instant falls on at the depot: "2026-06-25".
export const depotDay = (instant: number) => DAY.format(instant);

// A shop without its brand, where the design drops it: "Nugegoda".
export function placeOf(shopName: string) {
  const brand = brandOfShop(shopName);
  return brand ? shopName.slice(brand.length + 1) : shopName;
}

// The brand a stop's goods are counted in: the trip's, or the shop's own when the trip mixes brands.
export const brandOf = (trip: Pick<DriverTrip, 'brand'>, stop: Pick<DriverStop, 'shopName'>): Brand | null => trip.brand ?? brandOfShop(stop.shopName);

// "Nugegoda and Wellawatte", "Kotagala, Talawakele and Nanu Oya".
export function andList(items: string[]) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// "1 h 5 min", "3 min".
const span = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`);

// ── Today's trip ─────────────────────────────────────────────────────────────────────────────────────────────

// "Thu 25 Jun · trip 1", on the day the trip leaves.
export const tripDayLine = (trip: DriverTrip) => `${shortDay(depotDay(Date.parse(trip.leavesAt)))} · trip ${trip.tripNo}`;

// "leaves 04:36 · in 1 h 5 min"
export const leavingLine = (trip: DriverTrip, at: number | null) => [leaves(trip), untilLeaving(trip.leavesAt, at)].filter(Boolean).join(' · ');

// "Fresh · Colombo · back by 06:10"
export const placeLine = (trip: DriverTrip) => `${tripPlace(trip)} · back by ${clockTime(trip.backBy)}`;

// "1 dry short for Nugegoda", one for each temperature of each stop the loader went short on.
function shortsFor(trip: DriverTrip, figures: Figures) {
  return trip.stops.flatMap((stop, i) => {
    const counts = figures.byStop[i]!;
    const place = placeOf(stop.shopName);
    if (brandOf(trip, stop) === 'Fresh') {
      return (['chilled', 'dry'] as const).filter((temp) => counts.byTemp[temp].short > 0).map((temp) => `${whole(counts.byTemp[temp].short)} ${temp} short for ${place}`);
    }
    return counts.short > 0 ? [`${whole(counts.short)} short for ${place}`] : [];
  });
}

// "Loaded · 117 of 118 · 1 dry short for Nugegoda"
export const loadedLine = (trip: DriverTrip, figures: Figures) =>
  [`Loaded · ${whole(figures.loaded)} of ${whole(figures.ordered)}`, ...shortsFor(trip, figures)].join(' · ');

// The grey chip of a trip that is not ready.
export const notReadyChip = (trip: DriverTrip) => (trip.status === 'loading' ? 'Being loaded' : 'Not loaded yet');
export const startWhenLoaded = (trip: DriverTrip) => `Start trip works once ${trip.vehicleId} is loaded.`;

export const stopsCount = (n: number) => countOf(n, 'stop');

// A stop's row: "94 cartons", "23 of 24 cartons" when the loader went short, and what was ordered before loading.
export function stopUnitsLine(brand: Brand | null, stop: DriverStop, counts: StopFigures) {
  if (stop.lines.some((line) => line.loaded === null)) return unitsWords(brand, counts.ordered);
  if (counts.short > 0) return `${whole(counts.loaded)} of ${unitsWords(brand, counts.ordered)}`;
  return unitsWords(brand, counts.loaded);
}

// The day's sentences when there is no trip (rule 2).
export function noTripLine(day: DriverDay) {
  if (day.day === null) return 'No delivery day is left.';
  if (!day.planSent) return `No trip for ${shortDay(day.day)} yet. It shows here once the dispatcher sends the plan.`;
  return `You have no trip on ${shortDay(day.day)}.`;
}

// ── A stop ───────────────────────────────────────────────────────────────────────────────────────────────────

export const stopOfLine = (stop: DriverStop, figures: Figures) => `Stop ${stop.seq} of ${figures.stops}`;
// "Colombo · street"
export const shopLine = (stop: DriverStop) => `${stop.district} · ${ENTRANCE[stop.dockType]}`;
export const entranceOf = (stop: DriverStop) => ENTRANCE[stop.dockType];
// "05:30 to 08:00"
export const windowLine = (stop: DriverStop) => `${stop.windowOpen} to ${stop.windowClose}`;

// Past the window's close on the app clock, on the day the trip leaves.
export function isLate(trip: DriverTrip, stop: DriverStop, at: number | null) {
  if (at === null) return false;
  return `${depotDay(at)} ${inDepot(at).time}` > `${depotDay(Date.parse(trip.leavesAt))} ${stop.windowClose}`;
}

// "Unload 94 cartons"; for Fresh the chips "48 chilled" and "46 dry" beside it.
export const unloadLine = (brand: Brand | null, counts: StopFigures) => `Unload ${unitsWords(brand, counts.loaded)}`;

// "Left Peliyagoda 03:31" and "back by 06:10" under the trip bar.
export const leftLine = (day: DriverDay, trip: DriverTrip) => (trip.leftAt ? `Left ${day.depot} ${clockTime(trip.leftAt)}` : `Leaves ${day.depot} ${clockTime(trip.leavesAt)}`);
export const backByLine = (trip: DriverTrip) => `back by ${clockTime(trip.backBy)}`;

// ── Unload and Something's wrong ─────────────────────────────────────────────────────────────────────────────

// A line's name on its card: "Chilled" or "Dry" for Fresh, the item's name for Style and Tech.
export const lineName = (line: DriverLine, brand: Brand | null) => (brand === 'Fresh' ? (line.temp === 'chilled' ? 'Chilled' : 'Dry') : line.name);

// "Loader flagged 1 carton short at the depot"
export const loaderShortLine = (line: DriverLine, counts: LineFigures) => `Loader flagged ${amountOf(counts.short, line.unit)} short at the depot`;

// A line to pick for a refusal, by what is on the truck: "48 cartons chilled", or "10 boxes · Folded clothing".
export const pickLine = (line: DriverLine, counts: LineFigures, brand: Brand | null) =>
  brand === 'Fresh' ? `${amountOf(counts.loaded, line.unit)} ${line.temp}` : `${amountOf(counts.loaded, line.unit)} · ${line.name}`;

// Under "Accepted" and "Refused": "chilled" for Fresh, the item for Style and Tech.
export const lineKindLine = (line: DriverLine, brand: Brand | null) => (brand === 'Fresh' ? line.temp : line.name);

export const REASON_WORDS = { damaged: 'Damaged', expired: 'Expired', not_ordered: 'Not ordered' } as const;

// "3 min", the whole minutes of the clock's face from the arrival to now.
export function waitedLine(arrivedAt: string, at: number | null) {
  if (at === null) return '';
  return span(Math.max(0, Math.floor(at / 60_000) - Math.floor(Date.parse(arrivedAt) / 60_000)));
}

// "94 cartons stay on the truck"
export const stayLine = (brand: Brand | null, counts: StopFigures) => `${unitsWords(brand, counts.loaded)} ${counts.loaded === 1 ? 'stays' : 'stay'} on the truck`;

// "Fresh Wellawatte · stop 2 of 2" on Saved on this phone.
export const savedLine = (stop: DriverStop, figures: Figures) => `${stop.shopName} · stop ${stop.seq} of ${figures.stops}`;

// ── The top line ─────────────────────────────────────────────────────────────────────────────────────────────

// "Stop 1 Fresh Nugegoda delivered 03:38"
export const deliveredLine = (stop: DriverStop) => `Stop ${stop.seq} ${stop.shopName} delivered ${stop.doneAt ? clockTime(stop.doneAt) : ''}`.trim();

// "Stop 2 · 92 delivered · 2 refused", with "· 1 short" when the loader went short there too.
export const refusedLine = (stop: DriverStop, counts: StopFigures) =>
  [`Stop ${stop.seq}`, `${whole(counts.delivered)} delivered`, `${whole(counts.refused)} refused`, counts.short > 0 && `${whole(counts.short)} short`].filter(Boolean).join(' · ');

export const closedLine = (stop: DriverStop) => `Stop ${stop.seq} · not delivered · nobody there`;

// Before the dispatcher answers.
export const keepLine = (brand: Brand | null, counts: StopFigures) => `Keep the ${unitsWords(brand, counts.refused)} on the truck. The depot will tell you what to do.`;
export const DEPOT_DECIDES = 'The depot decides: retry on this trip or another day.';

// "2 chilled cartons", "2 chilled cartons and 1 dry carton" for Fresh, the brand's units otherwise.
function goodsWords(brand: Brand | null, counts: Pick<StopFigures, 'byTemp'>, key: 'refused' | 'notDelivered' | 'short', total: number) {
  if (brand !== 'Fresh') return unitsWords(brand, total);
  return (['chilled', 'dry'] as const).filter((temp) => counts.byTemp[temp][key] > 0)
    .map((temp) => { const n = counts.byTemp[temp][key]; return `${whole(n)} ${temp} ${n === 1 ? 'carton' : 'cartons'}`; }).join(' and ');
}

// The dispatcher's answer as the driver reads it: "Ruwan, dispatcher · 03:52 · Bring the 2 chilled cartons back to
// Peliyagoda."
export function answerLine(problem: DriverProblem, stop: DriverStop, brand: Brand | null, counts: StopFigures, depot: string) {
  let what = '';
  if (problem.decision === 'try_again') what = `Try ${stop.shopName} again after the other stops.`;
  else if (problem.kind === 'refused') what = `Bring the ${goodsWords(brand, counts, 'refused', counts.refused)} back to ${depot}.`;
  else what = `Bring the ${unitsWords(brand, counts.notDelivered)} back to ${depot}.`;
  return `${answeredBy(problem)} · ${what}`;
}

// ── The signal and the waiting writes ───────────────────────────────────────────────────────────────────────

export const waitingLine = (n: number) => `${whole(n)} waiting to send`;
export const noSignalLine = (n: number) => `No signal · ${n > 0 ? waitingLine(n) : 'everything is sent'}`;

// "Back online · 1 stop sent" and "Wellawatte reached the depot".
export function backOnlineLines(names: string[]) {
  const stops = names.filter((name) => !name.startsWith('the '));
  const what = stops.length === names.length ? countOf(names.length, 'stop') : countOf(names.length, 'record');
  return { title: `Back online · ${what} sent`, line: `${capital(andList(names))} reached the depot` };
}

export const signInLine = (n: number) => (n > 0 ? `Sign in again to send ${whole(n)} waiting ${n === 1 ? 'record' : 'records'}.` : 'Sign in again.');
export const NOT_SAVED = 'Could not save on this phone. Try again.';
export const OTHER_TAB = 'Wayfinder is open in another tab.';

// ── Trip done and Day done ──────────────────────────────────────────────────────────────────────────────────

export const headBackLine = (day: DriverDay, trip: DriverTrip) => `Head back to ${day.depot} · back by ${clockTime(trip.backBy)}`;

// A brand's unit, one and many.
const UNIT: Record<Brand, [string, string]> = { Fresh: ['carton', 'cartons'], Style: ['box', 'boxes'], Tech: ['item', 'items'] };
const unitOf = (brand: Brand | null, n: number) => (brand ? UNIT[brand] : ['unit', 'units'] as const)[n === 1 ? 0 : 1];

// "Cartons delivered", "Boxes delivered", "Units delivered" for a trip of several brands.
export const deliveredLabel = (trip: DriverTrip) => `${capital(unitOf(trip.brand, 2))} delivered`;

export interface Row { label: string; value: string }

// The trip's card: stops, what was delivered of what was ordered, and what was refused, not delivered or short.
export function tripRows(trip: DriverTrip, figures: Figures): Row[] {
  const per = (key: 'refused' | 'notDelivered') => trip.stops
    .map((stop, i) => ({ stop, n: figures.byStop[i]![key] }))
    .filter(({ n }) => n > 0)
    .map(({ stop, n }) => `${whole(n)} · ${placeOf(stop.shopName)}`).join(', ');
  const short = trip.stops.map((stop, i) => ({ stop, counts: figures.byStop[i]! })).filter(({ counts }) => counts.short > 0)
    .map(({ stop, counts }) => {
      const fresh = brandOf(trip, stop) === 'Fresh';
      const amount = fresh
        ? (['chilled', 'dry'] as const).filter((temp) => counts.byTemp[temp].short > 0).map((temp) => `${whole(counts.byTemp[temp].short)} ${temp}`).join(' and ')
        : whole(counts.short);
      return `${amount} · ${placeOf(stop.shopName)}`;
    }).join(', ');
  return [
    { label: 'Stops', value: `${whole(figures.stopsDone)} of ${whole(figures.stops)}` },
    { label: deliveredLabel(trip), value: `${whole(figures.delivered)} of ${whole(figures.ordered)}` },
    ...(figures.refused > 0 ? [{ label: 'Refused', value: per('refused') }] : []),
    ...(figures.notDelivered > 0 ? [{ label: 'Not delivered', value: per('notDelivered') }] : []),
    ...(figures.short > 0 ? [{ label: 'Short from the depot', value: short }] : []),
  ];
}

// The latest problem of a stop.
export const problemOf = (trip: DriverTrip, stop: DriverStop) => trip.problems.filter((problem) => problem.stopId === stop.id).at(-1) ?? null;

// The hand-back card: "Still on the truck" with what is on it and why, or "Nothing to hand back".
export function handBack(trip: DriverTrip, figures: Figures) {
  const lines: string[] = [];
  trip.stops.forEach((stop, i) => {
    const counts = figures.byStop[i]!;
    const brand = brandOf(trip, stop);
    const place = placeOf(stop.shopName);
    const problem = problemOf(trip, stop);
    if (counts.refused > 0) {
      lines.push(`${goodsWords(brand, counts, 'refused', counts.refused)} refused at ${place}. Hand them to the depot check${problem?.hasPhoto ? ' with the refusal photo' : ''}.`);
    }
    if (counts.notDelivered > 0) {
      const next = problem?.decision === 'bring_back' ? 'Hand them in; they go on the next run.' : 'The depot decides what happens to them.';
      lines.push(`${unitsWords(brand, counts.notDelivered)} for ${place}, nobody at the shop. ${next}`);
    }
  });
  trip.stops.forEach((stop, i) => {
    const counts = figures.byStop[i]!;
    if (counts.short === 0) return;
    const brand = brandOf(trip, stop);
    const place = placeOf(stop.shopName);
    if (brand === 'Fresh') {
      for (const temp of ['chilled', 'dry'] as const) {
        const n = counts.byTemp[temp].short;
        if (n > 0) lines.push(`The ${n === 1 ? `${temp} carton` : `${whole(n)} ${temp} cartons`} for ${place} never left the depot.`);
      }
    } else {
      lines.push(`The ${counts.short === 1 ? unitOf(brand, 1) : unitsWords(brand, counts.short)} for ${place} never left the depot.`);
    }
  });
  return { title: figures.onTruck > 0 ? 'Still on the truck' : 'Nothing to hand back', text: lines.join(' ') };
}

// "Trip 2", with "leaves 07:10" when the vehicle has one on the driver's day, or "none today".
export function nextTripLine(day: DriverDay, trip: DriverTrip) {
  const next = day.trips.find((other) => other.vehicleId === trip.vehicleId && other.tripNo === trip.tripNo + 1);
  return { label: `Trip ${trip.tripNo + 1}`, value: next ? leaves(next) : 'none today' };
}

export const tripClosedLine = (figures: Figures, waiting: number) =>
  (waiting > 0 ? `Trip closed · ${waitingLine(waiting)}` : `Trip closed · ${whole(figures.stopsDone)} of ${countOf(figures.stops, 'stop')} · all records sent`);
export const backAtLine = (day: DriverDay) => `Back at ${day.depot}`;
export const checkedInLine = (trip: DriverTrip) => (trip.backAt ? `Checked in at the depot ${clockTime(trip.backAt)}` : 'Checked in at the depot');
export const SIGN_OUT_WAITS = 'Sign out once everything is sent.';

// "Stop 2 · Fresh Wellawatte", "Start of trip · VEH035": what a saved write is about, on the waiting sheet.
export const aboutStop = (stop: DriverStop) => `Stop ${stop.seq} · ${stop.shopName}`;
export const aboutTrip = (trip: DriverTrip, kind: 'start' | 'finish') => `${kind === 'start' ? 'Start of trip' : 'End of trip'} · ${trip.vehicleId}`;
