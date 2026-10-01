import type { ReceiptWrite, StoreDeliveries, StoreDelivery, StoreOutlet } from '@wayfinder/contracts';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/lib/api';
import { screenOf, type DeliveriesView, type ReceiptRecord, type ScreenInput } from './deliveries';

// Which screen Deliveries shows (spec 015, rules 1 and 6, the screen states' table), on plain values: the deliveries
// the phone kept, its receipt records, the one-delivery read and the phone's signal.

const NADEESHA = '9a000000-0000-4000-8000-000000000001';
const STOP = '9b000000-0000-4000-8000-000000000001';
const OTHER_STOP = '9b000000-0000-4000-8000-000000000002';
const outlet: StoreOutlet = { id: 'OUT001', name: 'Fresh Nugegoda', brand: 'Fresh', windowOpen: '05:00', windowClose: '07:30', dockType: 'street' };

const line = (n: number, temp: 'chilled' | 'dry', ordered: number, loaded: number) => ({
  lineId: `9c000000-0000-4000-8000-00000000000${n}`, orderId: `9d000000-0000-4000-8000-00000000000${n}`, temp, productId: `fresh-${temp}-carton`,
  name: temp === 'chilled' ? 'Chilled carton' : 'Dry carton', unit: 'carton', ordered, loaded, delivered: loaded, received: null,
});
const delivery: StoreDelivery = {
  stopId: STOP, revision: 3, day: '2026-06-25', vehicleId: 'VEH035', driver: 'Dilshan', arrivedAt: '2026-06-24T22:04:00.000Z', doneAt: '2026-06-24T22:08:00.000Z',
  outcome: 'delivered', late: false, refusalReason: null, receipt: null,
  lines: [line(1, 'chilled', 12, 12), line(2, 'chilled', 8, 8), line(3, 'dry', 4, 3)],
};
const received: StoreDelivery = {
  ...delivery, revision: 4, lines: delivery.lines.map((each) => ({ ...each, received: each.delivered })),
  receipt: { at: '2026-06-25T03:01:00.000Z', sentAt: '2026-06-25T03:03:00.000Z', cold: true, report: null },
};
const day = (deliveries: StoreDelivery[]): StoreDeliveries => ({ outlet, userId: NADEESHA, today: '2026-06-25', appliedWriteIds: [], deliveries });
const write: ReceiptWrite = {
  kind: 'receipt', writeId: '9e000000-0000-4000-8000-000000000001', stopId: STOP, at: '2026-06-25T03:01:00.000Z', revision: 3,
  lines: [{ lineId: delivery.lines[0]!.lineId, received: 11 }, { lineId: delivery.lines[1]!.lineId, received: 8 }, { lineId: delivery.lines[2]!.lineId, received: 3 }],
  cold: true, reason: 'missing',
};
// A record as the phone keeps it: the exact request, and the delivery as the form showed it with its shop.
const record = (state: 'waiting' | 'refused'): ReceiptRecord => ({
  seq: 1, queue: 'shop', userId: NADEESHA, write, about: 'Fresh Nugegoda · VEH035 · Thu 25 Jun', savedAt: write.at, state,
  refusal: state === 'refused' ? { code: 'unknown_record', message: 'That delivery is not on your list.' } : null,
  shown: { ...delivery, outlet },
});
const view = (kept: StoreDeliveries | null, records: ReceiptRecord[] = []): DeliveriesView => ({ ready: true, failed: false, day: kept, records });
const notRead = { data: undefined, error: null, isError: false, isSuccess: false };
const input = (change: Partial<ScreenInput>): ScreenInput => ({
  view: view(day([delivery])), stopId: STOP, one: notRead, failure: null, unanswered: [], signedOut: false, signal: true, today: '2026-06-25',
  shownSaved: () => false, ...change,
});

describe('which screen Deliveries shows', () => {
  it('shows "Not on your list" when the one-delivery read was refused, even with an older answer of it kept', () => {
    // A receipt of an earlier day, read once and kept in the cache, and then the day reset: the read now answers
    // unknown_record, and that refusal wins over what the cache still holds.
    const refusal = new ApiRequestError(400, 'unknown_record', 'That delivery is not on your list.');
    const screen = screenOf(input({ view: view(day([])), one: { data: received, error: refusal, isError: true, isSuccess: false } }));
    expect(screen.show).toBe('not-on-list');
  });

  it('keeps the answer it had when a later one-delivery read only failed to get through', () => {
    const failed = new ApiRequestError(503, 'server_error', 'Something went wrong on our side.');
    const screen = screenOf(input({ view: view(day([])), one: { data: received, error: failed, isError: true, isSuccess: false } }));
    expect(screen).toMatchObject({ show: 'sent', delivery: received });
  });

  it('draws a saved receipt from its own record when the phone kept no deliveries', () => {
    const screen = screenOf(input({ view: view(null, [record('waiting')]), signal: false }));
    expect(screen).toMatchObject({ show: 'saved', outlet });
    if (screen.show !== 'saved') return;
    expect(screen.drawn?.lines.map((each) => each.received)).toEqual([11, 8, 3]);
    expect(screen.drawn?.receipt?.report).toMatchObject({ reason: 'missing', lines: [{ lineId: delivery.lines[0]!.lineId, counted: 1 }] });
  });

  it('draws a refused receipt from its own record when the phone kept no deliveries, and says the depot no longer lists it', () => {
    const screen = screenOf(input({ view: view(null, [record('refused')]) }));
    expect(screen).toMatchObject({ show: 'refused', outlet, listed: false });
    if (screen.show !== 'refused') return;
    expect(screen.drawn?.lines.map((each) => each.received)).toEqual([11, 8, 3]);
  });

  it('opens the stop of a receipt on the phone from the list, also when the phone kept no deliveries', () => {
    expect(screenOf(input({ stopId: null, view: view(null, [record('waiting')]), signal: false }))).toEqual({ show: 'redirect', stopId: STOP });
  });

  it('says it could not load only when the phone kept neither deliveries nor a receipt it can draw', () => {
    expect(screenOf(input({ stopId: null, view: view(null), signal: false })).show).toBe('could-not-load');
    expect(screenOf(input({ stopId: null, view: view(null), failure: 'Could not reach Wayfinder.' })).show).toBe('could-not-load');
    expect(screenOf(input({ stopId: null, view: view(null) })).show).toBe('loading');
    // A record kept by an older version names no shop, so with no deliveries it waits for them.
    const nameless = { ...record('waiting'), shown: delivery };
    expect(screenOf(input({ view: view(null, [nameless]), signal: false })).show).toBe('could-not-load');
  });

  it('shows a waiting receipt as sending while the phone has a signal and no send of it went unanswered', () => {
    expect(screenOf(input({ view: view(null, [record('waiting')]) })).show).toBe('sending');
    expect(screenOf(input({ view: view(null, [record('waiting')]), unanswered: [write.writeId] })).show).toBe('saved');
    expect(screenOf(input({ view: view(null, [record('waiting')]), shownSaved: () => true })).show).toBe('saved');
  });

  it('shows the delivery the phone kept: the form before its receipt, sent after it, and nothing to confirm without one', () => {
    expect(screenOf(input({})).show).toBe('form');
    expect(screenOf(input({ view: view(day([received])) })).show).toBe('sent');
    expect(screenOf(input({ stopId: null, view: view(day([received])) })).show).toBe('nothing');
    expect(screenOf(input({ stopId: null })).show).toBe('redirect');
    expect(screenOf(input({ stopId: OTHER_STOP, view: view(day([])), one: { data: undefined, error: null, isError: false, isSuccess: true } })).show).toBe('not-on-list');
  });
});

// Q-37: two devices at Kotahena. The phone saved 55 and 2 damaged with no signal; the desktop confirmed all 57; the
// phone's receipt came back refused as already confirmed. The screen keeps the phone's report and shows what the depot has.
describe('Q-37 a receipt refused because another device confirmed the delivery', () => {
  const stale = (): ReceiptRecord => ({ ...record('refused'), refusal: { code: 'stale', message: 'This delivery was already confirmed.' } });

  it('keeps the phone\'s own copy and gives the delivery as the depot has it, with its receipt', () => {
    const screen = screenOf(input({ view: view(day([received]), [stale()]) }));
    expect(screen).toMatchObject({ show: 'refused', listed: true, depot: received });
    if (screen.show !== 'refused') return;
    expect(screen.drawn?.lines.map((each) => each.received)).toEqual([11, 8, 3]);
  });

  it('reads the depot\'s copy from the one-delivery read when the phone\'s deliveries no longer list it', () => {
    expect(screenOf(input({ view: view(day([]), [stale()]), one: { data: received, error: null, isError: false, isSuccess: true } })))
      .toMatchObject({ show: 'refused', listed: false, depot: received });
    expect(screenOf(input({ view: view(day([]), [stale()]) }))).toMatchObject({ show: 'refused', depot: null });
  });
});
