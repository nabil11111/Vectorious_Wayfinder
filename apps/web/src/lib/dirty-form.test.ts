import { describe, expect, it } from 'vitest';
import { hasFormEdits } from './dirty-form';

describe('unsent form input', () => {
  it('does not ask for an untouched form', () => {
    expect(hasFormEdits({})).toBe(false);
    expect(hasFormEdits({ counts: {}, typed: {}, reasons: {}, note: '', cold: true, photo: null })).toBe(false);
  });
  it('protects quantities including invalid text, individual reasons, cold answers, notes and photos', () => {
    for (const draft of [{ counts: { a: 0 } }, { typed: { a: '-1' } }, { reasons: { a: 'damaged' } },
      { cold: false }, { note: ' ' }, { photo: { data: 'photo' } }, { reason: 'damaged' }]) {
      expect(hasFormEdits(draft)).toBe(true);
    }
  });
});
