import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ToConfirmCard } from './ToConfirmCard';

// Q-35: Kotahena's chilled cartons came on VEH035 and its dry ones on VEH038, and a manager who confirmed the first was
// never told the second waited. Today lists what still waits, as the server words it, each opening its delivery.

const STOP = (n: number) => `9b000000-0000-4000-8000-00000000000${n}`;

describe('Q-35 the deliveries still to confirm on Today', () => {
  it('says how many wait and links each one to its delivery', () => {
    const html = renderToStaticMarkup(<MemoryRouter><ToConfirmCard toConfirm={{ title: '2 deliveries to confirm', deliveries: [
      { stopId: STOP(1), line: '50 chilled cartons · Delivered 03:34 · VEH035 · Dilshan' },
      { stopId: STOP(2), line: '57 dry cartons · Delivered 04:07 · VEH038 · Lahiru' },
    ] }} /></MemoryRouter>);
    expect(html).toContain('2 deliveries to confirm');
    expect(html).toMatch(new RegExp(`href="/store/deliveries/${STOP(1)}"[^>]*>.*50 chilled cartons · Delivered 03:34 · VEH035 · Dilshan`));
    expect(html).toMatch(new RegExp(`href="/store/deliveries/${STOP(2)}"[^>]*>.*57 dry cartons · Delivered 04:07 · VEH038 · Lahiru`));
    expect(html.match(/>Confirm</g)).toHaveLength(2);
  });

  it('shows nothing when the server sends nothing to confirm', () => {
    expect(renderToStaticMarkup(<MemoryRouter><ToConfirmCard toConfirm={null} /></MemoryRouter>)).toBe('');
  });
});
