import { Link } from 'react-router';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Issue, IssueList, OperationsDay } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ICON, problemIcon } from '@/features/live/parts/icons';
import { allTrips, isRecorded, type RecordedTrip } from '@/features/live/parts/rows';
import { CARD } from '@/features/live/parts/ui';
import { NOTHING_NEEDS_YOU, NO_NEXT_DAY, nextRunTitle, ordersClose } from '@/features/live/words';
import { driverIssueTitle } from '@/features/live/words';
import { clockTime, countOf, issueTitle, truckName, untilLeaving, whole } from '@/features/loader/words';
import { inkButton, orangeButton, plainButton } from '@/features/plan/parts/look';
import { reasonOf } from '@/features/store/words';
import { cn } from '@/lib/utils';

// The dashboard's Needs you (Dispatcher · Dashboard 53:11540): every open problem of the depot, oldest first, each a
// summary whose Decide opens its full card on Live day (D-72). Below them the trucks whose report is missing, as the
// frame's Watching row, which are not problems and not counted. The map's place goes to these cards, and the next
// run sits at the foot.
export function NeedsYouCard({ issues, day, at }: { issues: UseQueryResult<IssueList>; day: OperationsDay | undefined; at: number | null }) {
  const open = issues.data?.issues ?? [];
  const watching = day ? allTrips(day).filter(isRecorded).filter((trip) => trip.openIssueIds.length === 0 && (trip.attention.kind === 'departure_unreported' || trip.attention.kind === 'arrival_unreported'))
    .sort((a, b) => plannedOf(a).localeCompare(plannedOf(b))) : [];
  return (
    <section aria-labelledby="needs-you" className={cn(CARD, 'px-4 pt-[18px] pb-4 lg:px-6 lg:pt-5')}>
      <div className="flex items-center gap-3">
        <img src={ICON.alert} alt="" className="size-8 object-contain" />
        <h2 id="needs-you" className="text-base leading-6 font-bold">Needs you{issues.data ? ` · ${whole(open.length)}` : ''}</h2>
        {issues.data && open.length > 0 && <span className="ml-auto text-xs leading-4 text-muted-foreground">{countOf(open.length, 'problem')} to answer</span>}
      </div>

      {!issues.data && issues.isError && (
        <div role="alert" className="mt-3">
          <p className="text-[13px] leading-[18px] font-semibold">Could not load what needs you.</p>
          <p className="mt-1 text-xs leading-4 text-muted-foreground">{reasonOf(issues.error)}</p>
          <Button variant="outline" className={plainButton('mt-3 h-9 px-4 text-xs')} disabled={issues.isFetching} onClick={() => { void issues.refetch(); }}>{issues.isFetching ? 'Trying…' : 'Try again'}</Button>
        </div>
      )}
      {!issues.data && !issues.isError && <RowsSkeleton />}
      {issues.data && open.length === 0 && watching.length === 0 && <p className="mt-3 text-[13px] leading-[18px]">{NOTHING_NEEDS_YOU}</p>}
      {(open.length > 0 || watching.length > 0) && (
        <ul className="mt-3.5 space-y-3">
          {open.map((issue, i) => <ProblemRow key={issue.id} issue={issue} first={i === 0} />)}
          {watching.map((trip) => <WatchingRow key={trip.tripId} trip={trip} />)}
        </ul>
      )}

      <NextRun day={day} at={at} />
    </section>
  );
}

const plannedOf = (trip: RecordedTrip) => (trip.attention.kind === 'departure_unreported' || trip.attention.kind === 'arrival_unreported' ? trip.attention.plannedAt : '');
const ROW = 'flex flex-col gap-3 rounded-[14px] border px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 lg:px-5';
const BUTTON = 'h-10 w-full shrink-0 text-[13px] sm:w-[150px]';

// "Fresh Wellawatte · 2 chilled cartons refused", "Dilshan · 03:48 · stop 2 · VEH035", and Decide.
function ProblemRow({ issue, first }: { issue: Issue; first: boolean }) {
  const title = issue.kind === 'loading' ? `${issue.stop.shopName} · ${issueTitle(issue)}` : issue.kind === 'refused' ? `${issue.stop.shopName} · ${driverIssueTitle(issue)}` : driverIssueTitle(issue);
  return (
    <li className={ROW}>
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <img src={problemIcon(issue.kind, issue.stop.shopName)} alt="" className="size-8 shrink-0 object-contain" />
        <div className="min-w-0">
          <p className="text-[15px] leading-5 font-semibold">{title}</p>
          <p className="mt-1 text-xs leading-4 text-muted-foreground">{issue.raisedBy} · {clockTime(issue.raisedAt)} · stop {issue.stop.seq} · {truckName(issue.trip)}</p>
        </div>
      </div>
      <Link to={`/dispatcher/live?issue=${encodeURIComponent(issue.id)}`} className={first ? orangeButton(BUTTON) : inkButton(BUTTON)}>Decide</Link>
    </li>
  );
}

// A missing report (rule 4): "Watching · VEH035 · Colombo · departure not reported", in grey, as the frame's row.
function WatchingRow({ trip }: { trip: RecordedTrip }) {
  const attention = trip.attention as Extract<RecordedTrip['attention'], { plannedAt: string }>;
  const what = attention.kind === 'departure_unreported' ? 'departure not reported' : 'arrival not reported';
  const last = trip.lastReportAt ? `last report ${clockTime(trip.lastReportAt)}` : 'no report yet';
  return (
    <li className={ROW}>
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <img src={ICON.watching} alt="" className="size-8 shrink-0 object-contain" />
        <div className="min-w-0">
          <p className="text-[15px] leading-5 font-semibold text-muted-foreground">Watching · {truckName(trip)} · {trip.district} · {what}</p>
          <p className="mt-1 text-xs leading-4 text-muted-foreground">{[trip.driver?.name, `planned ${clockTime(attention.plannedAt)}`, last].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <Link to={`/dispatcher/live?trip=${encodeURIComponent(trip.tripId)}`} className={plainButton(BUTTON)}>Open trip</Link>
    </li>
  );
}

// The next run (rule 3): the next operating day, its orders, when they close, and View plan for that day.
function NextRun({ day, at }: { day: OperationsDay | undefined; at: number | null }) {
  if (!day) return null;
  const next = day.nextRun;
  return (
    <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <img src={ICON.cutoff} alt="" className="size-8 shrink-0 object-contain" />
        {next ? (
          <div className="min-w-0">
            <h3 className="text-sm leading-5 font-semibold">{nextRunTitle(next.date)}</h3>
            <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{[countOf(next.orders, 'order'), ordersClose(next.cutoffAt), untilLeaving(next.cutoffAt, at)].filter(Boolean).join(' · ')}</p>
          </div>
        ) : <p className="text-[13px] leading-[18px] font-semibold">{NO_NEXT_DAY}</p>}
      </div>
      {next && <Link to={`/dispatcher/plan/${next.date}`} className={inkButton('h-10 w-full shrink-0 px-6 text-[13px] sm:w-auto')}>View plan</Link>}
    </div>
  );
}

function RowsSkeleton() {
  return (
    <div role="status" aria-label="Loading what needs you" className="mt-3.5 space-y-3">
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-3.5 rounded-[14px] border px-5 py-4">
          <Skeleton soft className="size-8 rounded-md" />
          <div className="flex-1 space-y-2"><Skeleton className="h-3 w-2/5 rounded-full" /><Skeleton soft className="h-2.5 w-3/5 rounded-full" /></div>
          <Skeleton soft className="h-10 w-[150px] rounded-[10px]" />
        </div>
      ))}
    </div>
  );
}
