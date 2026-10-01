import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { LookupOrdersQuery, type LookupOrders } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { useMe } from '@/features/auth/api';
import { useOnline } from '@/features/live/operations';
import { plainButton } from '@/features/plan/parts/look';
import { useAppClock } from '@/lib/clock';
import type { OrdersParams } from './api';
import { NO_ORDER_FILTERS, ordersPage, type OrderFilter, type OrderFilters } from './filters';
import { OrderDetail } from './OrderDetail';
import { OrderTable } from './parts/OrderTable';
import { SkippedLately } from './parts/SkippedLately';
import {
  Choices, DateInput, Figures, FiguresSkeleton, LAYOUT, LoadFailed, Note, RailSkeleton, ReadLine, ScrollBox, SearchField, TableSkeleton, type Figure,
} from './parts/ui';
import { currentRead, ordersOptions, readState, scopeOf, useFollowDefault, useFollowGeneration, useFollowLookupMessages, useSelection } from './queries';
import {
  CHOOSE_DAY, CHOOSE_DAY_LINE, NOT_A_DATE, NO_MATCH, NO_ORDERS, NO_ORDERS_IN_RANGE, NO_SENT_PLAN, NO_SENT_PLANS, ORDERS_FAILED, PICK_ORDER,
  ordersTitle, shortDay, showing, whole,
} from './words';

const FILTERS: { value: OrderFilter; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'carried_over', label: 'Carried over' }, { value: 'deferred', label: 'Deferred' }, { value: 'split', label: 'Split' },
];

// The URL's day and range. None means the board's own day, which the server resolves; a date that is not a calendar
// date, or a range the page does not read, is said rather than replaced by another.
function paramsOf(search: URLSearchParams): OrdersParams | null {
  const named = Object.fromEntries(['date', 'range'].flatMap((key) => (search.has(key) ? [[key, search.get(key)]] : [])));
  const parsed = LookupOrdersQuery.safeParse(named);
  if (!parsed.success) return null;
  return parsed.data.date ? { date: parsed.data.date, range: parsed.data.range } : { range: parsed.data.range };
}

const narrow = () => window.matchMedia('(max-width: 1023.98px)').matches;

// Orders at /dispatcher/orders (spec 017, Dispatcher · Orders 102:76375): one delivery day's orders, or the 28 days to
// it, opening on the board's day. The table, search and filters, the selected order's detail and Skipped lately all
// come from one read; filtering and opening a row never ask the server again (rule 3).
export function OrdersPage() {
  const { data: me } = useMe();
  const clock = useAppClock();
  const online = useOnline();
  const [search, setSearch] = useSearchParams();
  const params = paramsOf(search);
  useFollowLookupMessages();
  const options = ordersOptions(me, params ?? { range: 'day' });
  const query = useQuery({ ...options, enabled: options.enabled && params !== null });
  const clockDay = clock.state?.day ?? null;
  useFollowGeneration(clockDay, query.data?.demoDay ?? null);
  // What the page draws: the read of these parameters and of the reset the clock shows. A date that is not a calendar
  // date draws nothing a cached read holds, and a read from another reset is not drawn or chosen from.
  const data = params === null ? undefined : currentRead(query.data, clockDay);
  const read = { ...query, data };
  // A day the board chose follows the board past its 03:30 rollover; a chosen day stays chosen.
  useFollowDefault(options.queryKey, data?.readAt, params?.date === undefined, 'board');
  const [filters, setFilters] = useState<OrderFilters>(NO_ORDER_FILTERS);
  const scope = scopeOf({ userId: me?.id ?? null, depotId: me?.depotId ?? null, params: params ?? {}, generation: data?.demoDay ?? null, clockGeneration: clockDay });
  const [selectedId, select] = useSelection(scope, data?.rows.map((row) => row.id) ?? []);
  const view = data ? ordersPage(data, filters, selectedId) : null;
  const state = readState(read, online);
  const filtered = filters.search.trim() !== '' || filters.filter !== 'all';
  const day = data?.date ?? params?.date ?? null;
  const range = params?.range ?? 'day';

  const setParam = (name: 'date' | 'range', value: string | null) => setSearch((held) => {
    const next = new URLSearchParams(held);
    if (value === null) next.delete(name); else next.set(name, value);
    return next;
  });
  const open = (orderId: string) => {
    select(orderId);
    if (narrow()) window.requestAnimationFrame(() => document.getElementById('order-detail')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };
  const close = () => {
    const was = selectedId;
    select(null);
    if (was) window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-order="${was}"]`)?.focus());
  };
  const clearFilters = () => setFilters(NO_ORDER_FILTERS);

  return (
    <div className="lg:-mt-[7px]">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <h1 className="text-xl leading-7 font-bold">{ordersTitle(data ?? null, params)}</h1>
        {day && (
          <Choices
            label="Days shown"
            value={range}
            options={[{ value: 'day', label: shortDay(day) }, { value: 'four_weeks', label: 'Last 4 weeks' }]}
            onChange={(next) => setParam('range', next === 'day' ? null : next)}
          />
        )}
        <DateInput label="Pick a date" value={params?.date ?? data?.date ?? ''} onChange={(date) => setParam('date', date)} />
        <div className="flex w-full flex-wrap items-center gap-2.5 lg:ml-auto lg:w-auto">
          <SearchField label="Search shops" placeholder="Shop or outlet id" value={filters.search} onChange={(text) => setFilters((held) => ({ ...held, search: text }))} className="w-full sm:w-[240px]" />
          <Choices label="Orders shown" value={filters.filter} options={FILTERS} onChange={(filter) => setFilters((held) => ({ ...held, filter }))} />
        </div>
      </header>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-6 gap-y-2">
        {data?.summary ? <Figures items={summaryOf(data)} /> : params !== null && state === 'loading' && <FiguresSkeleton />}
        {params !== null && <ReadLine query={read} online={online} />}
      </div>

      <div className={`${LAYOUT} mt-4`}>
        <section aria-label="Orders" className="min-w-0 space-y-2.5">
          {params === null ? <Note>{NOT_A_DATE}</Note>
            : !data ? (state === 'failed' ? <LoadFailed title={ORDERS_FAILED} query={read} online={online} /> : <TableSkeleton label="Loading the orders" />)
              : data.date === null ? <Note>{CHOOSE_DAY}. {CHOOSE_DAY_LINE}</Note>
                : data.rows.length === 0 ? <Note>{data.range === 'day' ? NO_ORDERS : NO_ORDERS_IN_RANGE}</Note>
                  : view!.shown === 0 ? <Note action={<ClearFilters onClick={clearFilters} />}>{NO_MATCH}</Note>
                    : (
                      <>
                        {filtered && (
                          <p role="status" className="flex items-center gap-3 px-1 text-[11px] leading-[14px] text-muted-foreground">
                            {showing(view!.shown, view!.total)}
                            <ClearFilters onClick={clearFilters} />
                          </p>
                        )}
                        <ScrollBox label="Orders table">
                          <OrderTable groups={view!.groups} range={data.range} selectedId={selectedId} onSelect={open} />
                        </ScrollBox>
                      </>
                    )}
        </section>
        <aside aria-label="Order detail and skipped shops" className="min-w-0 space-y-4">
          {view?.selected ? <OrderDetail key={view.selected.id} row={view.selected} onClose={close} />
            : data && data.rows.length > 0 && <Note className="max-lg:hidden">{PICK_ORDER}</Note>}
          {data?.skippedLately ? <SkippedLately skipped={data.skippedLately} /> : params !== null && state === 'loading' && <RailSkeleton />}
        </aside>
      </div>
    </div>
  );
}

function ClearFilters({ onClick }: { onClick: () => void }) {
  return <Button variant="outline" className={plainButton('h-7 rounded-full px-3 text-[11px]')} onClick={onClick}>Clear filters</Button>;
}

// The server's own totals, never the filtered rows: orders, then the listed days' own sent plans' planned and deferred
// orders (said to be no sent plan when none was sent), carried over and split parts.
function summaryOf(data: LookupOrders): Figure[] {
  const s = data.summary!;
  const sent = data.rows.some((row) => row.days.some((day) => day.publication !== null));
  const unsent = sent ? undefined : data.range === 'day' ? NO_SENT_PLAN : NO_SENT_PLANS;
  return [
    { value: whole(s.orders), label: s.orders === 1 ? 'order' : 'orders' },
    { value: whole(s.planned), label: 'planned', note: unsent },
    { value: whole(s.deferred), label: 'deferred', tone: s.deferred > 0 ? 'warn' : undefined },
    { value: whole(s.carriedOver), label: 'carried over from earlier days', tone: s.carriedOver > 0 ? 'warn' : undefined },
    { value: whole(s.split), label: s.split === 1 ? 'split part' : 'split parts' },
  ];
}
