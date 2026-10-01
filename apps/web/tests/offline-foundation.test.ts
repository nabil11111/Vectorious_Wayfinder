import { QueryClient, QueryObserver } from '@tanstack/react-query';
import type { ClockState, Me } from '@wayfinder/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type CapturedQuery = {
  queryKey: readonly unknown[];
  queryFn: (context: { signal: AbortSignal; queryKey: readonly unknown[]; client: QueryClient }) => Promise<unknown>;
  initialData?: unknown | (() => unknown);
  networkMode?: string;
};
type CapturedMutation = {
  onMutate?: (...args: unknown[]) => unknown;
  onSuccess?: (...args: unknown[]) => unknown;
};
const hooks = vi.hoisted(() => ({
  client: undefined as QueryClient | undefined,
  queries: [] as CapturedQuery[],
  mutations: [] as CapturedMutation[],
  cleanups: [] as (() => void)[],
}));

// Exercise the real persistence, API requests and query cache without rendering a page. Effects run once when
// the captured hook is called, and all registrations are removed at the end of each test.
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { const cleanup = effect(); if (cleanup) hooks.cleanups.push(cleanup); },
  useState: (initial: unknown | (() => unknown)) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
}));
vi.mock('@tanstack/react-query', async original => ({
  ...await original<typeof import('@tanstack/react-query')>(),
  useQueryClient: () => hooks.client!,
  useQuery: (options: CapturedQuery) => {
    hooks.queries.push(options);
    if (!hooks.client!.getQueryState(options.queryKey) && options.initialData !== undefined) {
      const data = typeof options.initialData === 'function' ? options.initialData() : options.initialData;
      if (data !== undefined) hooks.client!.setQueryData(options.queryKey, data);
    }
    return { data: hooks.client!.getQueryData(options.queryKey), isError: false, isFetching: false, refetch: vi.fn() };
  },
  useMutation: (options: CapturedMutation) => { hooks.mutations.push(options); return options; },
}));

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

const ACCOUNT_KEY = 'wayfinder-account';
const CLOCK_KEY = 'wayfinder-clock';
const dilshan: Me = { id: 'driver-dilshan', username: 'dilshan', staffId: 'D-001', displayName: 'Dilshan', role: 'driver', depotId: 'Peliyagoda', outletId: null };
const chaminda: Me = { ...dilshan, id: 'driver-chaminda', username: 'chaminda', staffId: 'D-003', displayName: 'Chaminda' };
const clock: ClockState = { demo: true, now: '2026-06-24T22:00:00.000Z', part: 'on_the_road', holdsAt: '2026-06-25T02:59:59.000Z',
  next: { part: 'delivered', at: '2026-06-25T03:00:00.000Z' }, revision: 4, day: 1 };
let storage: MemoryStorage;
let client: QueryClient;

beforeEach(() => {
  vi.resetModules();
  storage = new MemoryStorage();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  hooks.client = client;
  hooks.queries.length = 0;
  hooks.mutations.length = 0;
  hooks.cleanups.length = 0;
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setInterval: vi.fn(() => 1), clearInterval: vi.fn(), setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() }));
});
afterEach(() => {
  for (const cleanup of hooks.cleanups.splice(0).reverse()) cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const query = (key: string) => hooks.queries.findLast(options => options.queryKey[0] === key)!;
const mutation = () => hooks.mutations.at(-1)!;
const fetchQuery = (options: CapturedQuery) => client.fetchQuery({ queryKey: options.queryKey,
  queryFn: context => options.queryFn(context), retry: false });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function deferredFetch() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  // Deliberately ignores AbortSignal, like a response already delivered by the transport before cancellation.
  const fetch = vi.fn(() => promise);
  vi.stubGlobal('fetch', fetch);
  return { fetch, resolve };
}

describe('the account kept for offline startup', () => {
  it('restores the account synchronously and attempts requests even while the browser is offline', async () => {
    storage.setItem(ACCOUNT_KEY, JSON.stringify(dilshan));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network unavailable')));
    const auth = await import('../src/features/auth/api');
    expect(auth.useMe().data).toEqual(dilshan);
    expect(query('me').networkMode).toBe('always');
    await expect(fetchQuery(query('me'))).rejects.toThrow('Network unavailable');
    expect(client.getQueryData(['me'])).toEqual(dilshan);
    expect(JSON.parse(storage.getItem(ACCOUNT_KEY)!)).toEqual(dilshan);
  });

  it('an API 401 clears both cached and persisted identity without deleting account-owned waiting data', async () => {
    storage.setItem(ACCOUNT_KEY, JSON.stringify(dilshan));
    storage.setItem('account-owned-waiting-record', 'still waiting');
    client.setQueryData(['me'], dilshan);
    const auth = await import('../src/features/auth/api');
    auth.useMe();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: { code: 'signed_out', message: 'Sign in again.' } }, 401)));
    const { api } = await import('../src/lib/api');
    await expect(api('/driver')).rejects.toMatchObject({ status: 401, code: 'signed_out' });
    await flush();
    expect(storage.getItem(ACCOUNT_KEY)).toBeNull();
    expect(client.getQueryData(['me'])).toBeNull();
    expect(storage.getItem('account-owned-waiting-record')).toBe('still waiting');
  });

  it('in the driver\'s area a 401 keeps the account, kept and cached, and elsewhere it still signs out', async () => {
    storage.setItem(ACCOUNT_KEY, JSON.stringify(dilshan));
    client.setQueryData(['me'], dilshan);
    const auth = await import('../src/features/auth/api');
    auth.useMe();
    const leave = auth.keepAccountThroughSignOut();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: { code: 'signed_out', message: 'Sign in again.' } }, 401)));
    const { api } = await import('../src/lib/api');
    await expect(api('/driver')).rejects.toMatchObject({ status: 401, code: 'signed_out' });
    await expect(fetchQuery(query('me'))).resolves.toEqual(dilshan);
    await flush();
    expect(JSON.parse(storage.getItem(ACCOUNT_KEY)!)).toEqual(dilshan);
    expect(client.getQueryData(['me'])).toEqual(dilshan);

    leave();
    await expect(api('/driver')).rejects.toMatchObject({ status: 401 });
    await flush();
    expect(storage.getItem(ACCOUNT_KEY)).toBeNull();
    expect(client.getQueryData(['me'])).toBeNull();
  });

  it('signing out tells the screens on show that the account is gone, so they leave the page', async () => {
    storage.setItem(ACCOUNT_KEY, JSON.stringify(dilshan));
    const auth = await import('../src/features/auth/api');
    client.setQueryData(['me'], dilshan);
    const seen: unknown[] = [];
    const stop = new QueryObserver(client, { queryKey: ['me'], enabled: false }).subscribe(result => seen.push(result.data));
    auth.useLogout();
    await mutation().onSuccess?.(undefined, undefined, undefined, { client });
    stop();
    expect(seen.at(-1)).toBeNull();
  });

  it('signing in drops everything the last account read', async () => {
    storage.setItem(ACCOUNT_KEY, JSON.stringify(dilshan));
    const auth = await import('../src/features/auth/api');
    client.setQueryData(['me'], dilshan);
    client.setQueryData(['orders', 'deliveries', 'stop-1'], { stopId: 'stop-1' });
    auth.useLogin();
    await mutation().onSuccess?.(chaminda, { staffId: 'D-003', pin: '1234' }, undefined, { client });
    expect(client.getQueryData(['orders', 'deliveries', 'stop-1'])).toBeUndefined();
    expect(client.getQueryData(['me'])).toEqual(chaminda);
  });

  it.each(['logout', 'login'] as const)('a cancelled account read cannot restore old identity after %s', async action => {
    storage.setItem(ACCOUNT_KEY, JSON.stringify(dilshan));
    const pending = deferredFetch();
    const auth = await import('../src/features/auth/api');
    auth.useMe();
    const request = fetchQuery(query('me')).catch(error => error);
    await flush();
    expect(pending.fetch).toHaveBeenCalledOnce();

    if (action === 'logout') auth.useLogout();
    else auth.useLogin();
    const callbacks = mutation();
    const variables = action === 'login' ? { staffId: 'D-003', pin: '1234' } : undefined;
    const context = await callbacks.onMutate?.(variables, { client });
    await callbacks.onSuccess?.(action === 'login' ? chaminda : undefined, variables, context, { client });
    pending.resolve(response(dilshan));
    await request;
    await flush();

    if (action === 'logout') {
      expect(storage.getItem(ACCOUNT_KEY)).toBeNull();
      expect(client.getQueryData(['me']) ?? null).toBeNull();
    } else {
      expect(JSON.parse(storage.getItem(ACCOUNT_KEY)!)).toEqual(chaminda);
      expect(client.getQueryData(['me'])).toEqual(chaminda);
    }
  });
});

describe('the clock kept for offline startup', () => {
  it.each([
    [30_000, '2026-06-24T22:00:30.000Z'],
    [24 * 60 * 60_000, '2026-06-25T02:59:59.000Z'],
    [-30_000, '2026-06-24T22:00:00.000Z'],
  ])('counts the saved clock on by %i device milliseconds without passing its hold or going backwards', async (elapsed, expected) => {
    const deviceAt = 1_800_000_000_000;
    storage.setItem(CLOCK_KEY, JSON.stringify({ clock, deviceAt }));
    vi.spyOn(Date, 'now').mockReturnValue(deviceAt + elapsed);
    vi.spyOn(performance, 'now').mockReturnValue(100);
    const clocks = await import('../src/lib/clock');
    const shown = clocks.useAppClock();
    expect(shown.state?.now).toBe(expected);
    expect(shown.at).toBe(Date.parse(expected));
    expect(query('clock').networkMode).toBe('always');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network unavailable')));
    await expect(fetchQuery(query('clock'))).rejects.toThrow('Network unavailable');
    expect(client.getQueryData(['clock'])).toMatchObject({ now: expected, revision: clock.revision });
  });

  it('a cancelled late clock read cannot replace the persisted state returned by reset', async () => {
    storage.setItem(CLOCK_KEY, JSON.stringify({ clock, deviceAt: Date.now() }));
    const pending = deferredFetch();
    const clocks = await import('../src/lib/clock');
    clocks.useAppClock();
    const request = fetchQuery(query('clock')).catch(error => error);
    await flush();
    expect(pending.fetch).toHaveBeenCalledOnce();
    clocks.useResetDay();
    const reset: ClockState = { ...clock, now: '2026-06-24T09:30:00.000Z', part: 'ordering', holdsAt: '2026-06-24T10:29:59.000Z',
      next: { part: 'planning', at: '2026-06-24T10:30:00.000Z' }, revision: clock.revision + 1, day: clock.day + 1 };
    await mutation().onSuccess?.(reset, undefined, undefined, { client });
    pending.resolve(response(clock));
    await request;
    await flush();
    expect(JSON.parse(storage.getItem(CLOCK_KEY)!).clock).toEqual(reset);
    expect(client.getQueryData(['clock'])).toMatchObject(reset);
  });
});
