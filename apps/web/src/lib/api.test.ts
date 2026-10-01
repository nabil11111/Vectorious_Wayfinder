import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, apiBytes, ApiRequestError, DEPOT_CHANGED, DEPOT_HEADER, forDepot, nameDepot } from './api';

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

it('AC-7 a tab on both depots names Both on every request, a read names the depot it is for, and a plan write names Both too', async () => {
  const fetch = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  nameDepot('Both');
  await api(forDepot('/operations', 'Kandy'));
  expect(fetch).toHaveBeenLastCalledWith('/api/v1/operations?depot=Kandy', expect.anything());
  expect(sentHeaders(fetch)[DEPOT_HEADER]).toBe('Both');
  await apiBytes(forDepot('/issues/7c000000-0000-4000-8000-000000000001/photo', 'Peliyagoda'));
  expect(fetch).toHaveBeenLastCalledWith('/api/v1/issues/7c000000-0000-4000-8000-000000000001/photo?depot=Peliyagoda', expect.anything());
  expect(sentHeaders(fetch)[DEPOT_HEADER]).toBe('Both');
  // A read that has its own query adds the depot to it.
  await api(forDepot('/lookup/orders?date=2026-06-25&range=day', 'Peliyagoda'));
  expect(fetch).toHaveBeenLastCalledWith('/api/v1/lookup/orders?date=2026-06-25&range=day&depot=Peliyagoda', expect.anything());
  // The server then refuses the plan write that names Both with 409 pick_a_depot, as any refusal.
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'pick_a_depot', message: 'A plan belongs to one depot. Pick the depot to plan.' } }, { status: 409 })));
  await expect(api('/plans/2026-06-25/draft', { method: 'PUT', json: {} })).rejects.toMatchObject({ status: 409, code: 'pick_a_depot' });
  expect(heard).toBe(0);
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
