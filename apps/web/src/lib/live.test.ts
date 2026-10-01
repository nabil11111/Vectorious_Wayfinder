import { QueryClient } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { useLive } from './live';

const held = vi.hoisted(() => ({ effect: undefined as (() => void | (() => void)) | undefined, client: undefined as unknown }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useEffect: (effect: () => void | (() => void)) => { held.effect = effect; } }));
vi.mock('@tanstack/react-query', async original => ({ ...await original<typeof import('@tanstack/react-query')>(), useQueryClient: () => held.client }));
vi.mock('@/features/auth/api', () => ({ useMe: () => ({ data: { id: 'ruwan' } }) }));
vi.mock('sonner', () => ({ toast: vi.fn() }));

class Stream {
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

it('AC-24 existing topics invalidate operations and keep normal invalidations', async () => {
  const client = new QueryClient();
  held.client = client;
  vi.stubGlobal('EventSource', Stream);
  vi.stubGlobal('window', { clearTimeout, setTimeout });
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
