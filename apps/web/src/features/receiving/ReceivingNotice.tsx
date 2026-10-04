import type { ReceivingState } from '@wayfinder/contracts';
import { inDepot } from '@/lib/clock';
import { shortDay } from '@/features/store/words';
import { statusWords } from './words';
export function ReceivingNotice({ state, stale = false }: { state: ReceivingState | null | undefined; stale?: boolean }) {
  if (!state) return <p className="mt-3 text-center text-xs text-muted-foreground">Receiving status unknown</p>;
  const updated = state.updatedAt ? inDepot(Date.parse(state.updatedAt)) : null;
  return <div className="mt-3 rounded-lg border px-3 py-2.5 text-sm">
    <p className="font-semibold">{stale ? 'Last known · ' : ''}{statusWords[state.status]} · {shortDay(state.date)}</p>
    {state.note && <p className="mt-1">{state.note}</p>}
    <p className="mt-1 text-xs text-muted-foreground">{updated ? `Updated ${updated.day} ${updated.time}` : 'No declaration recorded'}</p>
  </div>;
}
