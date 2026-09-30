import { useQuery } from '@tanstack/react-query';
import type { StoreOrderList } from '@wayfinder/contracts';
import { api } from '@/lib/api';

export const ordersKey = (list: 'today' | 'open' | 'past') => ['orders', 'store', list] as const;

// The orders that count for today, chilled first.
export function useTodayOrders() {
  return useQuery({ queryKey: ordersKey('today'), queryFn: () => api<StoreOrderList>('/store/orders?list=today') });
}
