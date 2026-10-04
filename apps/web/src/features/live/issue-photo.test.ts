import { QueryClient } from '@tanstack/react-query';
import type { Issue, Me } from '@wayfinder/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { meKey } from '@/features/auth/api';
import { DEPOT_CHANGED, DEPOT_HEADER, nameDepot } from '@/lib/api';
import { clockKey } from '@/lib/clock';
import { issuePhotoViewer } from './issues';

const ME: Me = { id: 'u1', username: 'ruwan', staffId: 'P-001', displayName: 'Ruwan', role: 'dispatcher', depotId: 'Peliyagoda', outletId: null };
const ISSUE = { id: 'problem-1', raisedAt: '2026-06-25T03:26:00.000Z', kind: 'receipt', stop: { shopName: 'Fresh Nugegoda' } } as Issue;
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const image = () => new Response(new Blob(['photo'], { type: 'image/jpeg' }));
let release: (response: Response) => void;
let qc: QueryClient;
let popup: ReturnType<typeof vi.fn>;
let released: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  qc = new QueryClient();
  qc.setQueryData(meKey, ME);
  qc.setQueryData(clockKey, { day: 1 });
  popup = vi.fn();
  vi.stubGlobal('window', Object.assign(new EventTarget(), { open: popup, setTimeout, clearTimeout }));
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:issue-photo');
  released = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  nameDepot('Peliyagoda');
});
afterEach(() => { qc.clear(); nameDepot(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads an issue photo inside its viewer using authenticated bytes and releases the URL on Close', async () => {
  const viewer = issuePhotoViewer(qc, ISSUE, 'Peliyagoda', vi.fn());
  const dispose = viewer.watch();
  viewer.open();
  expect(viewer.view).toMatchObject({ status: 'loading', label: 'Shop photo · Fresh Nugegoda' });
  expect(fetch).toHaveBeenCalledWith('/api/v1/issues/problem-1/photo?depot=Peliyagoda', expect.objectContaining({ credentials: 'same-origin', headers: expect.objectContaining({ [DEPOT_HEADER]: 'Peliyagoda' }) }));
  release(image());
  await settled();
  expect(viewer.view).toMatchObject({ status: 'shown', url: 'blob:issue-photo' });
  expect(popup).not.toHaveBeenCalled();
  viewer.close();
  expect(viewer.view).toEqual({ status: 'closed' });
  expect(released).toHaveBeenCalledExactlyOnceWith('blob:issue-photo');
  dispose();
});

it('keeps Both as the session depot while fetching the issue depot', async () => {
  qc.setQueryData(meKey, { ...ME, depotId: 'Both' });
  nameDepot('Both');
  const viewer = issuePhotoViewer(qc, ISSUE, 'Kandy', vi.fn());
  const dispose = viewer.watch();
  viewer.open();
  expect(fetch).toHaveBeenCalledWith('/api/v1/issues/problem-1/photo?depot=Kandy', expect.objectContaining({ headers: expect.objectContaining({ [DEPOT_HEADER]: 'Both' }) }));
  release(image());
  await settled();
  expect(viewer.view.status).toBe('shown');
  dispose();
  expect(released).toHaveBeenCalledExactlyOnceWith('blob:issue-photo');
});

it.each(['close', 'unmount', 'replacement'] as const)('drops late bytes after %s without creating a URL', async (action) => {
  const changed = vi.fn();
  const viewer = issuePhotoViewer(qc, ISSUE, 'Peliyagoda', changed);
  const dispose = viewer.watch();
  viewer.open();
  const oldRelease = release;
  const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal as AbortSignal;
  if (action === 'close') viewer.close();
  else dispose();
  if (action === 'replacement') {
    const newer = issuePhotoViewer(qc, { ...ISSUE, id: 'problem-2' }, 'Peliyagoda', vi.fn());
    const disposeNewer = newer.watch();
    newer.open();
    oldRelease(image());
    await settled();
    expect(newer.view.status).toBe('loading');
    disposeNewer();
  } else { oldRelease(image()); await settled(); }
  expect(signal.aborted).toBe(true);
  expect(viewer.view.status).toBe('closed');
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(changed.mock.calls.map(([view]) => view.status)).toEqual(['loading', 'closed']);
  dispose();
});

it.each(['account', 'depot', 'reset', 'signout', 'cache-clear'] as const)('cancels immediately on %s before a late old 401 can sign out the new owner', async (change) => {
  let signedOut = 0;
  let depotChanged = 0;
  window.addEventListener('wayfinder-signed-out', () => { signedOut += 1; });
  window.addEventListener(DEPOT_CHANGED, () => { depotChanged += 1; });
  const viewer = issuePhotoViewer(qc, ISSUE, 'Peliyagoda', vi.fn());
  const dispose = viewer.watch();
  viewer.open();
  const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal as AbortSignal;
  if (change === 'account') qc.setQueryData(meKey, { ...ME, id: 'u2' });
  if (change === 'depot') qc.setQueryData(meKey, { ...ME, depotId: 'Kandy' });
  if (change === 'reset') qc.setQueryData(clockKey, { day: 2 });
  if (change === 'signout') qc.setQueryData(meKey, null);
  if (change === 'cache-clear') qc.clear();
  expect(signal.aborted).toBe(true);
  expect(viewer.view.status).toBe('closed');
  release(Response.json({ error: { code: 'signed_out', message: 'Please sign in.' } }, { status: 401 }));
  await settled();
  expect(signedOut).toBe(0);
  expect(depotChanged).toBe(0);
  // A retained handler cannot reopen the old owner's photo, even if that account returns.
  qc.setQueryData(meKey, ME);
  qc.setQueryData(clockKey, { day: 1 });
  viewer.open();
  viewer.retry();
  expect(fetch).toHaveBeenCalledTimes(1);
  dispose();
});

it('revokes an already shown photo on reset and blocks stale image errors', async () => {
  const viewer = issuePhotoViewer(qc, ISSUE, 'Peliyagoda', vi.fn());
  const dispose = viewer.watch();
  viewer.open(); release(image()); await settled();
  qc.setQueryData(clockKey, { day: 2 });
  viewer.broken('blob:issue-photo');
  expect(viewer.view.status).toBe('closed');
  expect(released).toHaveBeenCalledExactlyOnceWith('blob:issue-photo');
  dispose();
});

it('shows failures in place, retries them, and releases an image that fails to draw', async () => {
  const viewer = issuePhotoViewer(qc, ISSUE, 'Peliyagoda', vi.fn());
  const dispose = viewer.watch();
  viewer.open();
  release(Response.json({ error: { code: 'unavailable', message: 'Try later.' } }, { status: 503 }));
  await settled();
  expect(viewer.view).toMatchObject({ status: 'failed', reason: 'Try later.' });
  viewer.retry();
  expect(viewer.view.status).toBe('loading');
  release(image()); await settled();
  viewer.broken('blob:issue-photo');
  expect(viewer.view).toMatchObject({ status: 'failed', reason: 'The photo could not be shown.' });
  expect(released).toHaveBeenCalledExactlyOnceWith('blob:issue-photo');
  viewer.retry();
  release(Response.json({ error: { code: 'not_found', message: 'No photo.' } }, { status: 404 }));
  await settled();
  expect(viewer.view.status).toBe('missing');
  expect(popup).not.toHaveBeenCalled();
  dispose();
});

it('still reports an active depot mismatch, while aborted old depot errors are ignored', async () => {
  let heard = 0;
  window.addEventListener(DEPOT_CHANGED, () => { heard += 1; });
  const viewer = issuePhotoViewer(qc, ISSUE, 'Peliyagoda', vi.fn());
  const dispose = viewer.watch();
  viewer.open();
  release(Response.json({ error: { code: 'depot_changed', message: 'The depot was switched in another tab.' } }, { status: 409 }));
  await settled();
  expect(heard).toBe(1);
  expect(viewer.view).toMatchObject({ status: 'failed', reason: 'The depot was switched in another tab.' });
  viewer.retry();
  viewer.close();
  release(Response.json({ error: { code: 'depot_changed', message: 'Old depot.' } }, { status: 409 }));
  await settled();
  expect(heard).toBe(1);
  dispose();
});
