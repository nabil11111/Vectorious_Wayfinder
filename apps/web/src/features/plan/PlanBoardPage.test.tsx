import type { PlanBoard, LookupOrders } from '@wayfinder/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { lookupKey } from '@/features/lookup/queries';
import { closingCountdown, PlanBoardPage } from './PlanBoardPage';

const held = vi.hoisted(() => ({ depot: 'Peliyagoda', clockDay: 1, board: null as PlanBoard | null, failed: false }));
const me = { id: 'dispatcher' };
vi.mock('@/features/auth/api', () => ({ useMe: () => ({ data: { ...me, depotId: held.depot } }) }));
vi.mock('@/lib/clock', () => ({ useAppClock: () => ({ at: Date.parse('2026-06-24T09:30:00.000Z'), state: { day: held.clockDay } }) }));
vi.mock('./board', async (original) => ({ ...await original<typeof import('./board')>(),
  useBoard: () => ({ data: held.board, isError: held.failed, isFetching: false, error: new Error('Board failed'), refetch: vi.fn() }),
  useBoardScreen: () => ({ screen: { board: held.board }, saver: {} }), useOrdersFollow: () => {} }));
const board = (): PlanBoard => ({ depot: held.depot, demoDay: 1, day: { date: '2026-06-25', cutoffAt: '2026-06-24T10:30:00.000Z', open: false },
  plan: { mixBrands: false, trips: [], deferrals: [], id: null, revision: 0, status: 'draft', savedAt: null, sentAt: null, canUnsend: false, lockedReason: null },
  dropped: [], check: null, orders: [], shops: [], vehicles: [], drivers: [], figures: null, counts: null, suggestion: null });
const read = (depot = 'Peliyagoda', demoDay = 1): LookupOrders => ({ depot: { id: depot, name: depot }, demoDay, readAt: '2026-06-24T09:30:00.000Z', date: '2026-06-25', from: '2026-06-25', range: 'day',
  summary: { orders: 12, planned: 0, deferred: 0, carriedOver: 0, split: 0 }, rows: [], skippedLately: null });
const render = (value: LookupOrders, demandError = false) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(lookupKey('orders', me, 'Peliyagoda', { date: '2026-06-25', range: 'day' }), value);
  if (demandError) qc.getQueryCache().find({ queryKey: lookupKey('orders', me, 'Peliyagoda', { date: '2026-06-25', range: 'day' }) })!.setState({ status: 'error', error: new Error('Demand failed') });
  held.board = board();
  const html = renderToStaticMarkup(<QueryClientProvider client={qc}><MemoryRouter><PlanBoardPage /></MemoryRouter></QueryClientProvider>);
  qc.clear();
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
};
describe('before-cutoff plan board', () => {
  it('shows actual received demand and countdown while planning remains closed', () => {
    held.depot = 'Peliyagoda'; held.clockDay = 1; held.failed = false;
    const html = render(read());
    expect(html).toContain('12 received orders');
    expect(html).toContain('1h 0m until orders close');
    expect(html).toContain('View orders');
    expect(html).not.toContain('Build suggested plan');
  });
  it('does not draw totals for an old reset, a changed depot or a failed board read', () => {
    held.clockDay = 2;
    expect(render(read())).not.toContain('12 received orders');
    held.clockDay = 1; held.depot = 'Kandy';
    expect(render(read())).not.toContain('12 received orders');
    held.depot = 'Peliyagoda'; held.failed = true;
    expect(render(read())).toContain('Could not load the plan board');
    expect(render(read())).not.toContain('12 received orders');
    held.failed = false;
    expect(render({ ...read(), date: '2026-06-26' })).not.toContain('12 received orders');
    const failedDemand = render(read(), true);
    expect(failedDemand).toContain('Could not load received demand');
    expect(failedDemand).not.toContain('12 received orders');
  });
  it('does not invent a countdown without a clock or show negative time', () => {
    expect(closingCountdown('2026-06-24T10:30:00.000Z', null)).toBeNull();
    expect(closingCountdown('2026-06-24T10:30:00.000Z', Date.parse('2026-06-24T11:00:00.000Z'))).toBe('Orders are closing');
  });
});
