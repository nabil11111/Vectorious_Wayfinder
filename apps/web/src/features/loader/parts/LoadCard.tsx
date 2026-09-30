import { Link } from 'react-router';
import type { LoadingStop, LoadingTruck } from '@wayfinder/contracts';
import { cn } from '@/lib/utils';
import { leaves, loadFigure, stopGoingOf, stopOn, stopOnShort, stopUnits, truckName, tripLine, untilLeaving, vehicleWords, whole } from '../words';
import { truckIcon } from './icons';
import { Card, Label, LoadBar, StopChip, Tag } from './ui';

// "← Trucks" and "← VEH035": the way back, as the frames write it.
export function BackLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="-mt-1 flex w-fit items-center gap-2 rounded-md py-1 text-[15px] leading-5 font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:-mt-2">
      <span aria-hidden="true" className="text-base">←</span>
      {children}
    </Link>
  );
}

// The truck's card on Load a truck: its picture and name, what it is, the units on over its units with the bar,
// when it leaves, and what is on so far over the vehicle's limits.
export function LoadCard({ truck, at, className }: { truck: LoadingTruck; at: number | null; className?: string }) {
  const until = untilLeaving(truck.leavesAt, at);
  return (
    <Card className={cn('px-4 pt-[18px] pb-4 lg:px-5 lg:pb-3.5', className)}>
      <div className="flex items-start gap-2.5">
        <img src={truckIcon(truck)} alt="" className="mt-0.5 size-12 shrink-0 object-contain" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] leading-7 font-bold">{truck.status === 'planned' ? truckName(truck) : `Loading ${truckName(truck)}`}</h1>
          <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">{vehicleWords(truck)} · {tripLine(truck)}</p>
        </div>
        <p className="mt-[15px] shrink-0 whitespace-nowrap lg:mt-1.5">
          <span className="font-heading text-[32px] leading-9 font-bold">{whole(truck.on.units)}</span>
          <span className="ml-1 text-base leading-5 text-muted-foreground">/{whole(truck.units)}</span>
        </p>
      </div>
      <LoadBar on={truck.on.units} of={truck.units} className="mt-2" />
      <div className="mt-2 flex flex-col gap-1 lg:mt-1.5 lg:flex-row lg:items-baseline lg:justify-between lg:gap-3">
        <p className="text-sm leading-5 font-semibold">{[leaves(truck), until].filter(Boolean).join(' · ')}</p>
        <p className="font-mono text-[13px] leading-5 text-muted-foreground">{loadFigure(truck)}</p>
      </div>
    </Card>
  );
}

// A stop in "Load in this order", last stop first: what is left to load, "23 of 24" with a flag lowering a count,
// "✓ 94 on" once loaded, and "23 on · 1 short" in red when it went on short. The stop being loaded is outlined.
function StopRow({ truck, stop, current }: { truck: LoadingTruck; stop: LoadingStop; current: boolean }) {
  const value = stop.loaded
    ? stop.short > 0 ? <Tag tone="bad">{stopOnShort(stop)}</Tag> : <Tag tone="good" tick>{stopOn(stop)}</Tag>
    : stop.short > 0
      ? <span className="shrink-0 text-sm leading-5 font-semibold">{stopGoingOf(stop)}</span>
      : <span className="shrink-0 font-mono text-sm leading-5 text-muted-foreground">{stopUnits(truck, stop)}</span>;
  return (
    <li>
      <Card ink={current} className={cn('flex min-h-[53px] items-center gap-3.5 py-2 pr-5 pl-3.5', current && 'min-h-[55px]')}>
        <StopChip seq={stop.seq} />
        <span className="min-w-0 flex-1 truncate text-[15px] leading-5 font-semibold">{stop.shopName}</span>
        {value}
      </Card>
    </li>
  );
}

export function StopList({ truck, current, className }: { truck: LoadingTruck; current: LoadingStop | null; className?: string }) {
  return (
    <section aria-labelledby="load-order" className={className}>
      <Label id="load-order">Load in this order</Label>
      <ol className="mt-3 space-y-3">
        {truck.stops.map((stop) => <StopRow key={stop.id} truck={truck} stop={stop} current={stop.id === current?.id} />)}
      </ol>
    </section>
  );
}
