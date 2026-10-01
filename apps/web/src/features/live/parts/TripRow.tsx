import type { Issue, OperationsTimeline, OperationsTrip } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { plainButton } from '@/features/plan/parts/look';
import { clockTime, truckName } from '@/features/loader/words';
import { cn } from '@/lib/utils';
import { tripAnchor } from './focus';
import { truckIcon } from './icons';
import { isRecorded, openIssueOf, type RowFacts } from './rows';
import { LINE_CELL, ROW } from './axis';
import { TripLine } from './Timeline';
import { TripDetails } from './TripDetails';
import { Chip } from './ui';

export interface RowActions {
  // The trip whose details are open, if any.
  openTrip: string | null;
  toggle: (tripId: string) => void;
  decide: (issueId: string) => void;
}

const SENTENCE = { bad: 'text-bad', warn: 'text-warn-ink', good: 'text-muted-foreground', plain: 'text-muted-foreground' } as const;

// One trip (Dispatcher · Live day): its truck and driver, what was recorded or which report is missing, its timeline,
// a short status and one button. Decide focuses the trip's open problem card; Open and Decided show the details
// inline below. Below 1024 the row is a card that lists its stops with labelled times instead of a timeline.
export function TripRow({ trip, facts, timeline, issues, actions }: { trip: OperationsTrip; facts: RowFacts; timeline: OperationsTimeline | null; issues: Issue[] | undefined; actions: RowActions }) {
  const open = actions.openTrip === trip.tripId;
  const issue = trip.action === 'decide' ? openIssueOf(trip, issues)?.id ?? trip.openIssueIds[0] ?? null : null;
  const name = truckName(trip);
  // A truck's second trip is its own row; its number leads the sentence, so the name column keeps the vehicle.
  const sentence = trip.tripNo > 1 ? `Trip ${trip.tripNo} · ${facts.sentence}` : facts.sentence;
  const tint = facts.tint === 'bad' ? 'bg-bad-tint' : facts.tint === 'warn' ? 'bg-warn-tint' : null;
  const word = facts.tone === 'bad' || facts.tone === 'warn'
    ? <Chip tone={facts.tone}>{facts.word}</Chip>
    : <span className="text-[10px] leading-3 text-muted-foreground">{facts.word}</span>;
  const button = (className: string) => issue ? (
    <Button variant="outline" className={plainButton(className)} onClick={() => actions.decide(issue)}>Decide</Button>
  ) : (
    <Button data-opener={trip.tripId} variant="outline" aria-expanded={open} aria-controls={`${tripAnchor(trip.tripId)}-details`} className={plainButton(className)} onClick={() => actions.toggle(trip.tripId)}>
      {trip.action === 'decided' ? 'Decided' : 'Open'}
    </Button>
  );
  // The truck's name opens the details too, so a trip whose button decides can still be opened.
  const nameButton = (
    <button
      type="button"
      data-opener={issue ? trip.tripId : undefined}
      aria-expanded={open}
      aria-label={`${name} details`}
      onClick={() => actions.toggle(trip.tripId)}
      className="min-w-0 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="font-mono text-xs leading-4 font-bold">{trip.vehicleId}</span>
      {trip.driver && <span className="ml-1.5 text-xs leading-4 font-semibold">{trip.driver.name}</span>}
    </button>
  );

  return (
    <li id={tripAnchor(trip.tripId)} className="scroll-mt-28">
      <div className={cn(ROW, 'hidden min-h-[30px] rounded-[10px] px-2 py-1 lg:grid xl:py-0.5', tint)}>
        <img src={truckIcon(trip)} alt="" className="size-6 object-contain" />
        <div className="min-w-0">
          {nameButton}
          <p className={cn('mt-0.5 text-[10px] leading-3 xl:hidden', SENTENCE[facts.tone])}>{sentence}</p>
          <div className="mt-1 xl:hidden">{word}</div>
        </div>
        <p className={cn('hidden min-w-0 text-[10px] leading-3 xl:block', SENTENCE[facts.tone])}>{sentence}</p>
        {timeline ? <TripLine trip={trip} timeline={timeline} className={LINE_CELL} /> : <span className={LINE_CELL} />}
        <div className="hidden min-w-0 xl:block">{word}</div>
        <div className="flex justify-end">{button('h-6 w-[76px] rounded-full text-[11px]')}</div>
      </div>

      <div className={cn('rounded-[12px] border px-3.5 pt-3 pb-3.5 lg:hidden', tint && `${tint} border-transparent`)}>
        <div className="flex items-start gap-2.5">
          <img src={truckIcon(trip)} alt="" className="mt-0.5 size-7 shrink-0 object-contain" />
          <div className="min-w-0 flex-1">
            {nameButton}
            <p className={cn('mt-1 text-xs leading-4', SENTENCE[facts.tone])}>{sentence}</p>
          </div>
          {button('h-8 shrink-0 rounded-full px-4 text-xs')}
        </div>
        <div className="mt-2">{word}</div>
        <StopTimes trip={trip} />
      </div>

      {open && <TripDetails id={`${tripAnchor(trip.tripId)}-details`} trip={trip} issues={issues} actions={actions} />}
    </li>
  );
}

// Below 1024, each stop with its labelled times, in place of the timeline.
function StopTimes({ trip }: { trip: OperationsTrip }) {
  if (!isRecorded(trip)) return null;
  const t = trip.trip;
  const leave = [`planned leave ${clockTime(trip.schedule.leavesAt)}`, t.leftAt && `left ${clockTime(t.leftAt)}`].filter(Boolean).join(' · ');
  const back = [`planned back ${clockTime(trip.schedule.backAt)}`, t.backAt && `back ${clockTime(t.backAt)}`].filter(Boolean).join(' · ');
  const next = trip.outRow?.nextStop?.id ?? (t.status === 'done' ? null : trip.figures.next?.id ?? null);
  return (
    <ol className="mt-2.5 space-y-1.5 border-t pt-2.5 text-[11px] leading-[15px]">
      <li className="text-muted-foreground">{leave}</li>
      {trip.stopDetails.map((stop) => (
        <li key={stop.id} className="flex flex-wrap gap-x-1.5">
          <span className="font-semibold">{stop.seq} · {stop.shopName}{stop.id === next ? ' · next' : ''}</span>
          <span className="text-muted-foreground">
            {[`planned ${clockTime(stop.plannedArrival)}`, stop.arrivedAt && `arrived ${clockTime(stop.arrivedAt)}`, stop.doneAt && `${stop.outcome ?? 'done'} ${clockTime(stop.doneAt)}`].filter(Boolean).join(' · ')}
          </span>
        </li>
      ))}
      <li className="text-muted-foreground">{back}</li>
    </ol>
  );
}
