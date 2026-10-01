import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { StoreNextOrder, StoreOrder, StoreProduct } from '@wayfinder/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { nextOrderKey } from './next-order';
import { OrdersPlacedPage } from './OrdersPlacedPage';

// The confirmation after a place (Q-03): it names what was just placed with its own time, and says apart any order
// placed earlier for the same day, with that order's own time. Drawn once from what the cache holds, as the
// browser gets it after the form hands over the orders its place answered with.

const THU = '2026-06-25';
// Depot time is five and a half hours ahead of UTC: 09:25, 15:05 and 15:37 on Wed 24 Jun.
const AT_0925 = '2026-06-24T03:55:00.000Z';
const AT_1505 = '2026-06-24T09:35:00.000Z';
const AT_1537 = '2026-06-24T10:07:00.000Z';

const item = (id: string, name: string, unit: string, temp: 'chilled' | 'dry' = 'dry'): StoreProduct => ({ id, name, unit, kgPerUnit: 12, m3PerUnit: 0.2, temp, needsTailLift: false });
const STYLE = [item('style-folded', 'Folded clothing', 'box'), item('style-hanging', 'Hanging garments', 'rail box'), item('style-shoes', 'Shoes', 'carton'), item('style-bags', 'Bags and accessories', 'carton')];
const FRESH = [item('fresh-chilled-carton', 'Chilled carton', 'carton', 'chilled'), item('fresh-dry-carton', 'Dry carton', 'carton')];

let made = 0;
function order(products: StoreProduct[], placedAt: string, quantities: Record<string, number>, temp: 'chilled' | 'dry' = 'dry'): StoreOrder {
  made += 1;
  const lines = products.filter((p) => quantities[p.id]).map((p) => ({ productId: p.id, name: p.name, unit: p.unit, quantity: quantities[p.id]! }));
  return {
    id: `00000000-0000-4000-8000-${String(made).padStart(12, '0')}`, deliveryDate: THU, scheduledDate: null, temp, status: 'placed', lines,
    units: lines.reduce((sum, line) => sum + line.quantity, 0), placedAt, deferralReason: null, delivery: null, receipt: null, problems: [], replacementFor: null,
  };
}

// The next order as the API answers it: everything placed for Thursday, its lines added together per item, and the
// latest placed time.
function nextOrder(brand: 'Style' | 'Fresh', products: StoreProduct[], placed: StoreOrder[]): StoreNextOrder {
  const lines = products.flatMap((p) => {
    const quantity = placed.flatMap((o) => o.lines).filter((l) => l.productId === p.id).reduce((sum, l) => sum + l.quantity, 0);
    return quantity ? [{ productId: p.id, name: p.name, unit: p.unit, quantity }] : [];
  });
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  return {
    outlet: { id: brand === 'Style' ? 'OUT017' : 'OUT001', name: brand === 'Style' ? 'Style Liberty Plaza' : 'Fresh Nugegoda', brand, windowOpen: '10:30', windowClose: '12:30', dockType: 'mall_bay' },
    products, deliveryDate: THU, cutoffAt: '2026-06-24T10:30:00.000Z', cutoffIsToday: true, movedFrom: null, draft: null,
    placed: { orders: placed, lines, lastPlacedAt: placed.map((o) => o.placedAt!).sort().at(-1)!, summary: { kg: units * 12, m3: units * 0.2, units, needsReefer: false, needsTailLift: false, keepUpright: false } },
  };
}

function draw(next: StoreNextOrder, placedOrders?: StoreOrder[]) {
  const client = new QueryClient();
  client.setQueryData(nextOrderKey, next);
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: '/store/orders/placed', state: placedOrders ? { placedOrders } : null }]}>
        <OrdersPlacedPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  client.clear();
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

describe('Q-03 a second order for the same day', () => {
  const first = order(STYLE, AT_0925, { 'style-folded': 50, 'style-hanging': 45, 'style-shoes': 25, 'style-bags': 15 });
  const second = order(STYLE, AT_1537, { 'style-folded': 10, 'style-hanging': 6, 'style-shoes': 3 });
  const next = nextOrder('Style', STYLE, [first, second]);

  it('confirms the 19 boxes just placed, with their own time, and never adds the earlier order into them', () => {
    const text = draw(next, [second]);
    expect(text).toContain('Your order is placed');
    expect(text).not.toContain('2 orders');
    expect(text).toContain('Folded clothing 10 boxes');
    expect(text).toContain('Hanging garments 6 rail boxes');
    expect(text).toContain('Shoes 3 cartons');
    for (const added of ['60 boxes', '51 rail boxes', '28 cartons', 'Bags and accessories 15']) expect(text).not.toContain(added);
    expect(text).toContain('The depot has received your request.');
    expect(text).toContain('Submission confirmation · 15:37');
  });

  it('says the 09:25 order apart, with its own time, never stamped 15:37', () => {
    const text = draw(next, [second]);
    expect(text).toContain('Placed earlier for Thursday 135 boxes 09:25');
    expect(text).not.toContain('Submission confirmation · 09:25');
  });

  it('opened from Today with no place in hand, shows the day’s orders, each with its own time, and calls none just placed', () => {
    const text = draw(next);
    expect(text).toContain('Your 2 orders are placed');
    expect(text).toContain('135 boxes placed 09:25 Folded clothing 50 boxes Hanging garments 45 rail boxes Shoes 25 cartons Bags and accessories 15 cartons');
    expect(text).toContain('19 boxes placed 15:37 Folded clothing 10 boxes Hanging garments 6 rail boxes Shoes 3 cartons');
    expect(text).toContain('The depot has received both requests.');
    for (const claim of ['Submission confirmation', 'Placed earlier', '60 boxes']) expect(text).not.toContain(claim);
  });

  it('confirms a Fresh place of two orders together, as the frame draws it, with nothing earlier', () => {
    const chilled = order(FRESH, AT_1505, { 'fresh-chilled-carton': 8 }, 'chilled');
    const dry = order(FRESH, AT_1505, { 'fresh-dry-carton': 4 });
    const text = draw(nextOrder('Fresh', FRESH, [chilled, dry]), [chilled, dry]);
    expect(text).toContain('Your 2 orders are placed');
    expect(text).toContain('Chilled 8 cartons Dry 4 cartons');
    expect(text).toContain('The depot has received both requests.');
    expect(text).not.toContain('Placed earlier');
    expect(text).toContain('Submission confirmation · 15:05');
  });

  it('keeps an earlier Fresh order apart from a later place of two', () => {
    const early = order(FRESH, AT_0925, { 'fresh-chilled-carton': 12 }, 'chilled');
    const chilled = order(FRESH, AT_1537, { 'fresh-chilled-carton': 8 }, 'chilled');
    const dry = order(FRESH, AT_1537, { 'fresh-dry-carton': 4 });
    const text = draw(nextOrder('Fresh', FRESH, [early, chilled, dry]), [chilled, dry]);
    expect(text).toContain('Your 2 orders are placed');
    expect(text).toContain('Chilled 8 cartons Dry 4 cartons');
    expect(text).not.toContain('Chilled 20 cartons');
    expect(text).toContain('Placed earlier for Thursday 12 chilled cartons 09:25');
    expect(text).toContain('Submission confirmation · 15:37');
  });
});

describe('Q-03 places made while the demo clock waits at 15:59:59', () => {
  // Every order placed then has the same time, so a place is told apart only by the orders its answer named.
  const AT_HOLD = '2026-06-24T10:29:59.000Z';
  const first = order(STYLE, AT_HOLD, { 'style-folded': 50, 'style-hanging': 45, 'style-shoes': 25, 'style-bags': 15 });
  const second = order(STYLE, AT_HOLD, { 'style-folded': 10, 'style-hanging': 6, 'style-shoes': 3 });
  const next = nextOrder('Style', STYLE, [first, second]);

  it('confirms the place by the orders its answer named, and says the other apart', () => {
    const text = draw(next, [second]);
    expect(text).toContain('Your order is placed');
    expect(text).toContain('Folded clothing 10 boxes Hanging garments 6 rail boxes Shoes 3 cartons');
    expect(text).not.toContain('60 boxes');
    expect(text).toContain('Placed earlier for Thursday 135 boxes 15:59');
  });

  it('opened from Today, shows the two orders apart and never as one place', () => {
    const text = draw(next);
    expect(text).toContain('135 boxes placed 15:59');
    expect(text).toContain('19 boxes placed 15:59');
    for (const claim of ['Submission confirmation', 'Placed earlier', '60 boxes', 'Your order is placed']) expect(text).not.toContain(claim);
  });

  it('opened from Today, shows a Fresh day of one chilled and one dry order with each order’s own time and item', () => {
    const chilled = order(FRESH, AT_HOLD, { 'fresh-chilled-carton': 8 }, 'chilled');
    const dry = order(FRESH, AT_HOLD, { 'fresh-dry-carton': 4 });
    const text = draw(nextOrder('Fresh', FRESH, [chilled, dry]));
    expect(text).toContain('Your 2 orders are placed');
    expect(text).toContain('8 chilled cartons placed 15:59 Chilled 8 cartons 4 dry cartons placed 15:59 Dry 4 cartons');
    expect(text).not.toContain('Submission confirmation');
  });

  it('opened from Today, names the item of an order of one item, with its quantity and unit', () => {
    const TECH = [item('tech-tv', 'Televisions', 'pallet of 8'), item('tech-washer', 'Washing machines', 'crate of 3'), item('tech-fridge', 'Refrigerators', 'crate of 2')];
    const fridges = order(TECH, AT_HOLD, { 'tech-fridge': 2 });
    const tech = { ...nextOrder('Style', TECH, [fridges]), outlet: { id: 'OUT064', name: 'Tech Matara', brand: 'Tech' as const, windowOpen: '09:00', windowClose: '11:00', dockType: 'rear_dock' as const } };
    const text = draw(tech);
    expect(text).toContain('Your order is placed');
    expect(text).toContain('2 items placed 15:59 Refrigerators 2 crates of 2');
  });
});
