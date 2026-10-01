import { createHash } from 'node:crypto';
import type { Brand } from '@wayfinder/contracts';
import { chilledCartons, dryCartons, KANDY_TECH_ORDERS, numberOf, ordersChilled, styleLines, TECH_ORDERS, type Line } from '../db/demo-day';

// Spec 028, rules 3 to 5: which shops a press of "Add sample shop orders" picks, what each one orders and when. The
// sizes start from the seeded day's rules for the same shop (spec 008), so a sample order looks like that day's. Every
// choice comes from a seed made of the delivery day and the shop or depot, so the same press on the same day gives the
// same orders, after a reset too.

export interface SampleShop { id: string; brand: Brand; parking: 'normal' | 'van_only' | 'mall_dock' }
// An item the shop can order now: its brand's and not archived.
export interface SampleItem { id: string; needsTailLift: boolean }
export interface SampleLine { productId: string; quantity: number }

// A few shops leave the driver a note, as Nadeesha's draft does.
export const DRIVER_NOTES = [
  'Ring the bell at the side door.',
  'Call the shop 10 minutes before you arrive.',
  'Use the back gate on the lane behind the shop.',
  'Park behind the bus stand, not in front of the shop.',
  'Ask security at the gate for the loading bay key.',
  'Leave the cartons by the store room, not at the till.',
  'The shop opens its shutter at 06:00. Knock if it is down.',
] as const;

// A small, fast generator (mulberry32) started from a SHA-1 of the key, so a key always gives the same numbers.
export function seeded(key: string): () => number {
  let state = createHash('sha1').update(key).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// The depot's shops in the order a press takes them, the same for the same delivery day and depot.
export function pickShops<T extends { id: string }>(shops: readonly T[], deliveryDate: string, depotId: string): T[] {
  const random = seeded(`sample-shops:${deliveryDate}:${depotId}`);
  const order = [...shops].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

// The Tech orders the seed writes out, Peliyagoda's and Kandy's: the shapes a Tech shop's order takes.
const TECH_SHAPES: Line[][] = [...TECH_ORDERS, ...KANDY_TECH_ORDERS].map((order) => order.lines);

const clamp = (n: number) => Math.min(999, Math.max(1, Math.round(n)));

// What a shop orders for the day, the note it leaves (or '') and the seconds between the shop picked before it and this
// one, from the shop's own seed. Only the items given are ordered, so an archived item is never asked for, and a shop
// with nothing left to order gets no lines.
export function sampleOrder(shop: SampleShop, items: readonly SampleItem[], deliveryDate: string): { lines: SampleLine[]; driverNote: string; gapSeconds: number } {
  const random = seeded(`sample-order:${deliveryDate}:${shop.id}`);
  const n = numberOf(shop.id);
  // Most shops order 90% to 110% of their seeded size, about one in seven 60% to 80% and one in seven 120% to 140%.
  const kind = random();
  const size = kind < 0.15 ? 'less' : kind >= 0.85 ? 'more' : 'usual';
  const factor = size === 'less' ? 0.6 + random() * 0.2 : size === 'more' ? 1.2 + random() * 0.2 : 0.9 + random() * 0.2;
  // Each line varies a little more, inside the same 60% to 140%.
  const sized = (base: number) => clamp(base * Math.min(1.4, Math.max(0.6, factor * (0.97 + random() * 0.06))));

  let lines: Line[];
  if (shop.brand === 'Fresh') {
    lines = [['fresh-dry-carton', sized(dryCartons(n))]];
    if (ordersChilled(n)) lines.unshift(['fresh-chilled-carton', sized(chilledCartons(n))]);
  } else if (shop.brand === 'Style') {
    lines = styleLines(n).map(([productId, quantity]) => [productId, sized(quantity)]);
  } else {
    // A van has no tail lift (D-24), so a shop only a van can reach gets a shape with nothing that needs one.
    const tailLift = new Set(items.filter((item) => item.needsTailLift).map((item) => item.id));
    const shapes = shop.parking === 'van_only' ? TECH_SHAPES.filter((shape) => shape.every(([productId]) => !tailLift.has(productId))) : TECH_SHAPES;
    const shape = shapes[Math.floor(random() * shapes.length)]!;
    // Crates and pallets come in ones: less is one fewer of each, more is one more of the first.
    lines = shape.map(([productId, quantity], i): Line => [productId, size === 'less' ? clamp(quantity - 1) : size === 'more' && i === 0 ? quantity + 1 : quantity]);
  }
  const note = random() < 1 / 7 ? DRIVER_NOTES[Math.floor(random() * DRIVER_NOTES.length)]! : '';
  const gapSeconds = 40 + Math.floor(random() * 51);
  const orderable = new Set(items.map((item) => item.id));
  return { lines: lines.filter(([productId]) => orderable.has(productId)).map(([productId, quantity]) => ({ productId, quantity })), driverNote: note, gapSeconds };
}

// When each picked shop placed its order: the last at the press, and each one before it earlier by the gap of the shop
// after it. Every time is at or before the press. Gaps that would reach back before `earliest` are shortened to fit.
export function spacedTimes(at: Date, gapSeconds: readonly number[], earliest: Date): Date[] {
  if (!gapSeconds.length) return [];
  const total = gapSeconds.slice(1).reduce((sum, gap) => sum + gap * 1000, 0);
  const room = Math.max(0, at.getTime() - earliest.getTime());
  const scale = total > room ? room / total : 1;
  const times = [at];
  for (let i = gapSeconds.length - 1; i > 0; i -= 1) times.unshift(new Date(times[0]!.getTime() - Math.floor(gapSeconds[i]! * 1000 * scale)));
  return times;
}
