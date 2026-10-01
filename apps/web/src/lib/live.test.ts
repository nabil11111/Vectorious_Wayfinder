import { QueryClient } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { useLive } from './live';

const held = vi.hoisted(() => ({ effect: undefined as (() => void | (() => void)) | undefined, client: undefined as unknown }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useEffect: (effect: () => void | (() => void)) => { held.effect = effect; } }));
vi.mock('@tanstack/react-query', async original => ({ ...await original<typeof import('@tanstack/react-query')>(), useQueryClient: () => held.client }));
vi.mock('@/features/auth/api', () => ({ useMe: () => ({ data: { id: 'ruwan' } }) }));
vi.mock('sonner', () => ({ toast: vi.fn() }));

class Stream {
  static OPEN = 1;
  static CLOSED = 2;
  static current: Stream;
  readyState = 1;
  onopen = () => {};
  onerror = () => {};
  change = (_: { data: string }) => {};
  close = vi.fn();
  readonly url: string;
  constructor(url: string) { this.url = url; Stream.current = this; }
  addEventListener(_event: string, listener: (message: { data: string }) => void) { this.change = listener; }
}
let cleanup: void | (() => void);
afterEach(() => { cleanup?.(); vi.unstubAllGlobals(); });

it('AC-28 existing topics and reconnect refresh lookup while preserving normal and operations invalidations', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { refetchInterval: 60_000 } } });
  held.client = client;
  vi.stubGlobal('EventSource', Stream);
  vi.stubGlobal('window', Object.assign(new EventTarget(), { clearTimeout, setTimeout }));
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const key = ['lookup', 'orders', 'ruwan', 'Peliyagoda', { date: '2026-06-25' }];
  useLive();
  cleanup = held.effect!();
  for (const topic of ['orders', 'plans', 'loading', 'driver', 'issues', 'admin']) {
    client.setQueryData(key, {});
    invalidate.mockClear();
    Stream.current.change({ data: JSON.stringify({ topic }) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [topic] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['lookup'] });
    if (topic !== 'admin') expect(invalidate).toHaveBeenCalledWith({ queryKey: ['operations'] });
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  }
  for (const topic of ['clock', 'demo']) {
    client.setQueryData(key, {});
    Stream.current.change({ data: JSON.stringify({ topic }) });
    await Promise.resolve();
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  }
  client.setQueryData(key, {});
  Stream.current.onerror();
  Stream.current.onopen();
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getDefaultOptions().queries?.refetchInterval).toBe(60_000);
  client.clear();
});

it('AC-24 existing topics invalidate operations and keep normal invalidations', async () => {
  const client = new QueryClient();
  held.client = client;
  vi.stubGlobal('EventSource', Stream);
  vi.stubGlobal('window', Object.assign(new EventTarget(), { clearTimeout, setTimeout }));
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  useLive();
  cleanup = held.effect!();
  expect(Stream.current.url).toBe('/api/v1/events');
  for (const topic of ['plans', 'loading', 'driver', 'orders', 'issues']) {
    client.setQueryData(['operations', 'ruwan', 'Peliyagoda'], { read: topic });
    client.setQueryData([topic], {});
    invalidate.mockClear();
    Stream.current.change({ data: JSON.stringify({ topic }) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [topic] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['operations'] });
    expect(client.getQueryState(['operations', 'ruwan', 'Peliyagoda'])?.isInvalidated).toBe(true);
  }
  for (const topic of ['clock', 'demo']) {
    client.setQueryData(['operations', 'ruwan', 'Peliyagoda'], {});
    Stream.current.change({ data: JSON.stringify({ topic }) });
    await Promise.resolve();
    expect(client.getQueryState(['operations', 'ruwan', 'Peliyagoda'])?.isInvalidated).toBe(true);
  }
  client.setQueryData(['operations', 'ruwan', 'Peliyagoda'], {});
  Stream.current.onerror();
  Stream.current.onopen();
  expect(client.getQueryState(['operations', 'ruwan', 'Peliyagoda'])?.isInvalidated).toBe(true);
  client.clear();
});

it('tries the stream again as soon as the browser is back online', () => {
  held.client = new QueryClient();
  vi.stubGlobal('EventSource', Stream);
  const browser = Object.assign(new EventTarget(), { clearTimeout, setTimeout });
  vi.stubGlobal('window', browser);
  useLive();
  cleanup = held.effect!();
  const first = Stream.current;
  browser.dispatchEvent(new Event('online'));
  expect(Stream.current).toBe(first);
  first.readyState = Stream.CLOSED;
  browser.dispatchEvent(new Event('online'));
  expect(first.close).toHaveBeenCalled();
  expect(Stream.current).not.toBe(first);
  expect(Stream.current.url).toBe('/api/v1/events');
});

it('Q-28 a driver message fetches the problems again too, so a card\'s "stops left" follows the trip on Live day and the Dashboard', () => {
  const client = new QueryClient();
  held.client = client;
  vi.stubGlobal('EventSource', Stream);
  vi.stubGlobal('window', Object.assign(new EventTarget(), { clearTimeout, setTimeout }));
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  useLive();
  cleanup = held.effect!();
  // Each depot's problems are a read of their own, as on both depots together.
  for (const depot of ['Peliyagoda', 'Kandy']) client.setQueryData(['issues', depot], { issues: [] });
  Stream.current.change({ data: JSON.stringify({ topic: 'driver' }) });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['driver'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['issues'] });
  for (const depot of ['Peliyagoda', 'Kandy']) expect(client.getQueryState(['issues', depot])?.isInvalidated).toBe(true);
  client.clear();
});
