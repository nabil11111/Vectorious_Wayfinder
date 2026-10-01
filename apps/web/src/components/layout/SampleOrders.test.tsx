import { MutationObserver, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEMO_DAY, type DemoPart, type Me, type SampleOrdersPreview, type SampleOrdersResult } from '@wayfinder/contracts';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { meKey } from '@/features/auth/api';
import type { HeldClock } from '@/lib/clock';
import { Control } from './DemoClock';
import { addSampleOrdersMutation, canOrderLine, sampleAnswer } from './sample-orders';
import { SampleOrdersView, type SampleOrdersViewProps } from './SampleOrders';

// Spec 028: "Add sample shop orders" in the demo control (AC-12), its panel (AC-13) and the answer it gives.

afterEach(() => vi.unstubAllGlobals());

const Title = ({ className, children }: { className?: string; children?: ReactNode }) => <h2 className={className}>{children}</h2>;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
const buttons = (html: string) => [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, attributes, name]) => ({ name: name!.replace(/&#x27;/g, "'"), attributes: attributes! }));

const person = (role: Me['role'], depotId: string | null = 'Peliyagoda'): Me => ({ id: 'u1', username: 'x', staffId: 'X-001', displayName: 'X', role, depotId, outletId: null });
const clockIn = (part: DemoPart): HeldClock => {
  const index = DEMO_DAY.parts.findIndex((p) => p.key === part);
  const next = DEMO_DAY.parts[index + 1];
  return { demo: true, now: DEMO_DAY.parts[index]!.at, part, holdsAt: null, next: next ? { part: next.key, at: next.at } : null, revision: 0, day: 1, heldAt: 0 };
};
function control(me: Me, part: DemoPart) {
  const qc = new QueryClient();
  qc.setQueryData(meKey, me);
  const state = clockIn(part);
  return renderToStaticMarkup(<QueryClientProvider client={qc}><Control state={state} at={Date.parse(state.now)} waiting={false} Title={Title} /></QueryClientProvider>);
}

describe('the control (AC-12)', () => {
  it('shows "Add sample shop orders" to the dispatcher while orders are open, above the reset', () => {
    const names = buttons(control(person('dispatcher'), 'ordering')).map((b) => b.name);
    expect(names).toEqual(['Next: Orders closed, 16:00', 'Add sample shop orders', 'Reset the demo day']);
    expect(buttons(control(person('dispatcher', 'Both'), 'ordering')).map((b) => b.name)).toContain('Add sample shop orders');
  });

  it('shows it in no other part of the day and to no other role', () => {
    for (const part of ['planning', 'loading', 'on_the_road', 'delivered'] as const) {
      expect([part, control(person('dispatcher'), part).includes('Add sample shop orders')]).toEqual([part, false]);
    }
    for (const role of ['store_manager', 'loader', 'driver'] as const) {
      expect([role, control(person(role), 'ordering').includes('Add sample shop orders')]).toEqual([role, false]);
    }
    expect(control(person('admin', null), 'ordering')).not.toContain('Add sample shop orders');
  });
});

const PREVIEW: SampleOrdersPreview = { deliveryDate: '2026-06-25', depots: [{ depotId: 'Peliyagoda', shops: 75, canOrder: 10 }] };
const view = (props: Partial<SampleOrdersViewProps> = {}) => renderToStaticMarkup(
  <SampleOrdersView Title={Title} depot="Peliyagoda" deliveryDate="2026-06-25" preview={PREVIEW} choice={10} onChoose={() => undefined}
    placing={false} result={undefined} problem={null} onPlace={() => undefined} onBack={() => undefined} {...props} />,
);

describe('the panel (AC-13)', () => {
  it('says what a press does and for which depot, how many shops may order, and offers the three choices', () => {
    const html = view();
    expect(text(html)).toBe([
      'Add sample shop orders',
      'Each shop places its own order for Thu 25 Jun, as if its manager pressed Place. At Peliyagoda.',
      "10 of Peliyagoda's 75 shops have not ordered yet.",
      "10 shops 25 shops Every shop that hasn't ordered",
      'When the shops that have not ordered run out, 10 and 25 shops go on with small top-ups from shops that already ordered.',
      'Place the orders Back',
    ].join(' '));
    expect(html).toContain('role="radiogroup" aria-label="How many shops"');
    expect(buttons(html).filter((b) => b.attributes.includes('role="radio"')).map((b) => [b.name, b.attributes.includes('aria-checked="true"')]))
      .toEqual([['10 shops', true], ['25 shops', false], ["Every shop that hasn't ordered", false]]);
    expect(buttons(view({ choice: 'all' })).find((b) => b.name === "Every shop that hasn't ordered")!.attributes).toContain('aria-checked="true"');
  });

  it('on Both names both depots and counts each', () => {
    const both = view({ depot: 'Both', preview: { deliveryDate: '2026-06-25', depots: [{ depotId: 'Peliyagoda', shops: 75, canOrder: 10 }, { depotId: 'Kandy', shops: 45, canOrder: 2 }] } });
    expect(text(both)).toContain('At Peliyagoda and Kandy, that many at each.');
    expect(text(both)).toContain("10 of Peliyagoda's 75 shops have not ordered yet. 2 of Kandy's 45 shops have not ordered yet.");
  });

  it('while placing says so and takes no second press, and a refusal shows its sentence', () => {
    const placing = buttons(view({ placing: true }));
    expect(placing.map((b) => b.name)).toContain('Placing…');
    expect(placing.find((b) => b.name === 'Placing…')!.attributes).toContain('aria-disabled="true"');
    expect(placing.find((b) => b.name === 'Back')!.attributes).toContain('disabled');
    const refused = view({ problem: 'Sample orders can be added only while orders are open, before 16:00.' });
    expect(refused).toContain('role="alert"');
    expect(text(refused)).toContain('Sample orders can be added only while orders are open, before 16:00.');
  });

  it('after the press shows the answer for each depot and Done', () => {
    const result: SampleOrdersResult = { deliveryDate: '2026-06-25', depots: [
      { depotId: 'Peliyagoda', orders: 10, newOrders: 10, outletIds: Array.from({ length: 10 }, (_, i) => `OUT0${i + 10}`), topUpIds: [], alreadyHad: 65, cannotOrder: 0 },
      { depotId: 'Kandy', orders: 10, newOrders: 2, outletIds: ['OUT090', 'OUT120'], topUpIds: Array(8).fill('OUT076'), alreadyHad: 43, cannotOrder: 0 },
    ] };
    const html = view({ result });
    expect(text(html)).toBe('Sample shop orders Placed 10 orders from 10 shops at Peliyagoda; 65 shops already had an order or a draft. '
      + 'Placed 10 orders at Kandy: 2 from shops that hadn\'t ordered, 8 top-ups. Done');
    expect(html.match(/role="status"/g)).toHaveLength(2);
  });
});

describe('the answer line', () => {
  const depot = { depotId: 'Peliyagoda', orders: 41, newOrders: 41, outletIds: Array(25).fill('OUT'), topUpIds: [] as string[], alreadyHad: 3, cannotOrder: 0 };
  it('says how many orders from how many shops and how many already had one', () => {
    expect(sampleAnswer(depot, '2026-06-25')).toBe('Placed 41 orders from 25 shops at Peliyagoda; 3 shops already had an order or a draft.');
    expect(sampleAnswer({ ...depot, orders: 1, outletIds: ['OUT015'], alreadyHad: 1 }, '2026-06-25')).toBe('Placed 1 order from 1 shop at Peliyagoda; 1 shop already had an order or a draft.');
    expect(sampleAnswer({ ...depot, alreadyHad: 0 }, '2026-06-25')).toBe('Placed 41 orders from 25 shops at Peliyagoda.');
    expect(sampleAnswer({ ...depot, cannotOrder: 2 }, '2026-06-25')).toBe('Placed 41 orders from 25 shops at Peliyagoda; 3 shops already had an order or a draft; 2 shops had no account or nothing to order.');
  });

  it('counts the top-ups apart when the free shops ran out', () => {
    const topped = { ...depot, orders: 25, newOrders: 10, outletIds: Array(10).fill('OUT'), topUpIds: Array(15).fill('OUT'), alreadyHad: 65 };
    expect(sampleAnswer(topped, '2026-06-25')).toBe("Placed 25 orders at Peliyagoda: 10 from shops that hadn't ordered, 15 top-ups.");
    expect(sampleAnswer({ ...topped, orders: 1, newOrders: 0, outletIds: [], topUpIds: ['OUT002'] }, '2026-06-25'))
      .toBe("Placed 1 order at Peliyagoda: 0 from shops that hadn't ordered, 1 top-up.");
  });

  it('says so when nothing was placed', () => {
    expect(sampleAnswer({ ...depot, orders: 0, outletIds: [], alreadyHad: 75 }, '2026-06-25')).toBe('Every shop at Peliyagoda already has an order or a draft for Thu 25 Jun. Nothing was placed.');
    expect(sampleAnswer({ ...depot, orders: 0, outletIds: [], alreadyHad: 74, cannotOrder: 1 }, '2026-06-25'))
      .toBe('Nothing was placed at Peliyagoda: 74 shops already had an order or a draft; 1 shop had no account or nothing to order.');
    expect(canOrderLine({ depotId: 'Kandy', shops: 45, canOrder: 0 })).toBe('Every shop at Kandy has ordered already.');
    expect(canOrderLine({ depotId: 'Kandy', shops: 45, canOrder: 1 })).toBe("1 of Kandy's 45 shops has not ordered yet.");
  });
});

describe('the press', () => {
  it('posts the choice and has the orders, look-ups and dashboard fetched again', async () => {
    const qc = new QueryClient();
    const result: SampleOrdersResult = { deliveryDate: '2026-06-25', depots: [] };
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json(result))));
    const invalidated = vi.spyOn(qc, 'invalidateQueries');
    expect(await new MutationObserver(qc, addSampleOrdersMutation(qc)).mutate(25)).toEqual(result);
    expect(fetch).toHaveBeenCalledWith('/api/v1/demo/sample-orders', expect.objectContaining({ method: 'POST', body: JSON.stringify({ shops: 25 }) }));
    expect(invalidated.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([['orders'], ['lookup'], ['operations'], ['plans']]);
  });
});
