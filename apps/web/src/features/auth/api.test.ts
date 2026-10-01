import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query';
import type { LoginRequest, Me } from '@wayfinder/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attemptSignIn, loginMutation } from './api';
import { FAILURE_LINE, failureOf } from './words';

// The sign-in request as the page sends it (spec 018). With no network it fails at once into the No signal line and
// sends nothing later on its own, and once an attempt has settled no cache still holds its PIN.

const BODY: LoginRequest = { staffId: 'P-001', pin: '1234' };
const RUWAN: Me = { id: 'u1', username: 'ruwan', staffId: 'P-001', displayName: 'Ruwan', role: 'dispatcher', depotId: 'd1', outletId: null };

const later = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

// The page's sign-in, on the same options and the same client calls as useLogin.
function signInPage() {
  const qc = new QueryClient();
  const observer = new MutationObserver(qc, loginMutation(qc));
  const login = { mutateAsync: (body: LoginRequest) => observer.mutate(body), reset: () => observer.reset() };
  return { qc, observer, attempt: () => attemptSignIn(login, BODY) };
}

// The mutation cache's entries that still hold the PIN, once the cache has had its turn to drop settled ones.
async function entriesWithThePin(qc: QueryClient) {
  await later(0, null);
  return qc.getMutationCache().getAll().filter((mutation) => JSON.stringify(mutation.state.variables ?? null).includes(BODY.pin));
}

describe('AC-8 a sign-in with no network', () => {
  afterEach(() => {
    onlineManager.setOnline(true);
    vi.unstubAllGlobals();
  });

  it('fails at once into the No signal line, and sends nothing when the network comes back', async () => {
    onlineManager.setOnline(false);
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetch);
    const { qc, attempt } = signInPage();
    const line = attempt().then(() => 'signed in', (error: unknown) => FAILURE_LINE[failureOf(error)]);
    expect(await Promise.race([line, later(50, 'still checking')])).toBe(FAILURE_LINE.noSignal);
    const sentOffline = fetch.mock.calls.length;
    expect(sentOffline).toBe(1);

    onlineManager.setOnline(true);
    await later(50, null);
    expect(fetch).toHaveBeenCalledTimes(sentOffline);
    expect(await entriesWithThePin(qc)).toEqual([]);
  });
});

describe('the PIN once a sign-in attempt has settled', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is in no cache entry after a wrong staff ID or PIN', async () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'bad_credentials', message: "Staff ID or PIN isn't correct. Try again." } }, { status: 401 })));
    const { qc, observer, attempt } = signInPage();
    await expect(attempt()).rejects.toMatchObject({ code: 'bad_credentials' });
    expect(await entriesWithThePin(qc)).toEqual([]);
    expect(observer.getCurrentResult().variables).toBeUndefined();
  });

  it('is in no cache entry after a sign-in that works', async () => {
    // With no browser storage here, keeping the signed-in account only warns.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(RUWAN)));
    const { qc, observer, attempt } = signInPage();
    await expect(attempt()).resolves.toMatchObject({ staffId: 'P-001' });
    expect(await entriesWithThePin(qc)).toEqual([]);
    expect(observer.getCurrentResult().variables).toBeUndefined();
  });
});
