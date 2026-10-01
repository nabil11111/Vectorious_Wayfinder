import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { DraftTrip, Problem } from '@wayfinder/contracts';
import { cn } from '@/lib/utils';
import { crewName, deferredOn, entranceAndWindow, figure, hhmm } from '../words';
import { vehicleIcon } from './icons';
import type { BoardIndex } from './lookup';
import { toneOf, type Tone } from './look';
import { Tag } from './ui';

const INK: Record<Tone, string> = { good: 'text-foreground', warn: 'text-warn-ink', bad: 'text-bad' };

// A vehicle on View plan: its trips' times, a dot per stop, how full it is by weight and volume, its first problem,
// and its stops when opened. The row is red when a trip of it is blocked and yellow when one warns.
export function VehicleRow({ vehicleId, trips, driverName, index }: { vehicleId: string; trips: DraftTrip[]; driverName: string | null; index: BoardIndex }) {
  const [open, setOpen] = useState(false);
  const vehicle = index.vehicle(vehicleId);
  const checked = trips.map((trip) => ({ trip, check: index.trip(trip.vehicleId, trip.tripNo), figures: index.figures(trip.vehicleId, trip.tripNo), problems: index.problems(trip.vehicleId, trip.tripNo) }));
  const problems: Problem[] = [...new Set(checked.flatMap((c) => c.problems))];
  const first = problems.find((p) => p.level === 'block') ?? problems[0];
  const blocked = problems.some((p) => p.level === 'block');
  const has = (code: string) => problems.some((p) => p.code === code);
  // The fuller of the vehicle's trips, picked rather than worked out.
  const fullest = (pick: 'kgPct' | 'm3Pct') => checked.flatMap((c) => (c.figures ? [c.figures[pick]] : [])).sort((a, b) => b - a)[0];
  const kg = fullest('kgPct');
  const m3 = fullest('m3Pct');
  const dots = checked.flatMap((c) => c.trip.stops.map((_, i) => c.check?.times?.stops[i]?.late ?? false));
  // The truck named by its driver, "Chaminda · dry truck", or by its kind and number with none (spec 026). A row holding
  // only the truck's second trip says so, "· trip 2", as its card on the board does (L-03).
  const alone = trips.length === 1 ? trips[0]!.tripNo : 1;
  const label = vehicle ? crewName(vehicle, driverName, alone) : vehicleId;

  return (
    <li>
      <div className={cn('grid grid-cols-[22px_minmax(0,1fr)_22px] items-center gap-x-3 gap-y-1 rounded-lg px-2 py-[3px] xl:grid-cols-[22px_166px_206px_150px_116px_minmax(0,1fr)_22px]', blocked ? 'bg-bad-tint' : first ? 'bg-warn-tint' : '')}>
        {vehicle && <img src={vehicleIcon(vehicle)} alt="" className="size-[22px] object-contain" />}
        <p className="min-w-0 truncate text-xs leading-[15px] font-semibold">{label}</p>
        {/* One chevron for both states, turned while the stops are open, as Done's cards draw it. */}
        <button type="button" aria-expanded={open} aria-label={open ? `Hide the stops of ${label}` : `Show the stops of ${label}`} onClick={() => setOpen(!open)} className="group col-start-3 row-start-1 flex size-[22px] items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 xl:col-start-7">
          <ChevronDown aria-hidden="true" className="size-3.5 transition-transform group-aria-expanded:rotate-180" />
        </button>
        <p className="col-span-2 col-start-2 font-mono text-[11px] leading-[14px] whitespace-nowrap xl:col-span-1 xl:col-start-auto">
          {checked.map((c) => (c.check?.times ? `${hhmm(c.check.times.leaveAt)} to ${hhmm(c.check.times.backAt)}` : `trip ${c.trip.tripNo}`)).join(' · ')}
        </p>
        <div className="relative col-start-2 hidden h-3.5 xl:col-start-auto xl:block" aria-hidden="true">
          {dots.length > 0 && <div className="absolute inset-x-1.5 top-1/2 h-[5px] -translate-y-1/2 rounded-full bg-good-tint" />}
          <div className="relative flex h-full items-center justify-between">
            {dots.map((late, i) => (
              <span key={i} className={cn('rounded-full border-2', late ? 'size-3 border-bad bg-bad' : blocked ? 'size-[11px] border-bad bg-card' : 'size-[11px] border-good bg-card')} />
            ))}
          </div>
        </div>
        <p className="col-start-2 text-[11px] leading-[14px] xl:col-start-auto">
          {kg !== undefined && <><span className={cn('font-mono font-bold', INK[toneOf(kg, has('over_weight'))])}>{figure(kg)}%</span> <span className="text-[10px] text-muted-foreground">kg</span></>}
          {m3 !== undefined && <> <span className={cn('ml-1 font-mono font-bold', INK[toneOf(m3, has('over_volume'))])}>{figure(m3)}%</span> <span className="text-[10px] text-muted-foreground">m³</span></>}
        </p>
        {first && <p title={first.message} className={cn('col-span-2 col-start-2 truncate text-[11px] leading-[14px] font-semibold xl:col-span-1 xl:col-start-auto', first.level === 'block' ? 'text-bad' : 'text-warn-ink')}>{first.message}</p>}
      </div>
      {open && (
        <div className="px-2.5 pt-1.5 pb-2 xl:pl-[64px]">
          {checked.map(({ trip, check }) => (
            <div key={trip.tripNo} className="pb-1.5">
              {trips.length > 1 && <p className="pb-1 text-[11px] font-semibold text-muted-foreground">Trip {trip.tripNo}</p>}
              <ol className="grid gap-x-8 gap-y-1.5 xl:grid-cols-2">
                {trip.stops.map((stop, i) => {
                  const shop = index.shop(stop.outletId);
                  const time = check?.times?.stops[i];
                  const carried = stop.orderIds.map((id) => index.order(id)).find((order) => order?.carriedOver);
                  return (
                    <li key={stop.outletId} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] leading-[14px]">
                      <span className={cn('flex size-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold', time?.late ? 'bg-bad text-white' : 'bg-muted')}>{i + 1}</span>
                      <span className={cn('font-mono', time?.late && 'text-bad')}>{time ? hhmm(time.arriveAt) : '--:--'}</span>
                      <span className="font-semibold">{shop?.name ?? stop.outletId}</span>
                      {carried && <Tag tone="warn" className="px-2 text-[10px] leading-[13px]">{deferredOn(carried)}</Tag>}
                      {shop && <span className="text-[10px] text-muted-foreground">{entranceAndWindow(shop, time?.windowOpen ?? shop.windowOpen, time?.windowClose ?? shop.windowClose)}</span>}
                      {time && time.waitMin > 0 && <Tag tone="warn" className="px-2 text-[10px] leading-[13px]">waits {time.waitMin} min</Tag>}
                      {time?.late && <Tag tone="bad" className="px-2 text-[10px] leading-[13px]">late</Tag>}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
