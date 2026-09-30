import { describe, expect, it } from 'vitest';
import { goingOf } from './going';

describe('what goes out of a line', () => {
  it('AC-8 is the quantity when the line has no flag', () => {
    expect(goingOf(4, null)).toBe(4);
  });

  it("AC-8 is the flag's count while the flag is open", () => {
    expect(goingOf(4, { counted: 3, decision: null })).toBe(3);
  });

  it('AC-8 is the flag\'s count after "Go short"', () => {
    expect(goingOf(4, { counted: 3, decision: 'go_short' })).toBe(3);
  });

  it('AC-8 is the quantity again after "Load it all"', () => {
    expect(goingOf(4, { counted: 3, decision: 'load_all' })).toBe(4);
  });

  it('is nothing for a line counted at 0 and sent short, and the whole line when the rest comes from stock', () => {
    expect(goingOf(4, { counted: 0, decision: null })).toBe(0);
    expect(goingOf(4, { counted: 0, decision: 'go_short' })).toBe(0);
    expect(goingOf(4, { counted: 0, decision: 'load_all' })).toBe(4);
  });
});
