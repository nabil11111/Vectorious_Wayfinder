import type { UseQueryResult } from '@tanstack/react-query';
import type { OperationsDay } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useIssueLists } from '@/features/live/issues';
import { isLive, useOnline, useOperations } from '@/features/live/operations';
import { CARD, LiveLine, StaleLine } from '@/features/live/parts/ui';
import { agreed } from '@/features/live/sums';
import { LOAD_FAILED, NO_DAY, staleLine } from '@/features/live/words';
import { clockTime, shortDay } from '@/features/loader/words';
import { plainButton } from '@/features/plan/parts/look';
import { reasonOf } from '@/features/store/words';
import { useAppClock } from '@/lib/clock';
import { cn } from '@/lib/utils';
import { TilesSkeleton, TrucksSkeleton } from './parts/DashboardSkeleton';
import { FleetMap } from './parts/FleetMap';
import { bothMapRead, mapReadOf } from './parts/fleet-map';
import { NeedsYouCard } from './parts/NeedsYouCard';
import { Tiles } from './parts/Tiles';
import { TrucksOut } from './parts/TrucksOut';
import { useScope } from './scope';

// The dispatcher's dashboard at /dispatcher (spec 016, Dispatcher · Dashboard 53:11540): the watched day and the app's
// time, six tiles from the read, Needs you with the next run below it and the district map beside it (spec 019), and
// the trucks out now, problems first. From 1280 wide the map sits right of Needs you, 520 wide as in the frame; below
// that it goes under Needs you. Below 1024 the tiles go two to a row, then Needs you, the map and the truck cards.
// On both depots together (spec 021) it reads each depot apart: the tiles and the map add the two up once both days are
// read, the lists hold both depots' rows, and a depot whose read failed says so with Try again while the other's rows
// stay.
export function DashboardPage() {
  const { scope, depots, both } = useScope();
  const ops = useOperations(depots);
  const issues = useIssueLists(depots);
  const clock = useAppClock();
  const online = useOnline();
  const days = ops.map((query) => query.data);
  const shown = days.filter((day): day is OperationsDay => day !== undefined);
  // Every depot's day, once each is read: only then is there anything to add up.
  const all = depots.length > 0 && shown.length === depots.length ? shown : null;
  const failed = depots.flatMap((depot, i) => (!ops[i]!.data && ops[i]!.isError ? [{ depot, query: ops[i]! }] : []));
  const watched = agreed(shown.map((day) => day.day));
  // A failed refresh keeps the last read, so the card keeps drawing it; a first read that failed shows the error above,
  // and the card keeps its depot switch, the only one below 1280 wide.
  const map = scope && <FleetMap view={scope} read={all ? (both ? bothMapRead(all) : mapReadOf(all[0]!)) : null} failed={failed.length > 0} />;

  return (
    <div className="lg:-mt-[7px]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 className="text-xl leading-7 font-bold">{shown.length && watched !== undefined ? (watched ? shortDay(watched) : NO_DAY) : 'Dashboard'}</h1>
        <span aria-hidden="true" className="text-muted-foreground">·</span>
        <span className="font-mono text-base leading-6 font-bold tabular-nums">{clock.time}</span>
        <ReadLines depots={depots} ops={ops} online={online} both={both} />
      </header>

      <div className="mt-4 space-y-4">
        {all ? <Tiles depots={depots} days={all} issues={issues} /> : failed.length ? failed.map(({ depot, query }) => (
          <div key={depot} role="alert" className={cn(CARD, 'px-5 py-5')}>
            <h2 className="font-sans text-[15px] leading-5 font-semibold">{both ? `Could not load ${depot}'s day.` : LOAD_FAILED}</h2>
            <p className="mt-1.5 text-xs leading-4 text-muted-foreground">{reasonOf(query.error)}</p>
            <Button variant="outline" className={plainButton('mt-4 h-9 px-4 text-xs')} disabled={query.isFetching} onClick={() => { void query.refetch(); }}>
              {query.isFetching ? 'Trying…' : 'Try again'}
            </Button>
          </div>
        )) : <TilesSkeleton />}
        <div className={cn('grid gap-4', map && 'xl:grid-cols-[minmax(0,1fr)_520px] xl:gap-x-3.5')}>
          <NeedsYouCard parts={depots.map((depot, i) => ({ depot, issues: issues[i]!, day: days[i] }))} both={both} />
          {map}
        </div>
        {shown.length
          ? <TrucksOut parts={depots.flatMap((depot, i) => (days[i] ? [{ depot, day: days[i]!, issues: issues[i]!.data?.issues }] : []))} both={both} complete={all !== null} />
          : !failed.length && <TrucksSkeleton />}
      </div>
    </div>
  );
}

// Beside the time: live while every depot's last read worked, at the time of the older read; otherwise each depot whose
// refresh failed keeps its last read and says so, with Try again. A first read still on its way shows a grey line.
function ReadLines({ depots, ops, online, both }: { depots: string[]; ops: UseQueryResult<OperationsDay>[]; online: boolean; both: boolean }) {
  const read = depots.flatMap((depot, i) => (ops[i]!.data ? [{ depot, query: ops[i]!, day: ops[i]!.data! }] : []));
  if (read.length === 0) return ops.some((query) => query.isPending) ? <Skeleton aria-hidden="true" className="h-2.5 w-28 rounded-full" /> : null;
  if (read.length === depots.length && read.every(({ query }) => isLive(query, online))) {
    return <LiveLine updated={clockTime(read.map(({ day }) => day.readAt).sort()[0]!)} />;
  }
  return read.filter(({ query }) => !isLive(query, online)).map(({ depot, query, day }) => (
    <StaleLine key={depot} busy={query.isFetching && !query.isPaused} onRetry={() => { void query.refetch(); }}>{staleLine(day.readAt, both ? depot : undefined)}</StaleLine>
  ));
}
