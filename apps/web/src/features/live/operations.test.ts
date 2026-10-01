import { QueryClient, QueryObserver, onlineManager } from '@tanstack/react-query';
import { OperationsDay, type Me } from '@wayfinder/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dayHasChanged, followDay, followMessages, isLive, operationsKey, operationsOptions } from './operations';

// AC-34 (spec 016, plan.md "Live updates and query ordering"): the dashboard and Live day share one operations read.
// A held older answer must never replace a newer one, and once the app clock passes the watched day's 16:00 the next
// day is asked for at once, without a reload. The server is a stubbed fetch whose answers arrive when the test says.

const ruwan: Me = { id: 'dispatcher-ruwan', username: 'ruwan', displayName: 'Ruwan', role: 'dispatcher', depotId: 'Peliyagoda', outletId: null };
const THU_1600 = '2026-06-25T10:30:00.000Z';
const FRI_1600 = '2026-06-26T10:30:00.000Z';

// The smallest whole day the contract accepts, told apart by its day and the instant it was read.
const dayAt = (day: string, readAt: string, dayChangesAt: string): OperationsDay => OperationsDay.parse({
  depot: { id: 'Peliyagoda', name: 'Peliyagoda' }, demoDay: 1, day, dayChangesAt, readAt, plan: null,
  counts: {
    stopsTotal: 0, stopsDelivered: 0, stopsDone: 0, partialStops: 0, noGoodsStops: 0, closedStops: 0, tripsTotal: 0, vehiclesOut: 0, vehiclesTotal: 38,
    deferredOrders: 0, deliveryProgress: { numerator: 0, denominator: 0, percent: 0 }, truckProgress: { numerator: 0, denominator: 38, percent: 0 },
  },
  map: { shops: 0, districts: [] },
  nextRun: null, fuel: null, brandTotals: [], groups: [], timeline: null, earlierOut: [], outTripIds: [], events: [], eventsTruncated: false,
});
const thursday = (readAt: string) => dayAt('2026-06-25', readAt, THU_1600);
const friday = (readAt: string) => dayAt('2026-06-26', readAt, FRI_1600);

// Every GET waits for the test to answer it. Like a transport that already holds its answer, it ignores the abort.
const answers: ((body: unknown) => void)[] = [];
const requests: string[] = [];
const respond = (n: number, body: unknown) => answers[n]!(body);
const settle = () => new Promise<void>((done) => setTimeout(done, 0));

let client: QueryClient;
let stop = () => {};
beforeEach(() => {
  answers.length = 0;
  requests.length = 0;
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    requests.push(url);
    return new Promise<Response>((done) => {
      answers.push((body) => done(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    });
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  // Mounted as the app's provider mounts it, so going back online resumes a held read.
  client.mount();
});
afterEach(() => {
  onlineManager.setOnline(true);
  stop();
  client.unmount();
  client.clear();
  vi.unstubAllGlobals();
});

// The page's view of the read, as both dispatcher pages hold it.
async function watch() {
  const observer = new QueryObserver(client, operationsOptions(ruwan));
  stop = observer.subscribe(() => {});
  await settle();
  return observer;
}
const shown = () => client.getQueryData<OperationsDay>(operationsKey(ruwan));

it('AC-34 older operations response cannot replace a newer day', async () => {
  expect(operationsKey(ruwan)).toEqual(['operations', 'dispatcher-ruwan', 'Peliyagoda']);
  await watch();
  expect(requests).toEqual(['/api/v1/operations']);
  respond(0, thursday('2026-06-24T22:00:00.000Z'));
  await settle();
  expect(shown()?.readAt).toBe('2026-06-24T22:00:00.000Z');

  // A live message asks again, and a second one asks again before the first answer is back.
  void client.invalidateQueries({ queryKey: ['operations'] });
  await settle();
  void client.invalidateQueries({ queryKey: ['operations'] });
  await settle();
  expect(requests).toHaveLength(3);
  // The newer answer lands, then the held older one arrives: the newer stays.
  respond(2, thursday('2026-06-24T22:10:00.000Z'));
  await settle();
  respond(1, thursday('2026-06-24T22:05:00.000Z'));
  await settle();
  expect(shown()?.readAt).toBe('2026-06-24T22:10:00.000Z');

  // The other way round: the held older answer arrives first and is still not shown.
  void client.invalidateQueries({ queryKey: ['operations'] });
  await settle();
  void client.invalidateQueries({ queryKey: ['operations'] });
  await settle();
  respond(3, thursday('2026-06-24T22:15:00.000Z'));
  await settle();
  expect(shown()?.readAt).toBe('2026-06-24T22:10:00.000Z');
  respond(4, thursday('2026-06-24T22:20:00.000Z'));
  await settle();
  expect(shown()?.readAt).toBe('2026-06-24T22:20:00.000Z');
});

it('AC-34 an app clock day change asks for the newly watched day and drops the old day\'s held read', async () => {
  await watch();
  respond(0, thursday('2026-06-25T10:25:00.000Z'));
  await settle();
  const before = shown()!;
  // Before 16:00 the day stands; from 16:00 on the app clock it has changed.
  expect(dayHasChanged(before, Date.parse(THU_1600) - 1)).toBe(false);
  expect(dayHasChanged(before, Date.parse(THU_1600))).toBe(true);
  expect(dayHasChanged(dayAt('2026-06-25', '2026-06-25T10:25:00.000Z', THU_1600), null)).toBe(false);
  expect(dayHasChanged({ ...before, day: null, dayChangesAt: null }, Date.parse(FRI_1600))).toBe(false);

  // The one-minute read started at 15:59 is still out when the clock reaches 16:00.
  void client.refetchQueries({ queryKey: ['operations'] });
  await settle();
  expect(requests).toHaveLength(2);
  void followDay(client, ruwan);
  await settle();
  // The new day is asked for at once, without waiting for the held read or a reload.
  expect(requests).toHaveLength(3);
  respond(1, thursday('2026-06-25T10:29:59.000Z'));
  await settle();
  expect(shown()?.day).toBe('2026-06-25');
  expect(shown()?.readAt).toBe('2026-06-25T10:25:00.000Z');
  respond(2, friday('2026-06-25T10:30:01.000Z'));
  await settle();
  expect(shown()?.day).toBe('2026-06-26');
  expect(dayHasChanged(shown(), Date.parse(THU_1600) + 1000)).toBe(false);
});

it('AC-32 a live message while the first read is out asks again once that read lands', async () => {
  const unfollow = followMessages(client);
  await watch();
  expect(requests).toHaveLength(1);
  // The stream says the driver's records changed while the first read is still on its way. TanStack hands the
  // message that same read, whose snapshot is from before the change.
  void client.invalidateQueries({ queryKey: ['operations'] });
  await settle();
  expect(requests).toHaveLength(1);
  respond(0, thursday('2026-06-24T22:01:00.000Z'));
  await settle();
  expect(requests).toHaveLength(2);
  respond(1, thursday('2026-06-24T22:02:00.000Z'));
  await settle();
  expect(shown()?.readAt).toBe('2026-06-24T22:02:00.000Z');
  // With the day on screen a message asks once, as before, and nothing more follows its answer.
  void client.invalidateQueries({ queryKey: ['operations'] });
  await settle();
  expect(requests).toHaveLength(3);
  respond(2, thursday('2026-06-24T22:03:00.000Z'));
  await settle();
  expect(requests).toHaveLength(3);
  unfollow();
});

it('AC-34 a day change while the first read is out asks for the new day once that read lands', async () => {
  const unfollow = followMessages(client);
  await watch();
  void followDay(client, ruwan);
  await settle();
  respond(0, thursday('2026-06-25T10:29:59.000Z'));
  await settle();
  expect(requests).toHaveLength(2);
  respond(1, friday('2026-06-25T10:30:01.000Z'));
  await settle();
  expect(shown()?.day).toBe('2026-06-26');
  unfollow();
});

it('AC-33 a read held back with the browser offline, or a failed refresh, is not live', async () => {
  const observer = await watch();
  respond(0, thursday('2026-06-24T22:00:00.000Z'));
  await settle();
  expect(isLive(observer.getCurrentResult(), true)).toBe(true);
  // The browser goes offline: the next read waits, paused, and the page must not call itself live.
  onlineManager.setOnline(false);
  void client.invalidateQueries({ queryKey: ['operations'] });
  await settle();
  expect(observer.getCurrentResult().isPaused).toBe(true);
  expect(isLive(observer.getCurrentResult(), false)).toBe(false);
  // Offline with no read waiting is not live either.
  expect(isLive({ ...observer.getCurrentResult(), isPaused: false }, false)).toBe(false);
  onlineManager.setOnline(true);
  await settle();
  respond(1, thursday('2026-06-24T22:05:00.000Z'));
  await settle();
  expect(isLive(observer.getCurrentResult(), true)).toBe(true);
  expect(isLive({ ...observer.getCurrentResult(), isError: true }, true)).toBe(false);
  expect(isLive({ ...observer.getCurrentResult(), data: undefined }, true)).toBe(false);
});

it('AC-34 another account or depot never sees the day kept for the last one', async () => {
  await watch();
  respond(0, thursday('2026-06-25T10:25:00.000Z'));
  await settle();
  const other: Me = { ...ruwan, id: 'dispatcher-other' };
  expect(operationsKey(other)).not.toEqual(operationsKey(ruwan));
  expect(client.getQueryData(operationsKey(other))).toBeUndefined();
  expect(operationsOptions({ ...ruwan, depotId: null }).enabled).toBe(false);
});
