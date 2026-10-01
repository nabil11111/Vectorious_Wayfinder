import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConfirmButton } from './ReceiptForm';

// L-11: while a count box held -2, 15 or 20, Nadeesha's Confirm delivery did nothing when pressed but kept its full
// orange, since it stays focusable while off and the grey matched only the disabled attribute. Off, it takes the app's
// grey whichever way it is off; sending, it keeps its orange with "Sending…".

const button = (props: { held: boolean; sending: boolean }) => renderToStaticMarkup(<ConfirmButton {...props} onConfirm={() => {}} />).match(/<button[^>]*>[^<]*<\/button>/)![0];
const classes = (html: string) => html.match(/class="([^"]*)"/)![1]!.split(' ');

describe('L-11 Confirm delivery while a count is wrong', () => {
  it('looks off while it waits for the counts, as every orange button that is off does', () => {
    const html = button({ held: true, sending: false });
    expect(html).toMatch(/aria-disabled="true"/);
    expect(html).toMatch(/data-disabled=""/);
    // The marks it carries while off are the ones that turn it grey.
    expect(classes(html)).toEqual(expect.arrayContaining(['data-disabled:bg-border', 'data-disabled:text-muted-foreground/65', 'data-disabled:pointer-events-none']));
    expect(classes(html)).not.toContain('data-disabled:bg-primary');
    expect(html).toContain('>Confirm delivery<');
  });

  it('keeps its orange with "Sending…" while the receipt goes, and is plain orange when it can go', () => {
    const sending = button({ held: true, sending: true });
    expect(sending).toContain('>Sending…<');
    expect(classes(sending)).toEqual(expect.arrayContaining(['data-disabled:bg-primary', 'data-disabled:text-primary-foreground']));
    expect(classes(sending)).not.toContain('data-disabled:bg-border');
    const ready = button({ held: false, sending: false });
    expect(ready).not.toMatch(/data-disabled=""|aria-disabled="true"/);
  });
});
