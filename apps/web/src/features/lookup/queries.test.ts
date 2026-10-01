import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { LookupOrders, type LookupPhoto, type Me } from '@wayfinder/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api';
import {
  currentRead, defaultMoved, fleetOptions, followGeneration, historyOptions, historySelection, lookupKey, ordersOptions, photoLoader, readState, scopeOf,
  shownSelection, type PhotoView,
} from './queries';

// AC-29 (spec 017, rule 12 and plan.md "Live updates, selection and screens"): every lookup read is keyed by its account,
// depot and parameters and carries the query's signal, so an older answer cannot land under a newer date, account or
// reset. A selection belongs to the scope it was made in, and a photo's bytes to the request that asked for them: a
// later selection, a close, a reset or a sign-out drops the old request and gives back its image.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ruwan: Me = { id: 'dispatcher-ruwan', username: 'ruwan', staffId: 'P-001', displayName: 'Ruwan', role: 'dispatcher', depotId: 'Peliyagoda', outletId: null };
const other: Me = { ...ruwan, id: 'dispatcher-other', username: 'other', staffId: 'P-002', displayName: 'Other' };

// The smallest whole Orders read the contract accepts, told apart by its day, read time and reset generation.
const orders = (date: string, readAt: string, demoDay = 1) => LookupOrders.parse({
  depot: { id: 'Peliyagoda', name: 'Peliyagoda' }, readAt, demoDay, date, from: date, range: 'day',
  summary: { orders: 0, planned: 0, deferred: 0, carriedOver: 0, split: 0 }, rows: [], skippedLately: { from: date, to: date, rows: [] },
});

// Every GET waits for the test to answer it, and records whether its signal was aborted. Like a transport that already
// holds its answer, it ignores the abort and answers anyway.
const answers: ((body: unknown) => void)[] = [];
const requests: string[] = [];
const signals: AbortSignal[] = [];
const respond = (n: number, body: unknown) => answers[n]!(body);
const settle = () => new Promise<void>((done) => setTimeout(done, 0));
let client: QueryClient;
let stop = () => {};
beforeEach(() => {
  answers.length = 0;
  requests.length = 0;
  signals.length = 0;
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    requests.push(url);
    signals.push(init!.signal!);
    return new Promise<Response>((done) => {
      answers.push((body) => done(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    });
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.mount();
});
afterEach(() => {
  stop();
  client.unmount();
  client.clear();
  vi.unstubAllGlobals();
});

it('AC-29 late reads and photos cannot cross selection account or reset', async () => {
  // Keys name the page, the account, the depot and the parameters the API was sent, and each read sends only those.
  expect(lookupKey('orders', ruwan, { date: '2026-06-25', range: 'day' })).toEqual(['lookup', 'orders', 'dispatcher-ruwan', 'Peliyagoda', { date: '2026-06-25', range: 'day' }]);
  expect(ordersOptions({ ...ruwan, depotId: null }, { range: 'day' }).enabled).toBe(false);
  expect(historyOptions(ruwan, {}).queryKey).toEqual(['lookup', 'history', 'dispatcher-ruwan', 'Peliyagoda', {}]);
  expect(fleetOptions(ruwan).queryKey).toEqual(['lookup', 'fleet', 'dispatcher-ruwan', 'Peliyagoda', {}]);

  // Wednesday is asked for, then Thursday is chosen before Wednesday's answer is back.
  const observer = new QueryObserver(client, ordersOptions(ruwan, { date: '2026-06-24', range: 'day' }));
  stop = observer.subscribe(() => {});
  await settle();
  observer.setOptions(ordersOptions(ruwan, { date: '2026-06-25', range: 'day' }));
  await settle();
  expect(requests).toEqual(['/api/v1/lookup/orders?date=2026-06-24&range=day', '/api/v1/lookup/orders?date=2026-06-25&range=day']);
  // The page that left Wednesday cancelled its read, so its answer, arriving last, is never kept or shown.
  expect(signals[0]!.aborted).toBe(true);
  respond(1, orders('2026-06-25', '2026-06-24T22:05:00.000Z'));
  await settle();
  respond(0, orders('2026-06-24', '2026-06-24T22:06:00.000Z'));
  await settle();
  expect(observer.getCurrentResult().data?.date).toBe('2026-06-25');
  expect(client.getQueryData(lookupKey('orders', ruwan, { date: '2026-06-24', range: 'day' }))).toBeUndefined();

  // Another account or depot starts from nothing: it never sees the read kept for the last one.
  expect(client.getQueryData(lookupKey('orders', other, { date: '2026-06-25', range: 'day' }))).toBeUndefined();
  expect(client.getQueryData(lookupKey('orders', { ...ruwan, depotId: 'Kandy' }, { date: '2026-06-25', range: 'day' }))).toBeUndefined();

  // A selection belongs to the account, depot, parameters and reset generation it was made in, and to a row the
  // read still holds. A reset (a new generation, even with the same ids) or another account clears it.
  const made = scopeOf({ userId: ruwan.id, depotId: 'Peliyagoda', params: { date: '2026-06-25' }, generation: 1 });
  const held = { id: id(5), scope: made };
  expect(shownSelection(held, made, [id(4), id(5)])).toBe(id(5));
  expect(shownSelection(held, made, [id(4)])).toBeNull();
  expect(shownSelection(held, scopeOf({ userId: ruwan.id, depotId: 'Peliyagoda', params: { date: '2026-06-25' }, generation: 2 }), [id(5)])).toBeNull();
  expect(shownSelection(held, scopeOf({ userId: other.id, depotId: 'Peliyagoda', params: { date: '2026-06-25' }, generation: 1 }), [id(5)])).toBeNull();
  expect(shownSelection(held, scopeOf({ userId: ruwan.id, depotId: 'Peliyagoda', params: { date: '2026-06-26' }, generation: 1 }), [id(5)])).toBeNull();
  // The clock already on a newer generation than the records on screen makes those records out of date too.
  expect(scopeOf({ userId: ruwan.id, depotId: 'Peliyagoda', params: {}, generation: 1, clockGeneration: 2 }))
    .not.toBe(scopeOf({ userId: ruwan.id, depotId: 'Peliyagoda', params: {}, generation: 1, clockGeneration: 1 }));
  expect(scopeOf({ userId: ruwan.id, depotId: 'Peliyagoda', params: {}, generation: 1, clockGeneration: 1 }))
    .toBe(scopeOf({ userId: ruwan.id, depotId: 'Peliyagoda', params: {}, generation: 1 }));

  // Photos: the bytes come only when a photo is opened, and only the newest request may put them on screen.
  const reads: { photo: LookupPhoto; signal: AbortSignal; answer: (blob: Blob) => void; fail: (error: unknown) => void }[] = [];
  const urls: string[] = [];
  const revoked: string[] = [];
  const views: PhotoView[] = [];
  const viewer = photoLoader({
    read: (photo, signal) => new Promise<Blob>((answer, fail) => { reads.push({ photo, signal, answer, fail }); }),
    toUrl: () => { urls.push(`blob:${urls.length + 1}`); return urls.at(-1)!; },
    revoke: (url) => { revoked.push(url); },
  }, (view) => { views.push(view); });
  const proof: LookupPhoto = { kind: 'proof', stopId: id(701), takenAt: '2026-06-24T22:08:00.000Z' };
  const refusal: LookupPhoto = { kind: 'issue', issueId: id(601), takenAt: '2026-06-24T22:20:00.000Z' };
  const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });

  viewer.open(proof, 'Proof · Fresh Nugegoda');
  expect(viewer.view.status).toBe('loading');
  // A newer selection replaces the first request, which is aborted; its late bytes never become an image.
  viewer.open(refusal, 'Refused · Fresh Wellawatte');
  expect(reads[0]!.signal.aborted).toBe(true);
  reads[1]!.answer(jpeg());
  await settle();
  expect(viewer.view).toMatchObject({ status: 'shown', url: 'blob:1', label: 'Refused · Fresh Wellawatte' });
  reads[0]!.answer(jpeg());
  await settle();
  expect(urls).toEqual(['blob:1']);
  expect(viewer.view).toMatchObject({ status: 'shown', url: 'blob:1' });

  // Close (or a reset, or a sign-out, which close it) gives the image back at once, and late bytes cannot restore it.
  viewer.open(proof, 'Proof · Fresh Nugegoda');
  expect(revoked).toEqual(['blob:1']);
  viewer.close();
  expect(reads[2]!.signal.aborted).toBe(true);
  reads[2]!.answer(jpeg());
  await settle();
  expect(viewer.view.status).toBe('closed');
  expect(urls).toEqual(['blob:1']);

  // An absent photo and a failed read are their own states, and Try again asks once more.
  viewer.open(proof, 'Proof · Fresh Nugegoda');
  reads[3]!.fail(new ApiRequestError(404, 'not_found', 'This stop has no photo.'));
  await settle();
  expect(viewer.view.status).toBe('missing');
  viewer.open(proof, 'Proof · Fresh Nugegoda');
  reads[4]!.fail(new ApiRequestError(0, 'network', 'Could not reach Wayfinder. Check the connection and try again.'));
  await settle();
  expect(viewer.view.status).toBe('failed');
  viewer.retry();
  expect(viewer.view.status).toBe('loading');
  reads[5]!.answer(jpeg());
  await settle();
  expect(viewer.view).toMatchObject({ status: 'shown', url: 'blob:2' });
  viewer.close();
  expect(revoked).toEqual(['blob:1', 'blob:2']);
  expect(views.at(-1)).toEqual({ status: 'closed' });
});

it('AC-29 a reset cancels a first read still out and asks again, and a read of another reset is never current', async () => {
  const observer = new QueryObserver(client, ordersOptions(ruwan, { range: 'day' }));
  stop = observer.subscribe(() => {});
  await settle();
  expect(requests).toHaveLength(1);
  // The demo day is reset while the page's first read is still out. Invalidating alone would hand the reset that same
  // read, whose answer is from before it; the read is cancelled and asked again instead.
  await followGeneration(client);
  await settle();
  expect(signals[0]!.aborted).toBe(true);
  expect(requests).toHaveLength(2);
  respond(1, orders('2026-06-25', '2026-06-24T09:30:00.000Z', 2));
  await settle();
  respond(0, orders('2026-06-25', '2026-06-24T22:00:00.000Z', 1));
  await settle();
  expect(observer.getCurrentResult().data?.demoDay).toBe(2);
  // Whatever a page holds counts only while it is of the reset the clock shows, and never for a date that is not one.
  const before = orders('2026-06-25', '2026-06-24T22:00:00.000Z', 1);
  expect(currentRead(before, 1)).toBe(before);
  expect(currentRead(before, 2)).toBeUndefined();
  expect(currentRead(orders('2026-06-25', '2026-06-24T22:00:00.000Z', 3), 2)).toBeUndefined();
  expect(currentRead(before, null)).toBe(before);
  expect(currentRead({ ...before, demoDay: null }, 2)).toEqual({ ...before, demoDay: null });
  expect(currentRead(undefined, 2)).toBeUndefined();
});

it('AC-29 a History trip named in the address is only ever one of the read\'s own trips of the current reset', () => {
  const trip = (n: number) => ({ tripId: id(800 + n) });
  const read = { demoDay: 3, trips: [trip(1), trip(2)] };
  // The address's trip is chosen among the read's trips, never fetched by itself.
  expect(historySelection(read, id(802), 3)).toEqual({ trip: trip(2), gone: false });
  expect(historySelection(read, null, 3)).toEqual({ trip: null, gone: false });
  expect(historySelection(undefined, id(802), 3)).toEqual({ trip: null, gone: false });
  // A trip the sent plan does not hold (a stale link, or one from before a reset) clears the detail and says so.
  expect(historySelection(read, id(899), 3)).toEqual({ trip: null, gone: true });
  // Records read before a reset the clock already shows hold no selection, even with the same id, until the new read.
  expect(historySelection(read, id(802), 4)).toEqual({ trip: null, gone: false });
  // Outside demo mode there is no reset generation, and the clock may not have arrived yet.
  expect(historySelection({ demoDay: null, trips: [trip(1)] }, id(801), 1)).toEqual({ trip: trip(1), gone: false });
  expect(historySelection(read, id(801), null)).toEqual({ trip: trip(1), gone: false });
});

it('a photo whose bytes arrived but cannot be drawn is a failed photo with Try again, and gives its image back', async () => {
  const urls: string[] = [];
  const revoked: string[] = [];
  const reads: { answer: (blob: Blob) => void }[] = [];
  const viewer = photoLoader({
    read: () => new Promise<Blob>((answer) => { reads.push({ answer }); }),
    toUrl: () => { urls.push(`blob:${urls.length + 1}`); return urls.at(-1)!; },
    revoke: (url) => { revoked.push(url); },
  }, () => {});
  const proof: LookupPhoto = { kind: 'proof', stopId: id(701), takenAt: '2026-06-24T22:08:00.000Z' };
  viewer.open(proof, 'Proof · Fresh Nugegoda');
  reads[0]!.answer(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }));
  await settle();
  expect(viewer.view).toMatchObject({ status: 'shown', url: 'blob:1' });
  // The browser could not draw it: the viewer says so, offers Try again and gives the address back.
  viewer.broken('blob:1');
  expect(viewer.view).toMatchObject({ status: 'failed', label: 'Proof · Fresh Nugegoda' });
  expect(revoked).toEqual(['blob:1']);
  // A late report about an image no longer on screen changes nothing.
  viewer.retry();
  viewer.broken('blob:1');
  expect(viewer.view.status).toBe('loading');
});

it('a read\'s state keeps first load, failed read, failed refresh, lost connection and live apart', () => {
  const read = { readAt: '2026-06-24T22:00:00.000Z' };
  expect(readState({ data: undefined, isError: false, failureCount: 0 }, true)).toBe('loading');
  // A first attempt that failed is a failed read while its retry waits, whatever held the retry back.
  expect(readState({ data: undefined, isError: false, failureCount: 1 }, true)).toBe('failed');
  expect(readState({ data: undefined, isError: true, failureCount: 2 }, true)).toBe('failed');
  expect(readState({ data: undefined, isError: false, failureCount: 0 }, false)).toBe('failed');
  // With records on screen they stay, said to be out of date: offline only when the browser says so.
  expect(readState({ data: read, isError: false, failureCount: 0 }, false)).toBe('offline');
  expect(readState({ data: read, isError: false, failureCount: 1 }, true)).toBe('stale');
  expect(readState({ data: read, isError: true, failureCount: 2 }, true)).toBe('stale');
  expect(readState({ data: read, isError: false, failureCount: 0 }, true)).toBe('live');
});

it('AC-29 an implicit default follows the board rollover and calendar midnight, never an earlier read', () => {
  // The board day moves at 03:30 depot time, Today and the latest sent date at midnight (both from the app clock).
  const read = '2026-06-24T21:59:00.000Z'; // Thu 03:29 at the depot
  expect(defaultMoved(read, Date.parse('2026-06-24T21:59:59.000Z'), 'board')).toBe(false);
  expect(defaultMoved(read, Date.parse('2026-06-24T22:00:00.000Z'), 'board')).toBe(true);
  expect(defaultMoved(read, Date.parse('2026-06-24T22:00:00.000Z'), 'calendar')).toBe(false);
  expect(defaultMoved('2026-06-24T18:29:59.000Z', Date.parse('2026-06-24T18:30:00.000Z'), 'calendar')).toBe(true);
  // A clock that moved backward is followed by the clock's own message, not by this rule, and no clock asks nothing.
  expect(defaultMoved(read, Date.parse('2026-06-23T22:00:00.000Z'), 'board')).toBe(false);
  expect(defaultMoved(read, null, 'board')).toBe(false);
});
