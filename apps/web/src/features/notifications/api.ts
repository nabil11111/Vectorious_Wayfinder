import { useCallback } from 'react';
import { queryOptions, useQueries, type UseQueryResult } from '@tanstack/react-query';
import { MAX_NOTIFICATIONS, type Notification, type NotificationList } from '@wayfinder/contracts';
import { api, forDepot } from '@/lib/api';

// The bell's updates (spec 025): GET /notifications under ['notifications'], so the live stream's orders, plans,
// loading, driver and issues messages fetch them again (lib/live.ts), and the minute's refetch keeps them current when
// the stream is down. A dispatcher's read names its depot (spec 021), so on both depots each depot is a read of its own.

export const notificationsKey = ['notifications'] as const;

const updatesOptions = (userId: string | null, depot: string | null) => queryOptions({
  queryKey: ['notifications', userId, depot],
  queryFn: ({ signal }) => api<NotificationList>(depot ? forDepot('/notifications', depot) : '/notifications', { signal }),
  enabled: userId !== null,
});

// An update, and on both depots together the depot it belongs to, which its row names.
export type ShownUpdate = Notification & { depot?: string };
export interface Updates { items: ShownUpdate[]; demoDay: number | null; ready: boolean }

// The person's updates: their own, or a dispatcher's for each depot on show, the two depots' together newest first, at
// most 30 as one read. ready once every read has answered, so a tab never takes one depot's as both.
export function useUpdates(userId: string | null, depots: readonly string[] | null): Updates {
  // By value, so a new list of the same depots keeps the answer the same.
  const shown = depots?.join(',') ?? '';
  const combine = useCallback((reads: UseQueryResult<NotificationList>[]): Updates => {
    const named = shown ? shown.split(',') : [];
    const tagged = named.length > 1;
    const ready = reads.length > 0 && reads.every((read) => read.data !== undefined);
    const items = reads.flatMap((read, i) => (read.data?.items ?? []).map((item) => (tagged ? { ...item, depot: named[i]! } : item)));
    if (tagged) items.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
    return { items: items.slice(0, MAX_NOTIFICATIONS), demoDay: reads[0]?.data?.demoDay ?? null, ready };
  }, [shown]);
  return useQueries({ queries: (shown ? shown.split(',') : [null]).map((depot) => updatesOptions(userId, depot)), combine });
}
