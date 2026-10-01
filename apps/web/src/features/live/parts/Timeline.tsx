import type { OperationsTimeline, OperationsTrip, StopDetail } from '@wayfinder/contracts';
import { clockTime } from '@/features/loader/words';
import { cn } from '@/lib/utils';
import { NOT_RECORDED, timeOn } from '../words';
import { LINE_CELL, ROW, placeOn } from './axis';
import { isRecorded } from './rows';

// Live day's timelines (spec 016, rule 4): one row per trip on the section's shared axis, 02:00 to 22:00 or wider when
// a mark falls outside. A thin planned track carries the sent leave, stop and return times; the recorded departure,
// arrivals, outcomes and return are solid marks of their own. Delivered is teal, refused or closed red, and the next
// stop is ringed. Nothing moves a truck between stops or fills a line up to now. Placing a time on the axis is the one
// sum done here.

// The axis above a section's trips: the hours every two hours, "now" in bold, and the legend's three marks.
export function Axis({ timeline, date, now }: { timeline: OperationsTimeline; date: string; now: number | null }) {
  // A tick label that would sit under "now" gives it the room, as the frame does.
  const clear = (tick: string) => now === null || Math.abs(Date.parse(tick) - now) > 75 * 60_000;
  return (
    <div className={cn(ROW, 'h-[22px] px-6')}>
      <div className="col-span-2 flex items-center gap-3 text-[10px] leading-3 text-muted-foreground xl:col-span-3">
        <Legend />
      </div>
      <div className={cn(LINE_CELL, 'relative h-full')}>
        {/* Below 1280 every other hour is labelled, so the labels never run into each other. */}
        {timeline.ticks.map((tick, i) => clear(tick) && (
          <span key={tick} className={cn('absolute top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-[10px] leading-3 whitespace-nowrap text-muted-foreground', i % 2 === 1 && 'max-xl:hidden')} style={{ left: `${placeOn(timeline, tick)}%` }}>
            {timeOn(tick, date)}
          </span>
        ))}
        {now !== null && (
          <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-[10px] leading-3 font-bold" style={{ left: `${placeOn(timeline, now)}%` }}>now</span>
        )}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <>
      <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="size-2 rounded-full border-[1.5px] border-good bg-card" />Planned</span>
      <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="size-2 rounded-full bg-good" />Recorded</span>
      <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="size-2 rounded-full border-2 border-bad bg-card" />Problem</span>
    </>
  );
}

// The now line through a section's rows: an overlay with the rows' own columns, so it sits on every timeline.
export function NowLine({ timeline, now }: { timeline: OperationsTimeline; now: number | null }) {
  if (now === null) return null;
  return (
    <div aria-hidden="true" className={cn(ROW, 'pointer-events-none absolute inset-0 z-[1] px-6')}>
      <div className={cn(LINE_CELL, 'relative h-full')}>
        <span className="absolute inset-y-0 w-px -translate-x-1/2 bg-foreground/70" style={{ left: `${placeOn(timeline, now)}%` }} />
      </div>
    </div>
  );
}

const at = (timeline: OperationsTimeline, moment: string) => ({ left: `${placeOn(timeline, moment)}%` });
const MARK = 'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full';

// One trip's line: the sent schedule as a thin track with open stop marks, and what was recorded as solid marks.
export function TripLine({ trip, timeline, className }: { trip: OperationsTrip; timeline: OperationsTimeline; className?: string }) {
  if (!isRecorded(trip)) return <span className={cn('text-[10px] leading-3 text-muted-foreground', className)}>{NOT_RECORDED}</span>;
  const { schedule, stopDetails: stops } = trip;
  const t = trip.trip;
  const next = trip.outRow?.nextStop?.id ?? (t.status === 'done' ? null : trip.figures.next?.id ?? null);
  // The recorded line runs between recorded marks only: from leaving to the last thing recorded, never to now.
  const recorded = [t.leftAt, ...stops.flatMap((stop) => [stop.arrivedAt, stop.doneAt]), t.backAt].filter((m): m is string => m !== null);
  const last = recorded.length ? recorded.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a)) : null;
  const from = placeOn(timeline, schedule.leavesAt);
  const to = placeOn(timeline, schedule.backAt);
  return (
    <span className={cn('relative block h-[18px]', className)}>
      <span aria-hidden="true">
        <span className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-good-tint" style={{ left: `${from}%`, width: `${Math.max(0, to - from)}%` }} />
        {stops.map((stop) => <PlannedStop key={stop.id} stop={stop} timeline={timeline} next={stop.id === next} />)}
        {t.leftAt && last && (
          <span className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-good" style={{ left: `${placeOn(timeline, t.leftAt)}%`, width: `${Math.max(0.6, placeOn(timeline, last) - placeOn(timeline, t.leftAt))}%` }} />
        )}
        {t.leftAt && <span title={`Left ${clockTime(t.leftAt)}`} className={cn(MARK, 'size-2 bg-good')} style={at(timeline, t.leftAt)} />}
        {stops.map((stop) => <RecordedStop key={stop.id} stop={stop} timeline={timeline} />)}
        {t.backAt && <span title={`Back ${clockTime(t.backAt)}`} className={cn(MARK, 'size-2.5 bg-foreground')} style={at(timeline, t.backAt)} />}
      </span>
      <span className="sr-only">{describe(trip)}</span>
    </span>
  );
}

function PlannedStop({ stop, timeline, next }: { stop: StopDetail; timeline: OperationsTimeline; next: boolean }) {
  return (
    <span
      title={`${stop.shopName} planned ${clockTime(stop.plannedArrival)}`}
      className={cn(MARK, next ? 'z-[2] size-3.5 border-2 border-foreground bg-card' : 'size-2.5 border-[1.5px] border-good bg-card')}
      style={at(timeline, stop.plannedArrival)}
    />
  );
}

function RecordedStop({ stop, timeline }: { stop: StopDetail; timeline: OperationsTimeline }) {
  const problem = stop.outcome === 'refused' || stop.outcome === 'closed';
  return (
    <>
      {stop.arrivedAt && <span title={`${stop.shopName} arrived ${clockTime(stop.arrivedAt)}`} className={cn(MARK, 'size-2 bg-good')} style={at(timeline, stop.arrivedAt)} />}
      {stop.doneAt && (
        <span
          title={`${stop.shopName} ${stop.outcome ?? 'done'} ${clockTime(stop.doneAt)}`}
          className={cn(MARK, 'z-[2]', problem ? 'size-3.5 border-2 border-bad bg-card' : 'size-2.5 bg-good')}
          style={at(timeline, stop.doneAt)}
        />
      )}
    </>
  );
}

// The marks in words, for a screen reader: the sent times, then what was recorded.
function describe(trip: Extract<OperationsTrip, { detailRecorded: true }>) {
  const planned = [`leaves ${clockTime(trip.schedule.leavesAt)}`, ...trip.stopDetails.map((stop) => `${stop.shopName} ${clockTime(stop.plannedArrival)}`), `back ${clockTime(trip.schedule.backAt)}`];
  const t = trip.trip;
  const recorded = [
    t.leftAt && `left ${clockTime(t.leftAt)}`,
    ...trip.stopDetails.flatMap((stop) => [stop.arrivedAt && `${stop.shopName} arrived ${clockTime(stop.arrivedAt)}`, stop.doneAt && `${stop.outcome ?? 'done'} ${clockTime(stop.doneAt)}`]),
    t.backAt && `back ${clockTime(t.backAt)}`,
  ].filter(Boolean);
  return `Planned: ${planned.join(', ')}. ${recorded.length ? `Recorded: ${recorded.join(', ')}.` : 'Nothing recorded yet.'}`;
}
