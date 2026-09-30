import { DEMO_DAY } from '@wayfinder/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { depotDate, depotInstant, depotMinutes, now, realNow, setClockForTests } from './clock';

const serverZone = process.env.TZ;
afterEach(() => {
  setClockForTests(null);
  if (serverZone === undefined) delete process.env.TZ;
  else process.env.TZ = serverZone;
});

describe('depot time', () => {
  it('AC-11 gives the depot date and time of an instant: 18:45 UTC on 24 Jun 2026 is Thu 25 Jun, 00:15', () => {
    const instant = new Date('2026-06-24T18:45:00Z');
    expect(depotDate(instant)).toBe('2026-06-25');
    expect(depotMinutes(instant)).toBe(15);
  });

  it('AC-11 gives the same answer whatever time zone the server runs in', () => {
    const instant = new Date('2026-06-24T18:45:00Z');
    for (const zone of ['UTC', 'America/New_York', 'Pacific/Kiritimati']) {
      process.env.TZ = zone;
      expect([zone, depotDate(instant), depotMinutes(instant)]).toEqual([zone, '2026-06-25', 15]);
    }
  });

  it('turns a depot date and minutes back into the instant', () => {
    expect(depotInstant('2026-06-24', 960).toISOString()).toBe('2026-06-24T10:30:00.000Z');
    expect(depotInstant('2026-06-25', 0).toISOString()).toBe('2026-06-24T18:30:00.000Z');
    // Minutes past midnight land on the next day, as a late trip's times do.
    expect(depotInstant('2026-06-24', 1450).toISOString()).toBe(depotInstant('2026-06-25', 10).toISOString());
  });

  it('agrees with the parts of the demo day in the contracts', () => {
    expect(depotInstant(DEMO_DAY.orderDay, 15 * 60)).toEqual(new Date(DEMO_DAY.parts[0].at));
    expect(depotInstant(DEMO_DAY.deliveryDay, 2 * 60 + 30)).toEqual(new Date(DEMO_DAY.parts[2].at));
    expect(depotDate(new Date(DEMO_DAY.endsAt))).toBe(DEMO_DAY.deliveryDay);
    expect(depotMinutes(new Date(DEMO_DAY.endsAt))).toBe(23 * 60 + 59);
  });

  it('goes there and back for every minute of a day', () => {
    for (let minutes = 0; minutes < 1440; minutes += 7) {
      const instant = depotInstant('2026-06-25', minutes);
      expect([depotDate(instant), depotMinutes(instant)]).toEqual(['2026-06-25', minutes]);
    }
  });

  it('refuses something that is not a date and whole minutes', () => {
    expect(() => depotInstant('25 June', 0)).toThrow();
    expect(() => depotInstant('2026-06-25', 1.5)).toThrow();
  });
});

describe('the clock in tests', () => {
  it('stays at the instant a test sets, and runs again when the test lets it go', () => {
    const saturday = depotInstant('2026-06-20', 600);
    setClockForTests(saturday);
    expect(now()).toEqual(saturday);
    expect(now()).toEqual(saturday);
    setClockForTests(null);
    expect(Math.abs(now().getTime() - realNow().getTime())).toBeLessThan(1000);
  });

  it('keeps its own copy, so changing the date a test passed in does not move the clock', () => {
    const instant = new Date('2026-06-24T09:30:00Z');
    setClockForTests(instant);
    instant.setUTCFullYear(2030);
    now().setUTCFullYear(2031);
    expect(now().toISOString()).toBe('2026-06-24T09:30:00.000Z');
  });
});
