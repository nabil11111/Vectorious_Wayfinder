import { renderToStaticMarkup } from 'react-dom/server';
import { PlanBoard } from '@wayfinder/contracts';
import { describe, expect, it } from 'vitest';
import { REASON_FULL, REASON_REFUSED, reasonFits, reasonLine } from '../words';
import { DeferForm } from './DeferForm';
import { indexOf } from './lookup';

// The sentence a deferred order's shop reads (Q-11, as the shop's note does for Q-06). It takes 200 characters at
// most, as the API checks it (spec 010, rule 7). As it nears that it says how many are left, it says plainly when it is
// full, and a longer sentence is refused whole with a line, never cut without a word.

const ORDER = '00000000-0000-4000-8000-000000000001';
const BOARD = PlanBoard.parse({
  depot: 'Peliyagoda', demoDay: 1, day: { date: '2026-06-25', cutoffAt: '2026-06-24T10:30:00.000Z', open: true },
  plan: { mixBrands: false, trips: [], deferrals: [], id: null, revision: 0, status: 'draft', savedAt: null, sentAt: null, canUnsend: false },
  dropped: [], check: null,
  orders: [{
    id: ORDER, outletId: 'OUT020', temp: 'dry', deliveryDate: '2026-06-25', lines: [{ productId: 'style-bags', name: 'Bags', unit: 'box', quantity: 3 }],
    load: { kg: 30, m3: 0.3, units: 3, needsReefer: false, needsTailLift: false, keepUpright: false },
    carriedOver: false, timesDeferred: 0, lastDeferral: null, splitFrom: null, originalUnits: null,
  }],
  shops: [{ id: 'OUT020', name: 'Style Maharagama', brand: 'Style', district: 'Colombo', dockType: 'street', parking: 'normal', windowOpen: 540, windowClose: 1020, mallOpen: null, mallClose: null, unloadMin: 20 }],
  vehicles: [], drivers: [], figures: null, counts: null, suggestion: null,
});
const draw = (reason: string) => renderToStaticMarkup(
  <DeferForm orders={BOARD.orders} index={indexOf(BOARD)} code="over_capacity" reason={reason} onDefer={() => undefined} onCancel={() => undefined} />,
);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Q-11 the sentence the shop reads', () => {
  it('says how many characters are left from 40 before the end', () => {
    expect(reasonLine(159, false)).toBeNull();
    expect(reasonLine(160, false)).toEqual({ words: '40 characters left', refused: false });
    expect(reasonLine(199, false)).toEqual({ words: '1 character left', refused: false });
  });

  it('says plainly when it is full', () => {
    expect(reasonLine(200, false)).toEqual({ words: REASON_FULL, refused: false });
    expect(REASON_FULL).toBe('The sentence is full: 200 characters at most.');
  });

  it('refuses a change that would make it longer than 200 whole, with a line, and takes one that fits', () => {
    const pasted = 'The Colombo Style truck is full today with Liberty Plaza\'s weekend sale stock, so your order goes on the next run. '.repeat(2).slice(0, 225);
    expect(reasonFits(pasted)).toBe(false);
    expect(reasonFits('a'.repeat(201))).toBe(false);
    expect(reasonFits('a'.repeat(200))).toBe(true);
    expect(reasonLine(0, true)).toEqual({ words: REASON_REFUSED, refused: true });
    expect(reasonLine(200, true)).toEqual({ words: REASON_REFUSED, refused: true });
    expect(REASON_REFUSED).toBe('The sentence takes 200 characters at most, so that was not added.');
  });

  it('draws the count under the box and lets the box take any length, so the browser never cuts a paste', () => {
    const html = draw('a'.repeat(185));
    expect(html).not.toMatch(/maxlength/i);
    expect(text(html)).toContain('15 characters left');
    const line = html.match(/<p[^>]*id="([^"]+)"[^>]*>15 characters left/);
    expect(html).toMatch(new RegExp(`<textarea[^>]*aria-describedby="${line?.[1]}"`));
  });

  it('draws the full line at 200, and nothing under a short sentence', () => {
    expect(text(draw('a'.repeat(200)))).toContain(REASON_FULL);
    const short = draw('The trucks for Colombo were full.');
    expect(text(short)).not.toMatch(/characters? left|full:/);
    expect(short).not.toMatch(/aria-describedby/);
  });
});
