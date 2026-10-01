import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PlacedElsewhere } from './NewOrderPage';

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
