import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DriverDay } from '@wayfinder/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDriverView } from './view';
import { TopArea } from './parts/TopArea';

const held = vi.hoisted(() => ({ userId: 'driver', signal: true, failure: null as string | null, fetched: false, signedOut: false }));
const day: DriverDay = { driverId: 'driver', driver: 'Driver', depot: 'Kandy', day: '2026-06-25', planSent: true, appliedWriteIds: [], trips: [] };
vi.mock('./queue', () => ({ useKept: () => ({ ready: true, userId: held.userId, day, queue: [] }),
  useSync: () => ({ fetched: held.fetched, signedOut: held.signedOut, failure: held.failure, notSaved: false }), retrySync: vi.fn(), recordOf: vi.fn() }));
vi.mock('@/lib/phone/signal', () => ({ useSignal: () => held.signal }));
function View({ userId = 'driver' }: { userId?: string }) {
  const view = useDriverView(userId);
  return <p>{view.day ? 'Cached day available' : 'Waiting for current day'}</p>;
}
const render = (userId?: string) => renderToStaticMarkup(<View userId={userId} />);
describe('current run read with a cached driver day', () => {
  it('hides an earlier run during startup, then restores own cache on a failed read', () => {
    held.signal = true; held.fetched = false; held.signedOut = false; held.failure = null;
    expect(render()).toContain('Waiting for current day');
    for (const failure of ['Wayfinder is temporarily unavailable.', 'Too many requests. Try again soon.']) {
      held.failure = failure;
      expect(render()).toContain('Cached day available');
      expect(render('other-driver')).toContain('Waiting for current day');
      const qc = new QueryClient();
      const html = renderToStaticMarkup(<QueryClientProvider client={qc}><TopArea waitingRecords={0} /></QueryClientProvider>);
      expect(html).toContain('Last known trip');
      expect(html).toContain(failure);
      expect(html).toContain('Try again');
      qc.clear();
    }
    held.failure = null; held.fetched = true;
    expect(render()).toContain('Cached day available');
  });
  it('keeps offline and reauthentication cache available without drawing another account', () => {
    held.failure = null; held.fetched = false; held.signal = false;
    expect(render()).toContain('Cached day available');
    held.signal = true; held.signedOut = true;
    expect(render()).toContain('Cached day available');
    expect(render('other-driver')).toContain('Waiting for current day');
    held.signedOut = false;
  });
});
