import { describe, expect, it } from 'vitest';
import { PRODUCTS } from '../db/fixtures';
import { DRIVER_NOTES, pickShops, sampleOrder, spacedTimes, type SampleShop } from './sample-lines';

// Spec 028, rules 3 to 5: which shops a press picks, what each one orders and when. Pure, so no database.

const THU = '2026-06-25';
const items = PRODUCTS.map((p) => ({ id: p.id, brand: p.brand, needsTailLift: p.needsTailLift }));
const own = (shop: SampleShop) => items.filter((item) => item.brand === shop.brand);
const shop = (id: string, brand: SampleShop['brand'], parking: SampleShop['parking'] = 'normal'): SampleShop => ({ id, brand, parking });
const out = (n: number) => `OUT${String(n).padStart(3, '0')}`;
const order = (s: SampleShop, date = THU) => sampleOrder(s, own(s), date);
const qty = (lines: { productId: string; quantity: number }[], id: string) => lines.find((line) => line.productId === id)?.quantity;

describe('what a shop orders (rule 4)', () => {
  it('a Fresh shop orders dry cartons around its seeded size, and chilled ones only where the seed has them', () => {
    // OUT026: the seed's 58 dry and 53 chilled cartons, 60% to 140% of them.
    const fresh = order(shop('OUT026', 'Fresh'));
    expect(fresh.lines.map((line) => line.productId).sort()).toEqual(['fresh-chilled-carton', 'fresh-dry-carton']);
    expect(qty(fresh.lines, 'fresh-dry-carton')).toBeGreaterThanOrEqual(Math.round(58 * 0.6));
    expect(qty(fresh.lines, 'fresh-dry-carton')).toBeLessThanOrEqual(Math.round(58 * 1.4));
    expect(qty(fresh.lines, 'fresh-chilled-carton')).toBeGreaterThanOrEqual(Math.round(53 * 0.6));
    expect(qty(fresh.lines, 'fresh-chilled-carton')).toBeLessThanOrEqual(Math.round(53 * 1.4));
    // OUT027 ends in 7, so the seed gives it dry cartons only.
    expect(order(shop('OUT027', 'Fresh')).lines.map((line) => line.productId)).toEqual(['fresh-dry-carton']);
  });

  it('a Style shop orders its four kinds of box, and a Tech shop one of the seeded Tech orders', () => {
    expect(order(shop('OUT020', 'Style')).lines.map((line) => line.productId)).toEqual(['style-folded', 'style-hanging', 'style-shoes', 'style-bags']);
    const tech = order(shop('OUT023', 'Tech'));
    expect(tech.lines.length).toBeGreaterThan(0);
    expect(tech.lines.every((line) => line.productId.startsWith('tech-'))).toBe(true);
    expect(tech.lines.reduce((sum, line) => sum + line.quantity, 0)).toBeLessThanOrEqual(5);
  });

  it('a Tech shop only a van can reach orders nothing that needs a tail lift', () => {
    for (let n = 1; n <= 120; n += 1) {
      const lines = order(shop(out(n), 'Tech', 'van_only')).lines;
      expect(lines.some((line) => ['tech-washer', 'tech-fridge'].includes(line.productId)), out(n)).toBe(false);
      expect(lines.length).toBeGreaterThan(0);
    }
  });

  it('orders only the items it is given, so an archived item is never asked for', () => {
    const style = shop('OUT020', 'Style');
    const lines = sampleOrder(style, own(style).filter((item) => item.id !== 'style-bags'), THU).lines;
    expect(lines.map((line) => line.productId)).toEqual(['style-folded', 'style-hanging', 'style-shoes']);
    expect(sampleOrder(style, [], THU).lines).toEqual([]);
  });

  it('every line is a whole number from 1 to 999, and every note is one of the list and at most 200 characters', () => {
    for (const brand of ['Fresh', 'Style', 'Tech'] as const) {
      for (let n = 1; n <= 120; n += 1) {
        const { lines, driverNote } = order(shop(out(n), brand));
        for (const line of lines) {
          expect(Number.isInteger(line.quantity)).toBe(true);
          expect(line.quantity).toBeGreaterThanOrEqual(1);
          expect(line.quantity).toBeLessThanOrEqual(999);
        }
        if (driverNote) expect(DRIVER_NOTES).toContain(driverNote);
      }
    }
    expect(DRIVER_NOTES.every((note) => note.length <= 200)).toBe(true);
  });

  it('some shops order less than their seeded size, some more, and a few leave a note', () => {
    const fresh = Array.from({ length: 120 }, (_, i) => shop(out(i + 1), 'Fresh'));
    const ratios = fresh.map((s) => qty(order(s).lines, 'fresh-dry-carton')! / (45 + ((11 * Number(s.id.slice(3))) % 21)));
    const smaller = ratios.filter((r) => r < 0.85).length;
    const bigger = ratios.filter((r) => r > 1.15).length;
    expect(smaller).toBeGreaterThanOrEqual(6);
    expect(bigger).toBeGreaterThanOrEqual(6);
    expect(ratios.length - smaller - bigger).toBeGreaterThan(60);
    const notes = fresh.filter((s) => order(s).driverNote).length;
    expect(notes).toBeGreaterThanOrEqual(6);
    expect(notes).toBeLessThanOrEqual(36);
  });

  it('the same shop on the same day orders the same, and another day gives other orders', () => {
    const fresh = Array.from({ length: 30 }, (_, i) => shop(out(i + 1), 'Fresh'));
    expect(fresh.map((s) => order(s))).toEqual(fresh.map((s) => order(s)));
    expect(fresh.map((s) => order(s, '2026-06-26'))).not.toEqual(fresh.map((s) => order(s)));
  });
});

describe('which shops a press picks (rule 3)', () => {
  const shops = Array.from({ length: 75 }, (_, i) => shop(out(i + 1), 'Fresh'));

  it('shuffles the depot shops the same way for the same day and depot', () => {
    const picked = pickShops(shops, THU, 'Peliyagoda');
    expect(picked.map((s) => s.id).sort()).toEqual(shops.map((s) => s.id));
    expect(picked).toEqual(pickShops(shops, THU, 'Peliyagoda'));
    expect(picked).not.toEqual(shops);
    expect(pickShops(shops, THU, 'Kandy')).not.toEqual(picked);
    expect(pickShops(shops, '2026-06-26', 'Peliyagoda')).not.toEqual(picked);
  });
});

describe('when each order is placed (rule 5)', () => {
  const at = new Date('2026-06-24T15:20:00+05:30');
  const midnight = new Date('2026-06-24T00:00:00+05:30');

  it('the last at the press, each before it by the next shop gap, and none in the future', () => {
    const times = spacedTimes(at, [50, 60, 45], midnight);
    expect(times.map((t) => t.toISOString())).toEqual([
      new Date(at.getTime() - 105_000).toISOString(),
      new Date(at.getTime() - 45_000).toISOString(),
      at.toISOString(),
    ]);
    expect(spacedTimes(at, [], midnight)).toEqual([]);
    expect(spacedTimes(at, [70], midnight)).toEqual([at]);
  });

  it('shortens the gaps to fit when they would reach back before midnight', () => {
    const early = new Date('2026-06-24T00:02:00+05:30');
    const times = spacedTimes(early, Array(10).fill(60), midnight);
    expect(times[0]!.getTime()).toBeGreaterThanOrEqual(midnight.getTime());
    expect(times.at(-1)).toEqual(early);
    for (let i = 1; i < times.length; i += 1) expect(times[i]!.getTime()).toBeGreaterThan(times[i - 1]!.getTime());
  });
});
