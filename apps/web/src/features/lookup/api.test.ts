import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEPOT_CHANGED, DEPOT_HEADER, nameDepot } from '@/lib/api';
import { readPhoto } from './api';

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
  const jpeg = await readPhoto({ kind: 'proof', stopId: 's1', takenAt: '2026-06-25T03:00:00.000Z' }, new AbortController().signal);
  expect(await jpeg.text()).toBe('proof');
  expect(fetch).toHaveBeenCalledWith('/api/v1/lookup/stops/s1/photo', expect.objectContaining({ headers: expect.objectContaining({ [DEPOT_HEADER]: 'Peliyagoda' }) }));

  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'depot_changed', message: 'The depot was switched in another tab.' } }, { status: 409 })));
  await expect(readPhoto({ kind: 'issue', issueId: 'i1', takenAt: '2026-06-25T03:00:00.000Z' }, new AbortController().signal)).rejects.toMatchObject({ code: 'depot_changed' });
  expect(heard).toBe(1);
});
