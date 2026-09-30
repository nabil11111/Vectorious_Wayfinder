import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { reasonOf } from '../words';
import { PLAIN } from './actions';
import { Panel } from './Panel';

// The "could not load" card of every shop screen: what failed, why, and a plain Try again.
export function LoadError({ what, error, onRetry, busy = false, line = false }: { what: string; error: unknown; onRetry: () => void; busy?: boolean; line?: boolean }) {
  return (
    <Panel line={line} role="alert">
      <h2 className="font-sans text-[15px] leading-[18px] font-semibold">Could not load {what}</h2>
      <p className="mt-1.5 text-xs leading-[15px] text-muted-foreground">{reasonOf(error)}</p>
      <Button variant="outline" className={cn(PLAIN, 'mt-3 h-11 w-full text-sm')} disabled={busy} onClick={onRetry}>
        {busy ? 'Trying…' : 'Try again'}
      </Button>
    </Panel>
  );
}

// A later fetch that fails leaves the last answer on the screen. This line says it may be out of date, so old
// numbers never pass for fresh ones.
export function StaleNotice({ onRetry, busy = false }: { onRetry: () => void; busy?: boolean }) {
  return (
    <p role="status" className="flex items-center justify-between gap-3 rounded-[10px] bg-warn-tint px-3 py-[9px] text-xs leading-[15px] font-semibold text-warn-ink">
      Could not update. This may be out of date.
      <button type="button" className="-my-3.5 shrink-0 py-3.5 underline underline-offset-2 disabled:opacity-50" disabled={busy} onClick={onRetry}>Try again</button>
    </p>
  );
}
