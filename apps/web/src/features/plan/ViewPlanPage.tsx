import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import type { BoardCounts, Brand, DraftTrip, PlanBoard, PlanRef } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { workingFor } from '@/features/auth/api';
import { PickDepot } from '@/features/dispatcher/parts/PickDepot';
import { useScope } from '@/features/dispatcher/scope';
import { StaleNotice } from '@/features/store/parts/LoadError';
import { reasonOf } from '@/features/store/words';
import { ApiRequestError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { acceptDecisions, boardKey, dayKey, sendPlan, unsendPlan, useBoard, useDayBoard, useOrdersFollow, usePlanSaver, writeOutsideBoard } from './board';
import { ChecksPanel } from './parts/ChecksPanel';
import { Decisions } from './parts/Decisions';
import { BRAND_ICON } from './parts/icons';
import type { BoardIndex } from './parts/lookup';
import { checkItems, decisionsOf, indexOf } from './parts/lookup';
import { inkButton, orangeButton, plainButton } from './parts/look';
import { Column } from './parts/ui';
import { VehicleRow } from './parts/VehicleRow';
import { clockTime, countOf, figure, hhmm, sendDecisionsOpen, space, suggestedAt, viewPlanOf, whole } from './words';

const BRANDS: Brand[] = ['Fresh', 'Style', 'Tech'];

// View plan (spec 010, Dispatcher · View plan, · ready to send and · sent) at /dispatcher/plan/:date, so a reload or a
// clock move keeps the day. The vehicles by brand and district with their trips, the checks, and the send: greyed
// while a check blocks, orange when none does, and once sent the time it went out. "Back to edit" returns a draft
// to the board, and a sent plan too while the board says it can go back (D-33); where it cannot, the server's sentence
// says why in its place, "Loading has started, so this plan cannot go back to edit." (Q-19). A suggested plan (spec 014) says when
// it was suggested beside the title and lists the planner's decisions above the checks, and the send stays greyed
// until each is accepted or ended by an edit (D-54). On both depots together a plan belongs to one depot (spec 021,
// D-96): the page reads no plan and asks which depot's to show.
export function ViewPlanPage() {
  const { date = '' } = useParams();
  return useScope().both ? <PickDepot title={/^\d{4}-\d{2}-\d{2}$/.test(date) ? viewPlanOf(date) : 'View plan'} /> : <OneDepotPlan date={date} />;
}

function OneDepotPlan({ date }: { date: string }) {
  const query = useDayBoard(date);
  useOrdersFollow();

  if (!query.data) {
    return query.isError ? <CannotLoad date={date} error={query.error} busy={query.isFetching} onRetry={() => { void query.refetch(); }} /> : <ViewSkeleton date={date} />;
  }
  // A board kept from an earlier visit may be from before a reset, so only one read or answered since this page
  // opened is passed on to the board's queue.
  // A refresh that fails keeps the plan on screen, and says it may be out of date.
  const stale = query.isError ? <StaleNotice busy={query.isFetching} onRetry={() => { void query.refetch(); }} /> : null;
  return <ViewPlan date={date} board={query.data} fresh={query.isFetchedAfterMount && !query.isError} stale={stale} />;
}

function ViewPlan({ date, board, fresh, stale }: { date: string; board: PlanBoard; fresh: boolean; stale: ReactNode }) {
  const qc = useQueryClient();
  const saver = usePlanSaver();
  const navigate = useNavigate();
  // The board's own day (rule 1), so another day's plan offers no Accept (spec 014).
  const current = useBoard();
  const [busy, setBusy] = useState<'send' | 'unsend' | 'accept' | null>(null);
  // Which accept is on its way: one decision's key, or 'all'.
  const [accepting, setAccepting] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const index = indexOf(board);
  const sent = board.plan.status === 'published';
  const items = checkItems(board.check?.problems ?? []);
  const blocked = board.check?.ok !== true;
  // The planner's decisions still open: View plan lists them, and the screen counts the rows (rule 9).
  const open = decisionsOf(board).filter((decision) => decision.open).length;
  const canAccept = !sent && current.data?.day?.date === date;
  // The board's queue keeps up with the plan this page shows, so a send names the revision on screen.
  useEffect(() => {
    if (fresh) saver.sync(board);
  }, [saver, board, fresh]);

  // A send, a back to edit and an accept wait for the board's save on its way and answer with the board. The board's
  // queue runs them when this is its day; any other day's plan, or this one after a reload, goes on its own, naming the
  // plan on screen.
  const run = async (kind: 'send' | 'unsend' | 'accept', call: (day: string, ref: PlanRef) => Promise<PlanBoard>) => {
    setBusy(kind);
    setRefused(null);
    const sentFor = workingFor(qc);
    let problem: string | null = null;
    if (saver.date === date) {
      if (fresh) saver.sync(board);
      problem = await saver.act(call);
    } else {
      try {
        await writeOutsideBoard(qc, date, board, call);
      } catch (error) {
        problem = reasonOf(error);
        if (error instanceof ApiRequestError && error.status === 409) void qc.invalidateQueries({ queryKey: dayKey(date) });
      }
    }
    setBusy(null);
    setAccepting(null);
    // An answer that lands once the screen works for another account or depot (spec 020) is not this page's: it says
    // and opens nothing.
    if (workingFor(qc) !== sentFor) return;
    setRefused(problem);
    void qc.invalidateQueries({ queryKey: boardKey });
    if (problem === null && kind === 'unsend') navigate('/dispatcher/plan');
  };
  const accept = (keys: string[], which: string) => {
    setAccepting(which);
    void run('accept', (day, ref) => acceptDecisions(day, { ...ref, keys }));
  };

  const back = sent
    ? !board.plan.canUnsend ? board.plan.lockedReason && <p className="flex min-h-9 items-center text-[13px] leading-4 text-muted-foreground">{board.plan.lockedReason}</p> : (
      <Button variant="outline" className={plainButton('h-9 px-5 text-[13px]')} disabled={busy !== null} onClick={() => { void run('unsend', unsendPlan); }}>
        {busy === 'unsend' ? 'Taking back…' : '← Back to edit'}
      </Button>
    )
    : <Button variant="outline" className={plainButton('h-9 px-5 text-[13px]')} onClick={() => navigate('/dispatcher/plan')}>← Back to edit</Button>;

  const drivers = board.counts?.drivers ?? 0;
  const send = sent
    ? board.plan.sentAt && (
      <p role="status" className="flex h-9 items-center rounded-[10px] bg-good-tint px-4 text-[13px] font-semibold text-good">
        ✓ Sent {clockTime(board.plan.sentAt)} · {drivers > 0 ? `loaders and ${countOf(drivers, 'driver')}` : 'loaders'}
      </p>
    )
    : blocked
      ? <Button variant="secondary" className={inkButton('h-9 px-5 text-[13px]')} disabled focusableWhenDisabled>Send plan · {countOf(items.length, 'check')} open</Button>
      : open > 0
        ? <Button variant="secondary" className={inkButton('h-9 px-5 text-[13px]')} disabled focusableWhenDisabled>{sendDecisionsOpen(open)}</Button>
        : <Button className={orangeButton('h-9 px-5 text-[13px]')} disabled={busy !== null} focusableWhenDisabled onClick={() => { void run('send', sendPlan); }}>{busy === 'send' ? 'Sending…' : 'Send plan to loaders and drivers'}</Button>;

  return (
    <div className="lg:-mt-2.5">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-xl leading-6 font-bold">{viewPlanOf(date)}</h1>
        {board.suggestion && (
          <span className="inline-flex h-7 items-center rounded-full border bg-card px-3 text-xs leading-[15px] font-semibold whitespace-nowrap">{suggestedAt(board.suggestion.builtAt)}</span>
        )}
        <div className="flex flex-wrap items-center gap-2.5 sm:ml-auto">
          {back}
          {send}
        </div>
      </header>
      {stale && <div className="mt-3">{stale}</div>}
      {refused && <p role="alert" className="mt-3 rounded-[10px] bg-bad-tint px-3 py-2 text-xs leading-[15px] font-semibold text-bad">{refused}</p>}
      {board.counts && <Counts counts={board.counts} />}
      <div className="mt-3.5 grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_330px] lg:items-start">
        <div className="order-2 space-y-3.5 lg:order-1">
          <Vehicles board={board} index={index} />
        </div>
        <div className="order-1 space-y-3.5 lg:order-2">
          <Decisions board={board} index={index} canAccept={canAccept} accepting={accepting} onAccept={accept} />
          <ChecksPanel board={board} />
        </div>
      </div>
    </div>
  );
}

// The counts, as the API sent them: orders on trips, the ones left, trucks and trips, windows met, kilometres and
// hours, and fridge space.
function Counts({ counts }: { counts: BoardCounts }) {
  const items: { number: string; label: string; tone?: string }[] = [
    { number: `${whole(counts.ordersOnTrips)} / ${whole(counts.ordersDue)}`, label: 'orders placed' },
    ...(counts.ordersUnplanned > 0 ? [{ number: whole(counts.ordersUnplanned), label: 'unplanned', tone: 'text-warn-ink' }] : []),
    ...(counts.ordersDeferred > 0 ? [{ number: whole(counts.ordersDeferred), label: 'deferred' }] : []),
    { number: `${whole(counts.vehiclesUsed)} / ${whole(counts.vehiclesWorking)}`, label: `trucks · ${countOf(counts.trips, 'trip')}` },
    { number: `${whole(counts.stopsOnTime)} / ${whole(counts.stops)}`, label: 'windows met' },
    { number: `${figure(counts.km)} km`, label: `${figure(counts.hoursOnRoad)} h on the road` },
    { number: `${space(counts.fridgeM3Used)} / ${space(counts.fridgeM3Working)}`, label: 'm³ fridge space' },
  ];
  return (
    <dl className="mt-3 flex flex-wrap items-baseline gap-x-8 gap-y-1.5 pl-1">
      {items.map((item) => (
        <div key={item.label} className={cn('flex items-baseline gap-1.5 whitespace-nowrap', item.tone)}>
          <dt className="sr-only">{item.label}</dt>
          <dd className="font-mono text-sm leading-[18px] font-bold">{item.number}</dd>
          <span aria-hidden="true" className={cn('text-[11px] leading-[14px]', !item.tone && 'text-muted-foreground')}>{item.label}</span>
        </div>
      ))}
    </dl>
  );
}

// The plan's vehicles by brand, then by district: a card per brand with its leaving times and how many trucks and
// trips it has, and a row per vehicle. A vehicle whose trips go to two places shows under each.
function Vehicles({ board, index }: { board: PlanBoard; index: BoardIndex }) {
  const place = (trip: DraftTrip) => {
    const shop = trip.stops[0] ? index.shop(trip.stops[0].outletId) : null;
    return shop ? { brand: shop.brand, district: shop.district } : null;
  };
  const sections = [...BRANDS, null].map((brand) => {
    const trips = board.plan.trips.filter((trip) => (place(trip)?.brand ?? null) === brand);
    const districts = [...new Set(trips.map((trip) => place(trip)?.district ?? ''))].sort();
    return { brand, trips, districts };
  }).filter((section) => section.trips.length > 0);

  if (sections.length === 0) {
    const words = board.plan.status === 'published' ? 'This plan has no trips.' : 'No trip yet. Start one on the plan board.';
    return <Column className="p-5"><p className="text-sm text-muted-foreground">{words}</p></Column>;
  }
  return sections.map(({ brand, trips, districts }) => {
    const leaving = trips.flatMap((trip) => index.trip(trip.vehicleId, trip.tripNo)?.times?.leaveAt ?? []).sort((a, b) => a - b);
    const vehicles = new Set(trips.map((trip) => trip.vehicleId)).size;
    const line = [
      leaving.length > 0 && (leaving[0] === leaving.at(-1) ? `leaves ${hhmm(leaving[0]!)}` : `leaves ${hhmm(leaving[0]!)} to ${hhmm(leaving.at(-1)!)}`),
      countOf(vehicles, 'truck'),
      countOf(trips.length, 'trip'),
    ].filter(Boolean).join(' · ');
    return (
      <Column key={brand ?? 'none'} className="px-3.5 pt-3 pb-2.5">
        <div className="flex items-center gap-3 pl-1">
          {brand && <img src={BRAND_ICON[brand]} alt="" className="size-[30px] object-contain" />}
          <h2 className="text-[15px] leading-5 font-bold">{brand ?? 'No stop yet'}</h2>
          <p className="text-[11px] leading-[14px] text-muted-foreground">{line}</p>
        </div>
        {districts.map((district) => {
          const here = trips.filter((trip) => (place(trip)?.district ?? '') === district);
          const ids = [...new Set(here.map((trip) => trip.vehicleId))].sort();
          return (
            <section key={district} aria-label={district || 'No stop yet'} className="mt-1.5">
              {district && <h3 className="px-2 pb-1 text-[11px] leading-[14px] font-semibold text-muted-foreground">{district} · {countOf(ids.length, 'truck')}</h3>}
              <ul>
                {ids.map((vehicleId) => {
                  const own = here.filter((trip) => trip.vehicleId === vehicleId).sort((a, b) => a.tripNo - b.tripNo);
                  return <VehicleRow key={vehicleId} vehicleId={vehicleId} trips={own} driverName={index.driver(own[0]!.driverId)?.name ?? null} index={index} />;
                })}
              </ul>
            </section>
          );
        })}
      </Column>
    );
  });
}

function CannotLoad({ date, error, busy, onRetry }: { date: string; error: unknown; busy: boolean; onRetry: () => void }) {
  return (
    <div className="space-y-4 lg:pt-2.5">
      <h1 className="text-xl leading-6 font-bold">{/^\d{4}-\d{2}-\d{2}$/.test(date) ? viewPlanOf(date) : 'View plan'}</h1>
      <Column role="alert" className="max-w-md p-4">
        <h2 className="font-sans text-[15px] leading-[18px] font-semibold">Could not load the plan</h2>
        <p className="mt-1.5 text-xs leading-[15px] text-muted-foreground">{reasonOf(error)}</p>
        <Button variant="outline" className={plainButton('mt-3 h-11 w-full text-sm')} disabled={busy} onClick={onRetry}>{busy ? 'Trying…' : 'Try again'}</Button>
      </Column>
    </div>
  );
}

function ViewSkeleton({ date }: { date: string }) {
  return (
    <div role="status" aria-label="Loading the plan" className="lg:-mt-2.5">
      <div className="flex flex-wrap items-center gap-4">
        {/^\d{4}-\d{2}-\d{2}$/.test(date) ? <h1 className="text-xl leading-6 font-bold">{viewPlanOf(date)}</h1> : <Skeleton className="h-6 w-56" />}
        <Skeleton soft className="ml-auto h-9 w-32 rounded-[10px]" />
        <Skeleton soft className="h-9 w-60 rounded-[10px]" />
      </div>
      <Skeleton className="mt-4 h-3.5 w-[640px] max-w-full" />
      <div className="mt-4 grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_330px]">
        <Column className="space-y-3 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-4 w-full" />)}</Column>
        <Column className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-4 w-3/4" />)}</Column>
      </div>
    </div>
  );
}
