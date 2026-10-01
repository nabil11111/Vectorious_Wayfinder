import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { LookupHistoryQuery, type Brand, type LookupHistory } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { useMe } from '@/features/auth/api';
import { useScope } from '@/features/dispatcher/scope';
import { useOnline } from '@/features/live/operations';
import { plainButton } from '@/features/plan/parts/look';
import { useAppClock } from '@/lib/clock';
import { cn } from '@/lib/utils';
import type { HistoryParams } from './api';
import { NO_TRIP_FILTERS, matchesTrip, type TripFilter, type TripFilters } from './filters';
import { HistoryDetail } from './HistoryDetail';
import { axisOf } from './parts/axis';
import { Confirmations, DeferralList, DeferredCard, NotDelivered } from './parts/HistoryCards';
import { HistoryTrips } from './parts/HistoryTrips';
import {
  Choices, DateInput, Figures, FiguresSkeleton, LAYOUT, LoadFailed, Note, RailSkeleton, ReadLine, ScrollBox, SelectPill, TableSkeleton, type Figure,
} from './parts/ui';
import {
  currentRead, historyOptions, historySelection, readState, scopeOf, useFollowDefault, useFollowGeneration, useFollowLookupMessages, usePhotoViewer,
} from './queries';
import {
  HISTORY_FAILED, NOT_A_DATE, NO_SENT_PLANS_YET, NO_SENT_PLAN_ON, NO_TRIPS_SENT, NO_TRIP_MATCH, PICK_TRIP, TRIP_NOT_ON_PLAN, historyTitle, shortDay,
  showingTrips, unrecordedWords, whole,
} from './words';

const FILTERS: { value: TripFilter; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'late', label: 'Late' }, { value: 'short', label: 'Short' }, { value: 'returned', label: 'Returned' }, { value: 'deferred', label: 'Deferred' },
];
const BRANDS: { value: Brand | 'all'; label: string }[] = [{ value: 'all', label: 'All brands' }, { value: 'Fresh', label: 'Fresh' }, { value: 'Style', label: 'Style' }, { value: 'Tech', label: 'Tech' }];

// The URL's sent-plan date: none means the latest sent date no later than today, which the server resolves. One that is
// not a calendar date is said rather than replaced.
function paramsOf(search: URLSearchParams): HistoryParams | null {
  const parsed = LookupHistoryQuery.safeParse(search.has('date') ? { date: search.get('date') } : {});
  if (!parsed.success) return null;
  return parsed.data.date ? { date: parsed.data.date } : {};
}

const narrow = () => window.matchMedia('(max-width: 1023.98px)').matches;

// History at /dispatcher/history (spec 017, Dispatcher · History 112:78211): one sent plan as it was recorded, on a
// static timeline, with the selected trip's stops, loading, problems, attempts, proofs and shop confirmations. ?trip=
// selects a trip among the read's own; only the date goes to the API. No replay, speed or signature (D-82).
export function HistoryPage() {
  const { data: me } = useMe();
  const clock = useAppClock();
  const online = useOnline();
  const [search, setSearch] = useSearchParams();
  const params = paramsOf(search);
  useFollowLookupMessages();
  const depot = useScope().depots[0] ?? null;
  const options = historyOptions(me, depot, params ?? {});
  const query = useQuery({ ...options, enabled: options.enabled && params !== null });
  const clockDay = clock.state?.day ?? null;
  useFollowGeneration(clockDay, query.data?.demoDay ?? null);
  // What the page draws: the read of this date and of the reset the clock shows. A date that is not a calendar date
  // draws nothing a cached read holds, and a read from another reset is not drawn or chosen from.
  const data = params === null ? undefined : currentRead(query.data, clockDay);
  const read = { ...query, data };
  // The latest sent date follows the calendar past midnight; a chosen date stays chosen.
  useFollowDefault(options.queryKey, data?.readAt, params?.date === undefined, 'calendar');
  const [filters, setFilters] = useState<TripFilters>(NO_TRIP_FILTERS);

  // The selected trip is the address's, while the read holds it and its records are of the reset the clock shows.
  const { trip: selected, gone } = historySelection(data, search.get('trip'), clockDay);
  // The photo belongs to the account, depot, date, selected trip and reset it was opened in.
  const viewer = usePhotoViewer(scopeOf({ userId: me?.id ?? null, depotId: me?.depotId ?? null, params: { ...params, trip: selected?.tripId ?? null }, generation: data?.demoDay ?? null, clockGeneration: clockDay }), depot ?? '');

  const shownTrips = data ? data.trips.filter((trip) => matchesTrip(trip, filters)) : [];
  const deferrals = data ? data.deferrals.filter((deferral) => filters.brand === 'all' || deferral.outlet.brand === filters.brand) : [];
  const axis = data ? axisOf(data.trips) : null;
  const filtered = filters.attention !== 'all' || filters.brand !== 'all';
  const state = readState(read, online);

  const setParams = (change: Record<string, string | null>) => setSearch((held) => {
    const next = new URLSearchParams(held);
    for (const [name, value] of Object.entries(change)) {
      if (value === null) next.delete(name); else next.set(name, value);
    }
    return next;
  });
  const toggle = (tripId: string) => {
    if (selected?.tripId === tripId) {
      setParams({ trip: null });
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-trip="${tripId}"]`)?.focus());
      return;
    }
    setParams({ trip: tripId });
    if (narrow()) window.requestAnimationFrame(() => document.getElementById('history-detail')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };

  // A trip named by a link (Orders, Fleet) is brought into view once its row is drawn.
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!selected || shown.current === selected.tripId) return;
    shown.current = selected.tripId;
    document.querySelector(`[data-trip="${selected.tripId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [selected]);

  const title = historyTitle(data ? data.date : params?.date ?? null);
  return (
    <div className="lg:-mt-[7px]">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <h1 className="text-xl leading-7 font-bold">{title}</h1>
        {data && data.publishedDates.length > 0 && (
          <div role="group" aria-label="Latest sent plans" className="inline-flex max-w-full overflow-x-auto rounded-full border bg-card">
            {data.publishedDates.map((date) => (
              <button
                key={date}
                type="button"
                aria-pressed={date === data.date}
                onClick={() => setParams({ date, trip: null })}
                className={cn(
                  'h-[27px] px-3.5 text-xs leading-none font-semibold whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset',
                  date === data.date ? 'rounded-full bg-secondary text-secondary-foreground' : 'text-foreground hover:bg-muted',
                )}
              >
                {shortDay(date)}
              </button>
            ))}
          </div>
        )}
        <DateInput label="Pick a date" value={params?.date ?? data?.date ?? ''} onChange={(date) => setParams({ date, trip: null })} />
        <div className="flex w-full flex-wrap items-center gap-2.5 lg:ml-auto lg:w-auto">
          <Choices label="Trips shown" value={filters.attention} options={FILTERS} onChange={(attention) => setFilters((held) => ({ ...held, attention }))} />
          <SelectPill label="Brand" value={filters.brand} options={BRANDS} onChange={(brand) => setFilters((held) => ({ ...held, brand }))} />
        </div>
      </header>

      <div className="mt-2.5 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {data?.counts ? <Figures items={summaryOf(data)} /> : params !== null && state === 'loading' && <FiguresSkeleton />}
          {params !== null && <ReadLine query={read} online={online} />}
        </div>
        {data?.counts && <StageLine data={data} />}
      </div>

      <div className={`${LAYOUT} mt-4`}>
        <section aria-label="Trips" className="min-w-0 space-y-2.5">
          {gone && (
            <p role="status" className="flex flex-wrap items-center gap-3 rounded-[10px] bg-muted px-3 py-2.5 text-xs leading-4 font-semibold">
              {TRIP_NOT_ON_PLAN}
              <button type="button" className="underline underline-offset-2" onClick={() => setParams({ trip: null })}>Dismiss</button>
            </p>
          )}
          {params === null ? <Note>{NOT_A_DATE}</Note>
            : !data ? (state === 'failed' ? <LoadFailed title={HISTORY_FAILED} query={read} online={online} /> : <TableSkeleton label="Loading the sent plan" cards={[4, 2]} />)
              : data.date === null ? <Note>{NO_SENT_PLANS_YET}</Note>
                : data.publication === null ? <Note>{NO_SENT_PLAN_ON}</Note>
                  : filters.attention === 'deferred' ? <ScrollBox label="Deferred orders"><DeferralList deferrals={deferrals} total={data.deferrals.length} /></ScrollBox>
                    : data.trips.length === 0 ? <Note>{NO_TRIPS_SENT}</Note>
                      : shownTrips.length === 0 ? <Note action={<ClearFilters onClick={() => setFilters(NO_TRIP_FILTERS)} />}>{NO_TRIP_MATCH}</Note>
                        : (
                          <>
                            {filtered && (
                              <p role="status" className="flex items-center gap-3 px-1 text-[11px] leading-[14px] text-muted-foreground">
                                {showingTrips(shownTrips.length, data.trips.length)}
                                <ClearFilters onClick={() => setFilters(NO_TRIP_FILTERS)} />
                              </p>
                            )}
                            <ScrollBox label="Trips and their timelines">
                              <HistoryTrips read={data} trips={shownTrips} axis={axis} selectedId={selected?.tripId ?? null} onToggle={toggle} />
                            </ScrollBox>
                          </>
                        )}
        </section>
        <aside aria-label="Trip detail, goods not delivered and shop confirmations" className="min-w-0 space-y-4">
          {selected && data ? <HistoryDetail key={selected.tripId} trip={selected} brand={filters.brand} viewer={viewer} onClose={() => toggle(selected.tripId)} />
            : data?.trips.length ? <Note className="max-lg:hidden">{PICK_TRIP}</Note> : null}
          {data?.publication && (
            <>
              <NotDelivered trips={data.trips} onOpen={toggle} />
              <Confirmations read={data} onOpen={toggle} />
              {filters.attention !== 'deferred' && <DeferredCard deferrals={data.deferrals} onShowAll={() => setFilters((held) => ({ ...held, attention: 'deferred' }))} />}
            </>
          )}
          {params !== null && state === 'loading' && <RailSkeleton />}
        </aside>
      </div>
    </div>
  );
}

function StageLine({ data }: { data: LookupHistory }) {
  const { figures, unrecorded } = stagesOf(data);
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
      <Figures items={figures} />
      {unrecorded && <p className="text-[11px] leading-[14px] text-muted-foreground">{unrecorded}</p>}
    </div>
  );
}

function ClearFilters({ onClick }: { onClick: () => void }) {
  return <Button variant="outline" className={plainButton('h-7 rounded-full px-3 text-[11px]')} onClick={onClick}>Clear filters</Button>;
}

// The whole publication's own counts, never the filtered rows (rule 6): trips, stops, orders, stops delivered of all
// stops with the partial ones, late, short, return instructed, deferred orders and shop confirmations.
function summaryOf(data: LookupHistory): Figure[] {
  const c = data.counts!;
  return [
    { value: whole(c.trips), label: c.trips === 1 ? 'trip' : 'trips' },
    { value: `${whole(c.delivered)} / ${whole(c.stops)}`, label: `stops delivered${c.partial ? ` · ${whole(c.partial)} partial` : ''}` },
    { value: whole(c.orders), label: c.orders === 1 ? 'order on trips' : 'orders on trips' },
    { value: whole(c.late), label: 'late', tone: c.late > 0 ? 'warn' : undefined },
    { value: whole(c.short), label: 'short', tone: c.short > 0 ? 'bad' : undefined },
    { value: whole(c.returned), label: 'return instructed', tone: c.returned > 0 ? 'bad' : undefined },
    { value: whole(c.deferred), label: 'deferred', tone: c.deferred > 0 ? 'warn' : undefined },
    { value: whole(c.confirmations), label: c.confirmations === 1 ? 'shop confirmation' : 'shop confirmations' },
    { value: whole(c.receivedOrders), label: 'received orders' },
  ];
}

// The publication's units at each stage that is recorded, and in one line the stages not recorded yet with how many of
// their lines are (rule 6): a stage never becomes a zero it did not record.
function stagesOf(data: LookupHistory) {
  const s = data.counts!.stages;
  const stages: [string, typeof s.loaded][] = [
    ['loaded', s.loaded], ['handed over', s.handedOver], ['received', s.received], ['short from the depot', s.depotShort],
    ['refused', s.refused], ['short on receipts', s.receiptShort], ['not delivered', s.notDelivered],
  ];
  const figures: Figure[] = [
    { value: whole(s.ordered), label: 'ordered' },
    ...stages.flatMap(([label, measure]) => (measure.units === null ? [] : [{ value: whole(measure.units), label }])),
  ];
  return { figures, unrecorded: unrecordedWords(stages) };
}

