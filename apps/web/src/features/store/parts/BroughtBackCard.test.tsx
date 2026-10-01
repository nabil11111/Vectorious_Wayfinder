import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BroughtBackCard } from './BroughtBackCard';

// L-14: Fresh Wellawatte was closed when Wasantha came, and Ruwan answered "Bring them back". Its chilled order left
// "Coming today", and nothing on Today said the 48 chilled cartons did not come or what happens to them. Today says it,
// as the server words it.

const ORDER = (n: number) => `9d000000-0000-4000-8000-00000000000${n}`;

describe('L-14 an order brought back from a closed shop on Today', () => {
  it('says what happened to each order brought back, as the server words it', () => {
    const html = renderToStaticMarkup(<BroughtBackCard broughtBack={{ title: 'Not coming today', orders: [
      { orderId: ORDER(1), line: '48 chilled cartons brought back to the depot · waiting for the next plan' },
      { orderId: ORDER(2), line: '46 dry cartons brought back to the depot · planned for Fri 26 Jun' },
    ] }} />);
    expect(html).toContain('Not coming today');
    expect(html).toContain('48 chilled cartons brought back to the depot · waiting for the next plan');
    expect(html).toContain('46 dry cartons brought back to the depot · planned for Fri 26 Jun');
  });

  it('shows nothing when no order was brought back', () => {
    expect(renderToStaticMarkup(<BroughtBackCard broughtBack={null} />)).toBe('');
  });
});
