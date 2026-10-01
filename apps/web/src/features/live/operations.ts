import { useEffect, useSyncExternalStore } from 'react';
import { onlineManager, queryOptions, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Me, OperationsDay } from '@wayfinder/contracts';
import { useMe } from '@/features/auth/api';
import { api } from '@/lib/api';
import { useAppClock } from '@/lib/clock';

// The day the dispatcher watches (spec 016, plan.md "Live updates and query ordering"): one GET /operations that the
// dashboard and Live day share. The key starts with the topic, so the live stream's plans, loading, driver, orders
// and issues messages fetch it again (T0's fan-out in lib/live.ts), and a clock or demo message fetches everything.
// It names the account and the depot, so another account never starts from the last one's day.
export const operationsKey = (me: Pick<Me, 'id' | 'depotId'> | null | undefined) => ['operations', me?.id ?? null, me?.depotId ?? null] as const;

// The request carries the query's signal: a newer read cancels an older one, whose answer then never lands, so an
// older day can never replace a newer one (AC-34). Each answer replaces the whole day in one step.
export const operationsOptions = (me: Pick<Me, 'id' | 'depotId'> | null | undefined) => queryOptions({
  queryKey: operationsKey(me),
  queryFn: ({ signal }) => api<OperationsDay>('/operations', { signal }),
  enabled: Boolean(me?.id && me.depotId),
});

// The watched day changes at 16:00 (D-66), which the read names as dayChangesAt. From then on the app clock has
// passed it, and the day on screen is the old one.
export const dayHasChanged = (day: OperationsDay | undefined, at: number | null) =>
  Boolean(day?.dayChangesAt) && at !== null && at >= Date.parse(day!.dayChangesAt!);

// Asks for the new day at once. A read still out for the old day is cancelled, so it cannot land after the new one.
export const followDay = (qc: QueryClient, me: Pick<Me, 'id' | 'depotId'> | null | undefined) =>
  qc.invalidateQueries({ queryKey: operationsKey(me), exact: true }, { cancelRefetch: true });

// A live message, or the 16:00 day change, while a read is out and no day is on screen yet would be lost: TanStack
// hands it the read already on its way, whose snapshot is from before the change. Such a message asks again once
// that read lands. With a day on screen a message already cancels the older read and asks again by itself.
export function followMessages(qc: QueryClient) {
  const asked = new Set<string>();
  return qc.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.query.queryKey[0] !== 'operations') return;
    const { query, action } = event;
    if (action.type === 'invalidate' && query.state.fetchStatus === 'fetching' && query.state.data === undefined) asked.add(query.queryHash);
    else if (action.type === 'success' && asked.delete(query.queryHash)) void qc.invalidateQueries({ queryKey: query.queryKey, exact: true });
    else if (action.type === 'error') asked.delete(query.queryHash);
  });
}

// The page is live only while its last read worked, no read is held back for want of a connection, and this
// browser is online, which is when the live stream can reach it. Otherwise it shows the last read and says so.
export const isLive = (query: { data: unknown; isError: boolean; isPaused: boolean }, online: boolean) =>
  query.data !== undefined && !query.isError && !query.isPaused && online;
export const useOnline = () => useSyncExternalStore((change) => onlineManager.subscribe(change), () => onlineManager.isOnline());

// Both dispatcher pages read the day through here. The page moves to the next day when the app clock reaches 16:00,
// even with no clock message on the stream, and the existing one-minute refetch keeps it current besides.
export function useOperations() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  useEffect(() => followMessages(qc), [qc]);
  const query = useQuery(operationsOptions(me));
  const { at } = useAppClock();
  const changed = dayHasChanged(query.data, at);
  const changesAt = query.data?.dayChangesAt ?? null;
  useEffect(() => {
    if (changed) void followDay(qc, me);
  }, [changed, changesAt, qc, me]);
  return query;
}
