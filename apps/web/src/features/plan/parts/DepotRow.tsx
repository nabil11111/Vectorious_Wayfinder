import { cn } from '@/lib/utils';
import { hhmm } from '../words';

// The depot at one end of a trip's stops (spec 022): before stop 1, "0 · Peliyagoda · leaves 03:30", and after the last
// stop, "Peliyagoda · back 10:20", at the checker's times. A quiet row, not a stop, so it sits outside the list of stops
// and nothing moves it. small is the row of Done's card, and the other the middle's "Stops in order".
export function DepotRow({ end, depot, at, small = false, className }: { end: 'start' | 'end'; depot: string; at: number; small?: boolean; className?: string }) {
  return (
    <div data-depot={end} className={cn('flex items-center text-muted-foreground', small ? 'gap-2 text-[11px] leading-[14px]' : 'gap-2.5 border-t py-[9px] text-xs leading-[15px]', className)}>
      <span className={cn('flex shrink-0 items-center justify-center rounded-full font-bold', small ? 'size-[18px] text-[10px]' : 'size-[22px] text-[11px]', end === 'start' && 'border border-dashed border-mute')}>
        {end === 'start' ? '0' : null}
      </span>
      {/* The time column of the stops, so the depot lines up with their shops. */}
      <span aria-hidden="true" className={cn('shrink-0', small ? 'w-9' : 'w-10')} />
      <span className="min-w-0 truncate">{`${depot} · ${end === 'start' ? 'leaves' : 'back'} ${hhmm(at)}`}</span>
    </div>
  );
}
