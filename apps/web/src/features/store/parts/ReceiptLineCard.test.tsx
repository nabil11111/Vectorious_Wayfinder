import type { StoreDeliveryLine } from '@wayfinder/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { receiptBox, receiptCounts } from '../receipt-counts';
import { CountCard } from './ReceiptLineCard';

// The receipt's count box as Confirm delivery draws it (Q-38): what is typed stays as typed. A minus or a fraction is
// marked with the line that counts are whole numbers from 0 to what was handed over, a count above that stays too, in
// red, with a line saying so, and Confirm waits until every box is right. Kotahena's 50 chilled cartons, as phase 5 met
// them.

const kotahena: StoreDeliveryLine = {
  lineId: '9c000000-0000-4000-8000-000000000001', orderId: '9d000000-0000-4000-8000-000000000001', temp: 'chilled', productId: 'fresh-chilled-carton',
  name: 'Chilled carton', unit: 'carton', ordered: 53, loaded: 53, delivered: 50, received: null,
};
const figures = { lineId: kotahena.lineId, orderId: kotahena.orderId, temp: 'chilled' as const, expected: 50, received: null, short: 0, shortFromDepot: 0, refused: 3 };
const card = (text?: string, count = 50) => renderToStaticMarkup(
  <CountCard brand="Fresh" line={kotahena} figures={figures} count={count} text={text} reason="missing" disabled={false}
    onStep={() => {}} onType={() => {}} onLeave={() => {}} onReason={() => {}} />,
);
const stepButtons = (html: string) => [...html.matchAll(/<button[^>]*aria-label="One (?:less|more)[^>]*>/g)].map(([tag]) => tag);
const lineUnder = (html: string) => html.match(/<p[^>]*id="([^"]+)"[^>]*role="alert"[^>]*>([^<]*)<\/p>/);

describe('Q-38 the receipt\'s count box', () => {
  it('reads a whole number from 0 to what was handed over as the count, and anything else as wrong, saying which', () => {
    expect([receiptBox('0', 50), receiptBox('48', 50), receiptBox('50', 50), receiptBox('048', 50), receiptBox('', 50)])
      .toEqual([{ count: 0, wrong: null }, { count: 48, wrong: null }, { count: 50, wrong: null }, { count: 48, wrong: null }, { count: 0, wrong: null }]);
    for (const text of ['-3', '-0', '1.5', '+3', 'three', '4 8']) expect(receiptBox(text, 50)).toEqual({ count: null, wrong: 'whole' });
    for (const text of ['51', '60', '999', '1000']) expect(receiptBox(text, 50)).toEqual({ count: null, wrong: 'over' });
  });

  it('keeps a typed -3 as it is, marked, with the line that counts are whole numbers to 50, and − and + wait', () => {
    const html = card('-3');
    expect(html).toMatch(/<input[^>]*value="-3"/);
    expect(html).toMatch(/<input[^>]*aria-invalid="true"/);
    const line = lineUnder(html);
    expect(line?.[2]).toBe('Whole numbers from 0 to 50.');
    expect(html).toMatch(new RegExp(`<input[^>]*aria-describedby="${line?.[1]}"`));
    expect(stepButtons(html)).toHaveLength(2);
    expect(stepButtons(html).every((tag) => /\sdisabled=""/.test(tag))).toBe(true);
    // The count the form holds is not changed by it, so no carton is said missing.
    expect(html).not.toContain('missing');
  });

  it('keeps 60 over 50 as it is, in red, with a line saying more came than was handed over, never cut to 50', () => {
    const html = card('60');
    expect(html).toMatch(/<input[^>]*value="60"/);
    expect(html).toMatch(/<input[^>]*aria-invalid="true"/);
    expect(lineUnder(html)?.[2]).toBe('More than the 50 handed over.');
    expect(html).not.toMatch(/<input[^>]*maxlength/i);
    expect(card('999')).toMatch(/<input[^>]*value="999"/);
  });

  // L-12: Nadeesha selected 12 and typed 15. The 1 typed on the way was taken as the count, so the card said "More than
  // the 12 handed over." and "11 cartons missing" with "What's wrong?" at once.
  it('shows only its own line while the box holds an over-count, never a missing line from a digit typed on the way', () => {
    for (const [text, held] of [['60', 6], ['999', 9], ['-3', 3]] as const) {
      const html = card(text, held);
      expect(lineUnder(html)?.[2]).toBe(text === '-3' ? 'Whole numbers from 0 to 50.' : 'More than the 50 handed over.');
      expect(html).not.toContain('missing');
      expect(html).not.toContain('What’s wrong?');
    }
    // The form reports nothing for that line either, so no photo or note is asked for.
    expect(receiptCounts([{ lineId: 'a', expected: 12 }], { a: 1 }, { a: '15' })).toMatchObject({ short: false, canConfirm: false });
    expect(receiptCounts([{ lineId: 'a', expected: 12 }, { lineId: 'b', expected: 5 }], { a: 1, b: 4 }, { a: '15' })).toMatchObject({ short: true, canConfirm: false });
  });

  it('shows the count the form holds with no line when the box is right, and stops − at 0 and + at what was handed over', () => {
    for (const html of [card(undefined, 48), card('048', 48)]) {
      expect(html).not.toMatch(/aria-invalid="true"/);
      expect(lineUnder(html)).toBeNull();
    }
    expect(card(undefined, 48)).toMatch(/<input[^>]*value="48"/);
    expect(card(undefined, 48)).toContain('2 cartons missing');
    expect(stepButtons(card(undefined, 0))[0]).toMatch(/disabled=""/);
    expect(stepButtons(card(undefined, 50))[1]).toMatch(/disabled=""/);
  });

  it('keeps Confirm off while any box holds a wrong number, and counts only what the boxes hold', () => {
    const lines = [{ lineId: 'a', expected: 50 }, { lineId: 'b', expected: 62 }];
    expect(receiptCounts(lines, {}, {})).toMatchObject({ canConfirm: true, short: false });
    expect(receiptCounts(lines, { a: 48 }, { a: '048' })).toMatchObject({ canConfirm: true, short: true });
    // Mahaiyawa's 6 of 5, typed and confirmed at once: Confirm is off, and the count stays what the box last held.
    const over = receiptCounts([{ lineId: 'a', expected: 5 }], {}, { a: '6' });
    expect(over).toMatchObject({ canConfirm: false, short: false });
    expect(over.countAt(0)).toBe(5);
    expect(receiptCounts(lines, { a: 48 }, { b: '-2' }).canConfirm).toBe(false);
    expect(receiptCounts(lines, { a: 48 }, { b: '-2' }).wrongOf('b')).toBe('whole');
  });
});
