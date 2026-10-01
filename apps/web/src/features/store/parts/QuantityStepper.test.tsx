import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QUANTITY_LINE } from '../words';
import { QuantityStepper, type QuantityBox } from './QuantityStepper';

// The quantity box as the order form draws it (Q-01, Q-02): what is typed stays as typed, and anything but a whole
// number from 0 to 999 is marked, with the line under it.

const box = (value: number, text?: string): QuantityBox => ({ value, text, onStep: () => {}, onType: () => {}, onLeave: () => {} });
const draw = (quantity: QuantityBox) => renderToStaticMarkup(<div className="flex flex-wrap"><QuantityStepper name="Chilled cartons" size="lg" box={quantity} /></div>);
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>/g)].map(([tag]) => tag);

describe('Q-01 and Q-02 the quantity box', () => {
  it('shows a typed -5 as it is, marked, with the line under it, and − and + wait until it is fixed', () => {
    const html = draw(box(8, '-5'));
    expect(html).toMatch(/<input[^>]*value="-5"/);
    expect(html).toMatch(/<input[^>]*aria-invalid="true"/);
    const line = html.match(/<p[^>]*id="([^"]+)"[^>]*>([^<]*)<\/p>/);
    expect(line?.[2]).toBe(QUANTITY_LINE);
    expect(html).toMatch(new RegExp(`<input[^>]*aria-describedby="${line?.[1]}"`));
    expect(buttons(html).every((tag) => /\sdisabled=""/.test(tag))).toBe(true);
  });

  it('shows 99999 and 1.5 whole, never cut to 999 or rounded to 2', () => {
    expect(draw(box(8, '99999'))).toMatch(/<input[^>]*value="99999"/);
    expect(draw(box(8, '1.5'))).toMatch(/<input[^>]*value="1.5"/);
    expect(draw(box(8, '99999'))).not.toMatch(/<input[^>]*maxlength/i);
  });

  it('shows the number the form holds with no line when the box is right', () => {
    for (const html of [draw(box(8)), draw(box(8, '08'))]) {
      expect(html).not.toContain(QUANTITY_LINE);
      expect(html).not.toMatch(/aria-invalid="true"/);
      expect(buttons(html).some((tag) => /\sdisabled=""/.test(tag))).toBe(false);
    }
    expect(draw(box(8))).toMatch(/<input[^>]*value="8"/);
    expect(draw(box(8, '08'))).toMatch(/<input[^>]*value="08"/);
  });

  it('stops − at 0 and + at 999', () => {
    const [less] = buttons(draw(box(0)));
    expect(less).toMatch(/disabled=""/);
    const [, more] = buttons(draw(box(999)));
    expect(more).toMatch(/disabled=""/);
  });
});
