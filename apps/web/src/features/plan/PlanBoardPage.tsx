import { useMemo, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { BoardOrder, Brand } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PickDepot } from '@/features/dispatcher/parts/PickDepot';
import { useScope } from '@/features/dispatcher/scope';
import { reasonOf } from '@/features/store/words';
import { cn } from '@/lib/utils';
import { joinOrder, useBoard, useBoardScreen, useOrdersFollow, type BoardScreen, type Saver } from './board';
import { keyOf, placesOf, startTrip, swapTruck, tripOf, type TripKey } from './draft';
import { BoardHeader, type Tab } from './parts/BoardHeader';
import { BuildPanel } from './parts/BuildPanel';
import { DoneList } from './parts/DoneList';
import { startUndo } from './parts/drops';
import { FindSlot } from './parts/FindSlot';
import { ICON } from './parts/icons';
import { groupKey, indexOf } from './parts/lookup';
import { OrderLists } from './parts/OrderLists';
import { PickTruck, type Pick } from './parts/PickTruck';
import { PlanDnd } from './parts/PlanDnd';
import { TripPanel } from './parts/TripPanel';
import { TruckList } from './parts/TruckList';
import { plainButton } from './parts/look';
import { Column } from './parts/ui';
import { clockTime, planFor, shortDay } from './words';

// The plan board (spec 010, Dispatcher · Edit plan and its states). The dispatcher builds the board's day by
// hand: trips from the orders and trucks on the left, the open trip in the middle, the other trips on the right.
// With no trip open, the middle builds the suggested plan instead (spec 014). Every number on it comes from the
// board the API sent. On both depots together a plan belongs to one depot (spec 021, D-96): the page reads no board and
// asks which depot to plan.
export function PlanBoardPage() {
  return useScope().both ? <PickDepot title="Plan board" /> : <OneDepotBoard />;
}

function OneDepotBoard() {
  const query = useBoard();
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
    return <Message title={planFor(board.day.date)} icon={ICON.cutoff} line={`Orders for ${shortDay(board.day.date)} close at ${clockTime(board.day.cutoffAt)}. The board opens then.`} />;
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

// What the middle column shows besides the open trip: picking a truck, or finding a slot for an order.
type Middle = { kind: 'trip' } | { kind: 'pick'; pick: Pick } | { kind: 'slot'; orderId: string };

function Board({ screen, saver, stale, refreshing, onRefresh }: { screen: BoardScreen; saver: Saver; stale: boolean; refreshing: boolean; onRefresh: () => void }) {
  const { board, draft } = screen;
  const { change } = saver;
  const date = board.day!.date;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [middle, setMiddle] = useState<Middle>({ kind: 'trip' });
  const [tab, setTab] = useState<Tab>(params.get('trip') ? 'planning' : 'unplanned');
  // The group a trip was started from, so "+ Add a stop" finds it before the trip has a stop.
  const [startedFrom, setStartedFrom] = useState<Record<TripKey, { brand: Brand; district: string }>>({});
  // The group "+ Add a stop" pointed at, outlined until the next one.
  const [outlined, setOutlined] = useState<string | null>(null);

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

  const chooseTruck = (pick: Pick, vehicleId: string) => {
    if (pick.kind === 'swap') {
      const moved = swapTruck(draft, pick.key, { vehicleId, driverId: null });
      if (!moved) return;
      change(moved.plan);
      const group = startedFrom[pick.key];
      if (group) setStartedFrom({ ...startedFrom, [moved.key]: group });
      openTrip(moved.key);
      return;
    }
    const started = startTrip(draft, { vehicleId, driverId: null }, pick.startWith);
    if (!started) return;
    change(started.plan, startUndo(pick, draft, started));
    const group = pick.group;
    if (group) setStartedFrom({ ...startedFrom, [started.key]: group });
    openTrip(started.key);
  };

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
    const refused = await saver.act((day, ref) => joinOrder(day, { ...ref, orderId: original }));
    if (refused) toast(refused, { id: 'plan-board' });
  };

  let inMiddle: ReactNode;
  if (middle.kind === 'pick') {
    inMiddle = <PickTruck board={board} draft={draft} index={index} pick={middle.pick} onChoose={(vehicleId) => chooseTruck(middle.pick, vehicleId)} onClose={() => setMiddle({ kind: 'trip' })} />;
  } else if (middle.kind === 'slot') {
    inMiddle = (
      <FindSlot
        key={middle.orderId}
        screen={screen}
        index={index}
        orderId={middle.orderId}
        change={change}
        onPut={openTrip}
        onStartTrip={(pick) => show({ kind: 'pick', pick })}
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
        onSwap={() => show({ kind: 'pick', pick: { kind: 'swap', key } })}
        onRemoved={() => openTrip(null)}
        onDone={() => openTrip(null)}
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
        unplannedCount={board.orders.filter((order) => !places.has(order.id)).length}
        doneCount={draft.trips.length - (open ? 1 : 0)}
        change={change}
        retry={saver.retry}
        onViewPlan={() => navigate(`/dispatcher/plan/${date}`)}
        stale={stale}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />
      <PlanDnd screen={screen} change={change} onStartTrip={(pick) => show({ kind: 'pick', pick })}>
      <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-3.5 lg:grid-cols-[300px_minmax(0,1fr)_270px] xl:grid-cols-[360px_minmax(0,1fr)_330px]">
        <div className={cn('min-h-0 flex-col gap-4', tab === 'unplanned' ? 'flex' : 'hidden lg:flex')}>
          <OrderLists
            screen={screen}
            index={index}
            places={places}
            open={open}
            outlined={outlined}
            change={change}
            onStartTrip={(group, orders) => { show({ kind: 'pick', pick: { kind: 'start', group, orders, startWith: [] } }); setOutlined(groupKey(group.brand, group.district)); }}
            onFindSlot={(orderId) => show({ kind: 'slot', orderId })}
            onJoin={(order) => { void join(order); }}
          />
          <TruckList board={board} draft={draft} />
        </div>
        <Column aria-label="Planning" className={cn('min-h-[420px] overflow-x-hidden overflow-y-auto lg:min-h-0', tab === 'planning' ? 'flex' : 'hidden lg:flex')}>{inMiddle}</Column>
        <Column aria-label="Done" className={cn('overflow-x-hidden overflow-y-auto', tab === 'done' ? 'flex' : 'hidden lg:flex')}>
          <DoneList screen={screen} index={index} openKey={open ? keyOf(open) : null} onOpen={openTrip} />
        </Column>
      </div>
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
