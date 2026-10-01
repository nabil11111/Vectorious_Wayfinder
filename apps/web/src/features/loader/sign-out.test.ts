import { MutationObserver, QueryClient } from '@tanstack/react-query';
import type { Me } from '@wayfinder/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { logoutMutation, meKey, signOutUnlessAsked } from '@/features/auth/api';
import { useLoaderWrites, type LoaderWrites } from './loading';
import { useAsksBeforeSignOut } from './unsent';

// Q-22, signing out: a flag that is not sent holds Sign out the way it holds leaving the form, and the form asks first.
// The flag form is run as React runs it while it is on screen: the loader's own writes, its question handed to sign-out
// when it mounts and taken back when it goes. Sign out goes through the entry point the avatar menu presses, into the
// same sign-out every role uses, with every request it sends.

const hooks = vi.hoisted(() => ({ client: undefined as unknown, cleanups: [] as (() => void)[] }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: <T,>(initial: T | (() => T)) => [typeof initial === 'function' ? (initial as () => T)() : initial, () => {}],
  useRef: <T,>(value: T) => ({ current: value }),
  useEffect: (effect: () => void | (() => void)) => { const cleanup = effect(); if (cleanup) hooks.cleanups.push(cleanup); },
}));
vi.mock('@tanstack/react-query', async (original) => ({ ...await original<typeof import('@tanstack/react-query')>(), useQueryClient: () => hooks.client }));

const KASUN: Me = { id: 'kasun', username: 'kasun', staffId: 'L-001', displayName: 'Kasun', role: 'loader', depotId: 'Peliyagoda', outletId: null };
const TRIP = '0b000000-0000-4000-8000-000000000004';
const FLAG = { revision: 7, stopId: '0d000000-0000-4000-8000-000000000002', reason: 'damaged' as const, lines: [{ lineId: '0e000000-0000-4000-8000-000000000064', counted: 62 }], note: 'Two cartons crushed' };
const DAY = { depot: 'Peliyagoda', demoDay: 1, day: '2026-06-25', plan: null, trucks: [], left: [] };
const settled = () => new Promise((done) => setTimeout(done, 0));

let qc: QueryClient;
let sent: string[];
// The flag's first send gets no answer, as with no signal; every later request is answered.
let signal: boolean;
beforeEach(() => {
  qc = new QueryClient();
  qc.setQueryData(meKey, KASUN);
  hooks.client = qc;
  hooks.cleanups = [];
  sent = [];
  signal = false;
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout: () => 0, clearTimeout: () => {} }));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    sent.push(url);
    if (url.endsWith('/flags') && !signal) throw new TypeError('Failed to fetch');
    return url.endsWith('/auth/logout') ? new Response(null, { status: 204 }) : Response.json(DAY);
  }));
  // With no browser storage here, forgetting the kept account only warns.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  for (const cleanup of hooks.cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The flag form as it mounts: its writes, and its question handed to sign-out, which asks through `ask`.
function useFlagForm(ask: () => void) {
  const writes = useLoaderWrites();
  useAsksBeforeSignOut(() => writes.holding('flag'), ask);
  return writes;
}
// The form's flag sent with no signal, until it shows "Not saved".
async function sendUnanswered(writes: LoaderWrites) {
  writes.send(TRIP, { kind: 'flag', body: FLAG });
  await vi.waitFor(() => expect(sent).toEqual([`/api/v1/loading/trips/${TRIP}/flags`]));
  await settled();
  expect(writes.holding('flag')).toBe(true);
}
const loggedOut = () => sent.filter((url) => url.endsWith('/auth/logout')).length;
// Sign out from the avatar menu, into the sign-out every role uses.
function pressSignOut() {
  const observer = new MutationObserver(qc, logoutMutation(qc));
  return { observer, started: signOutUnlessAsked(() => { void observer.mutate(); }) };
}

it('Q-22 asks before signing out while a flag is not sent, keeps the account, and Sign out anyway signs out', async () => {
  const ask = vi.fn();
  await sendUnanswered(useFlagForm(ask));
  const { observer, started } = pressSignOut();
  expect(started).toBe(false);
  await settled();
  expect(ask).toHaveBeenCalledOnce();
  expect(loggedOut()).toBe(0);
  expect(qc.getQueryData(meKey)).toEqual(KASUN);

  // Sign out anyway: the same sign-out, without asking.
  await observer.mutate();
  expect(loggedOut()).toBe(1);
  expect(qc.getQueryData(meKey)).toBeNull();
});

it('Q-22 signs out at once once the flag has gone, by Try again', async () => {
  const ask = vi.fn();
  const writes = useFlagForm(ask);
  await sendUnanswered(writes);
  signal = true;
  writes.retry();
  await vi.waitFor(() => expect(writes.holding('flag')).toBe(false));
  expect(pressSignOut().started).toBe(true);
  await vi.waitFor(() => expect(loggedOut()).toBe(1));
  expect(ask).not.toHaveBeenCalled();
});

it('Q-22 no longer asks once the form has gone from the screen', async () => {
  const ask = vi.fn();
  await sendUnanswered(useFlagForm(ask));
  for (const cleanup of hooks.cleanups.splice(0)) cleanup();
  expect(pressSignOut().started).toBe(true);
  await vi.waitFor(() => expect(loggedOut()).toBe(1));
  expect(ask).not.toHaveBeenCalled();
});
