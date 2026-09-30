import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { OrderListName, StoreOrderList } from '@wayfinder/contracts';
import { api } from '@/lib/api';

export const ordersKey = (list: OrderListName) => ['orders', 'store', list] as const;

const fetchOrders = (list: OrderListName, cursor?: string) =>
  api<StoreOrderList>(`/store/orders?list=${list}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);

// The orders that count for today, chilled first.
export function useTodayOrders() {
  return useQuery({ queryKey: ordersKey('today'), queryFn: () => fetchOrders('today') });
}

// Everything placed and not yet received, earliest day first, with how many there are.
export function useOpenOrders() {
  return useQuery({ queryKey: ordersKey('open'), queryFn: () => fetchOrders('open') });
}

// Received orders, newest day first, 20 at a time. The next page is asked for with the cursor of the last one.
export function usePastOrders(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ordersKey('past'),
    queryFn: ({ pageParam }) => fetchOrders('past', pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}
