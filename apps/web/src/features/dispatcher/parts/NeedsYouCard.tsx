import { Link } from 'react-router';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Issue, IssueList, OperationsDay } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ICON, problemIcon } from '@/features/live/parts/icons';
import { allTrips, isRecorded, type RecordedTrip } from '@/features/live/parts/rows';
import { CARD } from '@/features/live/parts/ui';
import { openOf } from '@/features/live/sums';
import { NOTHING_NEEDS_YOU, NO_NEXT_DAY, driverIssueTitle, nextRunTitle, ordersClose } from '@/features/live/words';
import { clockTime, countOf, issueTitle, truckName, whole } from '@/features/loader/words';
import { inkButton, orangeButton, plainButton } from '@/features/plan/parts/look';
import { StaleNotice } from '@/features/store/parts/LoadError';
import { reasonOf } from '@/features/store/words';
import { cn } from '@/lib/utils';
import { DepotTag } from './DepotTag';
import { ViewPlanLink } from './ViewPlanLink';

// One depot's part of the dashboard: its open problems and its watched day, as far as each is read.
export interface DashboardPart { depot: string; issues: UseQueryResult<IssueList>; day: OperationsDay | undefined }

// The dashboard's Needs you (Dispatcher · Dashboard 53:11540): every open problem of the depot, oldest first, each a
// summary whose Decide opens its full card on Live day (D-72). Below them the trucks whose report is missing, as the
// frame's Watching row, which are not problems and not counted. The next run sits at the foot, and the district map
// beside the card from 1280 wide (spec 019). On both depots together (spec 021) it lists both depots' problems and
// trucks, each row with its depot's chip, counts them only once both lists are read, says which depot's list failed,
// and has a next run line per depot.
export function NeedsYouCard({ parts, both }: { parts: DashboardPart[]; both: boolean }) {
  const read = parts.filter((part) => part.issues.data);
  const allRead = read.length === parts.length;
  const open = openOf(read.map((part) => ({ depot: part.depot, list: part.issues.data! })));
  const watching = parts.flatMap((part) => (part.day ? watchingOf(part.day).map((trip) => ({ depot: part.depot, trip })) : []))
    .sort((a, b) => plannedOf(a.trip).localeCompare(plannedOf(b.trip)));
  const stale = parts.filter((part) => part.issues.data && part.issues.isError);
  const failed = parts.filter((part) => !part.issues.data && part.issues.isError);
  return (
    <section aria-labelledby="needs-you" className={cn(CARD, 'px-4 pt-[18px] pb-4 lg:px-6 lg:pt-5')}>
      <div className="flex items-center gap-3">
        <img src={ICON.alert} alt="" className="size-8 object-contain" />
        <h2 id="needs-you" className="text-base leading-6 font-bold">Needs you{allRead ? ` · ${whole(open.length)}` : ''}</h2>
        {allRead && open.length > 0 && <span className="ml-auto text-xs leading-4 text-muted-foreground">{countOf(open.length, 'problem')} to answer</span>}
      </div>

      {/* A refresh that fails keeps the last list and says it may be out of date, as Live day's column does. */}
      {stale.length > 0 && (
        <div className="mt-3"><StaleNotice busy={stale.some((part) => part.issues.isFetching)} onRetry={() => { for (const part of stale) void part.issues.refetch(); }} /></div>
      )}
      {failed.map((part) => (
        <div key={part.depot} role="alert" className="mt-3">
          <p className="text-[13px] leading-[18px] font-semibold">Could not load what needs you{both ? ` at ${part.depot}` : ''}.</p>
          <p className="mt-1 text-xs leading-4 text-muted-foreground">{reasonOf(part.issues.error)}</p>
          <Button variant="outline" className={plainButton('mt-3 h-9 px-4 text-xs')} disabled={part.issues.isFetching} onClick={() => { void part.issues.refetch(); }}>{part.issues.isFetching ? 'Trying…' : 'Try again'}</Button>
        </div>
      ))}
      {parts.some((part) => !part.issues.data && !part.issues.isError) && <RowsSkeleton />}
      {allRead && open.length === 0 && watching.length === 0 && <p className="mt-3 text-[13px] leading-[18px]">{NOTHING_NEEDS_YOU}</p>}
      {(open.length > 0 || watching.length > 0) && (
        <ul className="mt-3.5 space-y-3">
          {open.map(({ depot, issue }, i) => <ProblemRow key={issue.id} issue={issue} depot={both ? depot : null} first={i === 0} />)}
          {watching.map(({ depot, trip }) => <WatchingRow key={trip.tripId} trip={trip} depot={both ? depot : null} />)}
        </ul>
      )}

      <NextRuns parts={parts} both={both} />
    </section>
  );
}

// The trucks whose departure or arrival report is missing and that have no open problem.
const watchingOf = (day: OperationsDay) => allTrips(day).filter(isRecorded)
  .filter((trip) => trip.openIssueIds.length === 0 && (trip.attention.kind === 'departure_unreported' || trip.attention.kind === 'arrival_unreported'));
const plannedOf = (trip: RecordedTrip) => (trip.attention.kind === 'departure_unreported' || trip.attention.kind === 'arrival_unreported' ? trip.attention.plannedAt : '');
const ROW = 'flex flex-col gap-3 rounded-[14px] border px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 lg:px-5';
const BUTTON = 'h-10 w-full shrink-0 text-[13px] sm:w-[150px]';
// A row's depot, on both depots together, at the head of its second line.
const Depot = ({ depot }: { depot: string | null }) => (depot ? <DepotTag depot={depot} className="mr-1.5 align-[1px]" /> : null);

// "Fresh Wellawatte · 2 chilled cartons refused", "Dilshan · 03:48 · stop 2 · VEH035", and Decide.
function ProblemRow({ issue, depot, first }: { issue: Issue; depot: string | null; first: boolean }) {
  const title = issue.kind === 'loading' ? `${issue.stop.shopName} · ${issueTitle(issue)}` : issue.kind === 'refused' ? `${issue.stop.shopName} · ${driverIssueTitle(issue)}` : driverIssueTitle(issue);
  return (
    <li className={ROW}>
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <img src={problemIcon(issue.kind, issue.stop.shopName)} alt="" className="size-8 shrink-0 object-contain" />
        <div className="min-w-0">
          <p className="text-[15px] leading-5 font-semibold">{title}</p>
          <p className="mt-1 text-xs leading-4 text-muted-foreground"><Depot depot={depot} />{issue.raisedBy} · {clockTime(issue.raisedAt)} · stop {issue.stop.seq} · {truckName(issue.trip)}</p>
        </div>
      </div>
      <Link to={`/dispatcher/live?issue=${encodeURIComponent(issue.id)}`} className={first ? orangeButton(BUTTON) : inkButton(BUTTON)}>Decide</Link>
    </li>
  );
}

// A missing report (rule 4): "Watching · VEH035 · Colombo · departure not reported", in grey, as the frame's row.
function WatchingRow({ trip, depot }: { trip: RecordedTrip; depot: string | null }) {
  const attention = trip.attention as Extract<RecordedTrip['attention'], { plannedAt: string }>;
  const what = attention.kind === 'departure_unreported' ? 'departure not reported' : 'arrival not reported';
  const last = trip.lastReportAt ? `last report ${clockTime(trip.lastReportAt)}` : 'no report yet';
  return (
    <li className={ROW}>
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <img src={ICON.watching} alt="" className="size-8 shrink-0 object-contain" />
        <div className="min-w-0">
          <p className="text-[15px] leading-5 font-semibold text-muted-foreground">Watching · {truckName(trip)} · {trip.district} · {what}</p>
          <p className="mt-1 text-xs leading-4 text-muted-foreground"><Depot depot={depot} />{[trip.driver?.name, `planned ${clockTime(attention.plannedAt)}`, last].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <Link to={`/dispatcher/live?trip=${encodeURIComponent(trip.tripId)}`} className={plainButton(BUTTON)}>Open trip</Link>
    </li>
  );
}

const RUN = 'flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4';
// The next run (rule 3): the next operating day, its orders, when they close, and View plan for that day. Only the
// read's own cutoff: the screen works out no countdown to it. On both depots together a line per depot whose day is
// read, each with its own View plan, which switches to that depot (spec 021).
function NextRuns({ parts, both }: { parts: DashboardPart[]; both: boolean }) {
  if (!both) {
    const day = parts[0]?.day;
    return day ? <div className={cn(RUN, 'mt-4 border-t pt-4')}><NextRun day={day} depot={parts[0]!.depot} tagged={false} /></div> : null;
  }
  const read = parts.filter((part) => part.day);
  if (read.length === 0) return null;
  return (
    <ul aria-label="Next runs" className="mt-4 space-y-3.5 border-t pt-4">
      {read.map((part) => <li key={part.depot} className={RUN}><NextRun day={part.day!} depot={part.depot} tagged /></li>)}
    </ul>
  );
}

function NextRun({ day, depot, tagged }: { day: OperationsDay; depot: string; tagged: boolean }) {
  const next = day.nextRun;
  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <img src={ICON.cutoff} alt="" className="size-8 shrink-0 object-contain" />
        {next ? (
          <div className="min-w-0">
            <h3 className="text-sm leading-5 font-semibold">{nextRunTitle(next.date)}</h3>
            <p className="mt-0.5 text-xs leading-4 text-muted-foreground"><Depot depot={tagged ? depot : null} />{countOf(next.orders, 'order')} · {ordersClose(next.cutoffAt)}</p>
          </div>
        ) : <p className="text-[13px] leading-[18px] font-semibold"><Depot depot={tagged ? depot : null} />{NO_NEXT_DAY}</p>}
      </div>
      {next && <ViewPlanLink date={next.date} depot={depot} className={inkButton('h-10 w-full shrink-0 px-6 text-[13px] sm:w-auto')} />}
    </>
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
