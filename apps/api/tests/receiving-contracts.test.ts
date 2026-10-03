import { describe, expect, it } from 'vitest';
import { ReceivingState, SaveReceivingRequest, StoreReceiving } from '@wayfinder/contracts';

describe('receiving readiness contracts (028 E)', () => {
  const write = { date: '2026-06-25', demoDay: 1, revision: 0, status: 'ready', note: 'Use the rear entrance.' };
  it('keeps readiness tied to a real date, reset generation and revision', () => {
    expect(SaveReceivingRequest.parse(write)).toEqual(write);
    for (const change of [{ date: '2026-02-30' }, { demoDay: 0 }, { revision: -1 }, { revision: 1.5 }, { status: 'closed' }, { note: 'x'.repeat(201) }]) {
      expect(SaveReceivingRequest.safeParse({ ...write, ...change }).success).toBe(false);
    }
    expect(SaveReceivingRequest.safeParse({ ...write, outletId: 'OUT002' }).success).toBe(false);
  });
  it('represents an unconfirmed shop without claiming that it is closed', () => {
    const state = { outletId: 'OUT001', date: '2026-06-25', status: 'unconfirmed', note: null, updatedAt: null, revision: 0 };
    expect(ReceivingState.parse(state)).toEqual(state);
    expect(StoreReceiving.parse({ date: state.date, demoDay: 1, state }).state?.status).toBe('unconfirmed');
    expect(StoreReceiving.parse({ date: null, demoDay: 1, state: null }).state).toBeNull();
  });
  it('trims notes and accepts clearing readiness explicitly', () => {
    expect(SaveReceivingRequest.parse({ ...write, status: 'unconfirmed', note: '  ' }).note).toBe('');
    expect(SaveReceivingRequest.parse({ ...write, status: 'unavailable' }).status).toBe('unavailable');
  });
});
