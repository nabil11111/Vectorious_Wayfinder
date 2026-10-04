import type { ReceivingList } from '@wayfinder/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { ReceivingListPanel } from './ReceivingListPanel';
const held = vi.hoisted(() => ({ data: undefined as ReceivingList | undefined, error: false, pending: false, online: true, expanded: false, search: '', filter: 'all', all: false }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: held.data, isError: held.error, isPending: held.pending, isFetching: false, refetch: vi.fn() }) }));
vi.mock('@/features/auth/api', () => ({ useMe: () => ({ data: { id: 'dispatcher', depotId: 'Peliyagoda' } }) }));
vi.mock('@/features/live/operations', () => ({ useOnline: () => held.online }));
vi.mock('@/lib/clock', () => ({ useAppClock: () => ({ at: Date.parse('2026-06-25T11:30:00Z'), state: { day: 1 } }) }));
vi.mock('./api', () => ({ receivingListOptions: () => ({ queryKey: ['receiving', 'depot', 'dispatcher', 'Peliyagoda', '2026-06-25', 1] }), useFollowReceiving: vi.fn() }));
vi.mock('react', async original => {
  const real = await original<typeof import('react')>();
  let boolean = 0;
  return { ...real, useState: (initial: unknown) => {
    if (typeof initial === 'boolean') { const value = boolean++ % 2 === 0 ? held.expanded : held.all; return [value, vi.fn()]; }
    return [initial === 'all' ? held.filter : held.search, vi.fn()];
  } };
});
const states = (count: number, status: ReceivingList['states'][number]['status'] = 'unconfirmed') => Array.from({ length: count }, (_, n) => ({ outletId: `OUT${n}`, shopName: `Shop ${String(n).padStart(2, '0')}`, date: '2026-06-25', status, note: n === 0 ? 'Full receiving note with entrance instructions.' : null, updatedAt: n === 0 ? '2026-06-25T04:00:00Z' : null, revision: n === 0 ? 1 : 0 }));
const draw = () => renderToStaticMarkup(<ReceivingListPanel depot="Peliyagoda" />);
beforeEach(() => { Object.assign(held, { data: { date: '2026-06-25', depot: 'Peliyagoda', states: states(12) }, error: false, pending: false, online: true, expanded: false, search: '', filter: 'all', all: false }); });
it('communicates date and honest counts while collapsed without adding shop rows to Live day', () => {
  const html = draw();
  expect(html).toContain('Shop receiving status'); expect(html).toContain('Thu 25 Jun'); expect(html).toContain('View shops');
  expect(html).toContain('Not confirmed: 12 shops'); expect(html).not.toContain('Shop 00'); expect(html).not.toContain('Closed');
});
it('shows only six compact rows initially and keeps more/fewer results in the same bounded keyboard scroll area', () => {
  held.expanded = true;
  let html = draw(); expect(html).toContain('Show more'); expect(html).toContain('Showing 6 of 12 shops'); expect(html).not.toContain('Shop 06');
  expect(html).toContain('Shop receiving results'); expect(html).toContain('tabindex="0"'); expect(html).toContain('h-[min(320px,45dvh)]');
  expect(html).toContain('Full receiving note with entrance instructions.'); expect(html).toContain('09:30'); expect(html).not.toContain('No declaration recorded');
  held.all = true; html = draw(); expect(html).toContain('Show fewer'); expect(html).toContain('Shop 11'); expect(html).toContain('h-[min(320px,45dvh)]');
});
it('distinguishes no matches, no shops and failed/loading unknown counts from known zeros', () => {
  held.expanded = true; held.search = 'does not exist'; expect(draw()).toContain('No shops match');
  held.search = ''; held.data!.states = []; expect(draw()).toContain('No shops to show');
  held.data = undefined; held.error = true;
  let html = draw(); expect(html).toContain('Status unknown'); expect(html).toContain('Read again'); expect(html).not.toContain('Ready: 0 shops');
  held.error = false; held.pending = true; html = draw(); expect(html).toContain('Reading shop receiving status'); expect(html).not.toContain('Ready: 0 shops');
});
it('labels cached failure/offline counts Last known and never uses a declaration from another date', () => {
  held.online = false; expect(draw()).toContain('Last known');
  held.online = true; held.error = true; expect(draw()).toContain('Last known'); expect(draw()).toContain('Read again');
  held.error = false; held.data!.date = '2026-06-24'; const html = draw(); expect(html).toContain('Status unknown'); expect(html).not.toContain('Not confirmed: 12 shops');
});
