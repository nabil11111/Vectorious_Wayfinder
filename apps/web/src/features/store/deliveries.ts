import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { applyReceipt, receiptView, type ReceiptWrite, type StoreDeliveries, type StoreDelivery, type StoreOutlet } from '@wayfinder/contracts';
import damaged from '@/assets/icons/icon-damaged.png';
import receipt from '@/assets/icons/icon-order-delivered.png';
import tray from '@/assets/icons/icon-offline-queue.png';
import proofPhoto from '@/assets/icons/icon-proof-photo.png';
import shortfall from '@/assets/icons/icon-shortfall.png';
import { api, ApiRequestError } from '@/lib/api';
import { shopQueue } from '@/lib/phone/shop';
import type { Queued } from '@/lib/phone/store';
import { depotDayOf, NO_SIGNAL, reasonOf } from './words';

// Deliveries' hooks over the shop's queue (spec 015, rules 1, 6 and 13, D-57, plan.md "The phone"). The page shows the
// deliveries the phone kept with the still-waiting receipts applied by receiptView, and draws a receipt waiting or
// refused on the phone from the record itself: applyReceipt of its own request on the delivery as the form showed it,
// whether or not the deliveries still hold its stop. A receipt's answer is never shown: the queue fetches the
// deliveries again after each one.

// "View past orders": Orders with Past chosen on a phone.
export const PAST_ORDERS = '/store/orders?list=past';

// What a receipt's record keeps to be drawn without the deliveries: the delivery as the form showed it, and the shop
// it was confirmed at, so a receipt waiting or refused on the phone shows even when the phone kept no deliveries.
// A record kept before the shop was kept with it names none, and is drawn with the deliveries' shop.
export type ShownReceipt = StoreDelivery & { outlet?: StoreOutlet };

// A receipt saved on the phone, with its own copy to draw it from.
export type ReceiptRecord = Queued<ReceiptWrite, ShownReceipt>;

export interface DeliveriesView {
  // The phone's database has been read for the signed-in account.
  ready: boolean;
  // It could not be read.
  failed: boolean;
  // The deliveries the server last sent with the waiting receipts applied, or null when the phone has none.
  day: StoreDeliveries | null;
  // The receipts still to send and those the server refused, oldest first.
  records: ReceiptRecord[];
}

export function useDeliveriesView(userId: string): DeliveriesView {
  const kept = shopQueue.useKept();
  return useMemo(() => {
    const own = kept.userId === userId;
    const ready = own && kept.ready;
    if (!ready) return { ready: false, failed: own && kept.failed, day: null, records: [] };
    const held = kept.queue.filter((entry) => entry.state === 'waiting');
    const refused = kept.queue.filter((entry) => entry.state === 'refused');
    if (!kept.day) return { ready, failed: false, day: null, records: kept.queue };
    const view = receiptView(kept.day, held.map((entry) => entry.write));
    const left = new Set(view.writes.map((write) => write.writeId));
    const records = [...held.filter((entry) => left.has(entry.write.writeId)), ...refused].sort((a, b) => a.seq - b.seq);
    return { ready, failed: false, day: view.deliveries, records };
  }, [kept, userId]);
}

// The record of a stop, the latest one when the phone has two.
export const recordFor = (view: DeliveriesView, stopId: string) => view.records.filter((record) => record.write.stopId === stopId).at(-1) ?? null;

// A record drawn from its own copy: the delivery as the form showed it with the record's receipt applied, the shop and
// day only carried along. null for a copy an older version kept that no longer fits.
export function drawnRecord(record: ReceiptRecord, outlet: StoreOutlet, today: string): StoreDelivery | null {
  if (!record.shown) return null;
  const { outlet: _kept, ...shown } = record.shown;
  return applyReceipt({ outlet, userId: record.userId, today, appliedWriteIds: [], deliveries: [shown] }, record.write).deliveries[0] ?? null;
}

// The server's own word on a request, such as unknown_record for a stop that is not this shop's, as against an answer
// that did not get through or an expired session.
const refused = (error: unknown) => error instanceof ApiRequestError && error.status >= 400 && error.status < 500 && error.status !== 401 && error.code !== 'network';

// GET /store/deliveries/:stopId: one delivery of the shop whatever its day, through the same builder as the list, for a
// stop the phone did not keep, such as a receipt of an earlier day opened from a card. Online only. A refusal is the
// server's word, so it is not asked again.
export function useOneDelivery(stopId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['orders', 'deliveries', stopId],
    queryFn: ({ signal }) => api<StoreDelivery>(`/store/deliveries/${encodeURIComponent(stopId)}`, { signal }),
    enabled,
    retry: (count, error) => count < 1 && !refused(error),
  });
}

// What decides the screen: the phone's deliveries and records, the one-delivery read as the page last made it, the
// queue's sync state, the signal, the app clock's day, and whether a receipt was already shown as saved in this tab.
export interface ScreenInput {
  view: DeliveriesView;
  stopId: string | null;
  one: { data: StoreDelivery | undefined; error: unknown; isError: boolean; isSuccess: boolean };
  failure: string | null;
  unanswered: string[];
  signedOut: boolean;
  signal: boolean;
  today: string | null;
  shownSaved: (writeId: string) => boolean;
}

export type DeliveriesScreen =
  | { show: 'could-not-read' }
  | { show: 'loading' }
  | { show: 'could-not-load'; reason: string; readAgain: boolean }
  | { show: 'redirect'; stopId: string }
  | { show: 'nothing' }
  | { show: 'not-on-list' }
  | { show: 'refused'; record: ReceiptRecord; drawn: StoreDelivery | null; depot: StoreDelivery | null; outlet: StoreOutlet; today: string; listed: boolean }
  | { show: 'saved'; record: ReceiptRecord; drawn: StoreDelivery | null; outlet: StoreOutlet; today: string }
  | { show: 'sending'; record: ReceiptRecord; delivery: StoreDelivery; outlet: StoreOutlet; today: string }
  | { show: 'sent' | 'form'; delivery: StoreDelivery; outlet: StoreOutlet; today: string };

// Which screen Deliveries shows (rules 1 and 6, plan.md "The pages"). The list opens the stop of the first receipt
// waiting or refused on the phone, else the first delivery to confirm, else says nothing is waiting. A stop shows its
// receipt on the phone, drawn from the record itself with the shop it keeps, whether or not the phone kept the
// deliveries; else the delivery the phone kept; else the one the server answers, whose refusal wins over an older
// answer still in the cache. "Could not load" is for a phone that kept neither deliveries nor a receipt it can draw.
export function screenOf(input: ScreenInput): DeliveriesScreen {
  const { view, stopId, one } = input;
  if (view.failed) return { show: 'could-not-read' };
  if (!view.ready) return { show: 'loading' };
  const { day } = view;
  const unloaded = (): DeliveriesScreen =>
    (input.failure !== null || !input.signal ? { show: 'could-not-load', reason: input.failure ?? NO_SIGNAL, readAgain: false } : { show: 'loading' });

  if (stopId === null) {
    const first = view.records[0]?.write.stopId ?? day?.deliveries.find((delivery) => delivery.receipt === null)?.stopId;
    if (first) return { show: 'redirect', stopId: first };
    return day ? { show: 'nothing' } : unloaded();
  }

  const record = recordFor(view, stopId);
  const outlet = record?.shown?.outlet ?? day?.outlet ?? null;
  if (record && outlet) {
    // "Saved at 08:31" says its day when that is not the app clock's today.
    const today = input.today ?? day?.today ?? depotDayOf(record.savedAt);
    const drawn = drawnRecord(record, outlet, today);
    if (record.state === 'refused') {
      // The delivery as the depot has it, from the deliveries the phone kept or the one-delivery read, so a receipt
      // refused because another device confirmed first shows what that confirmation said (Q-37).
      const listed = day?.deliveries.find((delivery) => delivery.stopId === stopId) ?? null;
      const depot = listed ?? (one.data?.stopId === stopId ? one.data : null);
      return { show: 'refused', record, drawn, depot, outlet, today, listed: listed !== null };
    }
    // On its way: the form says "Sending…" while the phone has a signal and no send of it went unanswered. Once the
    // saved screen was up, it stays.
    const goes = input.signal && !input.unanswered.includes(record.write.writeId) && !input.signedOut;
    if (goes && record.shown && !input.shownSaved(record.write.writeId)) return { show: 'sending', record, delivery: record.shown, outlet, today };
    return { show: 'saved', record, drawn, outlet, today };
  }
  if (!day) return unloaded();

  // "Arrived 03:34" says its day when that is not the app clock's today.
  const today = input.today ?? day.today;
  const kept = day.deliveries.find((delivery) => delivery.stopId === stopId);
  if (kept) return { show: kept.receipt ? 'sent' : 'form', delivery: kept, outlet: day.outlet, today };
  // The server's refusal of the stop is newer than any answer the cache still holds for it.
  if (one.isError && refused(one.error)) return { show: 'not-on-list' };
  // The server answers one stop of this shop, so the shop on screen is the day's.
  const fetched = one.data?.stopId === stopId ? one.data : null;
  if (fetched) return { show: fetched.receipt ? 'sent' : 'form', delivery: fetched, outlet: day.outlet, today };
  if (one.isError) return { show: 'could-not-load', reason: reasonOf(one.error), readAgain: true };
  if (one.isSuccess) return { show: 'not-on-list' };
  return { show: 'loading' };
}

// The receipts shown as saved on this phone in this tab. Once the saved screen is up, it stays until the receipt is in
// or refused, and its button says "Sending…" while it goes, rather than the form coming back.
const shownSaved = new Set<string>();
export const wasShownSaved = (writeId: string) => shownSaved.has(writeId);
export const markShownSaved = (writeId: string) => { shownSaved.add(writeId); };

// The service worker keeps every picture, but it answers only a page it controls, which the first page after it is
// installed is not. So Deliveries fetches the pictures its later states show as soon as it opens, while there is a
// signal, and holds on to them, as the driver's area does: a receipt saved with no signal still has its tray.
let held: HTMLImageElement[] | null = null;
export function holdPictures() {
  held ??= [tray, receipt, shortfall, damaged, proofPhoto].map((src) => {
    const picture = new Image();
    picture.decoding = 'async';
    picture.src = src;
    return picture;
  });
}
