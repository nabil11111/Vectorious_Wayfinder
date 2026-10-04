import { Fragment, useState, type ReactNode } from 'react';
import type { BoardOrder, BoardShop, Brand, DraftDeferral, DraftPlan, DraftTrip } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { BoardScreen, Undo } from '../board';
import { addOrders, defer, keyOf, undefer, type CrewRef, type Place } from '../draft';
import { carriedLine, countOf, decisionTitle, deferGroup, deferredTimes, orderAmount, ordersAmount, partLine, placeOf, reasonWords, shopLine, TO_DECIDE, whole } from '../words';
import chilledIcon from '@/assets/icons/icon-chilled.png';
import { CrewMenu } from './CrewMenu';
import type { Pick } from './crews';
import { demandLine } from './demand';
import { PlanChoice } from './PlanChoice';
import { DeferForm } from './DeferForm';
import { movable, useLanding } from './dragging';
import { fitsRoute } from './drops';
import type { Dragged } from './drops';
import { BRAND_ICON, ICON } from './icons';
import { decisionShop, decisionTruck, groupKey, listed, ordersLine, type BoardIndex } from './lookup';
import { inkButton, plainButton } from './look';
import { DragRow } from './PlanDnd';
import { Column, ColumnHead, MenuItem, MenuPopup, MenuRoot, MenuTrigger, Pills, Tag } from './ui';
import { Why } from './Why';
import { activeOrders, shopSummaries, summaryLine } from './shop-summary';

const BRANDS: Brand[] = ['Fresh', 'Style', 'Tech'];

// A chosen filter is ink with white words. The others stay white with black words.
const filterChip = (on: boolean) => cn(
  'inline-flex h-9 items-center rounded-[10px] border px-3 text-xs font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
  on ? 'border-transparent bg-secondary text-secondary-foreground' : 'border-border bg-card text-foreground hover:bg-muted',
);

interface ShopOrders { shop: BoardShop; orders: BoardOrder[] }
interface Group { key: string; brand: Brand; district: string; shops: ShopOrders[]; count: number }
const emptyTrip = (group: Group): Pick => ({ kind: 'start', group: { brand: group.brand, district: group.district }, orders: [], startWith: [] });

// The unplanned orders by brand and district, most orders first, each group's shops in id order.
function groupsOf(orders: BoardOrder[], index: BoardIndex): Group[] {
  const groups = new Map<string, Group>();
  for (const order of orders) {
    const shop = index.shop(order.outletId);
    if (!shop) continue;
    const key = groupKey(shop.brand, shop.district);
    const group = groups.get(key) ?? { key, brand: shop.brand, district: shop.district, shops: [], count: 0 };
    const row = group.shops.find((s) => s.shop.id === shop.id);
    if (row) row.orders.push(order);
    else group.shops.push({ shop, orders: [order] });
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, shops: [...group.shops].sort((a, b) => a.shop.id.localeCompare(b.shop.id)) }))
    .sort((a, b) => b.count - a.count || BRANDS.indexOf(a.brand) - BRANDS.indexOf(b.brand) || a.district.localeCompare(b.district));
}

// Oldest wanted first, then by shop, chilled before dry.
const TEMP_RANK = { chilled: 0, dry: 1 } as const;
const byWanted = (a: BoardOrder, b: BoardOrder) =>
  a.deliveryDate.localeCompare(b.deliveryDate) || a.outletId.localeCompare(b.outletId) || TEMP_RANK[a.temp] - TEMP_RANK[b.temp] || a.id.localeCompare(b.id);

// What an inline defer form is for: one order, a shop row's orders or a whole group.
interface DeferTarget { key: string; orders: BoardOrder[]; code?: DraftDeferral['code']; reason?: string }

// One order dragged from its row: named by its shop, in its shop's group (spec 023).
function orderDragged(order: BoardOrder, index: BoardIndex): Dragged | null {
  const shop = index.shop(order.outletId);
  return shop ? { kind: 'orders', orders: [order], group: { brand: shop.brand, district: shop.district }, label: shop.name, detail: orderAmount(shop.brand, order) } : null;
}

// The left column's upper card (Edit plan): the day's unplanned orders by brand and district, or as one list,
// with the carried-over ones first and the deferred ones last, each deferred one with the planner's "why?". An order,
// a shop's orders or a whole group can be dragged onto a trip, and a stop dropped here comes off its trip (spec 023).
export function OrderLists({ screen, index, places, open, route = null, outlined, change, act, onCrew, onFindSlot, onJoin }: {
  screen: BoardScreen;
  index: BoardIndex;
  places: Map<string, Place>;
  open: DraftTrip | null;
  // The open trip's brand and district. Orders outside it are shown grey, and cannot be added to this trip.
  route?: { brand: Brand; district: string } | null;
  outlined: string | null;
  change: (next: DraftPlan, said: Undo) => void;
  act?: Parameters<typeof PlanChoice>[0]['act'];
  onCrew: (pick: Pick, crew: CrewRef) => void;
  onFindSlot: (orderId: string) => void;
  onJoin: (order: BoardOrder) => void;
}) {
  const { board, draft } = screen;
  const canMove = movable(screen);
  const savedView = readView(board.day?.date);
  const [view, setView] = useState<'groups' | 'list'>(savedView?.view ?? 'groups');
  const [query, setQuery] = useState(savedView?.query ?? '');
  const [need, setNeed] = useState<'all' | 'chilled' | 'van' | 'carried'>(savedView?.need ?? 'all');
  const [sort, setSort] = useState<'count' | 'window'>(savedView?.sort ?? 'count');
  const [planning, setPlanning] = useState<Group | null>(null);
  const [deferring, setDeferring] = useState<DeferTarget | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const summaries = shopSummaries(board.orders, draft);
  const summary = (order: BoardOrder) => summaryLine(summaries.get(order.outletId)!);
  const waiting = activeOrders(board.orders).filter((order) => !places.has(order.id));
  const needle = query.trim().toLowerCase();
  const unplanned = waiting.filter((order) => {
    const shop = index.shop(order.outletId);
    if (needle && !`${shop?.name ?? ''} ${order.lines.map((line) => line.name).join(' ')}`.toLowerCase().includes(needle)) return false;
    if (need === 'chilled' && !order.load.needsReefer) return false;
    if (need === 'van' && shop?.parking !== 'van_only') return false;
    if (need === 'carried' && !order.carriedOver) return false;
    return true;
  });
  const carried = unplanned.filter((order) => order.carriedOver).sort(byWanted);
  // While a trip is open, only its district fits, and only its brand unless Mix brands is on.
  // A dry truck cannot take a chilled order, including one deferred earlier for lack of a fridge.
  const onThisRoute = (shop: { brand: Brand; district: string } | null) => !open || !route || (shop !== null && fitsRoute(route, draft.mixBrands, shop));
  const truck = open ? index.vehicle(open.vehicleId) : null;
  const canCarry = (order: BoardOrder) => !order.load.needsReefer || !truck || truck.temp === 'reefer';
  const fitsOrder = (order: BoardOrder) => onThisRoute(index.shop(order.outletId)) && canCarry(order);
  const groups = groupsOf(unplanned.filter((order) => !order.carriedOver), index)
    .sort((a, b) => sort === 'window'
      ? Math.min(...a.shops.map((row) => row.shop.windowClose)) - Math.min(...b.shops.map((row) => row.shop.windowClose)) || b.count - a.count
      : b.count - a.count)
    .sort((a, b) => Number(onThisRoute(b)) - Number(onThisRoute(a)));
  const deferred = draft.deferrals.flatMap((deferral) => {
    const order = index.order(deferral.orderId);
    return order ? [{ deferral, order }] : [];
  });

  const add = open ? (orders: BoardOrder[]) => {
    const kept = orders.filter(fitsOrder);
    if (kept.length === 0) return;
    change(addOrders(draft, keyOf(open), kept), { line: `${ordersLine(index, kept.map((o) => o.id))} added to ${index.called(open)}`, tripKey: keyOf(open) });
  } : null;
  const doDefer = (deferrals: DraftDeferral[]) => {
    if (!canMove) return;
    change(defer(draft, deferrals), { line: `${ordersLine(index, deferrals.map((d) => d.orderId))} deferred`, tripKey: null });
    setDeferring(null);
  };
  const form = (key: string) => deferring?.key === key && (
    <DeferForm
      orders={deferring.orders}
      index={index}
      code={deferring.code}
      reason={deferring.reason}
      disabled={!canMove}
      onDefer={doDefer}
      onCancel={() => setDeferring(null)}
    />
  );
  const deferOrders = (key: string, orders: BoardOrder[]) => {
    const last = orders.length === 1 ? orders[0]!.lastDeferral : null;
    setDeferring({ key, orders, code: last?.code, reason: last?.reason });
  };
  const { setNodeRef: landingRef, look: landingLook } = useLanding('unplanned', { kind: 'unplanned' }, 'Unplanned orders');
  // An order's row, with its grip when it can be dragged.
  const draggable = (order: BoardOrder, row: ReactNode) => {
    const dragged = orderDragged(order, index);
    return dragged ? <DragRow id={`orders:order:${order.id}`} dragged={dragged} movable={canMove && fitsOrder(order)}>{row}</DragRow> : row;
  };

  return (
    <>
    <Column ref={landingRef} aria-label="Unplanned orders" className={cn('min-h-[360px] flex-1 lg:min-h-0', landingLook)}>
      <ColumnHead icon={ICON.unplanned} title={`Unplanned orders · ${whole(unplanned.length)}`} className="pt-3.5 pr-3 pb-2.5 pl-5">
        <Pills tight label="Show the orders" value={view} onChange={setView} options={[{ value: 'groups', label: 'brand · district' }, { value: 'list', label: 'list' }]} />
      </ColumnHead>
      <div className="space-y-2 pr-3.5 pb-2 pl-5">
        <label className="block text-sm font-semibold">
          Search shops or orders
          <input value={query} onChange={(event) => { setQuery(event.target.value); remember(board.day?.date, { view, query: event.target.value, need, sort }); }} className="mt-1 h-11 w-full rounded-[10px] border bg-card px-3 text-sm font-normal" />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {([['all', 'All'], ['chilled', 'Chilled'], ['van', 'Van only'], ['carried', 'Waiting from earlier days']] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={need === value} className={filterChip(need === value)} onClick={() => { setNeed(value); remember(board.day?.date, { view, query, need: value, sort }); }}>{label}</button>
          ))}
          <button type="button" aria-pressed={sort === 'window'} className={filterChip(sort === 'window')} onClick={() => { const next = sort === 'window' ? 'count' : 'window'; setSort(next); remember(board.day?.date, { view, query, need, sort: next }); }}>Earliest window first</button>
          {(query || need !== 'all' || sort !== 'count') && <button type="button" className="h-9 px-2 text-xs font-semibold underline" onClick={() => { setQuery(''); setNeed('all'); setSort('count'); remember(board.day?.date, { view, query: '', need: 'all', sort: 'count' }); }}>Clear filters</button>}
        </div>
        <p className="text-xs text-muted-foreground">{whole(unplanned.length)} of {whole(waiting.length)} waiting</p>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto py-1 pr-3.5 pb-3.5 pl-5">
        {waiting.length === 0 && <p className="pt-1 text-xs text-muted-foreground">Every order is on a trip or deferred.</p>}
        {waiting.length > 0 && unplanned.length === 0 && <p className="pt-1 text-xs text-muted-foreground">Nothing matches these filters.</p>}

        {view === 'groups' ? (
          <>
            {carried.length > 0 && (
              <section aria-label="Carried over" className="mb-2 rounded-[10px] border-[1.5px] border-warn px-3.5 pt-2.5 pb-1">
                <h3 className="text-xs leading-[15px] font-semibold text-warn-ink">Carried over · {whole(carried.length)}</h3>
                {carried.map((order) => (
                  <Fragment key={order.id}>
                    <div className={cn(!fitsOrder(order) && 'opacity-40')}>
                    {draggable(order, (
                      <OrderRow
                        order={order}
                        title={titleOf(order, index)}
                        line={carriedLine(order)}
                        summary={summary(order)}
                        disabled={!canMove}
                        add={fitsOrder(order) ? add : null}
                        onDefer={() => deferOrders(order.id, [order])}
                        onJoin={onJoin}
                        extra={<Button variant="outline" className={plainButton('h-[22px] px-2.5 text-[11px]')} onClick={() => onFindSlot(order.id)}>Find a slot</Button>}
                      />
                    ))}
                    </div>
                    {form(order.id)}
                  </Fragment>
                ))}
              </section>
            )}
            {groups.map((group) => {
              const all = expanded.has(group.key);
              const shops = all ? group.shops : group.shops.slice(0, 3);
              const hidden = group.shops.slice(shops.length).reduce((n, row) => n + row.orders.length, 0);
              const fits = onThisRoute(group);
              const groupCarry = group.shops.every((row) => row.orders.every(canCarry));
              return (
                <section
                  key={group.key}
                  id={`group-${group.key}`}
                  aria-label={`${group.brand} · ${group.district}`}
                  className={cn('scroll-mt-2 rounded-[10px] border-[1.5px] border-l-4 px-2 pt-2.5 pb-1', !fits && 'opacity-40', outlined === group.key ? 'border-foreground' : 'border-transparent', group.brand === 'Fresh' ? 'border-l-fresh bg-fresh' : group.brand === 'Style' ? 'border-l-style bg-style' : 'border-l-tech bg-tech')}
                >
                  <DragRow
                    id={`orders:group:${group.key}`}
                    movable={canMove && fits && groupCarry}
                    dragged={{ kind: 'orders', orders: group.shops.flatMap((row) => row.orders), group: { brand: group.brand, district: group.district }, label: `${group.brand} · ${group.district}`, detail: countOf(group.count, 'order') }}
                  >
                    <div className="flex flex-wrap items-center gap-2 pl-1">
                      <img src={BRAND_ICON[group.brand]} alt="" className="size-[22px] shrink-0 object-contain" />
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm leading-5 font-semibold">{group.brand} · {group.district}</h3>
                        <p className="text-xs leading-4 text-muted-foreground">{demandLine(group.shops.flatMap((row) => row.orders), (id) => index.shop(id))}</p>
                      </div>
                      <div className="flex w-full flex-wrap justify-end gap-2">
                      <Button variant="outline" disabled={!canMove} className={plainButton('h-9 px-3 text-xs')} onClick={() => deferOrders(group.key, group.shops.flatMap((row) => row.orders))}>{deferGroup(group.count)}</Button>
                      <Button className={inkButton('h-9 px-3 text-xs')} disabled={!canMove || !act} onClick={() => setPlanning(group)}>Plan these orders</Button>
                      <CrewMenu
                        screen={screen}
                        index={index}
                        pick={emptyTrip(group)}
                        title={`Create an empty trip · ${group.brand} · ${group.district}. No orders will be added.`}
                        trigger="Create empty trip"
                        triggerClassName={plainButton('h-9 px-3 text-xs')}
                        onPick={(crew) => onCrew(emptyTrip(group), crew)}
                      />
                      </div>
                    </div>
                  </DragRow>
                  {form(group.key)}
                  <ul className="mt-1.5">
                    {shops.map(({ shop, orders }) => {
                      const rowFits = fits && orders.some(canCarry);
                      return (
                      <li key={shop.id} className={cn('border-t py-2 pl-1', !rowFits && 'opacity-40')}>
                        <DragRow
                          id={`orders:shop:${group.key}:${shop.id}`}
                          movable={canMove && rowFits && orders.every(canCarry)}
                          dragged={{ kind: 'orders', orders, group: { brand: group.brand, district: group.district }, label: shop.name, detail: ordersAmount(shop.brand, orders) }}
                        >
                          <Row
                            title={`${placeOf(shop)} · ${ordersAmount(shop.brand, orders)}`}
                            line={[shopLine(shop), ...orders.filter((o) => o.splitFrom !== null).map(partLine)].join(' · ')}
                            below={<ShopSummary line={summary(orders[0]!)} />}
                            actions={(
                              <>
                                {rowFits && add && <Button variant="outline" className={plainButton('h-[26px] px-3 text-[11px]')} onClick={() => add(orders)}>Add</Button>}
                                <Button variant="outline" disabled={!canMove} className={plainButton('h-[26px] px-3 text-[11px]')} onClick={() => deferOrders(`${group.key}:${shop.id}`, orders)}>Defer</Button>
                                <RowMenu label={shop.name} items={[
                                  ...orders.filter((o) => o.splitFrom !== null).map((o) => ({ label: `Join ${orderAmount(shop.brand, o)} back`, onClick: () => onJoin(o) })),
                                ]} />
                              </>
                            )}
                          />
                        </DragRow>
                        {form(`${group.key}:${shop.id}`)}
                      </li>
                      );
                    })}
                  </ul>
                  {hidden > 0 && (
                    <button type="button" className="mb-1.5 pl-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setExpanded(new Set([...expanded, group.key]))}>
                      {countOf(hidden, 'more order')}
                    </button>
                  )}
                </section>
              );
            })}
          </>
        ) : (
          <ul>
            {[...unplanned].sort(byWanted).map((order) => {
              const fits = fitsOrder(order);
              return (
              <li key={order.id} className={cn('border-t first:border-t-0', !fits && 'opacity-40')}>
                {draggable(order, (
                  <OrderRow
                    order={order}
                    title={titleOf(order, index)}
                    line={order.carriedOver ? carriedLine(order) : lineOf(order, index)}
                    summary={summary(order)}
                    disabled={!canMove}
                    add={fits ? add : null}
                    onDefer={() => deferOrders(order.id, [order])}
                    onJoin={onJoin}
                    extra={<Button variant="outline" className={plainButton('h-9 px-2.5 text-xs')} onClick={() => onFindSlot(order.id)}>Find a slot</Button>}
                  />
                ))}
                {form(order.id)}
              </li>
              );
            })}
          </ul>
        )}

        {deferred.length > 0 && (
          <section aria-label="Deferred" className="mt-3">
            <h3 className="px-1 text-xs leading-[15px] font-semibold text-muted-foreground">Deferred · {whole(deferred.length)}</h3>
            <ul className="mt-1">
              {deferred.map(({ deferral, order }) => {
                const title = titleOf(order, index);
                // The planner's reason and its decisions about the order (spec 014): "to decide" while one is open.
                const choice = index.choice(order.id);
                const decisions = index.decisions(order.id).filter(listed);
                return (
                  <li key={order.id} className="border-t px-1 py-2">
                    <Row
                      title={title}
                      line={reasonWords(deferral.reason)}
                      below={<><ShopSummary line={summary(order)} />{(choice || decisions.length > 0) && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {decisions.some((decision) => decision.open) && <Tag tone="warn">{TO_DECIDE}</Tag>}
                          {choice && (
                            <Why
                              align="start"
                              title={title}
                              reasons={[{ key: order.id, reason: choice.reason }]}
                              decisions={decisions.map((decision) => ({ key: decision.key, title: decisionTitle(decision, decisionShop(index, decision), decisionTruck(index, draft, decision)), acceptedAt: decision.acceptedAt }))}
                            />
                          )}
                        </div>
                      )}</>}
                      actions={(
                        <>
                          <button type="button" className="text-[11px] font-semibold underline underline-offset-2" onClick={() => change(undefer(draft, order.id), { line: `${ordersLine(index, [order.id])} back in Unplanned`, tripKey: null })}>Undo</button>
                          <Button variant="outline" disabled={!canMove} className={plainButton('h-[26px] px-3 text-[11px]')} onClick={() => setDeferring({ key: `deferred:${order.id}`, orders: [order], code: deferral.code, reason: deferral.reason })}>Edit reason</Button>
                          {order.splitFrom !== null && <RowMenu label={title} items={[{ label: 'Join back', onClick: () => onJoin(order) }]} />}
                        </>
                      )}
                    />
                    {form(`deferred:${order.id}`)}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </Column>
    {planning && act && (
      <PlanChoice
        screen={screen}
        index={index}
        orders={planning.shops.flatMap((row) => row.orders)}
        title={`Plan ${planning.brand} · ${planning.district}`}
        act={act}
        onCrew={(pick, crew) => {
          setPlanning(null);
          if (pick.kind === 'start') onCrew({ ...pick, group: { brand: planning.brand, district: planning.district } }, crew);
        }}
        onClose={() => setPlanning(null)}
      />
    )}
    </>
  );
}

// "Fresh Matara · 39 cartons chilled"
const titleOf = (order: BoardOrder, index: BoardIndex) => {
  const shop = index.shop(order.outletId);
  return shop ? `${shop.name} · ${orderAmount(shop.brand, order)}` : orderAmount('Fresh', order);
};

// Under an order in the list: its shop's window and entrance, and what it is part of.
const lineOf = (order: BoardOrder, index: BoardIndex) => {
  const shop = index.shop(order.outletId);
  return [shop && shopLine(shop), order.splitFrom !== null && partLine(order)].filter(Boolean).join(' · ');
};

// One order on a row of its own, a carried-over one or one in the list: two lines, with how often it was deferred
// on the right of the first and what can be done on the right of the second.
function OrderRow({ order, title, line, summary, disabled, add, onDefer, onJoin, extra }: {
  order: BoardOrder; title: string; line: string; add: ((orders: BoardOrder[]) => void) | null;
  summary: string; disabled: boolean;
  onDefer: () => void; onJoin: (order: BoardOrder) => void; extra?: ReactNode;
}) {
  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2">
        <p title={title} className="min-w-0 flex-1 truncate text-xs leading-[15px] font-semibold">{title}</p>
        {order.timesDeferred > 0 && <Tag tone={order.timesDeferred >= 2 ? 'bad' : 'warn'} className="px-2.5 text-[10px] leading-[13px]">{deferredTimes(order)}</Tag>}
      </div>
      <p className="mt-1 text-xs leading-4 text-muted-foreground">{line}</p>
      <OrderMarks order={order} />
      <ShopSummary line={summary} />
      <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5">
        {extra}
        {add && <Button variant="outline" className={plainButton('h-9 px-2.5 text-xs')} onClick={() => add([order])}>Add to this trip</Button>}
        <Button variant="outline" disabled={disabled} className={plainButton('h-[26px] px-3 text-[11px]')} onClick={onDefer}>Defer</Button>
        <RowMenu label={title} items={[
          ...(order.splitFrom !== null ? [{ label: 'Join back', onClick: () => onJoin(order) }] : []),
        ]} />
      </div>
    </div>
  );
}

// A row's two lines and what goes under them, with a chip and actions on the right.
function Row({ title, line, chip, below, actions }: { title: string; line: string; chip?: ReactNode; below?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <div className="min-w-0 flex-1 basis-40">
        <p className="text-xs leading-[15px] font-semibold">{title}</p>
        {line && <p className="mt-1 text-[11px] leading-[14px] text-muted-foreground">{line}</p>}
        {below}
      </div>
      {chip}
      {actions && <div className="ml-auto flex flex-wrap items-center gap-1">{actions}</div>}
    </div>
  );
}

interface SavedView { view: 'groups' | 'list'; query: string; need: 'all' | 'chilled' | 'van' | 'carried'; sort: 'count' | 'window' }

function readView(date: string | undefined): SavedView | null {
  if (!date || typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(`wf-plan-filters:${date}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SavedView>;
    if (typeof parsed.query !== 'string') return null;
    return {
      view: parsed.view === 'list' ? 'list' : 'groups',
      query: parsed.query,
      need: parsed.need === 'chilled' || parsed.need === 'van' || parsed.need === 'carried' ? parsed.need : 'all',
      sort: parsed.sort === 'window' ? 'window' : 'count',
    };
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function remember(date: string | undefined, view: SavedView) {
  if (date && typeof sessionStorage !== 'undefined') sessionStorage.setItem(`wf-plan-filters:${date}`, JSON.stringify(view));
}

function OrderMarks({ order }: { order: BoardOrder }) {
  if (!order.load.needsReefer && !order.carriedOver) return null;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
      {order.load.needsReefer && <span className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 font-semibold"><img src={chilledIcon} alt="" className="size-4" />Chilled</span>}
      {order.carriedOver && <span className="rounded-full bg-warn-tint px-2 py-0.5 font-semibold text-warn-ink">Waiting from an earlier day</span>}
    </p>
  );
}

function ShopSummary({ line }: { line: string }) {
  return <p className="mt-1.5 text-[11px] leading-4 font-medium text-foreground">{line}</p>;
}

// "⋮": what else can be done with a row.
export function RowMenu({ label, items }: { label: string; items: { label: string; onClick: () => void; disabled?: boolean }[] }) {
  if (items.length === 0) return null;
  return (
    <MenuRoot>
      <MenuTrigger aria-label={`More for ${label}`} className="flex h-[22px] w-5 shrink-0 items-center justify-center rounded-md text-sm font-bold text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted">⋮</MenuTrigger>
      <MenuPopup>
        {items.map((item) => <MenuItem key={item.label} disabled={item.disabled} onClick={item.onClick}>{item.label}</MenuItem>)}
      </MenuPopup>
    </MenuRoot>
  );
}
