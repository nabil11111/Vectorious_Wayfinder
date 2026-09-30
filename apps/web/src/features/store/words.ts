import { DEPOT_TIME_ZONE, type Brand, type DockType, type OrderLine, type StoreOrder, type StoreOutlet, type StoreProduct, type Temp } from '@wayfinder/contracts';
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

// What is in an order, in a few words: "8 chilled + 4 dry" for Fresh, whose lines are one per temperature, and
// the units the server counted for Style and Tech.
export function mixOf(brand: Brand, lines: OrderLine[], units: number, products: StoreProduct[]) {
  if (brand !== 'Fresh') return brandUnits(brand, units);
  return lines.map((line) => `${WHOLE.format(line.quantity)} ${products.find((p) => p.id === line.productId)?.temp ?? line.name.toLowerCase()}`).join(' + ');
}

// A row of an order: "Chilled" and "8 cartons" for Fresh, the item's own name for Style and Tech.
export function lineWords(brand: Brand, line: OrderLine, products: StoreProduct[]) {
  const temp = products.find((p) => p.id === line.productId)?.temp;
  return { name: brand === 'Fresh' && temp ? TEMP_NAME[temp] : line.name, amount: countOf(line.quantity, line.unit) };
}

// An item's own figures under its name: "box · 12 kg · 0.20 m³".
export const itemFigures = (product: StoreProduct) => `${product.unit} · ${kilos(product.kgPerUnit)} · ${CUBIC_EACH.format(product.m3PerUnit)} m³`;

export const ENTRANCE: Record<DockType, string> = { street: 'Street', rear_dock: 'Rear dock', mall_bay: 'Mall loading bay' };

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
  }
}

// What to tell the manager when a request fails: the API's own sentence when it sent one.
export const reasonOf = (error: unknown) =>
  error instanceof ApiRequestError ? error.message : 'Could not reach Wayfinder. Check the connection and try again.';
