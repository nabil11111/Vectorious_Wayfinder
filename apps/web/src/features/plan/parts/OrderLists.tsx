import { Fragment, useState, type ReactNode } from 'react';
import type { BoardOrder, BoardShop, Brand, DraftDeferral, DraftPlan, DraftTrip } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { BoardScreen, Undo } from '../board';
import { addOrders, defer, keyOf, undefer, type CrewRef, type Place } from '../draft';
import { carriedLine, countOf, decisionTitle, deferGroup, deferredTimes, orderAmount, ordersAmount, partLine, placeOf, shopLine, TO_DECIDE, whole } from '../words';
import { CrewMenu } from './CrewMenu';
import type { Pick } from './crews';
import { DeferForm } from './DeferForm';
import { movable, useLanding } from './dragging';
import type { Dragged } from './drops';
import { BRAND_ICON, ICON } from './icons';
import { decisionShop, decisionTruck, groupKey, listed, ordersLine, type BoardIndex } from './lookup';
import { plainButton } from './look';
import { DragRow } from './PlanDnd';
import { Column, ColumnHead, MenuItem, MenuPopup, MenuRoot, MenuTrigger, Pills, Tag } from './ui';
import { Why } from './Why';

const BRANDS: Brand[] = ['Fresh', 'Style', 'Tech'];

interface ShopOrders { shop: BoardShop; orders: BoardOrder[] }
interface Group { key: string; brand: Brand; district: string; shops: ShopOrders[]; count: number }
// A group's "Start a trip": its orders give the crews read, and the trip starts empty (spec 026).
const startOf = (group: Group): Pick => ({ kind: 'start', group: { brand: group.brand, district: group.district }, orders: group.shops.flatMap((row) => row.orders), startWith: [] });

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
export function OrderLists({ screen, index, places, open, outlined, change, onCrew, onFindSlot, onJoin }: {
  screen: BoardScreen;
  index: BoardIndex;
  places: Map<string, Place>;
  open: DraftTrip | null;
  outlined: string | null;
  change: (next: DraftPlan, said: Undo) => void;
  // A crew picked from a group's "Start a trip" (spec 026).
  onCrew: (pick: Pick, crew: CrewRef) => void;
  onFindSlot: (orderId: string) => void;
  onJoin: (order: BoardOrder) => void;
}) {
  const { board, draft } = screen;
  const [view, setView] = useState<'groups' | 'list'>('groups');
  const [deferring, setDeferring] = useState<DeferTarget | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const unplanned = board.orders.filter((order) => !places.has(order.id));
  const carried = unplanned.filter((order) => order.carriedOver).sort(byWanted);
  const groups = groupsOf(unplanned.filter((order) => !order.carriedOver), index);
  const deferred = draft.deferrals.flatMap((deferral) => {
    const order = index.order(deferral.orderId);
    return order ? [{ deferral, order }] : [];
  });

  const add = open ? (orders: BoardOrder[]) => change(addOrders(draft, keyOf(open), orders), { line: `${ordersLine(index, orders.map((o) => o.id))} added to ${index.called(open)}`, tripKey: keyOf(open) }) : null;
  const doDefer = (deferrals: DraftDeferral[]) => {
    change(defer(draft, deferrals), { line: `${ordersLine(index, deferrals.map((d) => d.orderId))} deferred`, tripKey: null });
    setDeferring(null);
  };
  const form = (key: string) => deferring?.key === key && (
    <DeferForm
      orders={deferring.orders}
      index={index}
      code={deferring.code}
      reason={deferring.reason}
      onDefer={doDefer}
      onCancel={() => setDeferring(null)}
    />
  );
  const deferOrders = (key: string, orders: BoardOrder[]) => {
    const last = orders.length === 1 ? orders[0]!.lastDeferral : null;
    setDeferring({ key, orders, code: last?.code, reason: last?.reason });
  };
  const canMove = movable(screen);
  const { setNodeRef: landingRef, look: landingLook } = useLanding('unplanned', { kind: 'unplanned' }, 'Unplanned orders');
  // An order's row, with its grip when it can be dragged.
  const draggable = (order: BoardOrder, row: ReactNode) => {
    const dragged = orderDragged(order, index);
    return dragged ? <DragRow id={`orders:order:${order.id}`} dragged={dragged} movable={canMove}>{row}</DragRow> : row;
  };

  return (
    <Column ref={landingRef} aria-label="Unplanned orders" className={cn('min-h-[360px] flex-1 lg:min-h-0', landingLook)}>
      <ColumnHead icon={ICON.unplanned} title={`Unplanned orders · ${whole(unplanned.length)}`} className="px-3 pt-3.5 pb-2.5">
        <Pills tight label="Show the orders" value={view} onChange={setView} options={[{ value: 'groups', label: 'brand · district' }, { value: 'list', label: 'list' }]} />
      </ColumnHead>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-3.5">
        {unplanned.length === 0 && <p className="pt-1 text-xs text-muted-foreground">Every order is on a trip or deferred.</p>}

        {view === 'groups' ? (
          <>
            {carried.length > 0 && (
              <section aria-label="Carried over" className="mb-2 rounded-[10px] border-[1.5px] border-warn px-3.5 pt-2.5 pb-1">
                <h3 className="text-xs leading-[15px] font-semibold text-warn-ink">Carried over · {whole(carried.length)}</h3>
                {carried.map((order) => (
                  <Fragment key={order.id}>
                    {draggable(order, (
                      <OrderRow
                        order={order}
                        title={titleOf(order, index)}
                        line={carriedLine(order)}
                        add={add}
                        onDefer={() => deferOrders(order.id, [order])}
                        onJoin={onJoin}
                        extra={<Button variant="outline" className={plainButton('h-[22px] px-2.5 text-[11px]')} onClick={() => onFindSlot(order.id)}>Find a slot</Button>}
                      />
                    ))}
                    {form(order.id)}
                  </Fragment>
                ))}
              </section>
            )}
            {groups.map((group) => {
              const all = expanded.has(group.key);
              const shops = all ? group.shops : group.shops.slice(0, 3);
              const hidden = group.shops.slice(shops.length).reduce((n, row) => n + row.orders.length, 0);
              return (
                <section
                  key={group.key}
                  id={`group-${group.key}`}
                  aria-label={`${group.brand} · ${group.district}`}
                  className={cn('scroll-mt-2 rounded-[10px] border-[1.5px] px-2 pt-2.5 pb-1', outlined === group.key ? 'border-foreground' : 'border-transparent')}
                >
                  <DragRow
                    id={`orders:group:${group.key}`}
                    movable={canMove}
                    dragged={{ kind: 'orders', orders: group.shops.flatMap((row) => row.orders), group: { brand: group.brand, district: group.district }, label: `${group.brand} · ${group.district}`, detail: countOf(group.count, 'order') }}
                  >
                    <div className="flex items-center gap-2 pl-1">
                      <img src={BRAND_ICON[group.brand]} alt="" className="size-[22px] shrink-0 object-contain" />
                      <h3 className="min-w-0 flex-1 truncate text-xs leading-[15px] font-semibold">{group.brand} · {group.district} · {whole(group.count)}</h3>
                      <RowMenu label={`${group.brand} · ${group.district}`} items={[{ label: deferGroup(group.count), onClick: () => deferOrders(group.key, group.shops.flatMap((row) => row.orders)) }]} />
                      <CrewMenu
                        screen={screen}
                        index={index}
                        pick={startOf(group)}
                        title={`Start a trip · ${group.brand} · ${group.district}`}
                        trigger="Start a trip"
                        triggerClassName={plainButton('h-[26px] px-3 text-[11px]')}
                        onPick={(crew) => onCrew(startOf(group), crew)}
                      />
                    </div>
                  </DragRow>
                  {form(group.key)}
                  <ul className="mt-1.5">
                    {shops.map(({ shop, orders }) => (
                      <li key={shop.id} className="border-t py-2 pl-1">
                        <DragRow
                          id={`orders:shop:${group.key}:${shop.id}`}
                          movable={canMove}
                          dragged={{ kind: 'orders', orders, group: { brand: group.brand, district: group.district }, label: shop.name, detail: ordersAmount(shop.brand, orders) }}
                        >
                          <Row
                            title={`${placeOf(shop)} · ${ordersAmount(shop.brand, orders)}`}
                            line={[shopLine(shop), ...orders.filter((o) => o.splitFrom !== null).map(partLine)].join(' · ')}
                            actions={(
                              <>
                                {add && <Button variant="outline" className={plainButton('h-[26px] px-3 text-[11px]')} onClick={() => add(orders)}>Add</Button>}
                                <RowMenu label={shop.name} items={[
                                  { label: orders.length > 1 ? `Defer ${countOf(orders.length, 'order')}` : 'Defer', onClick: () => deferOrders(`${group.key}:${shop.id}`, orders) },
                                  ...orders.filter((o) => o.splitFrom !== null).map((o) => ({ label: `Join ${orderAmount(shop.brand, o)} back`, onClick: () => onJoin(o) })),
                                ]} />
                              </>
                            )}
                          />
                        </DragRow>
                        {form(`${group.key}:${shop.id}`)}
                      </li>
                    ))}
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
            {[...unplanned].sort(byWanted).map((order) => (
              <li key={order.id} className="border-t first:border-t-0">
                {draggable(order, (
                  <OrderRow
                    order={order}
                    title={titleOf(order, index)}
                    line={order.carriedOver ? carriedLine(order) : lineOf(order, index)}
                    add={add}
                    onDefer={() => deferOrders(order.id, [order])}
                    onJoin={onJoin}
                    extra={order.carriedOver && <Button variant="outline" className={plainButton('h-[22px] px-2.5 text-[11px]')} onClick={() => onFindSlot(order.id)}>Find a slot</Button>}
                  />
                ))}
                {form(order.id)}
              </li>
            ))}
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
                      line={deferral.reason}
                      below={(choice || decisions.length > 0) && (
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
                      )}
                      actions={(
                        <>
                          <button type="button" className="text-[11px] font-semibold underline underline-offset-2" onClick={() => change(undefer(draft, order.id), { line: `${ordersLine(index, [order.id])} back in Unplanned`, tripKey: null })}>Undo</button>
                          {order.splitFrom !== null && <RowMenu label={title} items={[{ label: 'Join back', onClick: () => onJoin(order) }]} />}
                        </>
                      )}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </Column>
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
function OrderRow({ order, title, line, add, onDefer, onJoin, extra }: {
  order: BoardOrder; title: string; line: string; add: ((orders: BoardOrder[]) => void) | null;
  onDefer: () => void; onJoin: (order: BoardOrder) => void; extra?: ReactNode;
}) {
  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2">
        <p title={title} className="min-w-0 flex-1 truncate text-xs leading-[15px] font-semibold">{title}</p>
        {order.timesDeferred > 0 && <Tag tone={order.timesDeferred >= 2 ? 'bad' : 'warn'} className="px-2.5 text-[10px] leading-[13px]">{deferredTimes(order)}</Tag>}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <p title={line} className="min-w-0 flex-1 truncate text-[11px] leading-[14px] text-muted-foreground">{line}</p>
        {extra}
        {add && <Button variant="outline" className={plainButton('h-[22px] px-2.5 text-[11px]')} onClick={() => add([order])}>Add</Button>}
        <RowMenu label={title} items={[
          { label: 'Defer', onClick: onDefer },
          ...(order.splitFrom !== null ? [{ label: 'Join back', onClick: () => onJoin(order) }] : []),
        ]} />
      </div>
    </div>
  );
}

// A row's two lines and what goes under them, with a chip and actions on the right.
function Row({ title, line, chip, below, actions }: { title: string; line: string; chip?: ReactNode; below?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-[15px] font-semibold">{title}</p>
        {line && <p className="mt-1 text-[11px] leading-[14px] text-muted-foreground">{line}</p>}
        {below}
      </div>
      {chip}
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
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
