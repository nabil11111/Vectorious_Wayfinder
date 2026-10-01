import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import type {
  Brand, HistoryClosedAttempt, HistoryMeasure, HistoryProblem, HistoryReceipt, HistoryStages, HistoryStop, HistoryTrip, LookupPhoto,
} from '@wayfinder/contracts';
import { CARD, Chip } from '@/features/live/parts/ui';
import { cn } from '@/lib/utils';
import { PhotoViewer } from './PhotoViewer';
import { ICON, vehiclePicture } from './parts/icons';
import { TripFlags } from './parts/HistoryTrips';
import { CloseButton, DetailHeading, Facts } from './parts/ui';
import type { PhotoViewer as Viewer } from './queries';
import {
  NOT_CONFIRMED, NO_PHOTO, OUTCOME_WORDS, RETURN_INSTRUCTED, TRIP_STATUS_WORDS, answerWords, clockTime, coldWords, countWords, issueWords, kilos, kmWords,
  lineWords, measureWords, reasonWords, reportWords, sentWords, shortDay, tripName, tripPlace, unitsWords, whole, cubic,
} from './words';

// The selected trip (Dispatcher · History's rail, rules 5 to 8): its kept schedule and recorded times, the stage totals
// of its lines, and each stop with its lines ordered, loaded, handed over and received, its proof, its shop
// confirmation, its problems (answered ones too) and each closed attempt with its own times, counts, photo and answer.
// Every figure is the read's; one never recorded says so and is never a zero.
// anchor is the id the page scrolls to, one per depot's part on both depots together (spec 021).
export function HistoryDetail({ trip, brand, viewer, anchor, onClose }: { trip: HistoryTrip; brand: Brand | 'all'; viewer: Viewer; anchor: string; onClose: () => void }) {
  const title = useId();
  const recorded: [string, string][] = [
    ['Planned leave', clockTime(trip.schedule.leavesAt)],
    ['Planned back', clockTime(trip.schedule.backAt)],
    ['Planned load', `${unitsWords(trip.brand, trip.schedule.load.units)} · ${kilos(Math.round(trip.schedule.load.kg))} · ${cubic(trip.schedule.load.m3)}`],
    ['Planned distance', kmWords(trip.schedule.km)],
    ['Ready', trip.readyAt ? clockTime(trip.readyAt) : 'not recorded'],
    ['Left', trip.leftAt ? clockTime(trip.leftAt) : 'not recorded'],
    ['Back', trip.backAt ? clockTime(trip.backAt) : 'not recorded'],
  ];
  return (
    <section id={anchor} aria-labelledby={title} className={cn(CARD, 'scroll-mt-24 px-5 pt-[18px] pb-5')}>
      <div className="flex items-start gap-2.5">
        <img src={vehiclePicture({ type: trip.vehicleType, temp: trip.vehicleTemp })} alt="" className="mt-[-3px] size-[26px] shrink-0 object-contain" />
        <h2 id={title} className="min-w-0 flex-1 text-[15px] leading-5 font-bold">{tripName(trip)}</h2>
        <CloseButton label={`Close ${tripName(trip)}`} onClick={onClose} />
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{tripPlace(trip)} · sent plan {shortDay(trip.date)}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Chip tone="plain">{TRIP_STATUS_WORDS[trip.status]}</Chip>
        <TripFlags trip={trip} quiet />
        {trip.archived && <Chip tone="plain">Vehicle archived</Chip>}
      </div>
      <PhotoViewer viewer={viewer} className="mt-3 shadow-none ring-1 ring-border" />
      <Facts rows={recorded} className="mt-3.5" />
      <DetailHeading>Every line of the trip</DetailHeading>
      <Stages stages={trip.stages} brand={trip.brand} className="mt-1.5" />
      <ol className="mt-1">
        {trip.stops.map((stop) => (
          <StopBlock key={stop.id} stop={stop} viewer={viewer} other={brand !== 'all' && stop.outlet.brand !== brand ? brand : null} />
        ))}
      </ol>
    </section>
  );
}

// The stage totals of a set of lines: ordered, then each later stage as recorded, or not recorded with how many of its
// lines are still missing (Q-44).
function Stages({ stages, brand, className }: { stages: HistoryStages; brand: Brand | null; className?: string }) {
  // What did not fit on the truck is its own row, there only when some did not (L-21).
  const rows: [string, HistoryMeasure][] = [
    ['Loaded', stages.loaded], ['Handed over', stages.handedOver], ['Received', stages.received], ['Short from the depot', stages.depotShort],
    ...(stages.wontFit.units ? [['Didn\'t fit on the truck', stages.wontFit] as [string, HistoryMeasure]] : []),
    ['Refused', stages.refused], ['Short on the receipt', stages.receiptShort], ['Not delivered', stages.notDelivered],
  ];
  return (
    <dl className={cn('space-y-1 text-[11px] leading-[15px]', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-muted-foreground">Ordered</dt>
        <dd className="font-mono font-semibold">{unitsWords(brand, stages.ordered)}</dd>
      </div>
      {rows.map(([label, measure]) => (
        <div key={label} className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right">
            {measure.units === null
              ? <span className="text-muted-foreground">{measureWords(measure)}</span>
              : <span className="font-mono font-semibold">{whole(measure.units)}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function StopBlock({ stop, viewer, other }: { stop: HistoryStop; viewer: Viewer; other: Brand | null }) {
  const brand = stop.outlet.brand;
  const handed = stop.outcome === 'delivered' || stop.outcome === 'refused';
  const times = [
    stop.loadedAt && `loaded ${clockTime(stop.loadedAt)}`,
    stop.arrivedAt && `arrived ${clockTime(stop.arrivedAt)}`,
    stop.doneAt && `${stop.outcome ? OUTCOME_WORDS[stop.outcome] : 'done'} ${clockTime(stop.doneAt)}`,
  ].filter(Boolean);
  const differences = ([['short from the depot', stop.stages.depotShort], ['didn\'t fit on the truck', stop.stages.wontFit], ['refused', stop.stages.refused], ['short on the receipt', stop.stages.receiptShort], ['not delivered', stop.stages.notDelivered]] as const)
    .filter(([, measure]) => measure.units === null ? measure.known > 0 : measure.units > 0)
    .map(([label, measure]) => (measure.units === null ? `${label} ${measureWords(measure)}` : `${unitsWords(brand, measure.units)} ${label}`));
  // A closed visit is listed as its attempt and the shop's report inside its confirmation, each once.
  const listedElsewhere = new Set([...stop.attempts.map((attempt) => attempt.issueId), ...(stop.receipt?.report ? [stop.receipt.report.id] : [])]);
  return (
    <li className="mt-3.5 border-t pt-3.5">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-xs leading-4 font-bold">{clockTime(stop.plannedArrival)}</span>
        <span className="min-w-0 flex-1 text-xs leading-4 font-semibold">{stop.outlet.name}</span>
        <span className="text-[10px] leading-3 text-muted-foreground">stop {stop.seq}</span>
      </div>
      <p className="mt-1 text-[11px] leading-[15px] text-muted-foreground">
        window {clockTime(stop.windowOpen)}–{clockTime(stop.windowClose)} · {times.length ? times.join(' · ') : 'nothing recorded yet'}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {other && <Chip tone="plain">{brand} shop, not {other}</Chip>}
        {stop.flags.late === true && <Chip tone="warn">Arrived after window</Chip>}
        {stop.flags.short && <Chip tone="bad">Short</Chip>}
        {stop.flags.returned && <Chip tone="bad">{RETURN_INSTRUCTED}</Chip>}
      </div>
      <Lines stop={stop} />
      {differences.length > 0 && <p className="mt-1.5 text-[11px] leading-[15px] font-semibold text-bad">{differences.join(' · ')}</p>}
      <div className="mt-2 space-y-2">
        {stop.proof ? <PhotoButton photo={stop.proof} label={`Proof · ${stop.outlet.name}`} viewer={viewer}>Proof photo · {clockTime(stop.proof.takenAt)}</PhotoButton>
          : handed && <p className="text-[11px] leading-[15px] text-muted-foreground">Proof · {NO_PHOTO}</p>}
        {stop.receipt ? <Receipt receipt={stop.receipt} stop={stop} viewer={viewer} />
          : handed && <p className="text-[11px] leading-[15px] text-muted-foreground">{NOT_CONFIRMED}</p>}
        {stop.problems.filter((problem) => !listedElsewhere.has(problem.id)).map((problem) => <Problem key={problem.id} problem={problem} stop={stop} viewer={viewer} />)}
        {stop.attempts.map((attempt) => <Attempt key={attempt.issueId} attempt={attempt} stop={stop} viewer={viewer} />)}
      </div>
    </li>
  );
}

// Each line by stage: ordered, loaded, handed over, received. A stage not recorded for the line is a dash.
function Lines({ stop }: { stop: HistoryStop }) {
  const cols = 'grid grid-cols-[minmax(0,1fr)_repeat(4,40px)] gap-x-1.5';
  return (
    <div role="table" aria-label={`${stop.outlet.name} lines`} className="mt-2 text-[11px] leading-[15px]">
      <div role="row" className={cn(cols, 'text-[9px] leading-3 font-semibold text-muted-foreground')}>
        <span role="columnheader">Line</span>
        <span role="columnheader" className="text-right">Ordered</span>
        <span role="columnheader" className="text-right">Loaded</span>
        <span role="columnheader" className="text-right">Handed over</span>
        <span role="columnheader" className="text-right">Received</span>
      </div>
      {stop.lines.map((line) => (
        <div key={line.lineId} role="row" className={cn(cols, 'mt-0.5')}>
          <span role="cell" className="truncate">{line.name}</span>
          <span role="cell" className="text-right font-mono">{whole(line.quantity)}</span>
          <span role="cell" className="text-right font-mono">{countWords(line.loaded)}</span>
          <span role="cell" className="text-right font-mono">{countWords(line.delivered)}</span>
          <span role="cell" className="text-right font-mono">{countWords(line.received)}</span>
        </div>
      ))}
    </div>
  );
}

function PhotoButton({ photo, label, viewer, children }: { photo: LookupPhoto; label: string; viewer: Viewer; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => viewer.open(photo, label)}
      className="flex items-center gap-2 rounded-[10px] bg-muted px-2.5 py-1.5 text-left text-[11px] leading-[15px] font-semibold outline-none hover:bg-border/70 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <img src={ICON.proof} alt="" className="size-5 object-contain" />
      {children}
    </button>
  );
}

// The shop's confirmation of this stop (spec 015): one per stop, whatever its orders. It names the shop and the time it
// confirmed, never a signature, and its report and the depot's answer when there is one.
function Receipt({ receipt, stop, viewer }: { receipt: HistoryReceipt; stop: HistoryStop; viewer: Viewer }) {
  const brand = stop.outlet.brand;
  const report = receipt.report;
  // The report is also the stop's problem, which names who answered it.
  const answeredBy = report ? stop.problems.find((problem) => problem.id === report.id)?.decidedBy ?? null : null;
  return (
    <div className="rounded-[10px] border px-3 py-2.5 text-[11px] leading-[15px]">
      <p className="font-semibold">Shop confirmation · {stop.outlet.name}</p>
      <p className="text-muted-foreground">confirmed {clockTime(receipt.confirmedAt)} · {sentWords(receipt.sentAt)}</p>
      <p className="mt-1">
        {whole(receipt.orderCount)} {receipt.orderCount === 1 ? 'order' : 'orders'} · {unitsWords(brand, receipt.received)} received
        {receipt.short > 0 && <span className="font-semibold text-bad"> · {whole(receipt.short)} short on the receipt</span>}
      </p>
      {coldWords(receipt.cold) && <p className="text-muted-foreground">{coldWords(receipt.cold)}</p>}
      {report && (
        <div className="mt-1.5 border-t pt-1.5">
          <p className="font-semibold">Report · {reportWords(report, stop.lines, brand)}</p>
          {report.note && <p className="text-muted-foreground">Note · {report.note}</p>}
          <p className="text-muted-foreground">
            {answerWords(report.decision, answeredBy, report.decidedAt)}
            {report.replacement && ` · ${unitsWords(brand, report.replacement.units)} on ${shortDay(report.replacement.day)}`}
          </p>
          {report.photo && <div className="mt-1.5"><PhotoButton photo={report.photo} label={`Report photo · ${stop.outlet.name}`} viewer={viewer}>Report photo · {clockTime(report.photo.takenAt)}</PhotoButton></div>}
          {report.decision === null && <LiveLink issueId={report.id} />}
        </div>
      )}
    </div>
  );
}

// A loader's flag, a refusal or a shop's report, answered or not: who raised it and when, what it counted, the note,
// the photo and the answer. An open one is answered in Live day, never here.
function Problem({ problem, stop, viewer }: { problem: HistoryProblem; stop: HistoryStop; viewer: Viewer }) {
  const brand = stop.outlet.brand;
  const counted = problem.kind === 'loading'
    ? problem.lines.map((line) => `${whole(line.counted)} of ${whole(line.quantity)} ${line.name} at the dock`).join(', ')
    : `${unitsWords(brand, problem.short)} ${problem.kind === 'refused' ? 'refused' : reasonWords(problem.reason)}`;
  return (
    <div className="rounded-[10px] border px-3 py-2.5 text-[11px] leading-[15px]">
      <p className="font-semibold">{issueWords(problem.kind)} · {reasonWords(problem.reason)}</p>
      <p className="text-muted-foreground">raised by {problem.raisedBy} {clockTime(problem.raisedAt)} · {counted}</p>
      {problem.note && <p className="mt-0.5">“{problem.note}”</p>}
      <p className={cn('mt-0.5', problem.decision ? 'text-muted-foreground' : 'font-semibold text-warn-ink')}>
        {answerWords(problem.decision, problem.decidedBy, problem.decidedAt)}
        {problem.replacement && ` · ${unitsWords(brand, problem.replacement.units)} on ${shortDay(problem.replacement.day)}`}
      </p>
      {problem.photo && <div className="mt-1.5"><PhotoButton photo={problem.photo} label={`${issueWords(problem.kind)} · ${stop.outlet.name}`} viewer={viewer}>Photo · {clockTime(problem.photo.takenAt)}</PhotoButton></div>}
      {problem.status === 'open' && <LiveLink issueId={problem.id} />}
    </div>
  );
}

// A closed visit, kept as its own attempt: its own closed time, each line it counted as not delivered, its photo and
// its answer. No arrival is recovered for it and no later receipt is added to it.
function Attempt({ attempt, stop, viewer }: { attempt: HistoryClosedAttempt; stop: HistoryStop; viewer: Viewer }) {
  return (
    <div className="rounded-[10px] border border-dashed px-3 py-2.5 text-[11px] leading-[15px]">
      <p className="font-semibold">Closed attempt · {reasonWords(attempt.reason)}</p>
      <p className="text-muted-foreground">closed by {attempt.raisedBy} {clockTime(attempt.raisedAt)} · {unitsWords(stop.outlet.brand, attempt.notDelivered)} not delivered</p>
      <ul aria-label="Counted on this attempt" className="mt-1 space-y-0.5">
        {attempt.lines.map((line) => <li key={line.lineId}>{lineWords({ quantity: line.counted, unit: line.unit, name: line.name })}</li>)}
      </ul>
      {attempt.note && <p className="mt-0.5">“{attempt.note}”</p>}
      <p className={cn('mt-0.5', attempt.decision ? 'text-muted-foreground' : 'font-semibold text-warn-ink')}>{answerWords(attempt.decision, attempt.decidedBy, attempt.decidedAt)}</p>
      {attempt.photo && <div className="mt-1.5"><PhotoButton photo={attempt.photo} label={`Closed attempt · ${stop.outlet.name}`} viewer={viewer}>Photo · {clockTime(attempt.photo.takenAt)}</PhotoButton></div>}
      {attempt.decision === null && <LiveLink issueId={attempt.issueId} />}
    </div>
  );
}

function LiveLink({ issueId }: { issueId: string }) {
  return (
    <Link to={`/dispatcher/live?issue=${encodeURIComponent(issueId)}`} className="mt-1 inline-block font-semibold underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      Answer in Live day
    </Link>
  );
}
