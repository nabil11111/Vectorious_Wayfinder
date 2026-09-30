import { describe, expect, it } from 'vitest';
import { loaderDay } from './loader-day';

// Only operating days are passed in, as the calendar has them: Sun 21 Jun, Sun 28 Jun and the 1 May holiday are
// left out, and Sat 27 Jun is the last operating day.
const operatingDays = [
  '2026-04-29', '2026-04-30', '2026-05-02',
  '2026-06-19', '2026-06-20', '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26', '2026-06-27',
];

describe("the loader's day", () => {
  it.each([
    ['2026-06-24', 15 * 60 + 59, '2026-06-24'],
    ['2026-06-24', 16 * 60, '2026-06-25'],
    ['2026-06-25', 2 * 60 + 30, '2026-06-25'],
    ['2026-06-25', 15 * 60 + 59, '2026-06-25'],
    ['2026-06-25', 16 * 60, '2026-06-26'],
    ['2026-06-20', 16 * 60, '2026-06-22'],
    ['2026-06-21', 10 * 60, '2026-06-22'],
    ['2026-04-30', 17 * 60, '2026-05-02'],
  ] as const)('AC-1 at %s, minute %i, is %s', (today, minutesNow, day) => {
    expect(loaderDay(today, minutesNow, operatingDays)).toBe(day);
  });

  it('AC-1 is none once no operating day is left in the calendar', () => {
    expect(loaderDay('2026-06-27', 16 * 60, operatingDays)).toBeNull();
    expect(loaderDay('2026-06-28', 10 * 60, operatingDays)).toBeNull();
    expect(loaderDay('2026-06-25', 0, [])).toBeNull();
  });

  it('keeps an operating day from its midnight until one minute before 16:00', () => {
    expect(loaderDay('2026-06-25', 0, operatingDays)).toBe('2026-06-25');
    expect(loaderDay('2026-06-27', 15 * 60 + 59, operatingDays)).toBe('2026-06-27');
  });

  it('takes operating days in any order without changing them', () => {
    const days = [...operatingDays].reverse();
    const before = [...days];
    expect(loaderDay('2026-06-24', 16 * 60, days)).toBe('2026-06-25');
    expect(days).toEqual(before);
  });
});
