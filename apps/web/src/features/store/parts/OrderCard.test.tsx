import type { StoreOrder, StoreOutlet } from '@wayfinder/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { OrderCard } from './OrderCard';

// The shop's order card as Kotahena's chilled order read in phase 5 (Q-36): a refusal answered with replacements and a
// report answered with none. Each problem's line is the server's, naming its cartons, and the card lays it out as sent.

const kotahena: StoreOutlet = { id: 'OUT005', name: 'Fresh Kotahena', brand: 'Fresh', windowOpen: '05:00', windowClose: '07:30', dockType: 'street' };
const id = (n: number) => `9c000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const chilled: StoreOrder = {
  id: id(1), deliveryDate: '2026-06-25', scheduledDate: '2026-06-25', temp: 'chilled', status: 'received',
  lines: [{ productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', quantity: 53 }], units: 53, placedAt: '2026-06-24T09:30:00.000Z', deferralReason: null,
  delivery: { stopId: id(2), vehicleId: 'VEH035', driver: 'Dilshan', arrivedAt: '2026-06-24T22:00:00.000Z', doneAt: '2026-06-24T22:08:00.000Z', outcome: 'refused', late: false,
    delivered: 50, shortFromDepot: 0, refused: 3, refusalReason: 'expired' },
  receipt: { at: '2026-06-25T03:10:00.000Z', sentAt: '2026-06-25T03:10:00.000Z', units: 48, short: 5 },
  problems: [
    { id: id(3), kind: 'refused', units: 3, decision: 'send_replacements', replacementDay: '2026-06-26', line: '3 expired chilled cartons: replacements come on Fri 26 Jun' },
    { id: id(4), kind: 'receipt', units: 2, decision: 'no_replacement', replacementDay: null, line: '2 missing chilled cartons: no replacement' },
  ],
  replacementFor: null, broughtBack: false,
};

describe('Q-36 a card\'s answer lines', () => {
  it('shows each problem\'s line as the server words it, in order, with nothing added', () => {
    for (const look of ['today', 'past'] as const) {
      const text = renderToStaticMarkup(<MemoryRouter><OrderCard order={chilled} outlet={kotahena} look={look} /></MemoryRouter>);
      const at = (line: string) => text.indexOf(`>${line}<`);
      expect(at('3 expired chilled cartons: replacements come on Fri 26 Jun')).toBeGreaterThan(-1);
      expect(at('2 missing chilled cartons: no replacement')).toBeGreaterThan(at('3 expired chilled cartons: replacements come on Fri 26 Jun'));
      expect(text).not.toContain('No replacement is coming.');
      expect(text).not.toContain('3 replacements come on Fri 26 Jun.');
    }
  });
});

// Q-41: Fresh Mulgampola's 39 chilled cartons after "Bring them back", as Orders shows them, and once the next plan
// takes them.
const mulgampola: StoreOutlet = { id: 'OUT083', name: 'Fresh Mulgampola', brand: 'Fresh', windowOpen: '04:00', windowClose: '07:45', dockType: 'street' };
const broughtBack: StoreOrder = {
  ...chilled, id: id(5), scheduledDate: '2026-06-25', status: 'placed', units: 39, receipt: null, broughtBack: true,
  lines: [{ productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', quantity: 39 }],
  delivery: { stopId: id(6), vehicleId: 'VEH057', driver: 'Nuwan', arrivedAt: '2026-06-24T22:20:00.000Z', doneAt: '2026-06-24T22:21:00.000Z', outcome: 'closed', late: false,
    delivered: null, shortFromDepot: 0, refused: 0, refusalReason: null },
  problems: [{ id: id(7), kind: 'closed', units: 39, decision: 'bring_back', replacementDay: null, line: '39 chilled cartons: brought back to the depot, waiting for the next plan' }],
};

describe('Q-41 a brought-back order', () => {
  it('names no day while it waits for the next plan, only its window, the closed shop and that it was brought back', () => {
    const text = renderToStaticMarkup(<MemoryRouter><OrderCard order={broughtBack} outlet={mulgampola} look="open" /></MemoryRouter>);
    expect(text).toContain('Waiting for the delivery plan');
    expect(text).toContain('>04:00–07:45 · street<');
    expect(text).not.toContain('Thu 25 Jun');
    expect(text).toContain('Nobody at the shop at 03:50 · VEH057');
    expect(text).toContain('39 chilled cartons: brought back to the depot, waiting for the next plan');
    // An order placed for a day still names its day.
    expect(renderToStaticMarkup(<MemoryRouter><OrderCard order={{ ...broughtBack, broughtBack: false, delivery: null, problems: [] }} outlet={mulgampola} look="open" /></MemoryRouter>))
      .toContain('>Thu 25 Jun · 04:00–07:45 · street<');
  });
});
