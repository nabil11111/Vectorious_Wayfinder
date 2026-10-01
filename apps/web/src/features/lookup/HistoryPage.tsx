import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { LookupHistoryQuery, type Brand, type HistoryCounts, type HistoryTrip, type LookupHistory, type Me } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { useMe } from '@/features/auth/api';
import { DepotHeading } from '@/features/dispatcher/parts/DepotHeading';
import { partId, useScope } from '@/features/dispatcher/scope';
import { useOnline } from '@/features/live/operations';
import { plainButton } from '@/features/plan/parts/look';
import { useAppClock } from '@/lib/clock';
import { cn } from '@/lib/utils';
import type { HistoryParams } from './api';
import { newestDemoDay, sumHistory } from './both';
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
// selects a trip among the read's own; only the date goes to the API. No replay, speed or signature (D-82). On both
// depots together (spec 021) each depot's sent plan of the page's one date is a read of its own, shown as Peliyagoda's
// part and then Kandy's under their names; ?trip= is found in whichever part holds it, and the header's figures add
// the two plans up.
export function HistoryPage() {
  const { data: me } = useMe();
  const { depots, both } = useScope();
  const clock = useAppClock();
  const online = useOnline();
  const [search, setSearch] = useSearchParams();
  const params = paramsOf(search);
  useFollowLookupMessages();
  const options = depots.map((depot) => historyOptions(me, depot, params ?? {}));
  const queries = useQueries({ queries: options.map((each) => ({ ...each, enabled: each.enabled && params !== null })) });
  const clockDay = clock.state?.day ?? null;
  useFollowGeneration(clockDay, newestDemoDay(queries));
  // What the page draws: each depot's read of this date and of the reset the clock shows. A date that is not a calendar
  // date draws nothing a cached read holds, and a read from another reset is not drawn or chosen from.
  const reads = queries.map((query) => (params === null ? undefined : currentRead(query.data, clockDay)));
  const loaded = reads.filter((read): read is LookupHistory => read !== undefined);
  const all = loaded.length === reads.length ? loaded : null;
  const [filters, setFilters] = useState<TripFilters>(NO_TRIP_FILTERS);

  // The sent-plan dates the reads are of. A depot with no sent plan yet has none.
  const dates = [...new Set(loaded.flatMap((read) => (read.date === null ? [] : [read.date])))].sort();
  const date = params?.date ?? (dates.length === 1 ? dates[0]! : null);
  // On both depots together the page shows one date: when no date was chosen and the depots' latest sent plans are of
  // different dates, it takes the latest, and the other depot shows what it sent that day.
  const latest = all && params?.date === undefined && dates.length > 1 ? dates.at(-1)! : null;
  useEffect(() => {
    if (latest) setSearch((held) => { const next = new URLSearchParams(held); next.set('date', latest); return next; }, { replace: true });
  }, [latest, setSearch]);

  // The selected trip is the address's, in whichever depot's read holds it while its records are of the reset the clock
  // shows. It is gone once every depot's read says it holds no such trip.
  const selections = reads.map((read) => historySelection(read, search.get('trip'), clockDay));
  const selected = selections.find((selection) => selection.trip !== null)?.trip ?? null;
  const gone = selections.every((selection) => selection.gone);
  const counted = all && dates.length <= 1 ? all.flatMap((read) => (read.counts ? [read.counts] : [])) : [];
  const counts = counted.length ? sumHistory(counted) : null;
  const published = [...new Set(loaded.flatMap((read) => read.publishedDates))].sort().reverse().slice(0, 3);
  const loading = params !== null && queries.some((query, i) => readState({ ...query, data: reads[i] }, online) === 'loading');

  const setParams = (change: Record<string, string | null>) => setSearch((held) => {
    const next = new URLSearchParams(held);
    for (const [name, value] of Object.entries(change)) {
      if (value === null) next.delete(name); else next.set(name, value);
    }
    return next;
  });
  const toggle = (tripId: string, anchor: string) => {
    if (selected?.tripId === tripId) {
      setParams({ trip: null });
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-trip="${tripId}"]`)?.focus());
      return;
    }
    setParams({ trip: tripId });
    if (narrow()) window.requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };

  // A trip named by a link (Orders, Fleet) is brought into view once its row is drawn.
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!selected || shown.current === selected.tripId) return;
    shown.current = selected.tripId;
    document.querySelector(`[data-trip="${selected.tripId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [selected]);

  const goneLine = gone && (
    <p role="status" className="flex flex-wrap items-center gap-3 rounded-[10px] bg-muted px-3 py-2.5 text-xs leading-4 font-semibold">
      {TRIP_NOT_ON_PLAN}
      <button type="button" className="underline underline-offset-2" onClick={() => setParams({ trip: null })}>Dismiss</button>
    </p>
  );
  const part = (i: number, className: string) => (
    <HistoryPart depot={depots[i]!} both={both} me={me} params={params} query={queries[i]!} queryKey={options[i]!.queryKey} data={reads[i]}
      selected={selections[i]!.trip} filters={filters} setFilters={setFilters} onToggle={toggle} clockDay={clockDay} online={online}
      notice={both ? null : goneLine} className={className} />
  );
  return (
    <div className="lg:-mt-[7px]">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <h1 className="text-xl leading-7 font-bold">{historyTitle(date)}</h1>
        {published.length > 0 && (
          <div role="group" aria-label="Latest sent plans" className="inline-flex max-w-full overflow-x-auto rounded-full border bg-card">
            {published.map((each) => (
              <button
                key={each}
                type="button"
                aria-pressed={each === date}
                onClick={() => setParams({ date: each, trip: null })}
                className={cn(
                  'h-[27px] px-3.5 text-xs leading-none font-semibold whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset',
                  each === date ? 'rounded-full bg-secondary text-secondary-foreground' : 'text-foreground hover:bg-muted',
                )}
              >
                {shortDay(each)}
              </button>
            ))}
          </div>
        )}
        <DateInput label="Pick a date" value={date ?? ''} onChange={(each) => setParams({ date: each, trip: null })} />
        <div className="flex w-full flex-wrap items-center gap-2.5 lg:ml-auto lg:w-auto">
          <Choices label="Trips shown" value={filters.attention} options={FILTERS} onChange={(attention) => setFilters((held) => ({ ...held, attention }))} />
          <SelectPill label="Brand" value={filters.brand} options={BRANDS} onChange={(brand) => setFilters((held) => ({ ...held, brand }))} />
        </div>
      </header>

      <div className="mt-2.5 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {counts ? <Figures items={summaryOf(counts)} /> : loading && <FiguresSkeleton />}
          {params !== null && !both && <ReadLine query={{ ...queries[0]!, data: reads[0] }} online={online} />}
        </div>
        {counts && <StageLine counts={counts} />}
      </div>

      {both ? (
        <>
          {goneLine && <div className="mt-4">{goneLine}</div>}
          {depots.map((depot, i) => (
            <section key={depot} aria-labelledby={partId(depot)} className="mt-6">
              <DepotHeading depot={depot}>{params !== null && <ReadLine query={{ ...queries[i]!, data: reads[i] }} online={online} />}</DepotHeading>
              {part(i, 'mt-2.5')}
            </section>
          ))}
        </>
      ) : part(0, 'mt-4')}
    </div>
  );
}

// One depot's sent plan: its trips on the timeline or what stands in for them, and beside them the selected trip, what
// was not delivered, the shops' confirmations and the deferrals.
function HistoryPart({ depot, both, me, params, query, queryKey, data, selected, filters, setFilters, onToggle, clockDay, online, notice, className }: {
  depot: string; both: boolean; me: Me | null | undefined; params: HistoryParams | null; query: UseQueryResult<LookupHistory>; queryKey: readonly unknown[];
  data: LookupHistory | undefined; selected: HistoryTrip | null; filters: TripFilters; setFilters: (change: (held: TripFilters) => TripFilters) => void;
  onToggle: (tripId: string, anchor: string) => void; clockDay: number | null; online: boolean; notice: ReactNode; className: string;
}) {
  // The latest sent date follows the calendar past midnight; a chosen date stays chosen.
  useFollowDefault(queryKey, data?.readAt, params?.date === undefined, 'calendar');
  // The photo belongs to the account, depot, date, selected trip and reset it was opened in.
  const viewer = usePhotoViewer(scopeOf({ userId: me?.id ?? null, depotId: depot, params: { ...params, trip: selected?.tripId ?? null }, generation: data?.demoDay ?? null, clockGeneration: clockDay }), depot);
  const shownTrips = data ? data.trips.filter((trip) => matchesTrip(trip, filters)) : [];
  const deferrals = data ? data.deferrals.filter((deferral) => filters.brand === 'all' || deferral.outlet.brand === filters.brand) : [];
  const axis = data ? axisOf(data.trips) : null;
  const filtered = filters.attention !== 'all' || filters.brand !== 'all';
  const read = { ...query, data };
  const state = readState(read, online);
  // Where the narrow page scrolls to: one detail per depot on both depots together.
  const anchor = both ? `history-detail-${depot}` : 'history-detail';
  const toggle = (tripId: string) => onToggle(tripId, anchor);
  const clear = () => setFilters(() => NO_TRIP_FILTERS);

  return (
    <div className={`${LAYOUT} ${className}`}>
      <section aria-label="Trips" className="min-w-0 space-y-2.5">
        {notice}
        {params === null ? <Note>{NOT_A_DATE}</Note>
          : !data ? (state === 'failed' ? <LoadFailed title={HISTORY_FAILED} query={read} online={online} /> : <TableSkeleton label="Loading the sent plan" cards={[4, 2]} />)
            : data.date === null ? <Note>{NO_SENT_PLANS_YET}</Note>
              : data.publication === null ? <Note>{NO_SENT_PLAN_ON}</Note>
                : filters.attention === 'deferred' ? <ScrollBox label="Deferred orders"><DeferralList deferrals={deferrals} total={data.deferrals.length} /></ScrollBox>
                  : data.trips.length === 0 ? <Note>{NO_TRIPS_SENT}</Note>
                    : shownTrips.length === 0 ? <Note action={<ClearFilters onClick={clear} />}>{NO_TRIP_MATCH}</Note>
                      : (
                        <>
                          {filtered && (
                            <p role="status" className="flex items-center gap-3 px-1 text-[11px] leading-[14px] text-muted-foreground">
                              {showingTrips(shownTrips.length, data.trips.length)}
                              <ClearFilters onClick={clear} />
                            </p>
                          )}
                          <ScrollBox label="Trips and their timelines">
                            <HistoryTrips read={data} trips={shownTrips} axis={axis} selectedId={selected?.tripId ?? null} onToggle={toggle} />
                          </ScrollBox>
                        </>
                      )}
      </section>
      <aside aria-label="Trip detail, goods not delivered and shop confirmations" className="min-w-0 space-y-4">
        {selected && data ? <HistoryDetail key={selected.tripId} trip={selected} brand={filters.brand} viewer={viewer} anchor={anchor} onClose={() => toggle(selected.tripId)} />
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
  );
}

function StageLine({ counts }: { counts: HistoryCounts }) {
  const { figures, unrecorded } = stagesOf(counts);
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
// stops with the partial ones, late, short, return instructed, deferred orders and shop confirmations. On both depots
// together they are the two sent plans' added up.
function summaryOf(c: HistoryCounts): Figure[] {
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
function stagesOf(counts: HistoryCounts) {
  const s = counts.stages;
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
