import { MutationObserver, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import type { Me } from '@wayfinder/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { logoutMutation, meKey, takeAccount } from '@/features/auth/api';
import { AppShell } from './AppShell';

vi.mock('@/lib/clock', () => ({ useAppClock: () => ({ time: '03:30' }) }));
vi.mock('@/lib/live', () => ({ useLive: vi.fn() }));
vi.mock('./DemoClock', () => ({ DemoClock: () => null }));
vi.mock('@/features/notifications/Bell', () => ({ NotificationBell: () => null }));
const me: Me = { id: 'driver', username: 'driver', staffId: 'K-001', displayName: 'Driver', role: 'driver', depotId: 'Kandy', outletId: null };
const draw = (qc: QueryClient) => renderToStaticMarkup(<QueryClientProvider client={qc}><MemoryRouter><AppShell>Trip</AppShell></MemoryRouter></QueryClientProvider>);
beforeEach(() => {
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout: (run: () => void, ms: number) => setTimeout(run, ms), clearTimeout: (timer: number) => clearTimeout(timer) }));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('shows a failed logout from a form hook even when the avatar menu is closed', async () => {
  const qc = new QueryClient(); qc.setQueryData(meKey, me);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'unavailable', message: 'Wayfinder is temporarily unavailable.' } }, { status: 503 })));
  const formLogout = new MutationObserver(qc, logoutMutation(qc));
  await formLogout.mutate().catch(() => undefined);
  expect(qc.getQueryData(meKey)).toEqual(me);
  expect(draw(qc)).toContain('Sign-out could not be confirmed');
  expect(draw(qc)).toContain('Wayfinder is temporarily unavailable.');
  expect(draw(qc)).toContain('Try again');
  // An error belonging to another account must not be shown after identity changes.
  takeAccount(qc, { ...me, id: 'other' });
  expect(draw(qc)).not.toContain('Sign-out could not be confirmed');
  qc.clear();
});

it('shows the bounded logout timeout while retaining the account and clears it during a retry', async () => {
  vi.useFakeTimers();
  const qc = new QueryClient(); qc.setQueryData(meKey, me);
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
  })));
  const formLogout = new MutationObserver(qc, logoutMutation(qc));
  const outcome = formLogout.mutate().catch(error => error);
  await vi.advanceTimersByTimeAsync(15_000);
  await outcome;
  expect(qc.getQueryData(meKey)).toEqual(me);
  expect(draw(qc)).toContain('Sign-out could not be confirmed');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  await formLogout.mutate();
  expect(qc.getQueryData(meKey)).toBeNull();
  expect(draw(qc)).not.toContain('Sign-out could not be confirmed');
  qc.clear();
});
