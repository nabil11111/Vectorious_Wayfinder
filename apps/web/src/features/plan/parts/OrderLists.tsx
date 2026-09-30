import { useState, type ReactNode } from 'react';
import type { BoardOrder, BoardShop, Brand, DraftDeferral, DraftPlan, DraftTrip } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { BoardScreen, Undo } from '../board';
import { addOrders, defer, keyOf, undefer, type Place } from '../draft';
import { carriedLine, countOf, deferredTimes, orderAmount, ordersAmount, partLine, placeOf, shopLine, whole } from '../words';
import { DeferForm } from './DeferForm';
import { BRAND_ICON, ICON } from './icons';
import { groupKey, type BoardIndex } from './lookup';
import { plainButton } from './look';
import { Column, ColumnHead, MenuItem, MenuPopup, MenuRoot, MenuTrigger, Pills, Tag } from './ui';

const BRANDS: Brand[] = ['Fresh', 'Style', 'Tech'];

interface ShopOrders { shop: BoardShop; orders: BoardOrder[] }
interface Group { key: string; brand: Brand; district: string; shops: ShopOrders[]; count: number }

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

// The left column's upper card (Edit plan): the day's unplanned orders by brand and district, or as one list,
// with the carried-over ones first and the deferred ones last.
export function OrderLists({ screen, index, places, open, outlined, change, onStartTrip, onFindSlot, onJoin }: {
  screen: BoardScreen;
  index: BoardIndex;
  places: Map<string, Place>;
  open: DraftTrip | null;
  outlined: string | null;
  change: (next: DraftPlan, undo?: Undo) => void;
  onStartTrip: (group: { brand: Brand; district: string }, orders: BoardOrder[]) => void;
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

  const add = open ? (orders: BoardOrder[]) => change(addOrders(draft, keyOf(open), orders)) : null;
  const doDefer = (deferrals: DraftDeferral[]) => {
    change(defer(draft, deferrals));
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

  return (
    <Column aria-label="Unplanned orders" className="min-h-[360px] flex-1 lg:min-h-0">
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
                  <OrderRow
                    key={order.id}
                    order={order}
                    title={titleOf(order, index)}
                    line={carriedLine(order)}
                    add={add}
                    onDefer={() => deferOrders(order.id, [order])}
                    onJoin={onJoin}
                    extra={<Button variant="outline" className={plainButton('h-[22px] px-2.5 text-[11px]')} onClick={() => onFindSlot(order.id)}>Find a slot</Button>}
                  >
                    {form(order.id)}
                  </OrderRow>
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
                  <div className="flex items-center gap-2 pl-1">
                    <img src={BRAND_ICON[group.brand]} alt="" className="size-[22px] shrink-0 object-contain" />
                    <h3 className="min-w-0 flex-1 truncate text-xs leading-[15px] font-semibold">{group.brand} · {group.district} · {whole(group.count)}</h3>
                    <RowMenu label={`${group.brand} · ${group.district}`} items={[{ label: `Defer all ${whole(group.count)}`, onClick: () => deferOrders(group.key, group.shops.flatMap((row) => row.orders)) }]} />
                    <Button variant="outline" className={plainButton('h-[26px] px-3 text-[11px]')} onClick={() => onStartTrip({ brand: group.brand, district: group.district }, group.shops.flatMap((row) => row.orders))}>Start a trip</Button>
                  </div>
                  {form(group.key)}
                  <ul className="mt-1.5">
                    {shops.map(({ shop, orders }) => (
                      <li key={shop.id} className="border-t py-2 pl-1">
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
                <OrderRow
                  order={order}
                  title={titleOf(order, index)}
                  line={order.carriedOver ? carriedLine(order) : lineOf(order, index)}
                  add={add}
                  onDefer={() => deferOrders(order.id, [order])}
                  onJoin={onJoin}
                  extra={order.carriedOver && <Button variant="outline" className={plainButton('h-[22px] px-2.5 text-[11px]')} onClick={() => onFindSlot(order.id)}>Find a slot</Button>}
                >
                  {form(order.id)}
                </OrderRow>
              </li>
            ))}
          </ul>
        )}

        {deferred.length > 0 && (
          <section aria-label="Deferred" className="mt-3">
            <h3 className="px-1 text-xs leading-[15px] font-semibold text-muted-foreground">Deferred · {whole(deferred.length)}</h3>
            <ul className="mt-1">
              {deferred.map(({ deferral, order }) => (
                <li key={order.id} className="border-t px-1 py-2">
                  <Row
                    title={titleOf(order, index)}
                    line={deferral.reason}
                    actions={<button type="button" className="text-[11px] font-semibold underline underline-offset-2" onClick={() => change(undefer(draft, order.id))}>Undo</button>}
                  />
                </li>
              ))}
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
function OrderRow({ order, title, line, add, onDefer, onJoin, extra, children }: {
  order: BoardOrder; title: string; line: string; add: ((orders: BoardOrder[]) => void) | null;
  onDefer: () => void; onJoin: (order: BoardOrder) => void; extra?: ReactNode; children?: ReactNode;
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
      {children}
    </div>
  );
}

// A row's two lines, with a chip and actions on the right.
function Row({ title, line, chip, actions }: { title: string; line: string; chip?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-[15px] font-semibold">{title}</p>
        {line && <p className="mt-1 text-[11px] leading-[14px] text-muted-foreground">{line}</p>}
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
