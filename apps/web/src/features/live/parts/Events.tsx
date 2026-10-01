import { useId } from 'react';
import type { OperationsDay, OperationsEvent } from '@wayfinder/contracts';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { clockTime } from '@/features/loader/words';
import { inDepot } from '@/lib/clock';
import { NO_EVENTS, depotDay, eventLine } from '../words';
import { ICON } from './icons';
import { allTrips, isRecorded } from './rows';
import { Card } from './ui';

// Drops and events (spec 016, rule 7, D-69): the day's business records for the trips on show, latest first, as the
// read sends them. The list is replaced on every read, never added to, so a retry cannot repeat an event. A photo is
// the words "· photo" only: no link and no picture.
export function Events({ day, className }: { day: OperationsDay | undefined; className?: string }) {
  // Its own heading's id, as Live day on both depots together shows a card per depot (spec 021).
  const title = useId();
  if (!day) return <EventsSkeleton className={className} />;
  // A stop's own figures say how many were delivered or refused there; the event's lines are not added up.
  const figures = new Map(allTrips(day).filter(isRecorded).flatMap((trip) => trip.stopDetails.map((stop) => [stop.id, stop.figures] as const)));
  return (
    <Card aria-labelledby={title} className={cn('px-5 pt-[18px] pb-4', className)}>
      <div className="flex items-center gap-2.5">
        <img src={ICON.events} alt="" className="size-[26px] object-contain" />
        <h2 id={title} className="text-[15px] leading-5 font-bold">Drops and events</h2>
      </div>
      {day.events.length === 0 ? (
        <p className="mt-3 text-xs leading-4 text-muted-foreground">{NO_EVENTS}</p>
      ) : (
        <ol className="mt-2.5 border-t">
          {day.events.map((event) => (
            <li key={event.key} className="flex items-baseline gap-2.5 border-b py-[7px] last:border-0">
              <EventTime at={event.at} day={day.day} />
              <span aria-hidden="true" className={cn('size-1.5 shrink-0 translate-y-[-1px] rounded-full', DOT[toneOf(event)])} />
              <span className="min-w-0 text-[11px] leading-[15px]">
                {eventLine(event, event.stopId ? figures.get(event.stopId) : undefined)}
                {event.hasPhoto && ' · photo'}
              </span>
            </li>
          ))}
        </ol>
      )}
      {day.eventsTruncated && <p className="mt-2 text-[10px] leading-3 text-muted-foreground">Latest 50 events</p>}
    </Card>
  );
}

// "03:48", and for another day its weekday under the time, so the column keeps its width: "16:00" over "Wed".
function EventTime({ at, day }: { at: string; day: string | null }) {
  const other = day !== null && depotDay(at) !== day;
  return (
    <span className="w-[30px] shrink-0 font-mono text-[10px] leading-3 text-muted-foreground">
      {clockTime(at)}
      {other && <span className="block font-sans">{inDepot(Date.parse(at)).weekday}</span>}
    </span>
  );
}

const DOT = { good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad', quiet: 'bg-muted-foreground/60' } as const;
function toneOf(event: OperationsEvent): keyof typeof DOT {
  if (event.kind === 'problem_raised') return event.issueKind === 'refused' ? 'bad' : 'warn';
  if (event.kind === 'answer_sent' || event.kind === 'plan_sent') return 'quiet';
  return 'good';
}

function EventsSkeleton({ className }: { className?: string }) {
  return (
    <Card role="status" aria-label="Loading the events" className={cn('px-5 pt-[18px] pb-4', className)}>
      <div className="flex items-center gap-2.5">
        <Skeleton soft className="size-[26px] rounded-md" />
        <Skeleton className="h-3 w-40 rounded-full" />
      </div>
      <div className="mt-3 border-t">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="flex items-center gap-2.5 border-b py-[9px] last:border-0">
            <Skeleton className="h-2.5 w-[30px] rounded-full" />
            <Skeleton soft className="size-1.5 rounded-full" />
            <Skeleton className="h-2.5 flex-1 rounded-full" />
          </div>
        ))}
      </div>
    </Card>
  );
}
