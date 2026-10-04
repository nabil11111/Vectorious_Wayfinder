import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { BoardCounts, BoardOrder, Brand } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PickDepot } from '@/features/dispatcher/parts/PickDepot';
import { useScope } from '@/features/dispatcher/scope';
import { useMe } from '@/features/auth/api';
import { currentRead, ordersOptions, useFollowGeneration, useFollowLookupMessages } from '@/features/lookup/queries';
import { useAppClock } from '@/lib/clock';
import { reasonOf } from '@/features/store/words';
import { cn } from '@/lib/utils';
import { ENDS_HISTORY, joinOrder, useBoard, useBoardScreen, useOrdersFollow, type BoardScreen, type Saver } from './board';
import { keyOf, placesOf, tripOf, type CrewRef, type TripKey } from './draft';
import { BoardHeader, type Tab } from './parts/BoardHeader';
import { ScenarioPanel } from './scenario/ScenarioPanel';
import { BuildPanel } from './parts/BuildPanel';
import { crewChange, type Pick } from './parts/crews';
import { impactLine } from './parts/impact';
import { DoneList } from './parts/DoneList';
import { FindSlot } from './parts/FindSlot';
import { startOverChange } from './parts/changes';
import { historyKey, openAfter, pressOf } from './parts/history-keys';
import { ICON } from './parts/icons';
import { groupKey, indexOf } from './parts/lookup';
import { OrderLists } from './parts/OrderLists';
import { activeOrders } from './parts/shop-summary';
import { PlanDnd } from './parts/PlanDnd';
import { TripPanel } from './parts/TripPanel';
import { plainButton } from './parts/look';
import { Column } from './parts/ui';
import { clockTime, planFor, shortDay } from './words';

// The plan board (spec 010, Dispatcher · Edit plan and its states). The dispatcher builds the board's day by
// hand: trips from the orders on the left, each on a crew the crew picker gives it (spec 026), the open trip in the
// middle, the other trips on the right.
// With no trip open, the middle builds the suggested plan instead (spec 014). Every number on it comes from the
// board the API sent. On both depots together a plan belongs to one depot (spec 021, D-96): the page reads no board and
// asks which depot to plan.
export function PlanBoardPage() {
  return useScope().both ? <PickDepot title="Plan board" /> : <OneDepotBoard />;
}

function OneDepotBoard() {
  const query = useBoard();
  const { scope } = useScope();
  const clock = useAppClock();
  useOrdersFollow();
  const { saver, screen } = useBoardScreen(query.data);

  if (!screen) {
    return query.isError
      ? <CannotLoad error={query.error} busy={query.isFetching} onRetry={() => { void query.refetch(); }} />
      : <BoardSkeleton />;
  }
  const { board } = screen;
  if (!board.day) return <Message title="Plan board" icon={ICON.day} line="No delivery day is left to plan." />;
  // The board opens for planning once the day's orders close (rule 1).
  if (!board.day.open) {
    if (board.depot !== scope || (clock.state?.day != null && board.demoDay !== clock.state.day)) return <BoardSkeleton />;
    if (query.isError) return <CannotLoad error={query.error} busy={query.isFetching} onRetry={() => { void query.refetch(); }} />;
    return <WaitingForOrders key={`${board.depot}:${board.day.date}:${board.demoDay}`} date={board.day.date} cutoffAt={board.day.cutoffAt} generation={board.demoDay} />;
  }
  // A sent plan is read on View plan, whose address keeps the day through a reload or a clock move. The board held
  // from an earlier visit can be out of date (the day may have moved on, or the plan gone back to edit), so only a
  // read that has just answered sends the page there.
  if (board.plan.status === 'published') {
    const fresh = query.isFetching ? undefined : query.data;
    return fresh?.day && fresh.plan.status === 'published' ? <Navigate to={`/dispatcher/plan/${fresh.day.date}`} replace /> : <BoardSkeleton />;
  }
  return <Board screen={screen} saver={saver} stale={query.isError} refreshing={query.isFetching} onRefresh={() => { void query.refetch(); }} />;
}

export function closingCountdown(cutoffAt: string, at: number | null) {
  if (at === null) return null;
  const minutes = Math.max(0, Math.ceil((Date.parse(cutoffAt) - at) / 60_000));
  return minutes === 0 ? 'Orders are closing' : `${Math.floor(minutes / 60)}h ${minutes % 60}m until orders close`;
}

function WaitingForOrders({ date, cutoffAt, generation }: { date: string; cutoffAt: string; generation: number }) {
  const { data: me } = useMe();
  const { depots } = useScope();
  const clock = useAppClock();
  const depot = depots[0] ?? null;
  const query = useQuery(ordersOptions(me, depot, { date, range: 'day' }));
  useFollowLookupMessages();
  useFollowGeneration(clock.state?.day ?? null, query.data?.demoDay ?? null);
  const fresh = currentRead(query.data, clock.state?.day ?? null);
  // A failed refresh or a read for a different day/depot/reset never stands in for current received demand.
  const read = !query.isError && fresh?.date === date && fresh.depot.id === depot && fresh.demoDay === generation ? fresh : undefined;
  const countdown = closingCountdown(cutoffAt, clock.at);
  return <div className="space-y-4 lg:pt-2.5">
    <h1 className="text-xl leading-6 font-bold">{planFor(date)}</h1>
    <Column className="max-w-3xl gap-5 p-5 sm:p-6">
      <div className="flex items-start gap-4"><img src={ICON.cutoff} alt="" className="size-12 shrink-0 object-contain" /><div>
        <h2 className="text-lg font-bold">Receiving orders for {shortDay(date)}</h2>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">Orders close at {clockTime(cutoffAt)}. Planning opens after closing.</p>
        <p className="mt-3 font-mono text-lg font-bold">{countdown ?? 'Waiting for the application clock'}</p>
      </div></div>
      {read?.summary ? <dl className="grid grid-cols-2 gap-3" aria-label="Received demand">
        <div className="rounded-[12px] border bg-muted/30 p-4"><dd className="font-mono text-2xl font-bold">{read.summary.orders}</dd><dt className="mt-1 text-sm text-muted-foreground">received orders</dt></div>
        <div className="rounded-[12px] border bg-muted/30 p-4"><dd className="font-mono text-2xl font-bold">{new Set(read.rows.map((row) => row.outlet.id)).size}</dd><dt className="mt-1 text-sm text-muted-foreground">shops with orders</dt></div>
      </dl> : query.isError ? <div role="alert"><p className="text-sm font-semibold">Could not load received demand.</p><p className="mt-1 text-xs text-muted-foreground">{reasonOf(query.error)}</p><Button variant="outline" className={plainButton('mt-3 h-10 px-4')} disabled={query.isFetching} onClick={() => { void query.refetch(); }}>Try again</Button></div>
        : <p role="status" className="text-sm text-muted-foreground">Loading current received demand…</p>}
      <Link to={`/dispatcher/orders?date=${date}&range=day`} className={plainButton('inline-flex h-11 items-center justify-center rounded-[10px] border px-5 text-sm font-semibold')}>View orders</Link>
    </Column>
  </div>;
}

// What the middle column shows besides the open trip: finding a slot for an order.
type Middle = { kind: 'trip' } | { kind: 'slot'; orderId: string };

function Board({ screen, saver, stale, refreshing, onRefresh }: { screen: BoardScreen; saver: Saver; stale: boolean; refreshing: boolean; onRefresh: () => void }) {
  const { board, draft } = screen;
  const { change: saveChange } = saver;
  const noted = useRef<{ counts: BoardCounts; problems: number } | null>(null);
  const [impact, setImpact] = useState<string | null>(null);
  const change: Saver['change'] = (plan, said) => {
    if (board.counts) noted.current = { counts: board.counts, problems: board.check?.problems.length ?? 0 };
    saveChange(plan, said);
  };
  useEffect(() => {
    if (!noted.current || !board.counts || screen.saving === 'saving' || screen.saving === 'retrying') return;
    setImpact(impactLine(noted.current.counts, board.counts, { before: noted.current.problems, after: board.check?.problems.length ?? 0 }));
    noted.current = null;
  }, [board.counts, board.check, board.plan.revision, screen.saving]);
  const date = board.day!.date;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [middle, setMiddle] = useState<Middle>({ kind: 'trip' });
  const [tab, setTab] = useState<Tab>(params.get('trip') ? 'planning' : 'unplanned');
  // The group a trip was started from, so "+ Add a stop" finds it before the trip has a stop.
  const [startedFrom, setStartedFrom] = useState<Record<TripKey, { brand: Brand; district: string }>>({});
  // The group "+ Add a stop" pointed at, outlined until the next one.
  const [outlined, setOutlined] = useState<string | null>(null);
  // An order dropped in the empty middle, for which the crew picker is open there (spec 026).
  const [dropped, setDropped] = useState<Pick | null>(null);

  const index = useMemo(() => indexOf(board), [board]);
  const places = useMemo(() => placesOf(draft), [draft]);
  const open = tripOf(draft, params.get('trip'));

  // Shows something in the middle column, which a phone then has on screen.
  const show = (next: Middle) => {
    setMiddle(next);
    setTab('planning');
  };

  const openTrip = (key: TripKey | null) => {
    setMiddle({ kind: 'trip' });
    setOutlined(null);
    setParams((now) => {
      const next = new URLSearchParams(now);
      if (key) next.set('trip', key);
      else next.delete('trip');
      return next;
    }, { replace: true });
    setTab(key ? 'planning' : 'unplanned');
  };

  // The trip's brand and district: its first stop's shop, or the group it was started from.
  const groupOfTrip = (key: TripKey) => {
    const trip = tripOf(draft, key);
    const shop = trip?.stops[0] ? index.shop(trip.stops[0].outletId) : null;
    return shop ? { brand: shop.brand, district: shop.district } : startedFrom[key] ?? null;
  };

  // A crew picked: the trip started on its truck, or moved there, with its driver, as one change with one Undo (spec 026,
  // rule 1). The trip opens.
  const chooseCrew = (pick: Pick, crew: CrewRef) => {
    setDropped(null);
    const made = crewChange(pick, draft, crew, index, open ? keyOf(open) : null);
    if (!made) return;
    change(made.plan, made.undo);
    const group = pick.kind === 'swap' ? startedFrom[pick.key] : pick.group;
    if (group) setStartedFrom({ ...startedFrom, [made.key]: group });
    openTrip(made.key);
  };

  // The history (spec 027): Undo and Redo, from the header, a green line or the keys. A step that changed which trip is
  // open opens on Undo what was open before it, and on Redo what was open after it (L-10, L-16); a trip the draft no
  // longer has is never left open.
  const follow = (which: 'undo' | 'redo', step: ReturnType<Saver['undo']>) => {
    const now = saver.snapshot();
    const next = now ? openAfter(which, step, now.draft, open ? keyOf(open) : null) : undefined;
    if (next !== undefined) openTrip(next);
  };
  const undo = () => follow('undo', saver.undo());
  const redo = () => follow('redo', saver.redo());

  // Start over empties the draft, so the open trip closes; Undo opens it again (L-16).
  const startOver = () => {
    const over = startOverChange(draft, open ? keyOf(open) : null);
    change(over.plan, over.said);
    if (open) openTrip(null);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const which = historyKey(pressOf(event));
      if (!which) return;
      event.preventDefault();
      if (which === 'undo') undo();
      else redo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // "+ Add a stop" points at the trip's brand and district in the list and outlines that group.
  const addStop = () => {
    const group = open ? groupOfTrip(keyOf(open)) : null;
    setTab('unplanned');
    if (!group) return;
    const key = groupKey(group.brand, group.district);
    setOutlined(key);
    // The list is drawn on a phone only once its tab is on, so the scroll waits for that drawing.
    window.requestAnimationFrame(() => document.getElementById(`group-${key}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };

  // A split order put back together (rule 8). Either part can ask; the server says when it cannot be.
  const join = async (order: BoardOrder) => {
    const original = order.splitFrom;
    if (original === null) return;
    const refused = await saver.act((day, ref) => joinOrder(day, { ...ref, orderId: original }), undefined, ENDS_HISTORY);
    if (refused) toast(refused, { id: 'plan-board' });
  };

  let inMiddle: ReactNode;
  if (middle.kind === 'slot') {
    inMiddle = (
      <FindSlot
        key={middle.orderId}
        screen={screen}
        index={index}
        orderId={middle.orderId}
        change={change}
        onPut={openTrip}
        onCrew={chooseCrew}
        onClose={() => setMiddle({ kind: 'trip' })}
      />
    );
  } else if (open) {
    const key = keyOf(open);
    inMiddle = (
      <TripPanel
        key={key}
        screen={screen}
        index={index}
        trip={open}
        group={groupOfTrip(key)}
        change={change}
        act={saver.act}
        onUndo={undo}
        onCrew={chooseCrew}
        onRemoved={() => openTrip(null)}
        onDone={() => openTrip(null)}
        impact={screen.saving === 'saving' || screen.saving === 'retrying' ? 'Checking this change…' : impact}
        onAddStop={addStop}
        onJoin={(order) => { void join(order); }}
      />
    );
  } else {
    inMiddle = (
      <BuildPanel
        screen={screen}
        act={saver.act}
        onBuilding={() => setTab('planning')}
        index={index}
        dropped={dropped}
        onCrew={chooseCrew}
        onDropClose={() => setDropped(null)}
      />
    );
  }

  // The column being worked in, which a desktop's tabs mark. On a phone the tabs choose the column shown.
  const working: Tab = open ? 'planning' : 'unplanned';

  return (
    <div className="flex flex-col lg:-mt-2.5 lg:-mb-2 lg:h-[calc(100dvh-91px)]">
      <BoardHeader
        screen={screen}
        tab={tab}
        working={working}
        onTab={setTab}
        openCount={open ? 1 : 0}
        unplannedCount={activeOrders(board.orders).filter((order) => !places.has(order.id)).length}
        doneCount={draft.trips.length - (open ? 1 : 0)}
        change={change}
        retry={saver.retry}
        onViewPlan={() => navigate(`/dispatcher/plan/${date}`)}
        stale={stale}
        onRefresh={onRefresh}
        onUndo={undo}
        onRedo={redo}
        onStartOver={startOver}
        refreshing={refreshing}
      />
      <ScenarioPanel screen={screen} stale={stale} refreshing={refreshing} />
      <PlanDnd screen={screen} index={index} change={change} undo={undo} onStartTrip={setDropped}>
      <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-3.5 lg:grid-cols-[300px_minmax(0,1fr)_270px] xl:grid-cols-[360px_minmax(0,1fr)_330px]">
        <div className={cn('min-h-0 flex-col gap-4', tab === 'unplanned' ? 'flex' : 'hidden lg:flex')}>
          <OrderLists
            screen={screen}
            index={index}
            places={places}
            open={open}
            outlined={outlined}
            change={change}
            act={saver.act}
            onCrew={chooseCrew}
            onFindSlot={(orderId) => show({ kind: 'slot', orderId })}
            onJoin={(order) => { void join(order); }}
          />
        </div>
        <Column aria-label="Planning" className={cn('min-h-[420px] overflow-x-hidden overflow-y-auto lg:min-h-0', tab === 'planning' ? 'flex' : 'hidden lg:flex')}>{inMiddle}</Column>
        <Column aria-label="Planned trips" className={cn('overflow-x-hidden overflow-y-auto', tab === 'done' ? 'flex' : 'hidden lg:flex')}>
          <DoneList screen={screen} index={index} openKey={open ? keyOf(open) : null} onOpen={openTrip} />
        </Column>
      </div>
      {open && tab === 'unplanned' && (
        <div className="sticky bottom-0 z-20 flex items-center gap-3 border-t bg-card px-3 py-2 lg:hidden">
          <p className="min-w-0 flex-1 text-sm font-semibold">{index.crew(open)}{(() => {
            const load = index.trip(open.vehicleId, open.tripNo)?.load;
            const cap = index.vehicle(open.vehicleId)?.weightCapKg;
            return load && cap ? ` · ${(Math.round((cap - load.kg) / 100) / 10).toFixed(1)} t free` : '';
          })()}</p>
          <button type="button" className="h-11 shrink-0 rounded-md bg-foreground px-3 text-sm font-semibold text-background" onClick={() => setTab('planning')}>Back to trip</button>
        </div>
      )}
      </PlanDnd>
    </div>
  );
}

// A board with nothing to plan: its orders are still open, or no operating day is left.
function Message({ title, icon, line }: { title: string; icon: string; line: string }) {
  return (
    <div className="space-y-4 lg:pt-2.5">
      <h1 className="text-xl leading-6 font-bold">{title}</h1>
      <Column className="max-w-xl flex-row items-center gap-3 p-4">
        <img src={icon} alt="" className="size-10 shrink-0 object-contain" />
        <p className="text-sm">{line}</p>
      </Column>
    </div>
  );
}

// The board could not be read the first time.
function CannotLoad({ error, busy, onRetry }: { error: unknown; busy: boolean; onRetry: () => void }) {
  return (
    <div className="space-y-4 lg:pt-2.5">
      <h1 className="text-xl leading-6 font-bold">Plan board</h1>
      <Column role="alert" className="max-w-md p-4">
        <h2 className="font-sans text-[15px] leading-[18px] font-semibold">Could not load the plan board</h2>
        <p className="mt-1.5 text-xs leading-[15px] text-muted-foreground">{reasonOf(error)}</p>
        <Button variant="outline" className={plainButton('mt-3 h-11 w-full text-sm')} disabled={busy} onClick={onRetry}>{busy ? 'Trying…' : 'Try again'}</Button>
      </Column>
    </div>
  );
}

// The first load, in the style guide's grey blocks: the header, and the three columns in their places.
function BoardSkeleton() {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => (
    <div key={i} className="flex items-center gap-3 py-2.5">
      <Skeleton className="size-5 rounded-full" />
      <Skeleton className="h-3 w-40" />
      <Skeleton soft className="ml-auto h-3 w-16" />
    </div>
  ));
  return (
    <div role="status" aria-label="Loading the plan board" className="flex flex-col lg:-mt-2.5 lg:-mb-2 lg:h-[calc(100dvh-91px)]">
      <div className="flex flex-wrap items-center gap-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton soft className="h-[26px] w-64 rounded-full" />
        <Skeleton className="h-3.5 w-80" />
      </div>
      <div className="mt-3 flex justify-end gap-2.5"><Skeleton soft className="h-8 w-40 rounded-[10px]" /><Skeleton soft className="h-8 w-28 rounded-[10px]" /></div>
      <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-3.5 lg:grid-cols-[300px_minmax(0,1fr)_270px] xl:grid-cols-[360px_minmax(0,1fr)_330px]">
        <Column className="p-3.5"><div className="flex items-center gap-2.5 pb-2"><Skeleton className="size-6" /><Skeleton className="h-4 w-44" /></div>{rows(6)}</Column>
        <Column className="hidden p-3.5 lg:flex"><div className="flex items-center gap-2.5 pb-2"><Skeleton className="size-7" /><Skeleton className="h-4 w-56" /></div>{rows(5)}</Column>
        <Column className="hidden p-3.5 lg:flex"><div className="flex items-center gap-2.5 pb-2"><Skeleton className="size-6" /><Skeleton className="h-4 w-32" /></div>{rows(3)}</Column>
      </div>
    </div>
  );
}
