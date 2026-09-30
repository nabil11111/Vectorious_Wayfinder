import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import { toMinutes } from '../planning/words';
import { orderableDay } from './orderable-day';

// The booklet's calendar, so the rows of the spec's table run on the real days: Sundays are closed, Fri 1 May
// 2026 is a holiday and the calendar ends on Sun 28 Jun 2026.
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ?? path.resolve(here, '../../../../data/shared');
const calendar: Record<string, string>[] = parse(readFileSync(path.join(dataDir, 'calendar.csv')), { columns: true, skip_empty_lines: true });
const operatingDays = calendar.filter((day) => day.is_operating === '1').map((day) => day.date!);

const dayFor = (today: string, time: string) => orderableDay(today, toMinutes(time), operatingDays);

const WED = '2026-06-24';
const THU = '2026-06-25';
const FRI = '2026-06-26';
const SAT = '2026-06-27';

describe('the day an order is for', () => {
  it('AC-1 offers the next operating day before 16:00 on an operating day', () => {
    // Wed 24 Jun, 15:59: for Thu 25 Jun, which closes today at 16:00.
    expect(dayFor(WED, '15:59')).toEqual({ deliveryDate: THU, cutoffDate: WED });
    expect(dayFor(WED, '00:00')).toEqual({ deliveryDate: THU, cutoffDate: WED });
    expect(dayFor(WED, '15:00')).toEqual({ deliveryDate: THU, cutoffDate: WED });
  });

  it('AC-2 offers the operating day after that one from 16:00', () => {
    // Wed 24 Jun, 16:00: for Fri 26 Jun, which closes on Thursday at 16:00.
    expect(dayFor(WED, '16:00')).toEqual({ deliveryDate: FRI, cutoffDate: THU });
    expect(dayFor(WED, '16:01')).toEqual({ deliveryDate: FRI, cutoffDate: THU });
    expect(dayFor(WED, '23:59')).toEqual({ deliveryDate: FRI, cutoffDate: THU });
  });

  it('AC-3 skips the closed days in between: a Sunday and the 1 May holiday', () => {
    // Sat 20 Jun, 10:00: for Mon 22 Jun, because Sunday is closed. It closes today at 16:00.
    expect(dayFor('2026-06-20', '10:00')).toEqual({ deliveryDate: '2026-06-22', cutoffDate: '2026-06-20' });
    // From 16:00 that Saturday it is Tuesday, which closes on Monday.
    expect(dayFor('2026-06-20', '16:00')).toEqual({ deliveryDate: '2026-06-23', cutoffDate: '2026-06-22' });

    // Thu 30 Apr, 10:00: for Sat 2 May, because Fri 1 May is a holiday. It closes today at 16:00.
    expect(dayFor('2026-04-30', '10:00')).toEqual({ deliveryDate: '2026-05-02', cutoffDate: '2026-04-30' });
    // From 16:00 that Thursday it is Mon 4 May: Saturday's orders have closed and Sunday is closed.
    expect(dayFor('2026-04-30', '16:00')).toEqual({ deliveryDate: '2026-05-04', cutoffDate: '2026-05-02' });

    // Sat 30 May is a holiday that still operates, so it is not skipped.
    expect(dayFor('2026-05-29', '10:00')).toEqual({ deliveryDate: '2026-05-30', cutoffDate: '2026-05-29' });
  });

  it('AC-4 offers the first day whose cut-off is still ahead when today is closed', () => {
    // Sun 21 Jun, 10:00: for Tue 23 Jun, because Monday's orders closed on Saturday. It closes on Monday.
    expect(dayFor('2026-06-21', '10:00')).toEqual({ deliveryDate: '2026-06-23', cutoffDate: '2026-06-22' });
    // The time makes no difference on a closed day.
    expect(dayFor('2026-06-21', '00:00')).toEqual({ deliveryDate: '2026-06-23', cutoffDate: '2026-06-22' });
    expect(dayFor('2026-06-21', '16:00')).toEqual({ deliveryDate: '2026-06-23', cutoffDate: '2026-06-22' });
    expect(dayFor('2026-06-21', '23:59')).toEqual({ deliveryDate: '2026-06-23', cutoffDate: '2026-06-22' });

    // On the holiday, Fri 1 May: Saturday's orders closed on Thursday, so it is Mon 4 May, which closes on Saturday.
    expect(dayFor('2026-05-01', '10:00')).toEqual({ deliveryDate: '2026-05-04', cutoffDate: '2026-05-02' });
  });

  it('AC-5 says no delivery day is open when no later operating day has an open cut-off', () => {
    // Fri 26 Jun, 16:30: Saturday's orders have closed and the calendar ends on Sun 28 Jun, which is closed.
    expect(dayFor(FRI, '16:30')).toBeNull();
    expect(dayFor(FRI, '16:00')).toBeNull();
    expect(dayFor(SAT, '10:00')).toBeNull();
    expect(dayFor('2026-06-28', '10:00')).toBeNull();
    // A day the calendar does not reach.
    expect(dayFor('2026-07-15', '10:00')).toBeNull();

    // Until 16:00 on that Friday, Saturday is the last day that can still be ordered for.
    expect(dayFor(FRI, '15:59')).toEqual({ deliveryDate: SAT, cutoffDate: FRI });
  });

  it('takes the operating days in any order and leaves the list as it was', () => {
    const days = [SAT, THU, '2026-06-22', FRI, WED, '2026-06-23'];
    const before = [...days];
    expect(orderableDay(WED, toMinutes('15:59'), days)).toEqual({ deliveryDate: THU, cutoffDate: WED });
    expect(orderableDay(WED, toMinutes('16:00'), days)).toEqual({ deliveryDate: FRI, cutoffDate: THU });
    expect(days).toEqual(before);
  });

  it('offers nothing from a calendar with no operating days', () => {
    expect(orderableDay(WED, toMinutes('10:00'), [])).toBeNull();
  });
});
