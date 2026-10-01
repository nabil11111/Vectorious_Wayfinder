import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NOTE_FULL, NOTE_REFUSED, noteFits, noteLine } from '../words';
import { DriverNote } from './DriverNote';

// The note for the driver (Q-06). It takes 200 characters at most. As it nears that it says how many are left, it
// says plainly when it is full, and a longer note is refused whole with a line, never cut without a word.

const draw = (note: string) => renderToStaticMarkup(<DriverNote note={note} disabled={false} onChange={() => {}} />);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Q-06 the note for the driver', () => {
  it('says how many characters are left from 40 before the end', () => {
    expect(noteLine(159, false)).toBeNull();
    expect(noteLine(160, false)).toEqual({ words: '40 characters left', refused: false });
    expect(noteLine(199, false)).toEqual({ words: '1 character left', refused: false });
  });

  it('says plainly when it is full', () => {
    expect(noteLine(200, false)).toEqual({ words: NOTE_FULL, refused: false });
    expect(NOTE_FULL).toBe('The note is full: 200 characters at most.');
  });

  it('refuses a change that would make it longer than 200 whole, with a line, and takes one that fits', () => {
    const pasted = 'Badulla rear lane is narrow, so the lorry stops at the junction and the crates come in by trolley. '.repeat(3).slice(0, 230);
    expect(noteFits(pasted)).toBe(false);
    expect(noteFits('a'.repeat(201))).toBe(false);
    expect(noteFits('a'.repeat(200))).toBe(true);
    expect(noteLine(0, true)).toEqual({ words: NOTE_REFUSED, refused: true });
    expect(noteLine(200, true)).toEqual({ words: NOTE_REFUSED, refused: true });
    expect(NOTE_REFUSED).toBe('The note takes 200 characters at most, so that was not added.');
  });

  it('draws the count under the box and lets the box take any length, so the browser never cuts a paste', () => {
    const html = draw('a'.repeat(185));
    expect(html).not.toMatch(/maxlength/i);
    expect(text(html)).toContain('15 characters left');
    const line = html.match(/<p[^>]*id="([^"]+)"/);
    expect(html).toMatch(new RegExp(`<textarea[^>]*aria-describedby="${line?.[1]}"`));
  });

  it('draws the full line at 200, and nothing under a short note', () => {
    expect(text(draw('a'.repeat(200)))).toContain(NOTE_FULL);
    const short = draw('Ring the bell twice. The guard opens the gate.');
    expect(text(short)).not.toMatch(/characters? left|full/);
    expect(short).not.toMatch(/aria-describedby/);
  });
});
