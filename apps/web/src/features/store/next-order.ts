import { useQuery } from '@tanstack/react-query';
import type { PlaceOrdersRequest, PlaceOrdersResponse, SaveDraftRequest, StoreNextOrder } from '@wayfinder/contracts';
import { api } from '@/lib/api';

// Every key of the shop's screens starts with the topic 'orders', so the live "orders" message refetches them.
export const nextOrderKey = ['orders', 'store', 'next'] as const;

// The save or place that is running. Writes go one after the other, and the next order is never read while
// one runs, so an older answer cannot land on top of a newer one. A write that is aborted ends at once, so one
// that never answers holds nothing behind it once its form gives up on it (Q-04).
let writing: Promise<unknown> = Promise.resolve();

function write<T>(request: () => Promise<T>): Promise<T> {
  const run = writing.then(request);
  // The chain itself never rejects, or one failed save would fail every write after it.
  writing = run.catch(() => undefined);
  return run;
}

export const fetchNextOrder = async () => {
  await writing;
  return api<StoreNextOrder>('/store/next-order');
};

// The shop, its items, the day an order placed now is for, the draft and what is already placed for that day.
export function useNextOrder() {
  return useQuery({ queryKey: nextOrderKey, queryFn: fetchNextOrder });
}

// Saves the whole draft and answers like the read, with the new refs, saved time and summary. The signal aborts it.
export const saveDraft = (body: SaveDraftRequest, signal?: AbortSignal) =>
  write(() => api<StoreNextOrder>('/store/next-order/draft', { method: 'PUT', json: body, signal }));

// Places the drafts it names. Naming drafts that are already placed answers with those orders and makes
// nothing new, so trying again after a lost answer is safe. The signal aborts it.
export const placeOrders = (body: PlaceOrdersRequest, signal?: AbortSignal) =>
  write(() => api<PlaceOrdersResponse>('/store/next-order/place', { method: 'POST', json: body, signal }));
