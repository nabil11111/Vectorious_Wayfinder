import { describe, expect, it } from 'vitest';
import { keptTime } from './kept-time';

const at = (time: string) => new Date(`2026-06-25T${time}:00+05:30`);

describe('the time kept for a driver write', () => {
  it.each([
    ['03:45', '03:38', '03:50', '03:45'],
    ['03:52', '03:38', '03:50', '03:50'],
    ['03:30', '03:38', '03:50', '03:38'],
    ['03:38', '03:38', '03:50', '03:38'],
    ['03:50', '03:38', '03:50', '03:50'],
  ])('AC-8 keeps %s between the last event %s and server clock %s as %s', (claimed, last, now, expected) => {
    expect(keptTime(at(claimed), at(last), at(now))).toEqual(at(expected));
  });

  it('AC-8 keeps the trip last event after a stop is reopened', () => {
    expect(keptTime(at('03:40'), at('03:48'), at('03:52'))).toEqual(at('03:48'));
  });

  it.each(['03:30', '03:40', '03:55'])('never moves backwards when the server clock fell behind the last event and the phone says %s', (claimed) => {
    expect(keptTime(at(claimed), at('03:48'), at('03:38'))).toEqual(at('03:48'));
  });

  it('keeps millisecond precision and leaves its inputs alone', () => {
    const claimed = new Date('2026-06-24T22:15:00.123Z');
    const last = at('03:38');
    const now = at('03:50');
    const originals = [claimed, last, now].map(value => value.getTime());
    expect(keptTime(claimed, last, now)).toEqual(claimed);
    expect([claimed, last, now].map(value => value.getTime())).toEqual(originals);
  });
});
