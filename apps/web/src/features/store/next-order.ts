import { useQuery } from '@tanstack/react-query';
import type { StoreNextOrder } from '@wayfinder/contracts';
import { api } from '@/lib/api';

// Every key of the shop's screens starts with the topic 'orders', so the live "orders" message refetches them.
export const nextOrderKey = ['orders', 'store', 'next'] as const;

// The shop, its items, the day an order placed now is for, the draft and what is already placed for that day.
export function useNextOrder() {
  return useQuery({ queryKey: nextOrderKey, queryFn: () => api<StoreNextOrder>('/store/next-order') });
}
