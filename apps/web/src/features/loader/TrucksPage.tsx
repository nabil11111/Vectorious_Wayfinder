import { useEffect, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { LoadingDay, LoadingTruck } from '@wayfinder/contracts';
import { Skeleton } from '@/components/ui/skeleton';
import { StaleNotice } from '@/features/store/parts/LoadError';
import { useAppClock } from '@/lib/clock';
import { NOT_KEPT, SEE_CHANGES, WITHDRAWN, changedKeys, markChangesOpened, noticeOf, planChangedLine, truckKey, usePlanChanges } from './changes';
import { useLoadingDay, useLoaderWrites, type LoaderWrites } from './loading';
import { LoadFailed } from './parts/LoadFailed';
import { DayNote, NextOutCard } from './parts/NextOutCard';
import { NextList } from './parts/TruckRow';
import { Card, NotSaved, Refused } from './parts/ui';
import { countOf, shortDay } from './words';

// Today's trucks at /loader (spec 012, Loader · Today's trucks, · phone and · next truck): the loader's day, the next
// truck out with what goes in first, and the rest of the day's trucks in leaving order. One column on a phone, the
// tablet frame's two from 1024 px.
export function TrucksPage() {
  const query = useLoadingDay();
  const writes = useLoaderWrites();

  if (!query.data) {
    return query.isError
      ? <LoadFailed what="the trucks" error={query.error} busy={query.isFetching} onRetry={() => { void query.refetch(); }} />
      : <TrucksSkeleton />;
  }
  // A refresh that fails keeps the trucks on screen and says they may be out of date.
  const stale = query.isError ? <StaleNotice busy={query.isFetching} onRetry={() => { void query.refetch(); }} /> : null;
  return <Trucks day={query.data} writes={writes} stale={stale} />;
}

// The day's sentences when there is no truck to load (rule 1 and rule 3).
function emptyNote(day: LoadingDay): string | null {
  if (day.day === null) return 'No delivery day is left.';
  if (day.plan === null) return `No plan is out for ${shortDay(day.day)} yet. Trucks show here once the dispatcher sends it.`;
  if (day.trucks.length === 0) return `No trucks to load for ${shortDay(day.day)}.`;
  return null;
}

function Trucks({ day, writes, stale }: { day: LoadingDay; writes: LoaderWrites; stale: ReactNode }) {
  const navigate = useNavigate();
  const { at } = useAppClock();
  // Next out is the first truck that is not ready, and the others follow it from 2 in leaving order (rule 2).
  const next = day.trucks.find((truck) => truck.status !== 'ready') ?? null;
  const others = day.trucks.filter((truck) => truck !== next);
  const busy = writes.phase !== 'idle';
  // The plan sent again (spec 016, rule 9): while it is back in edit only the wait sentence shows, and a newer
  // publication opens its notice once, never over a write on its way. The changed chips stay after Got it.
  const changes = usePlanChanges();
  const notice = noticeOf(changes, day);
  const changed = changedKeys(changes.kept?.changes ?? []);
  const unopened = (notice === 'changed' || notice === 'unchanged') && !changes.kept?.opened;
  useEffect(() => {
    if (!unopened || busy) return;
    markChangesOpened();
    navigate('/loader/changes');
  }, [unopened, busy, navigate]);
  const note = notice === 'withdrawn' ? WITHDRAWN : emptyNote(day);

  const start = (truck: LoadingTruck) => {
    if (!day.plan) return;
    writes.send(truck.tripId, { kind: 'start', body: { revision: truck.revision, plan: day.plan } }, () => navigate(`/loader/trucks/${truck.tripId}`));
  };

  return (
    <div>
      {stale && <div className="mb-3">{stale}</div>}
      {writes.refused && <Refused>{writes.refused}</Refused>}
      {writes.phase === 'unsaved' && <NotSaved onRetry={writes.retry} />}
      {changes.failed && <p role="status" className="mb-3 rounded-[10px] bg-warn-tint px-3 py-2.5 text-[13px] leading-4 font-semibold text-warn-ink">{NOT_KEPT}</p>}
      {/* A notice seen but not closed with Got it stays on top of the list, and opens again from here or the bell. */}
      {changes.kept && (notice === 'changed' || notice === 'unchanged') && changes.kept.opened && (
        <p role="status" className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-[12px] bg-warn-tint px-4 py-2.5 text-[15px] leading-5 font-semibold text-warn-ink">
          <span><span aria-hidden="true" className="mr-2 font-bold">!</span>{planChangedLine(changes.kept.latest)}</span>
          <Link to="/loader/changes" className="text-[13px] underline underline-offset-2">{SEE_CHANGES}</Link>
        </p>
      )}

      {day.day && (
        <header className="flex items-baseline justify-between gap-3">
          <h1 className="font-sans text-[15px] leading-5 font-semibold">{shortDay(day.day)}</h1>
          {day.trucks.length > 0 && <p className="text-[13px] leading-4 text-muted-foreground">{countOf(day.trucks.length, 'truck')}</p>}
        </header>
      )}

      <div className="mt-4 grid grid-cols-1 gap-y-[11px] lg:mt-[19px] lg:grid-cols-[minmax(0,680fr)_minmax(0,420fr)] lg:gap-x-6">
        <div>
          {note !== null ? (
            <DayNote>{note}</DayNote>
          ) : next ? (
            <NextOutCard truck={next} at={at} busy={busy} starting={writes.out === 'start' && writes.phase === 'saving'} onStart={() => start(next)} changed={changed.has(truckKey(next))} />
          ) : (
            <DayNote>Every truck is loaded.</DayNote>
          )}
        </div>
        <NextList trucks={others} from={next ? 2 : 1} changed={changed} className="lg:mt-0.5" />
      </div>
    </div>
  );
}

// The first load (Loader · Today's trucks · loading): grey blocks for the day line, the card and three rows.
function TrucksSkeleton() {
  return (
    <div role="status" aria-label="Loading the trucks">
      <Skeleton className="h-4 w-[120px] rounded-full lg:w-[180px]" />
      <div className="mt-4 grid grid-cols-1 gap-y-[11px] lg:mt-[19px] lg:grid-cols-[minmax(0,680fr)_minmax(0,420fr)] lg:gap-x-6">
        <Card className="p-[18px] lg:p-6">
          <Skeleton className="h-3 w-20 rounded-full" />
          <Skeleton className="mt-3 h-7 w-3/5 rounded-full" />
          <Skeleton className="mt-3 h-3.5 w-2/5 rounded-full" />
          <Skeleton className="mt-9 h-2.5 w-full rounded-full" />
          <div className="mt-4 space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton soft className="h-[22px] w-14 rounded-full" />
                <Skeleton className="h-3.5 w-1/3 rounded-full" />
              </div>
            ))}
          </div>
          <Skeleton soft className="mt-4 h-16 w-full rounded-[12px]" />
        </Card>
        <div>
          <Skeleton className="h-[18px] w-[60px] rounded-full" />
          <div className="mt-[17px] space-y-[18px] lg:mt-3.5 lg:space-y-3">
            {[0, 1, 2].map((i) => (
              <Card key={i} className="flex items-center gap-3 px-3.5 py-3 lg:py-[15px]">
                <Skeleton soft className="size-[30px] rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-3/5 rounded-full" />
                  <Skeleton soft className="h-3 w-2/5 rounded-full" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
