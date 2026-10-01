import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { IssueList, OperationsDay } from '@wayfinder/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { plainButton } from '@/features/plan/parts/look';
import { reasonOf } from '@/features/store/words';
import { clockTime, shortDay, whole } from '@/features/loader/words';
import { useAppClock } from '@/lib/clock';
import { cn } from '@/lib/utils';
import { NeedsYou } from './NeedsYou';
import { useAnswer, useIssues } from './issues';
import { useOperations } from './operations';
import { Events } from './parts/Events';
import { focusIssue, focusOpener, showTrip } from './parts/focus';
import { CountsSkeleton, TripsSkeleton } from './parts/LiveSkeleton';
import { allTrips, needsAttention, type Filter } from './parts/rows';
import { Section } from './parts/Section';
import type { RowActions } from './parts/TripRow';
import { CARD, LiveLine, StaleLine, Switch } from './parts/ui';
import {
  ANSWERED_ALREADY, LOAD_FAILED, NOT_RECORDED_PLAN, NO_DAY, NO_MATCH, NO_TRIPS, TRIP_GONE, deliveredExtras, noPlanOut, ratio, staleLine, stillOutFrom,
} from './words';

const FILTERS: { value: Filter; label: string }[] = [{ value: 'all', label: 'All trucks' }, { value: 'problems', label: 'Problems only' }];

// Live day at /dispatcher/live (spec 016, Dispatcher · Live day 78:68047, · issue open 78:68510 and both · decision sent
// frames): the watched day's counts, every trip by brand and district on its timeline, and on the right the full
// Needs you cards (spec 012) and Drops and events. ?trip= opens a trip's details and ?issue= focuses a problem's card,
// as the dashboard's links do. Below 1024 the counts come first, then Needs you, the trip cards and the events.
export function LiveDayPage() {
  const ops = useOperations();
  const issues = useIssues();
  const answering = useAnswer();
  const { at } = useAppClock();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  // A problem a link or a Decide named that the open list no longer holds, even after reading it again.
  const [answered, setAnswered] = useState<string | null>(null);
  const day = ops.data;
  const trips = day ? allTrips(day) : [];
  const tripParam = params.get('trip');
  const issueParam = params.get('issue');
  const setParam = useCallback((name: 'trip' | 'issue', value: string | null) => setParams((held) => {
    const next = new URLSearchParams(held);
    if (value) next.set(name, value); else next.delete(name);
    return next;
  }, { replace: true }), [setParams]);

  // A trip named by a link is opened and brought into view once. One the read no longer holds is said, not looked up.
  const tripGone = Boolean(tripParam && day && !trips.some((trip) => trip.tripId === tripParam));
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!tripParam || !day || shown.current === tripParam || !allTrips(day).some((trip) => trip.tripId === tripParam)) return;
    shown.current = tripParam;
    showTrip(tripParam);
  }, [tripParam, day]);

  // A problem named by a link or a Decide is focused once its card is listed. The two reads are separate snapshots,
  // so one missing from the list is read again once, and still missing it was already answered.
  const { data: list, refetch: refetchIssues } = issues;
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!issueParam || !list) return;
    if (list.issues.some((issue) => issue.id === issueParam)) {
      focusIssue(issueParam);
      setParam('issue', null);
      return;
    }
    if (asked.current === issueParam) return;
    asked.current = issueParam;
    void refetchIssues().then((read) => {
      if (read.data?.issues.some((issue) => issue.id === issueParam)) return;
      setAnswered(issueParam);
      setParam('issue', null);
    });
  }, [issueParam, list, refetchIssues, setParam]);
  const notice = tripGone ? TRIP_GONE : answered ? ANSWERED_ALREADY : null;

  const actions: RowActions = {
    openTrip: tripParam,
    toggle: (tripId) => {
      setAnswered(null);
      if (tripParam === tripId) {
        setParam('trip', null);
        window.requestAnimationFrame(() => focusOpener(tripId));
      } else {
        shown.current = tripId;
        setParam('trip', tripId);
      }
    },
    decide: (issueId) => {
      setAnswered(null);
      if (!focusIssue(issueId)) { asked.current = null; setParam('issue', issueId); }
    },
  };

  return (
    <div className="lg:-mt-[7px]">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl leading-7 font-bold">Live day{day?.day ? ` · ${shortDay(day.day)}` : ''}</h1>
        {day ? (
          ops.isError
            ? <StaleLine busy={ops.isFetching} onRetry={() => { void ops.refetch(); }}>{staleLine(day.readAt)}</StaleLine>
            : <LiveLine updated={clockTime(day.readAt)} />
        ) : ops.isPending && <Skeleton aria-hidden="true" className="h-2.5 w-28 rounded-full" />}
        {trips.length > 0 && <Switch label="Trucks shown" value={filter} options={FILTERS} onChange={setFilter} className="lg:ml-auto" />}
      </header>
      <div className="mt-2.5">{day ? <Counts day={day} issues={issues.data} /> : ops.isPending && <CountsSkeleton />}</div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:mt-3 lg:grid-cols-[minmax(0,1fr)_330px] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-3.5 lg:gap-y-3">
        <section aria-label="Trucks" className="order-2 min-w-0 space-y-3 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {notice && <p role="status" className="rounded-[10px] bg-muted px-3 py-2.5 text-xs leading-4 font-semibold">{notice}</p>}
          <Trips query={ops} filter={filter} issues={issues.data} actions={actions} at={at} />
        </section>
        <NeedsYou query={issues} answering={answering} className="order-1 lg:col-start-2 lg:row-start-1" />
        <Events day={day} className="order-3 lg:col-start-2 lg:row-start-2" />
      </div>
    </div>
  );
}

// "1 / 38 trucks out", "1 / 2 delivered · 1 partial" and "1 need you". The first two are the read's own counts, the
// third the open problems the column lists.
function Counts({ day, issues }: { day: OperationsDay; issues: IssueList | undefined }) {
  const c = day.counts;
  const open = issues?.issues.length ?? 0;
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
function Trips({ query, filter, issues, actions, at }: { query: UseQueryResult<OperationsDay>; filter: Filter; issues: IssueList | undefined; actions: RowActions; at: number | null }) {
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
        <Note action={<Link to={`/dispatcher/plan/${day.day}`} className={plainButton('h-8 px-4 text-xs')}>View plan</Link>}>{noPlanOut(day.day)}</Note>
      )}
      {day.plan && !day.plan.detailRecorded && <Note>{NOT_RECORDED_PLAN}</Note>}
      {day.plan && day.groups.length === 0 && <Note>{NO_TRIPS}</Note>}
      {filter === 'problems' && !matching && <Note>{NO_MATCH}</Note>}
      {day.day !== null && day.groups.length > 0 && (
        <Section date={day.day} totals={day.brandTotals} groups={day.groups} timeline={day.timeline} filter={filter} issues={list} actions={actions} at={at} />
      )}
      {day.earlierOut.map((section) => (
        <div key={section.date} className="pt-1">
          <h2 className="px-1 text-sm leading-5 font-bold">{stillOutFrom(section.date)}</h2>
          <Section date={section.date} totals={section.brandTotals} groups={section.groups} timeline={section.timeline} filter={filter} issues={list} actions={actions} at={at} />
        </div>
      ))}
    </>
  );
}
