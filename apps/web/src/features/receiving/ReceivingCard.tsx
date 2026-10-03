import { useState } from 'react';
import type { Me, ReceivingStatus, StoreReceiving } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { useOnline } from '@/features/live/operations';
import { Panel } from '@/features/store/parts/Panel';
import { shortDay } from '@/features/store/words';
import { DirtyFormWarning } from '@/lib/dirty-form';
import { useSaveReceiving, useStoreReceiving } from './api';
import { ReceivingNotice } from './ReceivingNotice';
import { statusWords } from './words';
export function ReceivingCard() {
  const { query, me } = useStoreReceiving(); const online = useOnline();
  if (!query.data || !me) return <Panel className="my-3"><h2 className="font-semibold">Receiving readiness</h2>
    <p className="mt-1 text-sm">{!online ? 'Offline · receiving status unknown. Connect to read today’s declaration.' : query.isError ? 'Receiving status unknown. Could not read the declaration.' : 'Reading today’s declaration…'}</p>
    {query.isError && <Button variant="outline" className="mt-2" disabled={!online || query.isFetching} onClick={() => { void query.refetch(); }}>Read again</Button>}
  </Panel>;
  if (!query.data.date || !query.data.state) return <Panel className="my-3"><h2 className="font-semibold">Receiving readiness</h2><p className="mt-1 text-sm">No receiving day today.</p></Panel>;
  return <ReceivingForm key={`${me.id}:${me.outletId}:${query.data.date}:${query.data.demoDay}`} me={me} held={query.data} blocked={!online || query.isError || query.isFetching}
    online={online} readError={query.isError} reading={query.isFetching} stale={!online || query.isError} reload={async () => (await query.refetch()).data} />;
}
function ReceivingForm({ me, held, blocked, stale, online, readError, reading, reload }: { me: Me; held: StoreReceiving; blocked: boolean; stale: boolean; online: boolean; readError: boolean; reading: boolean; reload: () => Promise<StoreReceiving | undefined> }) {
  const [base, setBase] = useState(held);
  const [status, setStatus] = useState<ReceivingStatus>(held.state!.status);
  const [note, setNote] = useState(held.state!.note ?? '');
  const dirty = status !== base.state!.status || note !== (base.state!.note ?? '');
  // Background updates preserve entered changes; their old base revision is refused rather than overwriting another manager.
  if (!dirty && held.state!.revision !== base.state!.revision) { setBase(held); setStatus(held.state!.status); setNote(held.state!.note ?? ''); }
  const save = useSaveReceiving(me, base);
  const replace = (data: StoreReceiving) => { if (data.date === held.date && data.demoDay === held.demoDay && data.state) { setBase(data); setStatus(data.state.status); setNote(data.state.note ?? ''); save.reset(); } };
  return <Panel className="my-3"><h2 className="font-semibold">Receiving readiness · {shortDay(held.date!)}</h2>
    <ReceivingNotice state={held.state} stale={stale} />
    {!online && <p className="mt-2 text-xs">Connect and read today’s declaration before saving.</p>}
    {online && readError && <p role="alert" className="mt-2 text-xs">Could not read the current declaration. Read again before saving.</p>}
    <form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); save.mutate({ status, note }, { onSuccess: replace }); }}>
      <label className="block text-sm">Today’s receiving status<select className="mt-1 block w-full rounded-md border bg-background px-3 py-2" value={status} onChange={event => setStatus(event.target.value as ReceivingStatus)} disabled={save.isPending}>
        {Object.entries(statusWords).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select></label>
      <label className="block text-sm">Note (optional)<textarea className="mt-1 block w-full rounded-md border bg-background px-3 py-2" maxLength={200} value={note} onChange={event => setNote(event.target.value)} disabled={save.isPending} /></label>
      {save.isError && <p role="alert" className="text-sm text-bad">Could not confirm the change. {save.error.message} Read again before retrying.</p>}
      <div className="flex gap-2"><Button disabled={blocked || save.isPending || save.isError || !dirty} type="submit">{save.isPending ? 'Saving…' : 'Save readiness'}</Button>
        {(save.isError || readError) && <Button variant="outline" type="button" disabled={!online || reading || save.isPending} onClick={() => { void reload().then(data => { if (data) replace(data); }); }}>Read again</Button>}
      </div>
    </form>
    <DirtyFormWarning dirty={dirty || save.isPending} name="receiving declaration" />
  </Panel>;
}
