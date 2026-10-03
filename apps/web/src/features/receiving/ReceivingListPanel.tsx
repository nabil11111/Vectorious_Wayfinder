import { useQuery } from '@tanstack/react-query';
import { useMe } from '@/features/auth/api';
import { useOnline } from '@/features/live/operations';
import { depotDay } from '@/features/live/words';
import { shortDay } from '@/features/store/words';
import { useAppClock } from '@/lib/clock';
import { receivingListOptions, useFollowReceiving } from './api';
import { ReceivingNotice } from './ReceivingNotice';
export function ReceivingListPanel({ depot }: { depot: string }) {
  const { data: me } = useMe(); const clock = useAppClock(); const online = useOnline();
  const options = receivingListOptions(me, depot, clock.at === null ? null : depotDay(clock.at), clock.state?.day);
  useFollowReceiving(options.queryKey);
  const query = useQuery(options);
  return <details className="my-3 rounded-lg border bg-card px-4 py-3"><summary className="cursor-pointer text-sm font-semibold">Receiving readiness{query.data?.date ? ` · ${shortDay(query.data.date)}` : ''}</summary>
    {query.isError && <p role="alert" className="mt-2 text-sm">Receiving status unknown. Could not read current declarations. <button className="underline" onClick={() => { void query.refetch(); }}>Read again</button></p>}
    {!query.data ? !query.isError && <p className="mt-2 text-sm">Reading current declarations…</p> : query.data.date === null ? <p className="mt-2 text-sm">No receiving day today.</p> :
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">{query.data.states.map(state => <li key={state.outletId}><p className="text-sm font-semibold">{state.shopName}</p><ReceivingNotice state={state} stale={!online || query.isError} /></li>)}</ul>}
  </details>;
}
