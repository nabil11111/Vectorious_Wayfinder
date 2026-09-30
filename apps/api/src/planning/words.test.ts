import { describe, expect, it } from 'vitest';
import { kg, litres, m3, orderCalled, toClock, toMinutes } from './words';

describe('how the checker writes times and amounts', () => {
  it('reads a time of day as minutes after midnight and back', () => {
    expect(toMinutes('03:30')).toBe(210);
    expect(toClock(210)).toBe('03:30');
    expect(toClock(474)).toBe('07:54');
  });

  it('never wraps a time past midnight', () => {
    expect(toClock(1450)).toBe('24:10');
  });

  it('refuses something that is not a time of day', () => {
    expect(() => toMinutes('half past three')).toThrow();
  });

  it('writes amounts with a thousands comma and no trailing zeros', () => {
    expect(kg(1242)).toBe('1,242 kg');
    expect(kg(331.2)).toBe('331.2 kg');
    expect(m3(22.8)).toBe('22.8 m³');
    expect(m3(1.776)).toBe('1.776 m³');
    expect(litres(63.6)).toBe('63.6 litres');
  });

  it('calls an order by its weight, whether it is chilled and its shop', () => {
    // A Fresh shop has a chilled and a dry order most days, so "an order for the shop" would not say which.
    expect(orderCalled(276, true, 'Fresh Nugegoda')).toBe('276 kg chilled order for Fresh Nugegoda');
    expect(orderCalled(331.2, false, 'Fresh Nugegoda')).toBe('331.2 kg dry order for Fresh Nugegoda');
    // It has no "a" or "an" in front, because 800 kg would need the other one. A sentence says "the".
    expect(orderCalled(800, false, 'Tech Galle')).toBe('800 kg dry order for Tech Galle');
  });
});
