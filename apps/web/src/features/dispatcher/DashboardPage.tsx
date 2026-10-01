import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useIssues } from '@/features/live/issues';
import { isLive, useOnline, useOperations } from '@/features/live/operations';
import { CARD, LiveLine, StaleLine } from '@/features/live/parts/ui';
import { LOAD_FAILED, NO_DAY, staleLine } from '@/features/live/words';
import { clockTime, shortDay } from '@/features/loader/words';
import { plainButton } from '@/features/plan/parts/look';
import { reasonOf } from '@/features/store/words';
import { useAppClock } from '@/lib/clock';
import { cn } from '@/lib/utils';
import { MapSkeleton, TilesSkeleton, TrucksSkeleton } from './parts/DashboardSkeleton';
import { FleetMap } from './parts/FleetMap';
import { NeedsYouCard } from './parts/NeedsYouCard';
import { Tiles } from './parts/Tiles';
import { TrucksOut } from './parts/TrucksOut';

// The dispatcher's dashboard at /dispatcher (spec 016, Dispatcher · Dashboard 53:11540): the watched day and the app's
// time, six tiles from the read, Needs you with the next run below it and the district map beside it (spec 019), and
// the trucks out now, problems first. From 1280 wide the map sits right of Needs you, 520 wide as in the frame; below
// that it goes under Needs you. Below 1024 the tiles go two to a row, then Needs you, the map and the truck cards.
export function DashboardPage() {
  const ops = useOperations();
  const issues = useIssues();
  const clock = useAppClock();
  const online = useOnline();
  const day = ops.data;
  // A failed refresh keeps the last read, so the card keeps drawing it; a first read that failed shows the error above.
  const map = day ? <FleetMap day={day} /> : ops.isError ? null : <MapSkeleton />;

  return (
    <div className="lg:-mt-[7px]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 className="text-xl leading-7 font-bold">{day ? (day.day ? shortDay(day.day) : NO_DAY) : 'Dashboard'}</h1>
        <span aria-hidden="true" className="text-muted-foreground">·</span>
        <span className="font-mono text-base leading-6 font-bold tabular-nums">{clock.time}</span>
        {day ? (
          isLive(ops, online)
            ? <LiveLine updated={clockTime(day.readAt)} />
            : <StaleLine busy={ops.isFetching && !ops.isPaused} onRetry={() => { void ops.refetch(); }}>{staleLine(day.readAt)}</StaleLine>
        ) : ops.isPending && <Skeleton aria-hidden="true" className="h-2.5 w-28 rounded-full" />}
      </header>

      <div className="mt-4 space-y-4">
        {day ? <Tiles day={day} issues={issues} /> : ops.isError ? (
          <div role="alert" className={cn(CARD, 'px-5 py-5')}>
            <h2 className="font-sans text-[15px] leading-5 font-semibold">{LOAD_FAILED}</h2>
            <p className="mt-1.5 text-xs leading-4 text-muted-foreground">{reasonOf(ops.error)}</p>
            <Button variant="outline" className={plainButton('mt-4 h-9 px-4 text-xs')} disabled={ops.isFetching} onClick={() => { void ops.refetch(); }}>
              {ops.isFetching ? 'Trying…' : 'Try again'}
            </Button>
          </div>
        ) : <TilesSkeleton />}
        <div className={cn('grid gap-4', map && 'xl:grid-cols-[minmax(0,1fr)_520px] xl:gap-x-3.5')}>
          <NeedsYouCard issues={issues} day={day} />
          {map}
        </div>
        {day ? <TrucksOut day={day} issues={issues.data?.issues} /> : !ops.isError && <TrucksSkeleton />}
      </div>
    </div>
  );
}
