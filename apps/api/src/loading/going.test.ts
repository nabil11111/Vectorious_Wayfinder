import { describe, expect, it } from 'vitest';
import { goingOf, wontFitOf } from './going';

describe('what goes out of a line', () => {
  it('AC-8 is the quantity when the line has no flag', () => {
    expect(goingOf(4, null)).toBe(4);
  });

  it("AC-8 is the flag's count while the flag is open", () => {
    expect(goingOf(4, { counted: 3, decision: null, reason: 'short' })).toBe(3);
  });

  it('AC-8 is the flag\'s count after "Go short"', () => {
    expect(goingOf(4, { counted: 3, decision: 'go_short', reason: 'short' })).toBe(3);
  });

  it('AC-8 is the quantity again after "Load it all"', () => {
    expect(goingOf(4, { counted: 3, decision: 'load_all', reason: 'short' })).toBe(4);
  });

  it('is nothing for a line counted at 0 and sent short, and the whole line when the rest comes from stock', () => {
    expect(goingOf(4, { counted: 0, decision: null, reason: 'short' })).toBe(0);
    expect(goingOf(4, { counted: 0, decision: 'go_short', reason: 'short' })).toBe(0);
    expect(goingOf(4, { counted: 0, decision: 'load_all', reason: 'short' })).toBe(4);
  });
});

it('L-09 counts the units a "won\'t fit" flag leaves behind, and none for a short one or after "Load it all"', () => {
  expect(wontFitOf(4, { counted: 3, decision: 'go_short', reason: 'wont_fit' })).toBe(1);
  expect(wontFitOf(4, { counted: 3, decision: null, reason: 'wont_fit' })).toBe(1);
  expect(wontFitOf(4, { counted: 3, decision: 'load_all', reason: 'wont_fit' })).toBe(0);
  expect(wontFitOf(4, { counted: 3, decision: 'go_short', reason: 'short' })).toBe(0);
  expect(wontFitOf(4, null)).toBe(0);
});
