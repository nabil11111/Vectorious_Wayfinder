import { describe, expect, it } from 'vitest';
import { boardDay } from './board-day';

// Only operating days are passed in: Sunday and the 1 May holiday are deliberately absent.
const operatingDays = [
  '2026-04-29', '2026-04-30', '2026-05-02',
  '2026-06-20', '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26', '2026-06-27',
];

describe('the day on the plan board', () => {
  it.each([
    ['2026-06-24', 15 * 60, '2026-06-25', '2026-06-24', false],
    ['2026-06-24', 16 * 60, '2026-06-25', '2026-06-24', true],
    ['2026-06-25', 3 * 60 + 29, '2026-06-25', '2026-06-24', true],
    ['2026-06-25', 3 * 60 + 30, '2026-06-26', '2026-06-25', false],
    ['2026-06-21', 10 * 60, '2026-06-22', '2026-06-20', true],
    ['2026-04-30', 17 * 60, '2026-05-02', '2026-04-30', true],
  ] as const)('AC-1 gives the board at %s, minute %i', (today, minutesNow, date, cutoffDate, open) => {
    expect(boardDay(today, minutesNow, operatingDays)).toEqual({ date, cutoffDate, open });
  });

  it('AC-1 returns no board once the final operating day has moved on', () => {
    expect(boardDay('2026-06-27', 16 * 60, operatingDays)).toBeNull();
    expect(boardDay('2026-06-28', 10 * 60, operatingDays)).toBeNull();
    expect(boardDay('2026-07-01', 0, operatingDays)).toBeNull();
  });

  it('keeps the final operating day until exactly 03:30', () => {
    expect(boardDay('2026-06-27', 0, operatingDays)).toEqual({
      date: '2026-06-27', cutoffDate: '2026-06-26', open: true,
    });
    expect(boardDay('2026-06-27', 210, operatingDays)).toBeNull();
  });

  it('opens at exactly 16:00 on the preceding operating day', () => {
    expect(boardDay('2026-06-24', 959, operatingDays)?.open).toBe(false);
    expect(boardDay('2026-06-24', 960, operatingDays)?.open).toBe(true);
    expect(boardDay('2026-06-24', 1439, operatingDays)?.open).toBe(true);
  });

  it('does not use a closed day as the board before 03:30', () => {
    expect(boardDay('2026-06-21', 0, operatingDays)).toEqual({
      date: '2026-06-22', cutoffDate: '2026-06-20', open: true,
    });
  });

  it('takes operating days in any order without changing them', () => {
    const days = [...operatingDays].reverse();
    const before = [...days];
    expect(boardDay('2026-06-24', 960, days)).toEqual({
      date: '2026-06-25', cutoffDate: '2026-06-24', open: true,
    });
    expect(days).toEqual(before);
  });

  it('returns no board without a delivery day and its preceding operating day', () => {
    expect(boardDay('2026-06-24', 960, [])).toBeNull();
    expect(boardDay('2026-06-24', 960, ['2026-06-25'])).toBeNull();
  });
});
