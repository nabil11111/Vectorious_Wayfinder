import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { LookupOrdersQuery, type LookupOrders, type Me } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { useMe } from '@/features/auth/api';
import { DepotHeading } from '@/features/dispatcher/parts/DepotHeading';
import { partId, useScope } from '@/features/dispatcher/scope';
import { useOnline } from '@/features/live/operations';
import { plainButton } from '@/features/plan/parts/look';
import { useAppClock } from '@/lib/clock';
import type { OrdersParams } from './api';
import { newestDemoDay, sumOrders } from './both';
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
// come from one read; filtering and opening a row never ask the server again (rule 3). On both depots together (spec
// 021) each depot is a read of its own, and the page shows Peliyagoda's part and then Kandy's under their names; the
// header's day, search and filters are both parts', and its figures add the two up once both are read.
export function OrdersPage() {
  const { data: me } = useMe();
  const { depots, both } = useScope();
  const clock = useAppClock();
  const online = useOnline();
  const [search, setSearch] = useSearchParams();
  const params = paramsOf(search);
  useFollowLookupMessages();
  const options = depots.map((depot) => ordersOptions(me, depot, params ?? { range: 'day' }));
  const queries = useQueries({ queries: options.map((each) => ({ ...each, enabled: each.enabled && params !== null })) });
  const clockDay = clock.state?.day ?? null;
  useFollowGeneration(clockDay, newestDemoDay(queries));
  // What the page draws: each depot's read of these parameters and of the reset the clock shows. A date that is not a
  // calendar date draws nothing a cached read holds, and a read from another reset is not drawn or chosen from.
  const reads = queries.map((query) => (params === null ? undefined : currentRead(query.data, clockDay)));
  const all = reads.length > 0 && reads.every((read) => read !== undefined) ? reads as LookupOrders[] : null;
  const [filters, setFilters] = useState<OrderFilters>(NO_ORDER_FILTERS);
  // The days the reads are of, when every depot's is read and they are the same.
  const titled = all && all.every((read) => read.date === all[0]!.date && read.from === all[0]!.from && read.range === all[0]!.range) ? all[0]! : null;
  const day = titled?.date ?? params?.date ?? null;
  const range = params?.range ?? 'day';
  const loading = params !== null && queries.some((query, i) => readState({ ...query, data: reads[i] }, online) === 'loading');

  const setParam = (name: 'date' | 'range', value: string | null) => setSearch((held) => {
    const next = new URLSearchParams(held);
    if (value === null) next.delete(name); else next.set(name, value);
    return next;
  });
  const part = (i: number, className: string) => (
    <OrdersPart depot={depots[i]!} both={both} me={me} params={params} query={queries[i]!} queryKey={options[i]!.queryKey} data={reads[i]} filters={filters}
      onClearFilters={() => setFilters(NO_ORDER_FILTERS)} clockDay={clockDay} online={online} className={className} />
  );

  return (
    <div className="lg:-mt-[7px]">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <h1 className="text-xl leading-7 font-bold">{ordersTitle(titled, params)}</h1>
        {day && (
          <Choices
            label="Days shown"
            value={range}
            options={[{ value: 'day', label: shortDay(day) }, { value: 'four_weeks', label: 'Last 4 weeks' }]}
            onChange={(next) => setParam('range', next === 'day' ? null : next)}
          />
        )}
        <DateInput label="Pick a date" value={params?.date ?? titled?.date ?? ''} onChange={(date) => setParam('date', date)} />
        <div className="flex w-full flex-wrap items-center gap-2.5 lg:ml-auto lg:w-auto">
          <SearchField label="Search shops" placeholder="Shop or outlet id" value={filters.search} onChange={(text) => setFilters((held) => ({ ...held, search: text }))} className="w-full sm:w-[240px]" />
          <Choices label="Orders shown" value={filters.filter} options={FILTERS} onChange={(filter) => setFilters((held) => ({ ...held, filter }))} />
        </div>
      </header>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-6 gap-y-2">
        {all && all.every((read) => read.summary) ? <Figures items={summaryOf(all, depots)} /> : loading && <FiguresSkeleton />}
        {params !== null && !both && <ReadLine query={{ ...queries[0]!, data: reads[0] }} online={online} />}
      </div>

      {both ? depots.map((depot, i) => (
        <section key={depot} aria-labelledby={partId(depot)} className="mt-6">
          <DepotHeading depot={depot}>{params !== null && <ReadLine query={{ ...queries[i]!, data: reads[i] }} online={online} />}</DepotHeading>
          {part(i, 'mt-2.5')}
        </section>
      )) : part(0, 'mt-4')}
    </div>
  );
}

// One depot's orders: the table or what stands in for it, and beside it the selected order and Skipped lately.
function OrdersPart({ depot, both, me, params, query, queryKey, data, filters, onClearFilters, clockDay, online, className }: {
  depot: string; both: boolean; me: Me | null | undefined; params: OrdersParams | null; query: UseQueryResult<LookupOrders>; queryKey: readonly unknown[];
  data: LookupOrders | undefined; filters: OrderFilters; onClearFilters: () => void; clockDay: number | null; online: boolean; className: string;
}) {
  // A day the board chose follows the board past its 03:30 rollover; a chosen day stays chosen.
  useFollowDefault(queryKey, data?.readAt, params?.date === undefined, 'board');
  const scope = scopeOf({ userId: me?.id ?? null, depotId: depot, params: params ?? {}, generation: data?.demoDay ?? null, clockGeneration: clockDay });
  const [selectedId, select] = useSelection(scope, data?.rows.map((row) => row.id) ?? []);
  const view = data ? ordersPage(data, filters, selectedId) : null;
  const read = { ...query, data };
  const state = readState(read, online);
  const filtered = filters.search.trim() !== '' || filters.filter !== 'all';
  // Where the narrow page scrolls to: one detail per depot on both depots together.
  const anchor = both ? `order-detail-${depot}` : 'order-detail';
  const open = (orderId: string) => {
    select(orderId);
    if (narrow()) window.requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };
  const close = () => {
    const was = selectedId;
    select(null);
    if (was) window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-order="${was}"]`)?.focus());
  };

  return (
    <div className={`${LAYOUT} ${className}`}>
      <section aria-label="Orders" className="min-w-0 space-y-2.5">
        {params === null ? <Note>{NOT_A_DATE}</Note>
          : !data ? (state === 'failed' ? <LoadFailed title={ORDERS_FAILED} query={read} online={online} /> : <TableSkeleton label="Loading the orders" />)
            : data.date === null ? <Note>{CHOOSE_DAY}. {CHOOSE_DAY_LINE}</Note>
              : data.rows.length === 0 ? <Note>{data.range === 'day' ? NO_ORDERS : NO_ORDERS_IN_RANGE}</Note>
                : view!.shown === 0 ? <Note action={<ClearFilters onClick={onClearFilters} />}>{NO_MATCH}</Note>
                  : (
                    <>
                      {filtered && (
                        <p role="status" className="flex items-center gap-3 px-1 text-[11px] leading-[14px] text-muted-foreground">
                          {showing(view!.shown, view!.total)}
                          <ClearFilters onClick={onClearFilters} />
                        </p>
                      )}
                      <ScrollBox label="Orders table">
                        <OrderTable groups={view!.groups} range={data.range} selectedId={selectedId} onSelect={open} />
                      </ScrollBox>
                    </>
                  )}
      </section>
      <aside aria-label="Order detail and skipped shops" className="min-w-0 space-y-4">
        {view?.selected ? <OrderDetail key={view.selected.id} row={view.selected} anchor={anchor} onClose={close} />
          : data && data.rows.length > 0 && <Note className="max-lg:hidden">{PICK_ORDER}</Note>}
        {data?.skippedLately ? <SkippedLately skipped={data.skippedLately} /> : params !== null && state === 'loading' && <RailSkeleton />}
      </aside>
    </div>
  );
}

function ClearFilters({ onClick }: { onClick: () => void }) {
  return <Button variant="outline" className={plainButton('h-7 rounded-full px-3 text-[11px]')} onClick={onClick}>Clear filters</Button>;
}

// The server's own totals, never the filtered rows: orders, then the listed days' own sent plans' planned and deferred
// orders (said to be no sent plan when none was sent), carried over and split parts. On both depots together each is
// the two depots' added up, and a depot with no sent plan is named.
function summaryOf(reads: LookupOrders[], depots: string[]): Figure[] {
  const s = sumOrders(reads.map((read) => read.summary!));
  const unsentAt = depots.filter((_, i) => !reads[i]!.rows.some((row) => row.days.some((day) => day.publication !== null)));
  const words = reads[0]!.range === 'day' ? NO_SENT_PLAN : NO_SENT_PLANS;
  const unsent = unsentAt.length === 0 ? undefined : unsentAt.length === reads.length ? words : `${words} at ${unsentAt.join(' and ')}`;
  return [
    { value: whole(s.orders), label: s.orders === 1 ? 'order' : 'orders' },
    { value: whole(s.planned), label: 'planned', note: unsent },
    { value: whole(s.deferred), label: 'deferred', tone: s.deferred > 0 ? 'warn' : undefined },
    { value: whole(s.carriedOver), label: 'carried over from earlier days', tone: s.carriedOver > 0 ? 'warn' : undefined },
    { value: whole(s.split), label: s.split === 1 ? 'split part' : 'split parts' },
  ];
}
