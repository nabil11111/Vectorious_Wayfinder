import { Link } from 'react-router';
import type { LoadingStop, LoadingTruck } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { orangeButton } from '@/features/plan/parts/look';
import { cn } from '@/lib/utils';
import { leaves, onOfUnits, stopGoingOf, stopUnits, truckName, tripLine, untilLeaving, vehicleWords } from '../words';
import { truckIcon } from './icons';
import { Card, Label, LoadBar, StopChip, Tag } from './ui';

// A stop under "Goes in first": what is left to load, "23 of 24" when a flag lowered a count, and a faded row with
// "✓ on" once it is on.
function GoesIn({ truck, stop }: { truck: LoadingTruck; stop: LoadingStop }) {
  const value = stop.short > 0
    ? <span className="shrink-0 font-mono text-sm leading-5 text-muted-foreground">{stopGoingOf(stop)}</span>
    : stop.loaded
      ? <Tag tone="good" tick>on</Tag>
      : <span className="shrink-0 font-mono text-sm leading-5 text-muted-foreground">{stopUnits(truck, stop)}</span>;
  return (
    <li className="flex items-center gap-3">
      <StopChip seq={stop.seq} />
      <span className={cn('min-w-0 flex-1 truncate text-[15px] leading-5', stop.loaded ? 'text-muted-foreground' : 'font-semibold')}>{stop.shopName}</span>
      {value}
    </li>
  );
}

const BIG_BUTTON = 'mt-7 h-16 w-full rounded-[12px] text-lg';

// Next out (Loader · Today's trucks): the first truck of the day that is not ready, what goes in first, and the one
// orange button. "Start loading" starts the truck and opens it; "Continue loading" opens it.
export function NextOutCard({ truck, at, busy, starting, onStart }: {
  truck: LoadingTruck; at: number | null; busy: boolean; starting: boolean; onStart: () => void;
}) {
  const sub = [untilLeaving(truck.leavesAt, at), vehicleWords(truck)].filter(Boolean).join(' · ');
  return (
    <Card ink className="px-[18px] pt-[18px] pb-[18px] lg:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Label>Next out</Label>
          <h2 className="mt-[7px] text-[22px] leading-7 font-bold lg:mt-[9px] lg:text-[30px] lg:leading-9">{truckName(truck)} · {leaves(truck)}</h2>
          <p className="mt-[5px] text-[15px] leading-5 text-muted-foreground lg:mt-[7px]">{sub}</p>
        </div>
        <img src={truckIcon(truck)} alt="" className="-mt-1 size-14 shrink-0 object-contain lg:mt-1 lg:size-20" />
      </div>

      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[15px] leading-5 font-semibold">{tripLine(truck)}</p>
        <p className="ml-auto font-mono text-sm leading-5 text-muted-foreground">{onOfUnits(truck)}</p>
      </div>
      <LoadBar on={truck.on.units} of={truck.units} className="mt-[11px]" />

      <Label className="mt-4">Goes in first</Label>
      <ul className="mt-2 space-y-1.5">
        {truck.stops.slice(0, 4).map((stop) => <GoesIn key={stop.id} truck={truck} stop={stop} />)}
      </ul>

      {truck.status === 'planned' ? (
        <Button className={orangeButton(BIG_BUTTON)} disabled={busy} focusableWhenDisabled onClick={onStart}>
          {starting ? 'Saving…' : `Start loading ${truckName(truck)}`}
        </Button>
      ) : (
        <Link to={`/loader/trucks/${truck.tripId}`} aria-disabled={busy || undefined} className={orangeButton(cn(BIG_BUTTON, busy && 'pointer-events-none bg-border text-muted-foreground/65'))}>
          Continue loading
        </Link>
      )}
    </Card>
  );
}

// The card's place when there is no truck to load: "Every truck is loaded." and the day's other sentences.
export function DayNote({ children }: { children: string }) {
  return (
    <Card className="px-[18px] py-5 lg:px-6 lg:py-6">
      <p className="text-[15px] leading-5 font-semibold">{children}</p>
    </Card>
  );
}
