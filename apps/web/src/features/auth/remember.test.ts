import { afterEach, describe, expect, it, vi } from 'vitest';
import { REMEMBER_KEY, keepStaffId, rememberedStaffId, type StaffIdStorage } from './remember';

// Remember my staff ID (spec 018, rule 6, AC-9): only the staff ID, only on this device, written only after a sign-in
// that worked. Storage that throws or is empty never stops a sign-in.

function memory(): StaffIdStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); },
    removeItem: (key) => { entries.delete(key); },
  };
}

const broken = (): StaffIdStorage => {
  const fail = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
  return { getItem: fail, setItem: fail, removeItem: fail };
};

describe('AC-9 Remember my staff ID', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fills the staff ID in on the next visit after a ticked sign-in', () => {
    const storage = memory();
    keepStaffId('P-001', true, () => storage);
    expect(rememberedStaffId(() => storage)).toBe('P-001');
  });

  it('forgets it after an unticked sign-in', () => {
    const storage = memory();
    keepStaffId('P-001', true, () => storage);
    keepStaffId('P-001', false, () => storage);
    expect(rememberedStaffId(() => storage)).toBe('');
  });

  it('keeps the staff ID alone under one key, and never a PIN', () => {
    const storage = memory();
    keepStaffId('D-014', true, () => storage);
    expect([...storage.entries]).toEqual([[REMEMBER_KEY, 'D-014']]);
  });

  it('fills in nothing when nothing is kept', () => {
    expect(rememberedStaffId(() => memory())).toBe('');
  });

  it('never stops a sign-in when the storage throws on read or write', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(rememberedStaffId(broken)).toBe('');
    expect(() => keepStaffId('P-001', true, broken)).not.toThrow();
    expect(() => keepStaffId('P-001', false, broken)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('never stops a sign-in when the browser refuses the storage itself', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const refused = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
    expect(rememberedStaffId(refused)).toBe('');
    expect(() => keepStaffId('P-001', true, refused)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
