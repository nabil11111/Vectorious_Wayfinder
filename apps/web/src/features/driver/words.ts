import { DEPOT_TIME_ZONE, type Brand, type DriverDay, type DriverLine, type DriverProblem, type DriverStop, type DriverTrip, type tripFigures } from '@wayfinder/contracts';
import { answeredBy, brandOfShop, clockTime, leaves, shortDay, tripPlace, unitsWords, untilLeaving, whole } from '@/features/loader/words';
import { countOf, ENTRANCE } from '@/features/plan/words';
import { countOf as amountOf, plural } from '@/features/store/words';
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

// A brand's unit, one and many.
const UNIT: Record<Brand, [string, string]> = { Fresh: ['carton', 'cartons'], Style: ['box', 'boxes'], Tech: ['item', 'items'] };
const unitOf = (brand: Brand | null, n: number) => (brand ? UNIT[brand] : ['unit', 'units'] as const)[n === 1 ? 0 : 1];

// ── Today's trip ─────────────────────────────────────────────────────────────────────────────────────────────

// "Thu 25 Jun · trip 1", on the day the trip leaves.
export const tripDayLine = (trip: DriverTrip) => `${shortDay(depotDay(Date.parse(trip.leavesAt)))} · trip ${trip.tripNo}`;

// "leaves 04:36 · in 1 h 5 min"
export const leavingLine = (trip: DriverTrip, at: number | null) => [leaves(trip), untilLeaving(trip.leavesAt, at)].filter(Boolean).join(' · ');

// "Fresh · Colombo · back by 06:10"
// The return as the API words it against the app clock: "back by 06:10", or "was due back 06:10" once it has passed.
export const placeLine = (trip: DriverTrip) => `${tripPlace(trip)} · ${trip.backByWords}`;

// What the loader did not load, by why (L-09): short of stock, or won't fit on the truck. stockShort is the short ones.
const stockShort = (counts: { short: number; wontFit: number }) => counts.short - counts.wontFit;
const notLoaded = (counts: { short: number; wontFit: number }, what: string) =>
  [stockShort(counts) > 0 && `${whole(stockShort(counts))}${what} short`, counts.wontFit > 0 && `${whole(counts.wontFit)}${what} won't fit`].filter(Boolean) as string[];

// "1 dry short for Nugegoda", or "4 chilled won't fit for Nugegoda", for each temperature of each stop the loader went
// short on.
function shortsFor(trip: DriverTrip, figures: Figures) {
  return trip.stops.flatMap((stop, i) => {
    const counts = figures.byStop[i]!;
    const place = placeOf(stop.shopName);
    if (brandOf(trip, stop) === 'Fresh') {
      return (['chilled', 'dry'] as const).flatMap((temp) => notLoaded(counts.byTemp[temp], ` ${temp}`).map((words) => `${words} for ${place}`));
    }
    return notLoaded(counts, '').map((words) => `${words} for ${place}`);
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
export const backByLine = (trip: DriverTrip) => trip.backByWords;

// ── Unload and Something's wrong ─────────────────────────────────────────────────────────────────────────────

// A line's name on its card: "Chilled" or "Dry" for Fresh. For Style and Tech the item, after its unit as the loader's
// list words it, so a driver tells the crates apart (Q-32): "crates of 3 · Washing machines", "boxes · Folded clothing".
export const lineName = (line: DriverLine, brand: Brand | null) => {
  if (brand === 'Fresh') return line.temp === 'chilled' ? 'Chilled' : 'Dry';
  return `${line.quantity === 1 ? line.unit : plural(line.unit)} · ${line.name}`;
};

// "Loader flagged 1 carton short at the depot", or "Loader flagged 4 cartons that won't fit on the truck" (L-09).
export const loaderShortLine = (line: DriverLine, counts: LineFigures) => (counts.wontFit > 0
  ? `Loader flagged ${amountOf(counts.wontFit, line.unit)} that won't fit on the truck`
  : `Loader flagged ${amountOf(counts.short, line.unit)} short at the depot`);

// Under a count box that holds a minus, a fraction or anything but a whole number, and under a refusal's box that holds
// more than was loaded (Q-25): "Counts are whole numbers from 0 to the 12 loaded."
export const wholeCountsLine = (loaded: number) => `Counts are whole numbers from 0 to the ${whole(loaded)} loaded.`;

// Under an unload box that holds more than was loaded. One more at the door than left the depot means something of
// another shop's is in the stack (Q-25): "15 is more than the 12 loaded. Check the stack for another shop's cartons."
export const overLoadedLine = (count: number, loaded: number, brand: Brand | null) =>
  `${whole(count)} is more than the ${whole(loaded)} loaded. Check the stack for another shop's ${unitOf(brand, 2)}.`;

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

// "Stop 2 · 92 delivered · 2 refused", with "· 1 short" or "· 4 won't fit" when the loader went short there too.
export const refusedLine = (stop: DriverStop, counts: StopFigures) =>
  [`Stop ${stop.seq}`, `${whole(counts.delivered)} delivered`, `${whole(counts.refused)} refused`, ...notLoaded(counts, '')].join(' · ');

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
// Peliyagoda.", and with replacements (spec 015, D-59) "… back to Peliyagoda. The shop gets 2 replacements on the next
// run."
export function answerLine(problem: DriverProblem, stop: DriverStop, brand: Brand | null, counts: StopFigures, depot: string) {
  let what = '';
  if (problem.decision === 'try_again') what = `Try ${stop.shopName} again after the other stops.`;
  else if (problem.kind === 'refused') what = `Bring the ${goodsWords(brand, counts, 'refused', counts.refused)} back to ${depot}.`;
  else what = `Bring the ${unitsWords(brand, counts.notDelivered)} back to ${depot}.`;
  if (problem.decision === 'send_replacements') what += ` The shop gets ${whole(counts.refused)} ${counts.refused === 1 ? 'replacement' : 'replacements'} on the next run.`;
  return `${answeredBy(problem)} · ${what}`;
}

// ── The signal and the waiting writes ───────────────────────────────────────────────────────────────────────

export const waitingLine = (n: number) => `${whole(n)} waiting to send`;
export const noSignalLine = (n: number) => `No signal · ${n > 0 ? waitingLine(n) : 'everything is sent'}`;

// "Back online · 1 stop sent" and "Wellawatte reached the depot". Up to three places are named, and beyond three the
// first three and how many more (Q-27): "Ampitiya, Mulgampola, Katukele and 2 more reached the depot".
export function backOnlineLines(names: string[]) {
  const stops = names.filter((name) => !name.startsWith('the '));
  const what = stops.length === names.length ? countOf(names.length, 'stop') : countOf(names.length, 'record');
  const named = names.length > 3 ? [...names.slice(0, 3), `${whole(names.length - 3)} more`] : names;
  return { title: `Back online · ${what} sent`, line: `${capital(andList(named))} reached the depot` };
}

export const signInLine = (n: number) => (n > 0 ? `Sign in again to send ${whole(n)} waiting ${n === 1 ? 'record' : 'records'}.` : 'Sign in again.');
export const NOT_SAVED = 'Could not save on this phone. Try again.';
// The same, as the top band says it when the sync loop could not keep a refusal: its "Try again" is a button.
export const NOT_SAVED_BAND = 'Could not save on this phone.';
export const COULD_NOT_READ = 'Could not read what this phone kept.';
export const NOTHING_SENT_UNTIL_READ = 'Nothing is sent or saved until it is read.';

// ── Trip done and Day done ──────────────────────────────────────────────────────────────────────────────────

export const headBackLine = (day: DriverDay, trip: DriverTrip) => `Head back to ${day.depot} · ${trip.backByWords}`;

// "Cartons delivered", "Boxes delivered", "Units delivered" for a trip of several brands.
export const deliveredLabel = (trip: DriverTrip) => `${capital(unitOf(trip.brand, 2))} delivered`;

export interface Row { label: string; value: string }

// The trip's card: stops, what was delivered of what was ordered, and what was refused, not delivered or short.
export function tripRows(trip: DriverTrip, figures: Figures): Row[] {
  const per = (key: 'refused' | 'notDelivered') => trip.stops
    .map((stop, i) => ({ stop, n: figures.byStop[i]![key] }))
    .filter(({ n }) => n > 0)
    .map(({ stop, n }) => `${whole(n)} · ${placeOf(stop.shopName)}`).join(', ');
  // Short of stock, or won't fit on the truck (L-09), per stop and, for Fresh, per temperature.
  const left = (of: (counts: { short: number; wontFit: number }) => number) => trip.stops.map((stop, i) => ({ stop, counts: figures.byStop[i]! }))
    .filter(({ counts }) => of(counts) > 0)
    .map(({ stop, counts }) => {
      const fresh = brandOf(trip, stop) === 'Fresh';
      const amount = fresh
        ? (['chilled', 'dry'] as const).filter((temp) => of(counts.byTemp[temp]) > 0).map((temp) => `${whole(of(counts.byTemp[temp]))} ${temp}`).join(' and ')
        : whole(of(counts));
      return `${amount} · ${placeOf(stop.shopName)}`;
    }).join(', ');
  return [
    { label: 'Stops', value: `${whole(figures.stopsDone)} of ${whole(figures.stops)}` },
    { label: deliveredLabel(trip), value: `${whole(figures.delivered)} of ${whole(figures.ordered)}` },
    ...(figures.refused > 0 ? [{ label: 'Refused', value: per('refused') }] : []),
    ...(figures.notDelivered > 0 ? [{ label: 'Not delivered', value: per('notDelivered') }] : []),
    ...(stockShort(figures) > 0 ? [{ label: 'Short from the depot', value: left(stockShort) }] : []),
    ...(figures.wontFit > 0 ? [{ label: 'Won\'t fit on the truck', value: left((counts) => counts.wontFit) }] : []),
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
    // One carton is "it" and more are "them".
    if (counts.refused > 0) {
      const them = counts.refused === 1 ? 'it' : 'them';
      lines.push(`${goodsWords(brand, counts, 'refused', counts.refused)} refused at ${place}. Hand ${them} to the depot check${problem?.hasPhoto ? ' with the refusal photo' : ''}.`);
    }
    if (counts.notDelivered > 0) {
      const one = counts.notDelivered === 1;
      const next = problem?.decision === 'bring_back' ? (one ? 'Hand it in; it goes on the next run.' : 'Hand them in; they go on the next run.')
        : `The depot decides what happens to ${one ? 'it' : 'them'}.`;
      lines.push(`${unitsWords(brand, counts.notDelivered)} for ${place}, nobody at the shop. ${next}`);
    }
  });
  trip.stops.forEach((stop, i) => {
    const counts = figures.byStop[i]!;
    if (counts.short === 0) return;
    const brand = brandOf(trip, stop);
    const place = placeOf(stop.shopName);
    // Short of stock never left the depot; what would not fit did not fit on the truck (L-09).
    const said = (n: number, goods: string, why: string) => { if (n > 0) lines.push(`The ${goods} for ${place} ${why}.`); };
    if (brand === 'Fresh') {
      for (const temp of ['chilled', 'dry'] as const) {
        const cartons = (n: number) => (n === 1 ? `${temp} carton` : `${whole(n)} ${temp} cartons`);
        said(counts.byTemp[temp].wontFit, cartons(counts.byTemp[temp].wontFit), 'did not fit on the truck');
        said(stockShort(counts.byTemp[temp]), cartons(stockShort(counts.byTemp[temp])), 'never left the depot');
      }
    } else {
      const goods = (n: number) => (n === 1 ? unitOf(brand, 1) : unitsWords(brand, n));
      said(counts.wontFit, goods(counts.wontFit), 'did not fit on the truck');
      said(stockShort(counts), goods(stockShort(counts)), 'never left the depot');
    }
  });
  return { title: figures.onTruck > 0 ? 'Still on the truck' : 'Nothing to hand back', text: lines.join(' ') };
}

// "Trip 2", with "leaves 07:10" when the vehicle has one on the driver's day, or "none today".
export function nextTripLine(day: DriverDay, trip: DriverTrip) {
  const next = day.trips.find((other) => other.vehicleId === trip.vehicleId && other.tripNo === trip.tripNo + 1);
  return { label: `Trip ${trip.tripNo + 1}`, value: next ? leaves(next) : 'none today' };
}

// "Trip closed · 2 of 2 stops · all records sent", or "Trip closed · 1 waiting to send" while records wait. Named by its
// number where the day has more than one trip: "Trip 1 closed · …".
export function tripClosedLine(figures: Figures, waiting: number, tripNo?: number) {
  const closed = tripNo === undefined ? 'Trip closed' : `Trip ${tripNo} closed`;
  return waiting > 0 ? `${closed} · ${waitingLine(waiting)}` : `${closed} · ${whole(figures.stopsDone)} of ${countOf(figures.stops, 'stop')} · all records sent`;
}

// On the next trip's Today's trip, until it starts (Q-29): "Trip 1 closed · 4 of 4 stops · all records sent · checked
// in 03:56".
export const betweenTripsLine = (trip: DriverTrip, figures: Figures, waiting: number) =>
  [tripClosedLine(figures, waiting, trip.tripNo), trip.backAt && `checked in ${clockTime(trip.backAt)}`].filter(Boolean).join(' · ');
export const backAtLine = (day: DriverDay) => `Back at ${day.depot}`;

// A line of Day done after more than one trip, for a trip or for the whole day (Q-31), with what was delivered counted
// against what was loaded: "4 of 4 stops · 105 of 144 cartons delivered · 39 handed back".
export function dayDoneLine(counts: Pick<Figures, 'stops' | 'stopsDone' | 'loaded' | 'delivered' | 'onTruck'>, brand: Brand | null) {
  return [
    `${whole(counts.stopsDone)} of ${countOf(counts.stops, 'stop')}`,
    `${whole(counts.delivered)} of ${unitsWords(brand, counts.loaded)} delivered`,
    counts.onTruck > 0 ? `${whole(counts.onTruck)} handed back` : 'nothing handed back',
  ].join(' · ');
}

// The brand a day's totals are counted in: its trips' one brand, or none, in units, when they carried more than one.
export const dayBrand = (trips: DriverTrip[]): Brand | null => {
  const [first] = trips;
  return first && trips.every((trip) => trip.brand === first.brand) ? first.brand : null;
};
export const DAY_TOTAL = 'Total';
export const tripLabel = (tripNo: number) => `Trip ${tripNo}`;
export const checkedInLine = (trip: DriverTrip) => (trip.backAt ? `Checked in at the depot ${clockTime(trip.backAt)}` : 'Checked in at the depot');
export const SIGN_OUT_WAITS = 'Sign out once everything is sent.';

// "Stop 2 · Fresh Wellawatte", "Start of trip · VEH035": what a saved write is about, on the waiting sheet.
export const aboutStop = (stop: DriverStop) => `Stop ${stop.seq} · ${stop.shopName}`;
export const aboutTrip = (trip: DriverTrip, kind: 'start' | 'finish') => `${kind === 'start' ? 'Start of trip' : 'End of trip'} · ${trip.vehicleId}`;
