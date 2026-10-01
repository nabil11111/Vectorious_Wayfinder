import type { StoreNextOrder } from '@wayfinder/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Saving } from './draft-form';
import { Checkout, OrderSummary, PlacedElsewhere } from './NewOrderPage';

// Parts of the New order form drawn once, as the browser gets them.

const draw = (node: React.ReactNode) => renderToStaticMarkup(<MemoryRouter initialEntries={['/store/orders/new']}>{node}</MemoryRouter>);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('Q-07 a draft placed from another tab', () => {
  it('says the order was placed from another screen and links to its confirmation', () => {
    const html = draw(<PlacedElsewhere lost={false} />);
    expect(text(html)).toBe('This order was placed from another screen. View confirmation');
    expect(html).toMatch(/<a[^>]*href="\/store\/orders\/placed"[^>]*>View confirmation<\/a>/);
    expect(html).not.toContain('changed somewhere else');
  });

  it('says when the last change made here is not in it', () => {
    expect(text(draw(<PlacedElsewhere lost />))).toBe('This order was placed from another screen, without your last change. View confirmation');
  });
});

describe('Q-08 Place pressed while the draft is still saving', () => {
  const next = (draft: boolean): StoreNextOrder => ({
    outlet: { id: 'OUT001', name: 'Fresh Nugegoda', brand: 'Fresh', windowOpen: '05:00', windowClose: '07:30', dockType: 'street' },
    products: [], deliveryDate: '2026-06-25', cutoffAt: '2026-06-24T10:30:00.000Z', cutoffIsToday: true, movedFrom: null, placed: null,
    draft: draft ? {
      lines: [{ productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', quantity: 8 }], driverNote: '', refs: { chilled: { id: '00000000-0000-4000-8000-000000000001', revision: 2 } },
      savedAt: '2026-06-24T09:32:00.000Z', summary: { kg: 55.2, m3: 0.3, units: 8, needsReefer: true, needsTailLift: false, keepUpright: false }, tailLiftItems: [],
    } : null,
  });
  const button = (draft: boolean, saving: Saving, placing = false) =>
    draw(<Checkout next={next(draft)} saving={saving} placing={placing} refused={null} onPlace={() => {}} />).match(/<button[^>]*>[^<]*<\/button>/)?.[0] ?? '';

  it('takes the press while a change is saving or being tried again, also before the first draft exists', () => {
    for (const [draft, saving] of [[true, 'saving'], [false, 'saving'], [true, 'retrying'], [true, 'refused'], [true, 'saved']] as const) {
      expect(button(draft, saving)).not.toMatch(/\sdisabled=""/);
    }
  });

  it('is off with nothing added, while a box holds something that is not a whole number, and while placing', () => {
    expect(button(false, 'saved')).toMatch(/\sdisabled=""/);
    expect(button(true, 'held')).toMatch(/\sdisabled=""/);
    // While placing it keeps the focus it had, so it is off for assistive technology rather than taken out.
    expect(button(true, 'saved', true)).toMatch(/\saria-disabled="true"[^>]*>Placing…</);
  });
});

describe('L-02 Your order on a desktop', () => {
  const product = (id: string, name: string, unit: string) => ({ id, name, unit, temp: 'dry' as const, kgPerUnit: 1, m3PerUnit: 0.01, needsTailLift: false });
  const products = [product('style-folded', 'Folded clothing', 'box'), product('style-hanging', 'Hanging garments', 'rail box'), product('style-shoes', 'Shoes', 'carton'), product('style-bags', 'Bags and accessories', 'carton')];
  const line = (productId: string, quantity: number) => ({ productId, name: products.find((p) => p.id === productId)!.name, unit: products.find((p) => p.id === productId)!.unit, quantity });
  const rows = (html: string) => [...html.matchAll(/<li[^>]*>/g)].map(([tag]) => /\binvisible\b/.test(tag) ? 'held' : 'shown');

  it('keeps a row\'s place for every item, so a line added to the order never moves Place order down', () => {
    const three = draw(<OrderSummary brand="Style" products={products} lines={[line('style-folded', 5), line('style-shoes', 4), line('style-bags', 1)]} />);
    expect(rows(three)).toEqual(['shown', 'shown', 'shown', 'held']);
    expect(text(three)).toContain('Folded clothing 5 boxes Shoes 4 cartons Bags and accessories 1 carton');
    const four = draw(<OrderSummary brand="Style" products={products} lines={[line('style-folded', 5), line('style-hanging', 2), line('style-shoes', 4), line('style-bags', 1)]} />);
    expect(rows(four)).toEqual(['shown', 'shown', 'shown', 'shown']);
    // The held row is the item's own, out of sight and out of the reading order.
    expect(three).toMatch(/<li[^>]*aria-hidden="true"[^>]*>/);
  });
});
