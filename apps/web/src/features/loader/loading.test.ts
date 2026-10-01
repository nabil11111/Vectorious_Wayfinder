import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Q-22: a flag that got no answer stays on the phone's screen until it is sent again, and the form knows it is still
// waiting at the moment the loader tries to leave. The loader's writes are run as a screen runs them, outside React:
// its state is kept in plain cells and its effects run at once.

const hooks = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: <T,>(initial: T | (() => T)) => [typeof initial === 'function' ? (initial as () => T)() : initial, () => {}],
  useRef: <T,>(value: T) => ({ current: value }),
  useEffect: (effect: () => void) => { effect(); },
}));
vi.mock('@tanstack/react-query', async (original) => ({ ...await original<typeof import('@tanstack/react-query')>(), useQueryClient: () => hooks.client }));

const TRIP = '0b000000-0000-4000-8000-000000000004';
const FLAG = { revision: 7, stopId: '0d000000-0000-4000-8000-000000000002', reason: 'damaged' as const, lines: [{ lineId: '0e000000-0000-4000-8000-000000000064', counted: 62 }], note: 'Two cartons crushed' };
const DAY = { depot: 'Peliyagoda', demoDay: 1, day: '2026-06-25', plan: null, trucks: [] };

beforeEach(() => {
  hooks.client = new QueryClient();
  // The day fetched again after a write waits no longer than a write does. Here the fetch answers first, so that
  // limit is never reached and its timer is not set.
  vi.stubGlobal('window', { setTimeout: () => 0, clearTimeout: () => {}, dispatchEvent: () => true });
});
afterEach(() => vi.unstubAllGlobals());

it('Q-22 holds a flag that got no answer until it is sent again, with the same id, and lets it go before the form moves on', async () => {
  const sent = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(Response.json(DAY));
  vi.stubGlobal('fetch', sent);
  const { useLoaderWrites } = await import('./loading');
  const writes = useLoaderWrites();
  let heldWhenDone: boolean | null = null;

  expect(writes.holding('flag')).toBe(false);
  writes.send(TRIP, { kind: 'flag', body: FLAG }, () => { heldWhenDone = writes.holding('flag'); });
  expect(writes.holding('flag')).toBe(true);
  await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
  await new Promise((settled) => setTimeout(settled, 0));
  // No answer: the flag waits for Try again, and leaving the form now would lose it.
  expect(writes.holding('flag')).toBe(true);
  expect(writes.holding('stop')).toBe(false);

  writes.retry();
  await vi.waitFor(() => expect(heldWhenDone).toBe(false));
  expect(writes.holding('flag')).toBe(false);
  const ids = sent.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).writeId);
  expect(ids[0]).toBe(ids[1]);
});

it('Q-22 lets a refused flag go: the server has said why, and the form shows it', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: 'already_flagged', message: 'The 64 dry cartons for Fresh Akuressa are already flagged.' } }, { status: 409 })));
  const { useLoaderWrites } = await import('./loading');
  const writes = useLoaderWrites();
  writes.send(TRIP, { kind: 'flag', body: FLAG });
  await vi.waitFor(() => expect(writes.holding('flag')).toBe(false));
});
