import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEPOT_CHANGED, DEPOT_HEADER, nameDepot } from '@/lib/api';
import { readFleet, readHistory, readOrders, readPhoto } from './api';

// A stop's proof photo, as the look-up's viewer reads it (spec 017), names the depot the tab shows like every other
// request (D-95), so a tab that fell behind hears the session moved rather than "no such stop".

let heard = 0;
beforeEach(() => {
  heard = 0;
  const browser = new EventTarget();
  browser.addEventListener(DEPOT_CHANGED, () => { heard += 1; });
  vi.stubGlobal('window', browser);
  nameDepot('Peliyagoda');
});
afterEach(() => {
  nameDepot(null);
  vi.unstubAllGlobals();
});

it('D-95 a proof photo names the depot the tab shows, and a refusal for a depot the session left is heard', async () => {
  const fetch = vi.fn(async () => new Response(new Blob(['proof'], { type: 'image/jpeg' })));
  vi.stubGlobal('fetch', fetch);
  const jpeg = await readPhoto({ kind: 'proof', stopId: 's1', takenAt: '2026-06-25T03:00:00.000Z' }, 'Peliyagoda', new AbortController().signal);
  expect(await jpeg.text()).toBe('proof');
  expect(fetch).toHaveBeenCalledWith('/api/v1/lookup/stops/s1/photo?depot=Peliyagoda', expect.objectContaining({ headers: expect.objectContaining({ [DEPOT_HEADER]: 'Peliyagoda' }) }));

  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'depot_changed', message: 'The depot was switched in another tab.' } }, { status: 409 })));
  await expect(readPhoto({ kind: 'issue', issueId: 'i1', takenAt: '2026-06-25T03:00:00.000Z' }, 'Peliyagoda', new AbortController().signal)).rejects.toMatchObject({ code: 'depot_changed' });
  expect(heard).toBe(1);
});

it('AC-6 every look-up read and photo names the depot it reads, so on both depots each depot is read apart', async () => {
  nameDepot('Both');
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ not: 'a read' }));
  vi.stubGlobal('fetch', fetch);
  const signal = new AbortController().signal;
  // The answers are not reads the pages can trust, so each read fails as such; the requests are what this checks.
  await expect(readOrders('Kandy', { date: '2026-06-25', range: 'day' }, signal)).rejects.toBeDefined();
  await expect(readOrders('Peliyagoda', { range: 'four_weeks' }, signal)).rejects.toBeDefined();
  await expect(readHistory('Kandy', {}, signal)).rejects.toBeDefined();
  await expect(readFleet('Peliyagoda', signal)).rejects.toBeDefined();
  vi.stubGlobal('fetch', fetch.mockImplementation(async () => new Response(new Blob(['photo'], { type: 'image/jpeg' }))));
  await readPhoto({ kind: 'issue', issueId: 'i1', takenAt: '2026-06-25T03:00:00.000Z' }, 'Kandy', signal);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    '/api/v1/lookup/orders?date=2026-06-25&range=day&depot=Kandy',
    '/api/v1/lookup/orders?range=four_weeks&depot=Peliyagoda',
    '/api/v1/lookup/history?depot=Kandy',
    '/api/v1/lookup/fleet?depot=Peliyagoda',
    '/api/v1/issues/i1/photo?depot=Kandy',
  ]);
  expect(fetch.mock.calls.map(([, init]) => (init?.headers as Record<string, string> | undefined)?.[DEPOT_HEADER])).toEqual(['Both', 'Both', 'Both', 'Both', 'Both']);
});
