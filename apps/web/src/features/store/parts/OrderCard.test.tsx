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
  replacementFor: null,
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
