import type { Problem, TripTimes } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { hhmm } from '../words';
import { plainButton } from './look';

// The hours the timeline shows at least, as the frame does (03:00 to 09:00).
const SPAN_HOURS = 6;

// A trip on a line of hours (Edit plan's timeline): from the hour it leaves, the road to its last stop, and a dot
// per stop at the time the checker gives, red when it is late. Placing a stop on the line is the one thing the
// screen does with a time. Under it, the trip's problems in the checker's words, and a leaving time that clears
// one as a single click (rule 5).
export function Timeline({ times, problems, onLeaveAt }: { times: TripTimes | null; problems: Problem[]; onLeaveAt: (minutes: number) => void }) {
  return (
    <div className="rounded-[10px] bg-muted px-3 pt-2.5 pb-3">
      {times && times.stops.length > 0 ? <Line times={times} /> : <p className="py-2 text-[11px] text-muted-foreground">The trip is timed once it has a stop.</p>}
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

function Line({ times }: { times: TripTimes }) {
  const last = times.stops.at(-1)!;
  const start = Math.floor(times.leaveAt / 60);
  const end = Math.max(start + SPAN_HOURS, Math.ceil((last.arriveAt + 1) / 60));
  const hours = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  // Where a time sits on the line, from 0 to 100.
  const at = (minutes: number) => ((minutes - start * 60) / ((end - start) * 60)) * 100;
  return (
    // The first and last labels are centred on their hours, so the line runs inside half a label's width.
    <div className="px-[15px]">
      <div className="relative h-4">
        {hours.map((hour) => (
          <span key={hour} className="absolute top-0 -translate-x-1/2 font-mono text-[10px] leading-4 text-muted-foreground" style={{ left: `${at(hour * 60)}%` }}>{hhmm(hour * 60)}</span>
        ))}
      </div>
      <div className="relative mt-2 h-4" aria-hidden="true">
        <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-good-tint" style={{ left: `${at(times.leaveAt)}%`, width: `${at(last.arriveAt) - at(times.leaveAt)}%` }} />
        {times.stops.map((stop) => (
          <span
            key={stop.seq}
            className={cn('absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full', stop.late ? 'size-4 bg-bad' : 'size-3.5 border-2 border-good bg-card')}
            style={{ left: `${at(stop.arriveAt)}%` }}
          />
        ))}
      </div>
      <p className="sr-only">{times.stops.map((stop) => `Stop ${stop.seq} at ${hhmm(stop.arriveAt)}${stop.late ? ', late' : ''}`).join('. ')}</p>
    </div>
  );
}
