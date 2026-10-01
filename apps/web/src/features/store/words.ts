import {
  DEPOT_TIME_ZONE, reportReasons, type Brand, type DeliveryFigures, type DockType, type OrderDelivery, type OrderLine, type OrderProblem, type OrderReceipt,
  type RefusalReason, type ShortReason, type StoreDelivery, type StoreDeliveryLine, type StoreOrder, type StoreOutlet, type StoreProduct,
  type StoreReceipt, type Temp,
} from '@wayfinder/contracts';
import { ApiRequestError } from '@/lib/api';

// The words and formats of the shop's screens (spec 009, plan.md): days, times, numbers, unit words and chip
// words. Nothing here works a figure out. It only writes down what the API sent.

const partsOf = (format: Intl.DateTimeFormat, date: Date) => Object.fromEntries(format.formatToParts(date).map((p) => [p.type, p.value]));

// A day is a plain 'YYYY-MM-DD' at the depot. Read at noon UTC and written in UTC, it stays that day whatever
// the device's time zone is.
const SHORT_DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const LONG_DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const dayParts = (format: Intl.DateTimeFormat, day: string) => partsOf(format, new Date(`${day}T12:00:00Z`));

// "Wed 24 Jun"
export function shortDay(day: string) {
  const p = dayParts(SHORT_DAY, day);
  return `${p.weekday} ${p.day} ${p.month}`;
}

// "Thursday, 25 June"
export function longDay(day: string) {
  const p = dayParts(LONG_DAY, day);
  return `${p.weekday}, ${p.day} ${p.month}`;
}

// "Thursday"
export const weekday = (day: string) => dayParts(LONG_DAY, day).weekday;

// A moment is an instant, shown in depot time whatever the device is set to.
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: DEPOT_TIME_ZONE });
const WEEKDAY_SHORT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: DEPOT_TIME_ZONE });
const WEEKDAY_LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: DEPOT_TIME_ZONE });

// "15:02"
export const clockTime = (moment: string) => TIME.format(new Date(moment));

// When the order's day closes, short: "16:00" when that is today, "Thu 16:00" when it is a later day.
export const cutoffTime = (cutoffAt: string, isToday: boolean) =>
  isToday ? clockTime(cutoffAt) : `${WEEKDAY_SHORT.format(new Date(cutoffAt))} ${clockTime(cutoffAt)}`;

// The day it closes, for a sentence: "today", or "on Thursday".
export const cutoffDay = (cutoffAt: string, isToday: boolean) => (isToday ? 'today' : `on ${WEEKDAY_LONG.format(new Date(cutoffAt))}`);

const WHOLE = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const KILOS = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const CUBIC = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
const CUBIC_EACH = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

// "1,350 kg", "331.2 kg"
export const kilos = (kg: number) => `${KILOS.format(kg)} kg`;
// "22.8 m³"
export const cubic = (m3: number) => `${CUBIC.format(m3)} m³`;

// 'carton' to 'cartons', 'rail box' to 'rail boxes', 'pallet of 8' to 'pallets of 8'.
export function plural(unit: string) {
  const [head = '', ...rest] = unit.split(' of ');
  return [/(s|x|ch|sh)$/.test(head) ? `${head}es` : `${head}s`, ...rest].join(' of ');
}

// "8 cartons", "1 crate of 3"
export const countOf = (quantity: number, unit: string) => `${WHOLE.format(quantity)} ${quantity === 1 ? unit : plural(unit)}`;

// What a brand calls its units together: "12 cartons", "100 boxes", "3 items".
const BRAND_UNIT: Record<Brand, string> = { Fresh: 'carton', Style: 'box', Tech: 'item' };
export const brandUnits = (brand: Brand, units: number) => countOf(units, BRAND_UNIT[brand]);
// The heading of a brand's item list: "Style boxes", "Tech items".
export const brandList = (brand: Brand) => `${brand} ${plural(BRAND_UNIT[brand])}`;

export const TEMP_NAME: Record<Temp, string> = { chilled: 'Chilled', dry: 'Dry' };

// A card's title: "8 chilled cartons" for a Fresh order. Style and Tech ship dry only, so theirs is "100 boxes"
// or "3 items".
export const orderTitle = (brand: Brand, order: Pick<StoreOrder, 'temp' | 'units'>) =>
  brand === 'Fresh' ? `${WHOLE.format(order.units)} ${order.temp} ${order.units === 1 ? 'carton' : 'cartons'}` : brandUnits(brand, order.units);

// Lines in the order of the brand's product list, so chilled comes before dry. An item that left the list
// goes last.
export function inListOrder(lines: OrderLine[], products: StoreProduct[]) {
  const place = (line: OrderLine) => {
    const at = products.findIndex((p) => p.id === line.productId);
    return at === -1 ? products.length : at;
  };
  return [...lines].sort((a, b) => place(a) - place(b));
}

// What is in an order, in a few words: "8 chilled + 4 dry" for Fresh, whose lines are one per temperature, and
// the units the server counted for Style and Tech.
export function mixOf(brand: Brand, lines: OrderLine[], units: number, products: StoreProduct[]) {
  if (brand !== 'Fresh') return brandUnits(brand, units);
  return inListOrder(lines, products).map((line) => `${WHOLE.format(line.quantity)} ${products.find((p) => p.id === line.productId)?.temp ?? line.name.toLowerCase()}`).join(' + ');
}

// A row of an order: "Chilled" and "8 cartons" for Fresh, the item's own name for Style and Tech.
export function lineWords(brand: Brand, line: OrderLine, products: StoreProduct[]) {
  const temp = products.find((p) => p.id === line.productId)?.temp;
  return { name: brand === 'Fresh' && temp ? TEMP_NAME[temp] : line.name, amount: countOf(line.quantity, line.unit) };
}

// An item's own figures under its name: "box · 12 kg · 0.20 m³".
export const itemFigures = (product: StoreProduct) => `${product.unit} · ${kilos(product.kgPerUnit)} · ${CUBIC_EACH.format(product.m3PerUnit)} m³`;

// Under a quantity box that holds anything but a whole number from 0 to 999: a minus, a fraction or more (Q-01, Q-02).
export const QUANTITY_LINE = 'Whole numbers from 0 to 999.';

// On the form when the drafts it showed were placed from another screen (Q-07), with or without a change made here.
export const PLACED_ELSEWHERE = 'This order was placed from another screen.';
export const PLACED_ELSEWHERE_LOST = 'This order was placed from another screen, without your last change.';

// When a change to the order could not be saved and the form can no longer try: signed out, or the form left (Q-04).
export const NOT_KEPT = 'Your last change to the order was not saved. Check the draft before you place it.';
// When a sign-out could not wait any longer for a save or a place that had not answered: it may or may not have
// gone through.
export const NOT_CONFIRMED = 'Your last change to the order could not be confirmed. Check the draft before you place it.';
export const PLACE_NOT_CONFIRMED = 'Your order could not be confirmed as placed. Check Today before you order again.';

// The note for the driver takes 200 characters at most, as the API checks it (Q-06).
const NOTE_MOST = 200;
export const NOTE_FULL = 'The note is full: 200 characters at most.';
export const NOTE_REFUSED = 'The note takes 200 characters at most, so that was not added.';

// A change to the note is taken whole or not at all: one that would make it longer is refused, never cut.
export const noteFits = (note: string) => note.length <= NOTE_MOST;

// The line under the note: how many characters are left once 40 or fewer are, that it is full, or that a change was
// refused because it would have made the note too long.
export function noteLine(length: number, refused: boolean): { words: string; refused: boolean } | null {
  if (refused) return { words: NOTE_REFUSED, refused: true };
  const left = NOTE_MOST - length;
  if (left <= 0) return { words: NOTE_FULL, refused: false };
  if (left <= 40) return { words: `${left} ${left === 1 ? 'character' : 'characters'} left`, refused: false };
  return null;
}

export const ENTRANCE: Record<DockType, string> = { street: 'Street', rear_dock: 'Rear dock', mall_bay: 'Mall loading bay' };

// "Fresh · Nugegoda", the way Help writes the shop. A shop's name is its brand and then its place (spec 003).
export const brandAndPlace = (outlet: StoreOutlet) =>
  outlet.name.startsWith(`${outlet.brand} `) ? `${outlet.brand} · ${outlet.name.slice(outlet.brand.length + 1)}` : outlet.name;

// "05:00 to 07:30" on the form, "05:00–07:30" in a card's line.
export const windowWords = (outlet: StoreOutlet) => `${outlet.windowOpen} to ${outlet.windowClose}`;
export const windowShort = (outlet: StoreOutlet) => `${outlet.windowOpen}–${outlet.windowClose}`;

// An order counts for the day of the sent plan it is on, and until then for the day the shop wanted.
export const dayOf = (order: Pick<StoreOrder, 'deliveryDate' | 'scheduledDate'>) => order.scheduledDate ?? order.deliveryDate;

export type ChipTone = 'good' | 'warn' | 'quiet' | 'plain';

// The chip of each status (spec 009, rule 6): waiting and planned are grey, a changed date is yellow, and
// everything from the truck onwards is green.
export function statusChip(order: Pick<StoreOrder, 'status' | 'deliveryDate' | 'scheduledDate'>): { label: string; tone: ChipTone } {
  switch (order.status) {
    case 'draft': return { label: 'Draft', tone: 'plain' };
    case 'placed': return { label: 'Waiting for the delivery plan', tone: 'quiet' };
    case 'planned': return { label: `Planned · ${shortDay(dayOf(order))}`, tone: 'quiet' };
    case 'deferred': return { label: 'Date changed', tone: 'warn' };
    case 'loaded': return { label: 'Loaded', tone: 'good' };
    case 'delivered': return { label: 'Delivered', tone: 'good' };
    case 'received': return { label: 'Received', tone: 'good' };
    case 'cancelled': return { label: 'Cancelled', tone: 'quiet' };
    // The shop's lists show a split order's two parts, never the original (spec 010). This is for completeness.
    case 'split': return { label: 'Split in two', tone: 'quiet' };
  }
}

// What to tell the manager when a request fails: the API's own sentence when it sent one.
export const reasonOf = (error: unknown) =>
  error instanceof ApiRequestError ? error.message : 'Could not reach Wayfinder. Check the connection and try again.';

// ── The shop's receipt (spec 015, plan.md "Words") ──────────────────────────────────────────────────────────
// Every number here comes from deliveryFigures, the form's own counters or the facts the API sent with a card.
// These only write them down.

const DEPOT_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: DEPOT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
// The day a moment falls on at the depot: "2026-06-25".
export const depotDayOf = (moment: string | number) => DEPOT_DAY.format(new Date(moment));

// "03:34", with the day before it when that is not today: "Wed 24 Jun 06:58".
const whenOf = (moment: string, today: string) => {
  const day = depotDayOf(moment);
  return day === today ? clockTime(moment) : `${shortDay(day)} ${clockTime(moment)}`;
};

const unitOf = (brand: Brand, n: number) => (n === 1 ? BRAND_UNIT[brand] : plural(BRAND_UNIT[brand]));

// "Arrived 03:34 · VEH035 · Dilshan", and "Arrived Wed 24 Jun 06:58 · …" for a delivery of another day.
export const arrivedLine = (delivery: Pick<StoreDelivery, 'arrivedAt' | 'vehicleId' | 'driver'>, today: string) =>
  [`Arrived ${whenOf(delivery.arrivedAt, today)}`, delivery.vehicleId, delivery.driver].filter(Boolean).join(' · ');

// A line's name on the form: "Chilled cartons" or "Dry cartons" for Fresh, the item's name for Style and Tech.
export const receiptLineName = (brand: Brand, line: Pick<StoreDeliveryLine, 'temp' | 'unit' | 'name'>) =>
  (brand === 'Fresh' ? `${TEMP_NAME[line.temp]} ${plural(line.unit)}` : line.name);

// "12 expected"
export const expectedWords = (expected: number) => `${WHOLE.format(expected)} expected`;
// Under a line counted lower: "1 carton missing", "2 cartons damaged".
export const shortChip = (short: number, unit: string, reason: ShortReason) => `${countOf(short, unit)} ${reason}`;
// Under a line the depot sent short, and one the shop refused some of at the door.
export const shortFromDepotLine = (units: number) => `${WHOLE.format(units)} short from the depot`;
export const refusedAtDoorLine = (units: number) => `${WHOLE.format(units)} refused at the door`;
// Under a receipt's count box that holds more than was handed over (Q-38): it stays as typed, and this says why it
// cannot go. A minus or a fraction gets the loader's "Whole numbers from 0 to 50." instead.
export const overLine = (handedOver: number) => `More than the ${WHOLE.format(handedOver)} handed over.`;

export const SHORT_REASON_WORDS: Record<ShortReason, string> = { missing: 'Missing', damaged: 'Damaged' };
// The note that goes with a report (Q-40), for the depot to read with it.
export const RECEIPT_NOTE_LABEL = 'Note for the depot (optional)';

export const RECEIPT_TITLE = 'Confirm delivery';
export const NOT_SAVED_ON_PHONE = 'Could not save on this phone. Try again.';
export const ADD_PHOTO = 'Add a photo (optional)';
export const SIGN_IN_AGAIN = 'Sign in again to send this receipt.';
export const NOTHING_TO_CONFIRM = 'No delivery is waiting for you to confirm.';
export const NOT_ON_LIST = 'This delivery is not on your list.';
export const COULD_NOT_LOAD_DELIVERIES = 'Could not load your deliveries.';
export const COULD_NOT_READ_PHONE = 'Could not read what this phone kept.';
export const NOTHING_SENT_UNTIL_READ = 'Nothing is sent or saved until it is read.';
export const COULD_NOT_CLEAR = 'Could not clear on this phone. Try again.';

// A line of the saved and sent screens, in spec 012's line words: "12 chilled cartons", "10 boxes · Folded clothing".
export const lineGoods = (brand: Brand, line: Pick<StoreDeliveryLine, 'temp' | 'unit' | 'name'>, units: number) =>
  (brand === 'Fresh' ? `${WHOLE.format(units)} ${line.temp} ${units === 1 ? line.unit : plural(line.unit)}` : `${countOf(units, line.unit)} · ${line.name}`);

// Saved on this phone (Shop · Short delivery · receipt pending sync).
export const SAVED_TITLE = 'Receipt saved on this phone';
export const NO_SIGNAL = 'There is no signal right now.';
export const DROPPED = 'The connection dropped while sending.';
export const NOT_SENT_YET = 'Not sent to the depot yet';
export const keptSentences = (reports: boolean) => (reports
  ? ['Your receipt and report are kept together.', 'They will retry when the connection returns.', 'You do not need to confirm this delivery again.']
  : ['Your receipt is kept on this phone.', 'It will retry when the connection returns.', 'You do not need to confirm this delivery again.']);
export const savedFoot = (savedAt: string, today: string) => `Saved at ${whenOf(savedAt, today)} · waiting to sync`;
export const NOT_ACCEPTED = 'The depot did not accept this receipt.';
export const notAcceptedFoot = (savedAt: string, today: string) => `Saved at ${whenOf(savedAt, today)} · not accepted`;

// Sent (Shop · Receipt sent): "Confirmed at 08:31 · Fresh · Nugegoda", with the day for a receipt of another day.
export const SENT_TITLE = 'Receipt sent to the depot';
export const confirmedLine = (receipt: Pick<StoreReceipt, 'at'>, outlet: StoreOutlet, today: string) => `Confirmed at ${whenOf(receipt.at, today)} · ${brandAndPlace(outlet)}`;

// "1 chilled carton" when the goods are of one temperature at a Fresh shop, the brand's units otherwise.
const goodsOf = (brand: Brand, temps: Temp[], units: number) => {
  const temp = brand === 'Fresh' && new Set(temps).size === 1 ? `${temps[0]} ` : '';
  return `${WHOLE.format(units)} ${temp}${unitOf(brand, units)}`;
};

export interface SentStatus { chip: { label: string; tone: ChipTone }; sentences: string[]; foot: string }

// The sent screen's chip, its words and its foot, from the receipt and the depot's answer (the screen states' Sent
// rows). short is the units the receipt is short, from deliveryFigures; temps are the temperatures of the lines the
// report counts a unit on, for the replacement's words.
export function sentStatus(receipt: StoreReceipt, brand: Brand, short: number, temps: Temp[]): SentStatus {
  const sent = receipt.sentAt ? `Sent at ${clockTime(receipt.sentAt)}` : '';
  const foot = (rest?: string) => [sent, rest].filter(Boolean).join(' · ');
  const { report } = receipt;
  if (!report) return { chip: { label: 'All received', tone: 'good' }, sentences: ['The depot has your receipt.'], foot: foot() };
  const one = short === 1;
  // The report's reasons, each once (Q-40): "the 2 damaged and missing items" when its lines differ.
  const reasons = reportReasons(report);
  const goods = report.reason === 'not_cold' ? 'the chilled goods' : `the ${one ? '' : `${WHOLE.format(short)} `}${reasons.join(' and ')} ${unitOf(brand, short)}`;
  if (report.decision === 'send_replacements' && report.replacement) {
    const day = shortDay(report.replacement.day);
    return {
      chip: { label: `Replacement on ${day}`, tone: 'good' },
      sentences: [`The depot is sending ${goodsOf(brand, temps, report.replacement.units)} on ${day}.`, 'It shows in your open orders.'],
      foot: foot(`replacement on ${day}`),
    };
  }
  if (report.decision === 'no_replacement') {
    return {
      chip: { label: 'No replacement', tone: 'quiet' },
      sentences: [`The depot will not replace ${goods}.`, `Place another order if you need ${one && report.reason !== 'not_cold' ? 'it' : 'them'}.`],
      foot: foot('no replacement'),
    };
  }
  if (report.reason === 'not_cold') {
    return {
      chip: { label: 'Awaiting depot review', tone: 'good' },
      sentences: ['The depot has your receipt and your report that the chilled goods were not cold.', 'The report still needs a resolution.'],
      foot: foot('report unresolved'),
    };
  }
  const which = reasons.length > 1 ? null : report.reason === 'missing' ? 'shortage' : 'damage';
  const Goods = goods.charAt(0).toUpperCase() + goods.slice(1);
  return {
    chip: { label: 'Awaiting depot review', tone: 'good' },
    sentences: [
      `The depot has your receipt and ${which ? `${which} ` : ''}report.`,
      `${Goods} still ${one ? 'needs' : 'need'} a resolution.`,
      `Reporting ${one ? 'it does not mark it' : 'them does not mark them'} as replaced.`,
    ],
    foot: foot(`${which ?? 'report'} unresolved`),
  };
}

// The units the receipt is short, and the temperatures of the lines its report counts a unit on.
export function reportFacts(delivery: StoreDelivery, figures: DeliveryFigures) {
  const counted = new Set(delivery.receipt?.report?.lines.filter((line) => line.counted > 0).map((line) => line.lineId));
  return { short: figures.short, temps: delivery.lines.filter((line) => counted.has(line.lineId)).map((line) => line.temp) };
}

// What a saved receipt is about, kept with it on the phone: "Fresh Nugegoda · VEH035 · Thu 25 Jun".
export const aboutDelivery = (delivery: Pick<StoreDelivery, 'vehicleId' | 'day'>, outlet: StoreOutlet) => `${outlet.name} · ${delivery.vehicleId} · ${shortDay(delivery.day)}`;

// ── The shop's cards (spec 015, rule 11) ──────────────────────────────────────────────────────────────────────

const REFUSAL_WORDS: Record<RefusalReason, string> = { damaged: 'damaged', expired: 'expired', not_ordered: 'not ordered' };

// "Delivered 03:38 · VEH035 · Dilshan"
export const deliveredLine = (delivery: OrderDelivery) => [`Delivered ${clockTime(delivery.doneAt)}`, delivery.vehicleId, delivery.driver].filter(Boolean).join(' · ');

// "1 short from the depot", "2 refused, damaged"
const shortParts = (delivery: OrderDelivery) => [
  delivery.shortFromDepot > 0 && shortFromDepotLine(delivery.shortFromDepot),
  delivery.refused > 0 && `${WHOLE.format(delivery.refused)} refused${delivery.refusalReason ? `, ${REFUSAL_WORDS[delivery.refusalReason]}` : ''}`,
].filter((part): part is string => Boolean(part));

// "3 of 4 delivered · 1 short from the depot", when less came than was ordered.
export const lessLine = (order: Pick<StoreOrder, 'units'>, delivery: OrderDelivery) =>
  (delivery.delivered !== null && delivery.delivered < order.units ? [`${WHOLE.format(delivery.delivered)} of ${WHOLE.format(order.units)} delivered`, ...shortParts(delivery)].join(' · ') : null);

// What stays on a received card: "1 short from the depot", "2 refused, damaged".
export const shortLine = (delivery: OrderDelivery) => (shortParts(delivery).length > 0 ? shortParts(delivery).join(' · ') : null);

// "All 8 received", "11 received · 1 short"
export const receivedWords = (receipt: OrderReceipt) =>
  (receipt.short === 0 ? `All ${WHOLE.format(receipt.units)} received` : `${WHOLE.format(receipt.units)} received · ${WHOLE.format(receipt.short)} short`);

// The chip of a received order: "Received 08:31" on Today, and in Orders "All 8 received" in green or "11 received · 1
// short" in yellow.
export const receivedChip = (receipt: OrderReceipt, today: boolean): { label: string; tone: ChipTone } =>
  (today ? { label: `Received ${clockTime(receipt.at)}`, tone: 'good' } : { label: receivedWords(receipt), tone: receipt.short === 0 ? 'good' : 'warn' });
export const receivedAtLine = (receipt: OrderReceipt) => `Received ${clockTime(receipt.at)}`;
export const lateLine = (delivery: OrderDelivery) => `Arrived ${clockTime(delivery.arrivedAt)}, after your window`;
export const nobodyLine = (delivery: OrderDelivery) => `Nobody at the shop at ${clockTime(delivery.arrivedAt)} · ${delivery.vehicleId}`;
export const replacementForLine = (day: string) => `Replacement for ${shortDay(day)}`;

// One line per problem of the order's stop that counts it.
export function problemLine(problem: OrderProblem, brand: Brand) {
  const n = problem.units;
  const day = problem.replacementDay ? shortDay(problem.replacementDay) : null;
  const replacements = (count: number) => (count > 0 ? `${WHOLE.format(count)} ${count === 1 ? 'replacement comes' : 'replacements come'}` : 'Replacements come');
  switch (problem.kind) {
    case 'refused': {
      const them = n === 1 ? `refused ${unitOf(brand, 1)}` : `${WHOLE.format(n)} refused ${unitOf(brand, n)}`;
      if (problem.decision === 'send_replacements' && day) return `${replacements(n)} on ${day}.`;
      if (problem.decision === 'bring_back') return `The ${them} ${n === 1 ? 'goes' : 'go'} back to the depot.`;
      return `The depot decides what happens to the ${them}.`;
    }
    case 'closed':
      if (problem.decision === 'try_again') return 'The driver comes back after the other stops.';
      if (problem.decision === 'bring_back') return 'It goes on the next plan.';
      return 'The depot decides: today or another day.';
    case 'receipt':
      if (problem.decision === 'send_replacements' && day) return `${replacements(n)} on ${day}.`;
      if (problem.decision === 'no_replacement') return 'No replacement is coming.';
      return 'The depot is reviewing your report.';
  }
}
