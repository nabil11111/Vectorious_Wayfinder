import { Link } from 'react-router';
import type { Issue, OperationsDay, OperationsStatus } from '@wayfinder/contracts';
import { ICON, truckIcon } from '@/features/live/parts/icons';
import { isRecorded } from '@/features/live/parts/rows';
import { CARD, Chip, StopDots, type Tone } from '@/features/live/parts/ui';
import { NO_TRUCK_OUT, noPlanOut, placeLine, statusSentence } from '@/features/live/words';
import { clockTime, shortDay, whole } from '@/features/loader/words';
import { plainButton } from '@/features/plan/parts/look';
import { cn } from '@/lib/utils';
import { tripsOut, type OutTrip } from './trips-out';

// Trucks out now (Dispatcher · Dashboard 53:11540, rule 4): one row per trip that is out, in the read's order, problems
// first. Progress is the trip's own finished stops, the next stop its kept planned arrival (labelled original after a
// retry) and Back its planned return: the sent schedule, never an estimate. Status is the oldest open problem, or what
// was recorded or is missing. Open and Decide lead to the trip or the problem on Live day.
export function TrucksOut({ day, issues }: { day: OperationsDay; issues: Issue[] | undefined }) {
  const rows = tripsOut(day);
  return (
    <section aria-labelledby="trucks-out" className={cn(CARD, 'px-4 pt-[18px] pb-4 lg:px-6 lg:pt-5')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <img src={ICON.trucks} alt="" className="size-8 object-contain" />
        <h2 id="trucks-out" className="text-base leading-6 font-bold">Trucks out now · {whole(rows.length)}</h2>
        <span className="text-xs leading-4 text-muted-foreground">problems first</span>
        <Link to="/dispatcher/live" className={plainButton('ml-auto h-9 px-4 text-xs')}>Open live day</Link>
      </div>
      {day.day !== null && day.plan === null && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[12px] bg-muted px-4 py-3">
          <p className="text-[13px] leading-[18px] font-semibold">{noPlanOut(day.day)}</p>
          <Link to={`/dispatcher/plan/${day.day}`} className={plainButton('ml-auto h-8 px-4 text-xs')}>View plan</Link>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="mt-3 text-[13px] leading-[18px]">{NO_TRUCK_OUT}</p>
      ) : (
        <>
          {/* From 1280 every column has its own place, as the frame's; between 1024 and 1280 the driver and the trip
              number sit under the truck so the row still fits. */}
          <table className="mt-3 hidden w-full table-fixed text-left lg:table">
            <thead>
              <tr className="border-b text-[11px] leading-4 [&>th]:pr-3 [&>th]:pb-2 [&>th]:align-bottom [&>th]:font-semibold [&>th]:text-muted-foreground">
                <th className="w-[112px] xl:w-[84px]">Truck</th>
                <th className="hidden w-[92px] xl:table-cell">Driver</th>
                <th className="w-[128px] xl:w-[150px]">Brand · district</th>
                <th className="hidden w-[44px] xl:table-cell">Trip</th>
                <th className="w-[124px] xl:w-[164px]">Progress</th>
                <th>Next stop</th>
                <th className="w-[84px] xl:w-[100px]">Planned arrival</th>
                <th className="w-[84px] xl:w-[100px]">Planned return</th>
                <th className="w-[160px] xl:w-[200px]">Status</th>
                <th className="w-[104px] xl:w-[124px]"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((trip) => <Row key={trip.tripId} trip={trip} day={day} issues={issues} />)}
            </tbody>
          </table>
          <ul className="mt-3 space-y-2.5 lg:hidden">
            {rows.map((trip) => <Card key={trip.tripId} trip={trip} day={day} issues={issues} />)}
          </ul>
        </>
      )}
    </section>
  );
}

// The row's status in words and its tone: a problem in red, a missing report in yellow, the rest plain.
function statusOf(trip: OutTrip): { text: string; tone: Tone | null } {
  const status: OperationsStatus = trip.outRow.status;
  if (status.kind === 'open_problem') return { text: status.summary, tone: 'bad' };
  if (status.kind === 'arrival_unreported') return { text: 'Arrival not reported', tone: 'warn' };
  if (status.kind === 'departure_unreported') return { text: statusSentence(status, null)!, tone: 'warn' };
  if (status.kind === 'out') {
    const left = isRecorded(trip) ? trip.trip.leftAt : null;
    return { text: left ? `Left ${clockTime(left)}` : 'Out', tone: null };
  }
  return { text: statusSentence(status, null) ?? status.kind, tone: null };
}

function actionOf(trip: OutTrip, issues: Issue[] | undefined) {
  if (trip.action === 'decide') {
    const id = trip.outRow.status.kind === 'open_problem' ? trip.outRow.status.issueId : issues?.find((issue) => trip.openIssueIds.includes(issue.id))?.id ?? trip.openIssueIds[0]!;
    return { label: 'Decide', to: `/dispatcher/live?issue=${encodeURIComponent(id)}` };
  }
  return { label: trip.action === 'decided' ? 'Decided' : 'Open', to: `/dispatcher/live?trip=${encodeURIComponent(trip.tripId)}` };
}

const planned = (trip: OutTrip) => (trip.outRow.plannedArrival ? clockTime(trip.outRow.plannedArrival) : '–');
const back = (trip: OutTrip) => (trip.outRow.plannedReturn ? clockTime(trip.outRow.plannedReturn) : '–');
const progressText = (trip: OutTrip) => `${trip.outRow.progress.numerator === null ? '–' : whole(trip.outRow.progress.numerator)}/${whole(trip.outRow.progress.denominator)}`;

function Row({ trip, day, issues }: { trip: OutTrip; day: OperationsDay; issues: Issue[] | undefined }) {
  const status = statusOf(trip);
  const action = actionOf(trip, issues);
  const earlier = trip.date !== day.day;
  return (
    <tr className="border-b text-xs leading-4 last:border-0 [&>td]:py-2.5 [&>td]:pr-3 [&>td]:align-middle">
      <td>
        <span className="font-mono font-bold">{trip.vehicleId}</span>
        <span className="block truncate text-[11px] leading-[14px] text-muted-foreground xl:hidden">{[trip.driver?.name, `trip ${trip.tripNo}`].filter(Boolean).join(' · ')}</span>
        {earlier && <span className="block text-[10px] leading-3 text-muted-foreground">{shortDay(trip.date)}</span>}
      </td>
      <td className="hidden truncate xl:table-cell">{trip.driver?.name ?? '–'}</td>
      <td className="truncate text-muted-foreground">{placeLine(trip)}</td>
      <td className="hidden font-mono text-muted-foreground xl:table-cell">{trip.tripNo}</td>
      <td>
        <span className="flex items-center gap-2">
          <StopDots progress={trip.outRow.progress} />
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{progressText(trip)}</span>
        </span>
      </td>
      <td className="truncate">{trip.outRow.nextStop?.shopName ?? 'Returning'}</td>
      <td className="font-mono text-muted-foreground">
        {planned(trip)}
        {trip.outRow.arrivalIsOriginal && <span className="block font-sans text-[10px] leading-3">original</span>}
      </td>
      <td className="font-mono text-muted-foreground">{back(trip)}</td>
      <td>{status.tone ? <Chip tone={status.tone} className="max-w-full truncate text-[11px] leading-[14px]">{status.text}</Chip> : <span>{status.text}</span>}</td>
      <td className="text-right"><Link to={action.to} className={plainButton('h-[30px] w-full max-w-[110px] rounded-full text-xs')}>{action.label}</Link></td>
    </tr>
  );
}

// Below 1024: the same facts, labelled, as a card per truck.
function Card({ trip, day, issues }: { trip: OutTrip; day: OperationsDay; issues: Issue[] | undefined }) {
  const status = statusOf(trip);
  const action = actionOf(trip, issues);
  return (
    <li className="rounded-[12px] border px-3.5 pt-3 pb-3.5">
      <div className="flex items-start gap-2.5">
        <img src={truckIcon(trip)} alt="" className="mt-0.5 size-7 shrink-0 object-contain" />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-5"><span className="font-mono font-bold">{trip.vehicleId}</span>{trip.driver && <span className="ml-1.5 font-semibold">{trip.driver.name}</span>}</p>
          <p className="text-xs leading-4 text-muted-foreground">{[placeLine(trip), `trip ${trip.tripNo}`, trip.date !== day.day ? shortDay(trip.date) : null].filter(Boolean).join(' · ')}</p>
        </div>
        <Link to={action.to} className={plainButton('h-8 shrink-0 rounded-full px-4 text-xs')}>{action.label}</Link>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <StopDots progress={trip.outRow.progress} />
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{progressText(trip)}</span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs leading-4">
        <dt className="text-muted-foreground">Next stop</dt><dd>{trip.outRow.nextStop?.shopName ?? 'Returning'}</dd>
        <dt className="text-muted-foreground">{trip.outRow.arrivalIsOriginal ? 'Original planned arrival' : 'Planned arrival'}</dt><dd className="font-mono">{planned(trip)}</dd>
        <dt className="text-muted-foreground">Planned return</dt><dd className="font-mono">{back(trip)}</dd>
      </dl>
      <div className="mt-2.5">{status.tone ? <Chip tone={status.tone} className="whitespace-normal">{status.text}</Chip> : <span className="text-xs leading-4">{status.text}</span>}</div>
    </li>
  );
}
