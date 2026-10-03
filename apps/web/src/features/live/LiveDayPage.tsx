import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type { IssueList, OperationsDay } from '@wayfinder/contracts';
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DepotHeading } from '@/features/dispatcher/parts/DepotHeading';
import { ViewPlanLink } from '@/features/dispatcher/parts/ViewPlanLink';
import { partId, useScope } from '@/features/dispatcher/scope';
import { plainButton } from '@/features/plan/parts/look';
import { reasonOf } from '@/features/store/words';
import { clockTime, shortDay, whole } from '@/features/loader/words';
import { useAppClock } from '@/lib/clock';
import { cn } from '@/lib/utils';
import { ReceivingListPanel } from '@/features/receiving/ReceivingListPanel';
import { NeedsYou } from './NeedsYou';
import { answeringIn, issuesKey, issuesKeyOf, useAnswer, useIssueLists, type Answering, type SentFrom } from './issues';
import { isLive, useOnline, useOperations } from './operations';
import { Events } from './parts/Events';
import { focusIssue, focusOpener, showTrip } from './parts/focus';
import { CountsSkeleton, TripsSkeleton } from './parts/LiveSkeleton';
import { allTrips, needsAttention, shownGroups, type Filter } from './parts/rows';
import { Section } from './parts/Section';
import type { RowActions } from './parts/TripRow';
import { CARD, LiveLine, StaleLine, Switch } from './parts/ui';
import { agreed, sumCounts } from './sums';
import {
  ANSWERED_ALREADY, LOAD_FAILED, NOT_RECORDED_PLAN, NO_DAY, NO_MATCH, NO_TRIPS, TRIP_GONE, deliveredExtras, noPlanOut, ratio, staleLine, stillOutFrom,
} from './words';

const FILTERS: { value: Filter; label: string }[] = [{ value: 'all', label: 'All trucks' }, { value: 'problems', label: 'Problems only' }];

// One depot's part of the page: its watched day and its open problems.
interface Part { depot: string; ops: UseQueryResult<OperationsDay>; issues: UseQueryResult<IssueList> }

// Live day at /dispatcher/live (spec 016, Dispatcher · Live day 78:68047, · issue open 78:68510 and both · decision sent
// frames): the watched day's counts, every trip by brand and district on its timeline, and on the right the full
// Needs you cards (spec 012) and Drops and events. ?trip= opens a trip's details and ?issue= focuses a problem's card,
// as the dashboard's links do. Below 1024 the counts come first, then Needs you, the trip cards and the events.
// On both depots together (spec 021) the page reads each depot apart and shows Peliyagoda's part and then Kandy's, each
// under its depot's name with the same layout; the counts add the two up once both days are read, and a trip or a
// problem named in the address is found in whichever part holds it.
export function LiveDayPage() {
  const { depots, both } = useScope();
  const ops = useOperations(depots);
  const issues = useIssueLists(depots);
  const parts: Part[] = depots.map((depot, i) => ({ depot, ops: ops[i]!, issues: issues[i]! }));
  const answering = useAnswer();
  // The depot each answer was sent from, so its green line or its refusal shows only in that depot's part.
  const [sentFrom, setSentFrom] = useState<SentFrom>({ byIssue: {}, latest: null });
  const { at } = useAppClock();
  const online = useOnline();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  // A problem a link or a Decide named that no open list holds, even after reading them again.
  const [answered, setAnswered] = useState<string | null>(null);
  const shown = parts.flatMap((part) => (part.ops.data ? [part.ops.data] : []));
  // Every depot's day, once each is read: only then do the counts add up, or a trip none of them holds count as gone.
  const all = parts.length > 0 && shown.length === parts.length ? shown : null;
  const trips = shown.flatMap(allTrips);
  const watched = agreed(shown.map((day) => day.day));
  const tripParam = params.get('trip');
  const issueParam = params.get('issue');
  const setParam = useCallback((name: 'trip' | 'issue', value: string | null) => setParams((held) => {
    const next = new URLSearchParams(held);
    if (value) next.set(name, value); else next.delete(name);
    return next;
  }, { replace: true }), [setParams]);

  // A trip named by a link is opened and brought into view once. One the reads no longer hold is said, not looked up.
  const tripGone = Boolean(tripParam && all && !trips.some((trip) => trip.tripId === tripParam));
  const tripIds = trips.map((trip) => trip.tripId).join();
  const shownTrip = useRef<string | null>(null);
  useEffect(() => {
    if (!tripParam || shownTrip.current === tripParam || !tripIds.split(',').includes(tripParam)) return;
    shownTrip.current = tripParam;
    showTrip(tripParam);
  }, [tripParam, tripIds]);

  // A problem named by a link or a Decide is focused once its card is listed. The reads are separate snapshots, so one
  // no list holds is read again once, every list, and still missing it was already answered.
  const qc = useQueryClient();
  const lists = parts.map((part) => part.issues.data);
  const listed = lists.some((list) => list?.issues.some((issue) => issue.id === issueParam));
  // A list still to come may hold it.
  const allListed = lists.every(Boolean);
  const depotsKey = depots.join(',');
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!issueParam) return;
    if (listed) {
      focusIssue(issueParam);
      setParam('issue', null);
      return;
    }
    if (!allListed || asked.current === issueParam) return;
    asked.current = issueParam;
    void qc.refetchQueries({ queryKey: issuesKey, type: 'active' }).then(() => {
      if (depotsKey.split(',').some((depot) => qc.getQueryData<IssueList>(issuesKeyOf(depot))?.issues.some((issue) => issue.id === issueParam))) return;
      setAnswered(issueParam);
      setParam('issue', null);
    });
  }, [issueParam, listed, allListed, depotsKey, qc, setParam]);
  const notice = tripGone ? TRIP_GONE : answered ? ANSWERED_ALREADY : null;

  const actions: RowActions = {
    openTrip: tripParam,
    toggle: (tripId) => {
      setAnswered(null);
      if (tripParam === tripId) {
        setParam('trip', null);
        window.requestAnimationFrame(() => focusOpener(tripId));
      } else {
        shownTrip.current = tripId;
        setParam('trip', tripId);
      }
    },
    decide: (issueId) => {
      setAnswered(null);
      if (!focusIssue(issueId)) { asked.current = null; setParam('issue', issueId); }
    },
  };
  // On both depots together each part's column shows only the answers sent from it.
  const answeringOf = (depot: string): Answering => (both ? answeringIn(answering, depot, sentFrom, (issue, decision) => {
    setSentFrom((held) => ({ byIssue: { ...held.byIssue, [issue.id]: depot }, latest: depot }));
    answering.decide(issue, decision);
  }) : answering);
  const pending = parts.some((part) => part.ops.isPending);
  const body = (part: Part, className: string, partNotice: string | null) => (
    <LiveBody part={part} notice={partNotice} filter={filter} actions={actions} at={at} answering={answeringOf(part.depot)} className={className} />
  );

  return (
    <div className="lg:-mt-[7px]">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl leading-7 font-bold">Live day{watched ? ` · ${shortDay(watched)}` : ''}</h1>
        {!both && <ReadLine part={parts[0]!} online={online} />}
        {trips.length > 0 && <Switch label="Trucks shown" value={filter} options={FILTERS} onChange={setFilter} className="lg:ml-auto" />}
        {shown.length === 0 && pending && <Skeleton soft aria-hidden="true" className="h-[27px] w-[212px] rounded-full lg:ml-auto" />}
      </header>
      <div className="mt-2.5">{all ? <Counts days={all} lists={lists} /> : pending && <CountsSkeleton />}</div>

      {both ? (
        <>
          {notice && <p role="status" className="mt-4 rounded-[10px] bg-muted px-3 py-2.5 text-xs leading-4 font-semibold">{notice}</p>}
          {parts.map((part) => (
            <section key={part.depot} aria-labelledby={partId(part.depot)} className="mt-6">
              <DepotHeading depot={part.depot}><ReadLine part={part} online={online} /></DepotHeading>
              <ReceivingListPanel depot={part.depot} />
              {body(part, 'mt-2.5', null)}
            </section>
          ))}
        </>
      ) : <><ReceivingListPanel depot={parts[0]!.depot} />{body(parts[0]!, 'mt-4 lg:mt-3', notice)}</>}
    </div>
  );
}

// Live only while the last read worked and this browser is online; a held or failed read shows the last one.
function ReadLine({ part, online }: { part: Part; online: boolean }) {
  const day = part.ops.data;
  if (!day) return part.ops.isPending ? <Skeleton aria-hidden="true" className="h-2.5 w-28 rounded-full" /> : null;
  return isLive(part.ops, online)
    ? <LiveLine updated={clockTime(day.readAt)} />
    : <StaleLine busy={part.ops.isFetching && !part.ops.isPaused} onRetry={() => { void part.ops.refetch(); }}>{staleLine(day.readAt)}</StaleLine>;
}

// A depot's trucks on their timelines, and beside them its Needs you column and its Drops and events.
function LiveBody({ part, notice, filter, actions, at, answering, className }: {
  part: Part; notice: string | null; filter: Filter; actions: RowActions; at: number | null; answering: Answering; className: string;
}) {
  return (
    <div className={cn('grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_330px] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-3.5 lg:gap-y-3', className)}>
      <section aria-label="Trucks" className="order-2 min-w-0 space-y-3 lg:col-start-1 lg:row-span-2 lg:row-start-1">
        {notice && <p role="status" className="rounded-[10px] bg-muted px-3 py-2.5 text-xs leading-4 font-semibold">{notice}</p>}
        <Trips query={part.ops} depot={part.depot} filter={filter} issues={part.issues.data} actions={actions} at={at} />
      </section>
      <NeedsYou query={part.issues} depot={part.depot} answering={answering} className="order-1 lg:col-start-2 lg:row-start-1" />
      <Events day={part.ops.data} className="order-3 lg:col-start-2 lg:row-start-2" />
    </div>
  );
}

// "1 / 38 trucks out", "1 / 2 delivered · 1 partial" and "1 need you": the reads' own counts, on both depots together
// the two added up, and the open problems the columns list.
function Counts({ days, lists }: { days: OperationsDay[]; lists: (IssueList | undefined)[] }) {
  const c = sumCounts(days.map((day) => day.counts));
  const open = lists.every(Boolean) ? lists.reduce((n, list) => n + list!.issues.length, 0) : 0;
  const extras = deliveredExtras(c);
  return (
    <p className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
      <Count value={ratio(c.vehiclesOut, c.vehiclesTotal)} label="trucks out" />
      <Count value={ratio(c.stopsDelivered, c.stopsTotal)} label={['delivered', ...extras].join(' · ')} />
      {open > 0 && (
        <span className="text-bad">
          <span className="font-mono text-sm leading-[18px] font-bold">{whole(open)}</span>
          <span className="ml-1.5 text-[11px] leading-[14px]">{open === 1 ? 'needs' : 'need'} you</span>
        </span>
      )}
    </p>
  );
}

function Count({ value, label }: { value: string; label: string }) {
  return (
    <span>
      <span className="font-mono text-sm leading-[18px] font-bold whitespace-pre">{value.replace(' / ', '  /  ')}</span>
      <span className="ml-1.5 text-[11px] leading-[14px] text-muted-foreground">{label}</span>
    </span>
  );
}

function Note({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className={cn(CARD, 'flex flex-wrap items-center justify-between gap-3 px-5 py-4')}>
      <p className="text-[13px] leading-[18px] font-semibold">{children}</p>
      {action}
    </div>
  );
}

// The left column: the watched day's trips, the earlier days still out, or what stands in for them.
function Trips({ query, depot, filter, issues, actions, at }: {
  query: UseQueryResult<OperationsDay>; depot: string; filter: Filter; issues: IssueList | undefined; actions: RowActions; at: number | null;
}) {
  const day = query.data;
  if (!day) {
    if (!query.isError) return <TripsSkeleton />;
    return (
      <div role="alert" className={cn(CARD, 'px-5 py-5')}>
        <h2 className="font-sans text-[15px] leading-5 font-semibold">{LOAD_FAILED}</h2>
        <p className="mt-1.5 text-xs leading-4 text-muted-foreground">{reasonOf(query.error)}</p>
        <Button variant="outline" className={plainButton('mt-4 h-9 px-4 text-xs')} disabled={query.isFetching} onClick={() => { void query.refetch(); }}>
          {query.isFetching ? 'Trying…' : 'Try again'}
        </Button>
      </div>
    );
  }
  const list = issues?.issues;
  const matching = allTrips(day).some(needsAttention);
  return (
    <>
      {day.day === null && <Note>{NO_DAY}</Note>}
      {day.day !== null && day.plan === null && (
        <Note action={<ViewPlanLink date={day.day} depot={depot} className={plainButton('h-8 px-4 text-xs')} />}>{noPlanOut(day.day)}</Note>
      )}
      {day.plan && !day.plan.detailRecorded && <Note>{NOT_RECORDED_PLAN}</Note>}
      {day.plan && day.groups.length === 0 && <Note>{NO_TRIPS}</Note>}
      {filter === 'problems' && !matching && <Note>{NO_MATCH}</Note>}
      {/* A section the filter leaves empty goes, heading and axis too; its totals were never filtered. */}
      {day.day !== null && shownGroups(day.groups, filter).length > 0 && (
        <Section date={day.day} totals={day.brandTotals} groups={day.groups} timeline={day.timeline} filter={filter} issues={list} actions={actions} at={at} />
      )}
      {day.earlierOut.filter((section) => shownGroups(section.groups, filter).length > 0).map((section) => (
        <div key={section.date} className="pt-1">
          <h2 className="px-1 text-sm leading-5 font-bold">{stillOutFrom(section.date)}</h2>
          <Section date={section.date} totals={section.brandTotals} groups={section.groups} timeline={section.timeline} filter={filter} issues={list} actions={actions} at={at} />
        </div>
      ))}
    </>
  );
}
