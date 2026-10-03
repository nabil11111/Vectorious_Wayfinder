import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { type ClockState, type Me, type StoreReceiving } from '@wayfinder/contracts';
import type { ComponentProps, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { meKey } from '@/features/auth/api';
import { clockKey } from '@/lib/clock';
import { receivingKey, receivingListOptions } from './api';
import { ReceivingCard } from './ReceivingCard';
import { ReceivingListPanel } from './ReceivingListPanel';
const state = vi.hoisted(() => ({ online: true, query: null as unknown, retry: null as null | (() => void), retryDisabled: false }));
vi.mock('./api', async original => {
  const lib = await original<typeof import('./api')>();
  return { ...lib, useStoreReceiving: () => state.query ? { query: state.query, me } : lib.useStoreReceiving() };
});
vi.mock('@/components/ui/button', async original => {
  const lib = await original<typeof import('@/components/ui/button')>();
  return { ...lib, Button: (props: ComponentProps<typeof lib.Button>) => {
    if (props.children === 'Read again') { state.retryDisabled = Boolean(props.disabled); state.retry = () => props.onClick?.({} as never); }
    return <lib.Button {...props} />;
  } };
});
vi.mock('@/features/live/operations', async original => ({ ...await original<typeof import('@/features/live/operations')>(), useOnline: () => state.online }));
const me = { id: '01000000-0000-4000-8000-000000000001', displayName: 'Manager', role: 'store_manager', outletId: 'OUT001', depotId: null } as Me;
const CLOCK: ClockState = { demo: true, now: '2026-06-25T11:30:00.000Z', day: 1, revision: 1, holdsAt: null, next: null, part: 'on_the_road' };
const held: StoreReceiving = { date: '2026-06-25', demoDay: 1, state: { outletId: 'OUT001', date: '2026-06-25', status: 'ready', note: 'Rear dock.', revision: 1, updatedAt: '2026-06-25T04:00:00Z' } };
function draw(element: ReactNode, q: QueryClient) {
  const router = createMemoryRouter([{ path: '/', element }]);
  return renderToStaticMarkup(<QueryClientProvider client={q}><RouterProvider router={router} /></QueryClientProvider>);
}
function client(account = me) { const q = new QueryClient(); q.setQueryData(meKey, account); q.setQueryData(clockKey, { ...CLOCK, heldAt: performance.now() }); return q; }
afterEach(() => { state.online = true; state.query = null; state.retry = null; });
it('shows a dated confirmed declaration and never offers to queue offline changes', () => {
  const q = client(); q.setQueryData(receivingKey(me, held.date, 1), held); state.online = false;
  const html = draw(<ReceivingCard />, q);
  expect(html).toContain('Thu 25 Jun'); expect(html).toContain('Last known'); expect(html).toContain('Ready to receive'); expect(html).toContain('Rear dock.');
  expect(html).toContain('Connect and read today'); expect(html).toMatch(/disabled=""[^>]*>Save readiness/);
});
it('distinguishes a failed first read from Not confirmed and a nonoperating date', () => {
  const q = client(); const key = receivingKey(me, held.date, 1);
  q.getQueryCache().build(q, { queryKey: key }).setState({ status: 'error', error: new Error('read failed') });
  const failed = draw(<ReceivingCard />, q); expect(failed).toContain('Receiving status unknown'); expect(failed).not.toContain('Not confirmed');
  q.setQueryData(key, { date: null, demoDay: 1, state: null }); expect(draw(<ReceivingCard />, q)).toContain('No receiving day today.');
});
it('keeps dispatcher receiving list on the calendar date at 17:00 with named shops', () => {
  const dispatcher = { ...me, role: 'dispatcher', outletId: null, depotId: 'Peliyagoda' } as Me;
  const q = client(dispatcher); const options = receivingListOptions(dispatcher, 'Peliyagoda', held.date, 1);
  q.setQueryData(options.queryKey, { date: held.date, depot: 'Peliyagoda', states: [{ ...held.state!, shopName: 'Fresh Nugegoda' }] });
  const html = draw(<ReceivingListPanel depot="Peliyagoda" />, q);
  expect(html).toContain('Receiving readiness · Thu 25 Jun'); expect(html).toContain('Fresh Nugegoda'); expect(html).toContain('Rear dock.');
  expect(html).not.toContain('Fri 26 Jun');
});

it('recovers a cached declaration after a background read error through its enabled retry handler', async () => {
  const q = client(); const key = receivingKey(me, held.date, 1); q.setQueryData(key, held);
  let fails = true;
  const observer = new QueryObserver(q, { queryKey: key, retry: false, enabled: false, queryFn: async () => {
    if (fails) throw new Error('Service unavailable');
    return { ...held, state: { ...held.state!, status: 'unavailable' as const, revision: 2 } };
  } });
  const unsubscribe = observer.subscribe(result => { state.query = result; });
  await observer.refetch();
  let html = draw(<ReceivingCard />, q);
  expect(html).toContain('Last known'); expect(html).toContain('Could not read'); expect(html).toContain('Read again');
  expect(html).not.toContain('Connect and read'); expect(state.retryDisabled).toBe(false);
  fails = false; state.retry!();
  await vi.waitFor(() => expect(observer.getCurrentResult().data?.state?.revision).toBe(2));
  html = draw(<ReceivingCard />, q); expect(html).toContain('Temporarily unavailable'); expect(html).not.toContain('Last known');
  unsubscribe();
});
