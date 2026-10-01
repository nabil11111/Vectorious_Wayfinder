import { useId, useRef, useState } from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import type { Problem, StopTime, TripTimes } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { hhmm, whole } from '../words';
import { plainButton } from './look';

// The hours the timeline shows at least, as the frame does (03:00 to 09:00).
const SPAN_HOURS = 6;

// What a stop's tooltip says of its shop: its name, and what is unloaded there, worded as the stop list words its
// orders ("12 cartons chilled, 4 dry").
export interface StopShop { name: string; goods: string }

// A trip on a line of hours (Edit plan's timeline): the road from the minute it leaves the depot to the minute it is
// back, with the depot and its time at each end (spec 022), and a dot per stop at the time the checker gives, red when
// it is late, whose tooltip says when the trip is there. Placing a time on the line is the one thing the screen does
// with it. Under it, the trip's problems in the checker's words, and a leaving time that clears one as a single click
// (rule 5). shops holds each stop's shop by its id.
export function Timeline({ times, depot, shops, problems, onLeaveAt }: {
  times: TripTimes | null;
  depot: string;
  shops: ReadonlyMap<string, StopShop>;
  problems: Problem[];
  onLeaveAt: (minutes: number) => void;
}) {
  return (
    <div className="rounded-[10px] bg-muted px-3 pt-2.5 pb-3">
      {times && times.stops.length > 0 ? <Line times={times} depot={depot} shops={shops} /> : <p className="py-2 text-[11px] text-muted-foreground">The trip is timed once it has a stop.</p>}
      {problems.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {problems.map((problem, i) => (
            <li key={`${problem.code}-${problem.stopSeq ?? ''}-${problem.orderId ?? ''}-${i}`} className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-[14px] font-semibold', problem.level === 'block' ? 'text-bad' : 'text-warn-ink')}>
              <span>{problem.message}{problem.fix && problem.leaveAt === undefined && <span className="font-normal text-muted-foreground"> {problem.fix}</span>}</span>
              {problem.leaveAt !== undefined && (
                <Button variant="outline" className={plainButton('h-6 px-2.5 text-[11px]')} onClick={() => onLeaveAt(problem.leaveAt!)}>Leave at {hhmm(problem.leaveAt)}</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Line({ times, depot, shops }: { times: TripTimes; depot: string; shops: ReadonlyMap<string, StopShop> }) {
  // From the hour it leaves in to the hour after it is back, six hours at least.
  const start = Math.floor(times.leaveAt / 60);
  const end = Math.max(start + SPAN_HOURS, Math.ceil((times.backAt + 1) / 60));
  const hours = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  // Where a time sits on the line, from 0 to 100.
  const at = (minutes: number) => ((minutes - start * 60) / ((end - start) * 60)) * 100;
  // The road, from the depot and back to it.
  const road = { left: `${at(times.leaveAt)}%`, width: `${at(times.backAt) - at(times.leaveAt)}%` };
  return (
    // The first and last labels are centred on their hours, so the line runs inside half a label's width.
    <div className="px-[15px]">
      <div className="relative h-4 max-xl:[&>span:nth-child(even)]:hidden">
        {hours.map((hour) => (
          <span key={hour} className="absolute top-0 -translate-x-1/2 font-mono text-[10px] leading-4 text-muted-foreground" style={{ left: `${at(hour * 60)}%` }}>{hhmm(hour * 60)}</span>
        ))}
      </div>
      <div className="relative mt-2 h-4">
        <div aria-hidden="true" className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-good-tint" style={road} />
        <DepotMark end="start" left={at(times.leaveAt)} />
        <DepotMark end="end" left={at(times.backAt)} />
        {times.stops.map((stop) => <StopDot key={stop.seq} time={stop} shop={shops.get(stop.outletId) ?? null} left={at(stop.arriveAt)} />)}
      </div>
      {/* The depot's times under its marks. A trip too short for both keeps them side by side, past its end mark. */}
      <div className="relative mt-1 h-4">
        <p className="absolute flex min-w-max justify-between gap-3 font-mono text-[10px] leading-4 text-muted-foreground" style={road}>
          <span>{`${depot} ${hhmm(times.leaveAt)}`}</span>
          <span>{`back ${hhmm(times.backAt)}`}</span>
        </p>
      </div>
    </div>
  );
}

// The depot at one end of the road: a small ink square, so it never reads as a stop.
function DepotMark({ end, left }: { end: 'start' | 'end'; left: number }) {
  return <span aria-hidden="true" data-depot={end} className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[3px] bg-secondary" style={{ left: `${left}%` }} />;
}

// How late a late stop is: the checker's minutes after its window closed, or just "late" for a stop late with none,
// such as a Fresh shop reached at 08:00, its closing time.
const lateOf = (time: StopTime) => (time.lateMin > 0 ? `${whole(time.lateMin)} min late` : 'late');

// A stop's dot, a button with a small tooltip of the stop's times (spec 022). The popover opens it when a mouse points
// at it and when it is pressed or tapped; a keyboard's focus opens it through the popover's handle, so the popover keeps
// its own order: Tab goes into the tooltip and then on to the next stop, and Escape closes it. Focus the popover gives
// back after Escape does not open it again. A mouse press focuses without :focus-visible, so the press alone counts.
function StopDot({ time, shop, left }: { time: StopTime; shop: StopShop | null; left: number }) {
  const id = useId();
  const [handle] = useState(() => PopoverPrimitive.createHandle());
  const dismissed = useRef(false);
  const name = shop?.name ?? time.outletId;
  return (
    <Popover handle={handle} onOpenChange={(open, details) => { if (!open && details.reason === 'escape-key') dismissed.current = true; }}>
      <PopoverTrigger
        id={id}
        handle={handle}
        openOnHover
        delay={100}
        aria-label={[`Stop ${whole(time.seq)}`, name, `arrives ${hhmm(time.arriveAt)}`, time.late && lateOf(time)].filter(Boolean).join(', ')}
        onFocus={(event) => {
          if (dismissed.current) dismissed.current = false;
          else if (event.currentTarget.matches(':focus-visible')) handle.open(id);
        }}
        onBlur={() => { dismissed.current = false; }}
        className="absolute top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        style={{ left: `${left}%` }}
      >
        <span className={cn('rounded-full', time.late ? 'size-4 bg-bad' : 'size-3.5 border-2 border-good bg-card')} />
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={4} initialFocus={false} aria-label={`Stop ${whole(time.seq)} · ${name}`} className="w-auto max-w-64 gap-0.5 px-3 py-2 text-left">
        <StopTip time={time} name={name} goods={shop?.goods ?? null} />
      </PopoverContent>
    </Popover>
  );
}

// What a stop's tooltip says, and nothing else: the stop and its shop, when the trip arrives, waits and leaves, the
// window the checker timed it against, what is unloaded there, and for a late stop how late, in the stop's red.
export function StopTip({ time, name, goods }: { time: StopTime; name: string; goods: string | null }) {
  return (
    <>
      <p className="text-xs leading-4 font-semibold">{`Stop ${whole(time.seq)} · ${name}`}</p>
      <p className="text-[11px] leading-[15px]">{[`arrives ${hhmm(time.arriveAt)}`, time.waitMin > 0 && `waits ${whole(time.waitMin)}`, `leaves ${hhmm(time.leaveAt)}`].filter(Boolean).join(' · ')}</p>
      <p className="text-[11px] leading-[15px] text-muted-foreground">{`window ${hhmm(time.windowOpen)} to ${hhmm(time.windowClose)}`}</p>
      {goods && <p className="text-[11px] leading-[15px] text-muted-foreground">{goods}</p>}
      {time.late && <p className="text-[11px] leading-[15px] font-semibold text-bad">{lateOf(time)}</p>}
    </>
  );
}
