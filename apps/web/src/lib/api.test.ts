import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, apiBytes, ApiRequestError, DEPOT_CHANGED, DEPOT_HEADER, nameDepot } from './api';

// D-95: a dispatcher's tab names the depot it shows on every request, and hears when the server refuses one because the
// session works on another depot now. Any other account names none.

let heard = 0;
beforeEach(() => {
  heard = 0;
  const browser = new EventTarget();
  browser.addEventListener(DEPOT_CHANGED, () => { heard += 1; });
  vi.stubGlobal('window', browser);
});
afterEach(() => {
  nameDepot(null);
  vi.unstubAllGlobals();
});

const sentHeaders = (fetch: ReturnType<typeof vi.fn>) => ((fetch.mock.calls.at(-1)?.[1] as RequestInit | undefined)?.headers ?? {}) as Record<string, string>;

it('D-95 every request names the depot the tab shows while it shows a dispatcher\'s, and none otherwise', async () => {
  const fetch = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetch);

  await api('/plans');
  expect(sentHeaders(fetch)).not.toHaveProperty(DEPOT_HEADER);

  nameDepot('Kandy');
  await api('/plans');
  expect(sentHeaders(fetch)[DEPOT_HEADER]).toBe('Kandy');
  await api('/plans/2026-06-25/draft', { method: 'PUT', json: { plan: null } });
  expect(sentHeaders(fetch)).toMatchObject({ [DEPOT_HEADER]: 'Kandy', 'Content-Type': 'application/json' });

  nameDepot(null);
  await api('/plans');
  expect(sentHeaders(fetch)).not.toHaveProperty(DEPOT_HEADER);
});

it('D-95 a refusal because the session works on another depot is thrown like any refusal, and the tab hears of it', async () => {
  nameDepot('Peliyagoda');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'depot_changed', message: 'The depot was switched in another tab.' } }, { status: 409 })));
  const refused = await api('/plans').then(() => null, (error: unknown) => error);
  expect(refused).toBeInstanceOf(ApiRequestError);
  expect(refused).toMatchObject({ status: 409, code: 'depot_changed', message: 'The depot was switched in another tab.' });
  expect(heard).toBe(1);

  // Any other conflict is the page's own business.
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'stale', message: 'The plan was changed in another tab.' } }, { status: 409 })));
  await expect(api('/plans')).rejects.toMatchObject({ code: 'stale' });
  expect(heard).toBe(1);
});

it('D-95 bytes, such as a photo, go the same way: they name the depot the tab shows, and a refusal for a depot the session left is heard', async () => {
  nameDepot('Peliyagoda');
  const fetch = vi.fn(async () => new Response(new Blob(['jpeg bytes'], { type: 'image/jpeg' })));
  vi.stubGlobal('fetch', fetch);
  const jpeg = await apiBytes('/lookup/stops/s1/photo');
  expect(await jpeg.text()).toBe('jpeg bytes');
  expect(sentHeaders(fetch)[DEPOT_HEADER]).toBe('Peliyagoda');

  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'depot_changed', message: 'The depot was switched in another tab.' } }, { status: 409 })));
  await expect(apiBytes('/lookup/stops/s1/photo')).rejects.toMatchObject({ status: 409, code: 'depot_changed' });
  expect(heard).toBe(1);

  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'not_found', message: 'That stop has no photo.' } }, { status: 404 })));
  await expect(apiBytes('/lookup/stops/s1/photo')).rejects.toMatchObject({ status: 404, code: 'not_found' });
});
