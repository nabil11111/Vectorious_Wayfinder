import { useEffect } from 'react';
import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { PHONE_ACCOUNT_HEADER, ReceivingList, StoreReceiving, type Me, type ReceivingStatus } from '@wayfinder/contracts';
import { meKey, useMe } from '@/features/auth/api';
import { depotDay } from '@/features/live/words';
import { api, forDepot } from '@/lib/api';
import { clockKey, shownAt, useAppClock, type HeldClock } from '@/lib/clock';

export const receivingKey = (me: Pick<Me, 'id' | 'outletId'> | null | undefined, date: string | null, demoDay: number | undefined) => ['receiving', 'store', me?.id, me?.outletId, date, demoDay] as const;
export const storeReceivingOptions = (me: Me | null | undefined, date: string | null, demoDay: number | undefined) => queryOptions({
  queryKey: receivingKey(me, date, demoDay), retry: false, retryOnMount: false, enabled: Boolean(me?.outletId && date && demoDay),
  queryFn: async ({ signal }) => {
    const data = StoreReceiving.parse(await api('/store/receiving', { signal }));
    if (data.demoDay !== demoDay || (data.date !== null && data.date !== date)) throw new Error('The receiving day changed. Read it again.');
    return data;
  },
});
export function useStoreReceiving() {
  const { data: me } = useMe(); const clock = useAppClock();
  const options = storeReceivingOptions(me, clock.at === null ? null : depotDay(clock.at), clock.state?.day);
  useFollowReceiving(options.queryKey);
  return { query: useQuery(options), me };
}
// An invalidation during the first snapshot otherwise reuses that in-flight read. Read once more after it lands.
export function followReceiving(qc: QueryClient, key: readonly unknown[]) {
  let asked = false; const hash = JSON.stringify(key);
  return qc.getQueryCache().subscribe(event => {
    if (event.type !== 'updated' || JSON.stringify(event.query.queryKey) !== hash) return;
    const { query, action } = event;
    if (action.type === 'invalidate' && query.state.fetchStatus === 'fetching' && query.state.data === undefined) asked = true;
    else if (action.type === 'success' && asked) { asked = false; void qc.invalidateQueries({ queryKey: key, exact: true }); }
    else if (action.type === 'error') asked = false;
  });
}
export function useFollowReceiving(key: readonly unknown[]) {
  const qc = useQueryClient(); const hash = JSON.stringify(key);
  useEffect(() => followReceiving(qc, JSON.parse(hash) as unknown[]), [qc, hash]);
}
const stillOwn = (qc: QueryClient, me: Me, held: StoreReceiving) => {
  const current = qc.getQueryData<Me | null>(meKey); const clock = qc.getQueryData<HeldClock>(clockKey);
  return current?.id === me.id && current.outletId === me.outletId && clock?.day === held.demoDay
    && depotDay(shownAt(clock, Math.max(performance.now(), clock.heldAt))) === held.date;
};
// This is a direct, account-bound change. It never enters a phone queue or pauses to run after reconnect.
export const receivingMutation = (qc: QueryClient, me: Me, held: StoreReceiving) => ({
  mutationKey: ['receiving', 'save', me.id, held.date, held.demoDay], networkMode: 'always' as const, retry: false,
  mutationFn: async (change: { status: ReceivingStatus; note: string }) => {
    if (!navigator.onLine) throw new Error('You are offline. Connect and read readiness again before saving.');
    if (!held.date || !held.state || !stillOwn(qc, me, held)) throw new Error('The account or day changed. Read readiness again.');
    const cancel = new AbortController();
    const unsubscribe = qc.getQueryCache().subscribe(() => { if (!stillOwn(qc, me, held)) cancel.abort(); });
    try {
      const signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(15_000)]);
      const result = StoreReceiving.parse(await api('/store/receiving', { method: 'PUT', signal, headers: { [PHONE_ACCOUNT_HEADER]: me.id },
        json: { date: held.date, demoDay: held.demoDay, revision: held.state.revision, ...change } }));
      if (!stillOwn(qc, me, held)) throw new Error('The account or day changed. Read readiness again.');
      return result;
    } finally { unsubscribe(); }
  },
  onSuccess: async (result: StoreReceiving) => {
    if (!stillOwn(qc, me, held)) return;
    const key = receivingKey(me, held.date, held.demoDay);
    await qc.cancelQueries({ queryKey: key, exact: true });
    if (!stillOwn(qc, me, held)) return;
    const current = qc.getQueryData<StoreReceiving>(key);
    if (!current?.state || current.state.revision <= result.state!.revision) qc.setQueryData(key, result);
    void qc.invalidateQueries({ queryKey: key, exact: true });
  },
});
export function useSaveReceiving(me: Me, held: StoreReceiving) { return useMutation(receivingMutation(useQueryClient(), me, held)); }
export const receivingListOptions = (me: Me | null | undefined, depot: string, date: string | null, demoDay: number | undefined) => queryOptions({
  queryKey: ['receiving', 'depot', me?.id, me?.depotId, depot, date, demoDay], retry: false, retryOnMount: false, enabled: Boolean(me?.id && date && demoDay),
  queryFn: async ({ signal }) => {
    const data = ReceivingList.parse(await api(forDepot('/operations/receiving', depot), { signal }));
    if (data.date !== null && data.date !== date) throw new Error('The receiving day changed. Read it again.');
    return data;
  },
});
