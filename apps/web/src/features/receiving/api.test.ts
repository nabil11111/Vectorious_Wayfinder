import { MutationObserver, QueryClient } from '@tanstack/react-query';
import type { Me } from '@wayfinder/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { meKey } from '@/features/auth/api';
import { clockKey } from '@/lib/clock';
import { receivingMutation, receivingKey } from './api';
const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
const me = { id: 'manager-one', outletId: 'OUT001', role: 'store_manager', depotId: null } as Me;
const held = { date: '2026-06-25', demoDay: 1, state: { outletId: 'OUT001', date: '2026-06-25', status: 'unconfirmed' as const, revision: 0, note: null, updatedAt: null } };
const qc = () => { const q = new QueryClient(); q.setQueryData(meKey, me); q.setQueryData(clockKey, { demoDay: 1, now: '2026-06-25T04:00:00Z', heldAt: performance.now(), holdsAt: null }); return q; };
afterEach(() => { vi.clearAllMocks(); vi.stubGlobal('navigator', { onLine: true }); });
it('refuses offline readiness immediately and never pauses or sends it on reconnect', async () => {
  vi.stubGlobal('navigator', { onLine: false }); const q = qc(); const mutation = new MutationObserver(q, receivingMutation(q, me, held));
  await expect(mutation.mutate({ status: 'ready', note: '' })).rejects.toThrow('offline');
  expect(mutation.getCurrentResult().isPaused).toBe(false); expect(fetch).not.toHaveBeenCalled();
});
it('captures the manager account and dated revision in the direct write', async () => {
  fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...held, state: { ...held.state, status: 'ready', revision: 1 } }) });
  const q = qc(); const mutation = new MutationObserver(q, receivingMutation(q, me, held));
  await mutation.mutate({ status: 'ready', note: 'Rear door' });
  const init = fetch.mock.calls[0]![1];
  expect(init.headers['X-Wayfinder-Account']).toBe(me.id);
  expect(JSON.parse(init.body)).toEqual({ date: held.date, demoDay: 1, revision: 0, status: 'ready', note: 'Rear door' });
});
it('refuses before sending after an account, date, or reset change', async () => {
  for (const changed of ['account', 'date', 'reset']) {
    const q = qc(); const mutation = new MutationObserver(q, receivingMutation(q, me, held));
    if (changed === 'account') q.setQueryData(meKey, { ...me, id: 'manager-two' });
    else q.setQueryData(clockKey, { now: changed === 'date' ? '2026-06-26T04:00:00Z' : '2026-06-25T04:00:00Z', demoDay: changed === 'reset' ? 2 : 1, heldAt: performance.now(), holdsAt: null });
    await expect(mutation.mutate({ status: 'ready', note: '' })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  }
});
it('discards a late acknowledgement after switching accounts', async () => {
  let resolve!: (value: unknown) => void;
  fetch.mockImplementation(() => new Promise(done => { resolve = done; }));
  const q = qc(); const key = receivingKey(me, held.date, held.demoDay); q.setQueryData(key, held);
  const mutation = new MutationObserver(q, receivingMutation(q, me, held)); const sent = mutation.mutate({ status: 'ready', note: '' });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled()); q.setQueryData(meKey, { ...me, id: 'manager-two' });
  resolve({ ok: true, status: 200, json: async () => ({ ...held, state: { ...held.state, status: 'ready', revision: 1 } }) });
  await expect(sent).rejects.toThrow(); expect(q.getQueryData(key)).toEqual(held);
});
