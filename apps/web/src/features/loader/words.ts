import { BRANDS, lineReason as reasonOfLine, type Brand, type FlagReason, type Issue, type IssueLine, type LeftTruck, type LoadingLine, type LoadingStop, type LoadingTruck } from '@wayfinder/contracts';
import { clockTime, countOf, shortDay, unitsOf, vehicleKind } from '@/features/plan/words';
import { countOf as amountOf, plural, TEMP_NAME } from '@/features/store/words';

// The words and formats of the loader's screens and of the problems on Live day (spec 012, plan.md "Words").
// Nothing here works a count, kilo or cubic metre out: every figure comes from the loading day or the problem the
// API sent, and this only writes it down. The one thing counted here is the minutes to leaving, from the app clock
// on screen.

export { clockTime, countOf, shortDay };

const WHOLE = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const ONE_PLACE = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const whole = (n: number) => WHOLE.format(n);

// A shop's name is its brand and then its place (spec 003), so "Fresh Nugegoda" is a Fresh shop. A problem
// carries no brand of its own, and a trip that mixes brands has none either.
export const brandOfShop = (shopName: string): Brand | null => BRANDS.find((brand) => shopName.startsWith(`${brand} `)) ?? null;

// The brand a stop's goods are counted in: the truck's, or the shop's own when the trip mixes brands.
export const brandOfStop = (truck: Pick<LoadingTruck, 'brand'>, stop: Pick<LoadingStop, 'shopName'>) => truck.brand ?? brandOfShop(stop.shopName);

// "van reefer", "van", "reefer" or "dry", as spec 010 says them.
export const vehicleWords = (truck: Pick<LoadingTruck, 'vehicleType' | 'vehicleTemp'>) => vehicleKind({ type: truck.vehicleType, temp: truck.vehicleTemp });

// A truck's units in its brand's word: "118 cartons", "1 box", and "12 units" when the trip mixes brands.
export const unitsWords = (brand: Brand | null, units: number) => (brand ? unitsOf(brand, units) : countOf(units, 'unit'));

// "VEH035", and "VEH035 trip 2" for a truck's second trip of the day.
export const truckName = (truck: { vehicleId: string; tripNo: number }) => (truck.tripNo > 1 ? `${truck.vehicleId} trip ${truck.tripNo}` : truck.vehicleId);

// A truck its driver has driven away, as the API lists it (Q-34): "VEH011 left with Asanka at 04:11.", leaving out a
// driver or a time the day does not have.
export const leftLine = (left: Pick<LeftTruck, 'vehicleId' | 'tripNo' | 'driver' | 'leftAt'>) =>
  `${truckName(left)} left${left.driver ? ` with ${left.driver}` : ''}${left.leftAt ? ` at ${clockTime(left.leftAt)}` : ''}.`;

// "Fresh · Colombo", or the district alone when the trip mixes brands.
export const tripPlace = (truck: Pick<LoadingTruck, 'brand' | 'district'>) => [truck.brand, truck.district].filter(Boolean).join(' · ');

// "Fresh · Colombo · 2 stops": the stops are the rows the screen lists.
export const tripLine = (truck: LoadingTruck) => `${tripPlace(truck)} · ${countOf(truck.stops.length, 'stop')}`;

export const leaves = (truck: Pick<LoadingTruck, 'leavesAt'>) => `leaves ${clockTime(truck.leavesAt)}`;

const span = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`);

// The time to leaving, from the app clock on screen: "in 42 min", "in 2 h 6 min", "now" and "12 min late". It
// counts whole minutes of the clock's face, so 02:30 to 04:36 is 2 h 6 min whatever the seconds are. null until the
// clock has arrived.
export function untilLeaving(leavesAt: string, at: number | null): string | null {
  if (at === null) return null;
  const minutes = Math.floor(Date.parse(leavesAt) / 60_000) - Math.floor(at / 60_000);
  if (minutes === 0) return 'now';
  return minutes > 0 ? `in ${span(minutes)}` : `${span(-minutes)} late`;
}

// A truck's load and its limit in tenths of a tonne (Q-21): the limit to the nearest tenth, as the design writes it, and
// the load rounded down, kept a tenth below the limit's figure while it is under the limit, so the two read the same
// only when the truck is full: a 6,840 kg truck reads 6.8 t, and 6,810 kg on it 6.7 t. At or over the limit the load
// reads the limit's own figure, so a full 3,990 kg truck reads 4.0 / 4.0 t. Tenths of a kilo keep 807.3 kg exact.
function tonnes(kg: number, capKg: number): [on: number, cap: number] {
  const on = Math.round(kg * 10);
  const cap = Math.round(capKg * 10);
  const capTenths = Math.round(cap / 1000);
  return [on >= cap ? capTenths : Math.min(Math.floor(on / 1000), capTenths - 1), capTenths];
}

// A vehicle under 2 t has its weight written in kilos (Q-21): a 1,040 kg van read "1.0 / 1.0 t" with 81 kg free.
const KILOS_UNDER_KG = 2000;

// What is on the truck so far over the vehicle's limits, its weight never rounded up to look full (Q-21): a van's in
// kilos rounded down, "959 / 1,040 kg · 5.1 / 7.0 m³", and a truck's in tonnes to one place rounded down, "4.5 / 6.8 t
// · 21.0 / 33.4 m³". At or over the limit the weight reads the limit's own figure. Cubic metres are to the nearest
// tenth. The API worked the load out; this only writes it down.
export function loadFigure(truck: LoadingTruck) {
  const volume = `${ONE_PLACE.format(truck.on.m3)} / ${ONE_PLACE.format(truck.volumeCapM3)} m³`;
  if (truck.weightCapKg < KILOS_UNDER_KG) {
    const kilos = truck.on.kg >= truck.weightCapKg ? truck.weightCapKg : Math.floor(Math.round(truck.on.kg * 10) / 10);
    return `${whole(kilos)} / ${whole(truck.weightCapKg)} kg · ${volume}`;
  }
  const [on, cap] = tonnes(truck.on.kg, truck.weightCapKg);
  return `${ONE_PLACE.format(on / 10)} / ${ONE_PLACE.format(cap / 10)} t · ${volume}`;
}

// "0 of 118 cartons on"
export const onOfUnits = (truck: LoadingTruck) => `${whole(truck.on.units)} of ${unitsWords(truck.brand, truck.units)} on`;

// A trip whose vehicle is still out on an earlier one (Q-26), as the API words it: "out on trip 1 · back by 06:38" in its
// row, or "out on trip 1 · was due back 06:38" once that time has passed, and on its load page "VEH057 is out on trip 1
// · back by 06:38. Put the cartons ready on the dock; they go on when it is back.", in the brand's units, and "units"
// when the trip mixes brands.
type OutOn = NonNullable<LoadingTruck['outOn']>;
export const outOnWords = (outOn: OutOn) => outOn.words;
export const outOnLine = (truck: Pick<LoadingTruck, 'vehicleId' | 'brand'> & { outOn: OutOn | null }) => (truck.outOn
  ? `${truck.vehicleId} is ${outOnWords(truck.outOn)}. Put the ${truck.brand ? UNIT_WORD[truck.brand][1] : 'units'} ready on the dock; they go on when it is back.`
  : null);

// A line of a stop: "12 cartons chilled" for Fresh, and "10 boxes · Folded clothing" or "2 pallets of 8 ·
// Televisions" with the item's name for Style and Tech.
export const lineWords = (line: Pick<LoadingLine, 'quantity' | 'unit' | 'temp' | 'name'>, brand: Brand | null) =>
  brand === 'Fresh' ? `${amountOf(line.quantity, line.unit)} ${line.temp}` : `${amountOf(line.quantity, line.unit)} · ${line.name}`;

// A line's name on the flag's counter: "Chilled" or "Dry" for Fresh, the item's name for Style and Tech.
export const lineKind = (line: Pick<LoadingLine, 'temp' | 'name'>, brand: Brand | null) => (brand === 'Fresh' ? TEMP_NAME[line.temp] : line.name);

// Under a count box that holds anything but a whole number from 0 to the line's count (Q-17), in the shop's words for
// its quantity box (Q-01): "Whole numbers from 0 to 57."
export const countLine = (most: number) => `Whole numbers from 0 to ${whole(most)}.`;

// What the flag's counter counts: the good units at the dock, or for a truck that cannot take it all what fits on it
// (Q-20). And the line in the counter's place before a line is picked.
export const countWhere = (reason: FlagReason) => (reason === 'wont_fit' ? 'fit on the truck' : 'at the dock');
export const countHint = (reason: FlagReason) => (reason === 'wont_fit'
  ? 'Tap the line that will not all fit, then count what fits on the truck.'
  : 'Tap the line that is not right, then count what is at the dock.');

// A stop on a list, by what the API sent: "94 cartons" to load, "23 of 24" with a flag lowering a count, "✓ 94 on"
// once loaded, and "23 on · 1 short" when it went on short.
export const stopUnits = (truck: LoadingTruck, stop: LoadingStop) => unitsWords(brandOfStop(truck, stop), stop.units);
export const stopGoingOf = (stop: LoadingStop) => `${whole(stop.going)} of ${whole(stop.units)}`;
export const stopOn = (stop: LoadingStop) => `${whole(stop.going)} on`;
export const stopOnShort = (stop: LoadingStop) => `${whole(stop.going)} on · ${whole(stop.short)} short`;

// A loaded stop's menu (Q-16): "Undo stop 3 loaded", after the button that loaded it, and on a stop loaded before the
// last one, which stop comes off first: "undo stop 2 first".
export const undoStopWords = (stop: Pick<LoadingStop, 'seq'>) => `Undo stop ${stop.seq} loaded`;
export const undoFirstWords = (stop: Pick<LoadingStop, 'seq'>) => `undo stop ${stop.seq} first`;

// "117 of 118 on, 1 short" when every stop is loaded.
export const allOnLine = (truck: LoadingTruck) =>
  `${whole(truck.on.units)} of ${whole(truck.units)} on${truck.short > 0 ? `, ${whole(truck.short)} short` : ''}`;

// ── Problems ───────────────────────────────────────────────────────────────────────────────────────────────────

type IssueWords = Pick<Issue, 'lines' | 'stop' | 'short'>;

// What a problem counts, one and many: "dry carton" for Fresh, the unit for Style and Tech, and "item" when its
// lines are of different products.
function goodsOf(issue: Pick<Issue, 'lines' | 'stop'>): [string, string] {
  const first = issue.lines[0];
  if (!first || new Set(issue.lines.map((line) => line.productId)).size > 1) return ['item', 'items'];
  if (brandOfShop(issue.stop.shopName) === 'Fresh') return [`${first.temp} ${first.unit}`, `${first.temp} ${plural(first.unit)}`];
  return [first.unit, plural(first.unit)];
}

// "1 dry carton", "3 items": the units the problem's lines are short, as the API counted them.
export function shortGoods(issue: IssueWords) {
  const [one, many] = goodsOf(issue);
  return `${whole(issue.short)} ${issue.short === 1 ? one : many}`;
}

// A problem's title by its reason: "1 dry carton short", "2 chilled cartons damaged", "1 dry carton was the wrong
// item", "4 chilled cartons won't fit" when the truck cannot take them (Q-20), and "3 items short" when its lines differ.
export function issueTitle(issue: IssueWords & Pick<Issue, 'reason'>) {
  const goods = shortGoods(issue);
  if (issue.reason === 'short') return `${goods} short`;
  if (issue.reason === 'damaged') return `${goods} damaged`;
  if (issue.reason === 'wont_fit') return `${goods} won't fit`;
  return `${goods} ${issue.short === 1 ? 'was' : 'were'} the wrong item`;
}

// A counted line at the dock: "3 of 4 dry cartons" for Fresh, "8 of 10 boxes · Folded clothing" for Style and Tech.
export function countedLine(line: IssueLine, brand: Brand | null) {
  if (brand === 'Fresh') return `${whole(line.counted)} of ${whole(line.quantity)} ${line.temp} ${line.quantity === 1 ? line.unit : plural(line.unit)}`;
  return `${whole(line.counted)} of ${amountOf(line.quantity, line.unit)} · ${line.name}`;
}

// "Fresh Nugegoda · stop 1 · VEH035 · leaves 04:36"
export const issuePlace = (issue: Pick<Issue, 'stop' | 'trip'>) =>
  `${issue.stop.shopName} · stop ${issue.stop.seq} · ${truckName(issue.trip)} · leaves ${clockTime(issue.trip.leavesAt)}`;

// "Kasun · 02:33", who flagged it and when.
export const raisedLine = (issue: Pick<Issue, 'raisedBy' | 'raisedAt'>) => `${issue.raisedBy} · ${clockTime(issue.raisedAt)}`;

// The loader's side of an answer: "Ruwan, dispatcher · 02:35", then what to do.
export const answeredBy = (issue: Pick<Issue, 'decidedBy' | 'decidedAt'>) =>
  [issue.decidedBy && `${issue.decidedBy}, dispatcher`, issue.decidedAt && clockTime(issue.decidedAt)].filter(Boolean).join(' · ');

// The answer's sentence: "Go with 1 dry carton short for Fresh Nugegoda." or "Load it all for Fresh Nugegoda. The rest
// comes from stock.", and for a truck that cannot take it all (Q-20) "Go without the 4 chilled cartons that won't fit
// for Fresh Mahaiyawa." or "Load it all for Fresh Mahaiyawa. Make room for the rest."
export function answerSentence(issue: Issue) {
  const room = issue.reason === 'wont_fit';
  if (issue.decision === 'load_all') return `Load it all for ${issue.stop.shopName}. ${room ? 'Make room for the rest.' : 'The rest comes from stock.'}`;
  return room ? `Go without the ${shortGoods(issue)} that won't fit for ${issue.stop.shopName}.` : `Go with ${shortGoods(issue)} short for ${issue.stop.shopName}.`;
}

// The dispatcher's line once an answer is sent: "VEH035 goes 1 dry carton short, Kasun told", and "VEH057 goes without
// the 4 chilled cartons that won't fit, Sarath told" (Q-20).
export function sentLine(issue: Issue) {
  const truck = truckName(issue.trip);
  if (issue.decision === 'load_all') return `${truck} loads it all, ${issue.raisedBy} told`;
  return issue.reason === 'wont_fit'
    ? `${truck} goes without the ${shortGoods(issue)} that won't fit, ${issue.raisedBy} told`
    : `${truck} goes ${shortGoods(issue)} short, ${issue.raisedBy} told`;
}

// "Waiting for the dispatcher · flagged 02:33"
export const waitingLine = (issue: Pick<Issue, 'raisedAt'>) => `Waiting for the dispatcher · flagged ${clockTime(issue.raisedAt)}`;

// ── A shop's report and the replacements (spec 015, rule 12) ───────────────────────────────────────────────────

// "1 replacement", "2 replacements"
const replacementsWords = (units: number) => `${whole(units)} ${units === 1 ? 'replacement' : 'replacements'}`;

// A report's title by its lines' reasons: "1 chilled carton missing", "1 chilled carton damaged", "1 crate of 2 damaged,
// 1 pallet missing" when its lines differ (Q-40), and "Chilled goods not cold". The goods of each reason are those of the
// lines it counts a unit on, as the API counted them; a report kept before lines had reasons reads its one reason.
export function reportTitle(issue: IssueWords & Pick<Issue, 'reason'>) {
  if (issue.reason === 'not_cold') return 'Chilled goods not cold';
  const counted = issue.lines.filter((line) => line.counted > 0);
  const reasons = [...new Set(counted.map((line) => lineReason(issue, line) ?? issue.reason))];
  return reasons.map((reason) => {
    const lines = counted.filter((line) => (lineReason(issue, line) ?? issue.reason) === reason);
    return `${shortGoods({ ...issue, lines, short: lines.reduce((units, line) => units + line.counted, 0) })} ${reason}`;
  }).join(', ');
}

// "Fresh Nugegoda · stop 1 · VEH035 · Dilshan · delivered 03:38"
export const reportPlace = (issue: Pick<Issue, 'stop' | 'trip'>) =>
  [issue.stop.shopName, `stop ${issue.stop.seq}`, truckName(issue.trip), issue.trip.driver, issue.stop.doneAt && `delivered ${clockTime(issue.stop.doneAt)}`].filter(Boolean).join(' · ');

// Each line the report counts, as the shop received it of what was handed over, with what the shop said of the units
// short (Q-40): "11 of 12 chilled cartons, 1 missing", and "1 of 2 crates of 2 · Refrigerators, 1 damaged" for Style and
// Tech. A chilled line counted only because the goods came warm has nothing short to say.
export function receivedOf(issue: Pick<Issue, 'lines' | 'stop' | 'reason'>) {
  const brand = brandOfShop(issue.stop.shopName);
  return issue.lines.map((line) => {
    const handed = line.delivered ?? 0;
    const of = `${whole(line.received ?? 0)} of`;
    const said = lineReason(issue, line);
    const goods = brand === 'Fresh' ? `${of} ${whole(handed)} ${line.temp} ${handed === 1 ? line.unit : plural(line.unit)}` : `${of} ${amountOf(handed, line.unit)} · ${line.name}`;
    return said ? `${goods}, ${whole(line.counted)} ${said}` : goods;
  }).join('; ');
}

// What a report says of one of its lines (Q-40): its own reason, or a report kept before lines had reasons its one.
const lineReason = (issue: Pick<Issue, 'reason'>, line: IssueLine) =>
  (issue.reason === 'missing' || issue.reason === 'damaged' || issue.reason === 'not_cold' ? reasonOfLine({ reason: issue.reason }, line) : null);

// "yes", "no"
export const coldWords = (cold: boolean) => (cold ? 'yes' : 'no');

export const REPORT_QUESTION = 'What should the depot do?';

// "Send 1 replacement on Fri 26 Jun": the units the problem counts, for the day an order placed now is for.
export const sendReplacementsTitle = (units: number, day: string) => `Send ${replacementsWords(units)} on ${shortDay(day)}`;
// What it means for a shop's report, and for a refusal beside "Bring them back".
export const reportReplacementLine = (units: number) => `The shop gets ${units === 1 ? 'it' : 'them'} on the next run.`;
export const refusalReplacementLine = (units: number) => `The driver brings them back, and the shop gets ${whole(units)} on the next run.`;
export const NO_REPLACEMENT = { title: 'No replacement', line: 'Nothing more is sent. The shop is told.' } as const;

// The dispatcher's line once an answer to a shop's report is sent: "Fresh Nugegoda · 1 replacement on Fri 26 Jun,
// Nadeesha told", "Fresh Nugegoda · no replacement, Nadeesha told".
export function reportSentLine(issue: Issue) {
  const what = issue.decision === 'send_replacements' && issue.replacement
    ? `${replacementsWords(issue.replacement.units)} on ${shortDay(issue.replacement.day)}`
    : 'no replacement';
  return `${issue.stop.shopName} · ${what}, ${issue.raisedBy} told`;
}

// A driver's problem once answered, now that the shop's card shows the answer too: "VEH035 · 2 cartons back to
// Peliyagoda, Dilshan and the shop told", "VEH035 · 2 cartons back, 2 replacements on Fri 26 Jun, Dilshan and the shop
// told", "VEH035 · tries Fresh Wellawatte again, Dilshan and the shop told".
export function driverSentLine(issue: Issue, depot: string) {
  const truck = truckName(issue.trip);
  const told = `${issue.trip.driver ?? issue.raisedBy} and the shop told`;
  if (issue.decision === 'try_again') return `${truck} · tries ${issue.stop.shopName} again, ${told}`;
  const back = unitsWords(brandOfShop(issue.stop.shopName), issue.short);
  if (issue.decision === 'send_replacements' && issue.replacement) {
    return `${truck} · ${back} back, ${replacementsWords(issue.replacement.units)} on ${shortDay(issue.replacement.day)}, ${told}`;
  }
  return `${truck} · ${back} back to ${depot}, ${told}`;
}

// ── A ready truck ──────────────────────────────────────────────────────────────────────────────────────────────

// "117 of 118 on · 1 short, dispatcher told 02:35 · leaves 04:36", or "118 of 118 on · leaves 04:36" with nothing
// short. The answer's time is the latest one's: the answered problems come latest first.
export function readyLine(truck: LoadingTruck) {
  const told = truck.issues.find((issue) => issue.status === 'decided')?.decidedAt;
  const short = truck.short > 0 ? ` · ${whole(truck.short)} short${told ? `, dispatcher told ${clockTime(told)}` : ''}` : '';
  return `${whole(truck.on.units)} of ${whole(truck.units)} on${short} · ${leaves(truck)}`;
}

// "stop 1", "stops 1 and 2", "stops 1, 2 and 4"
function stopsWords(seqs: number[]) {
  if (seqs.length === 1) return `stop ${seqs[0]}`;
  return `stops ${seqs.slice(0, -1).join(', ')} and ${seqs.at(-1)}`;
}

const UNIT_WORD: Record<Brand, [string, string]> = { Fresh: ['carton', 'cartons'], Style: ['box', 'boxes'], Tech: ['item', 'items'] };

// "Dilshan sees the short carton on stop 1 before driving.", or null when nothing is short.
export function readyNote(truck: LoadingTruck) {
  if (truck.short === 0) return null;
  const seqs = truck.stops.filter((stop) => stop.short > 0).map((stop) => stop.seq).sort((a, b) => a - b);
  const [one, many] = truck.brand ? UNIT_WORD[truck.brand] : ['unit', 'units'];
  const where = seqs.length > 0 ? ` on ${stopsWords(seqs)}` : '';
  return `${truck.driver ?? 'The driver'} sees the short ${truck.short === 1 ? one : many}${where} before driving.`;
}
