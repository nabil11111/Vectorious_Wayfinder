import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { Dialog } from '@base-ui/react/dialog';
import { LookupHistoryQuery, type Brand, type HistoryCounts, type HistoryTrip, type LookupHistory, type Me } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { useMe } from '@/features/auth/api';
import { DepotHeading } from '@/features/dispatcher/parts/DepotHeading';
import { partId, useScope } from '@/features/dispatcher/scope';
import { useOnline } from '@/features/live/operations';
import { deliveredExtras } from '@/features/live/words';
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
  HISTORY_FAILED, NOT_A_DATE, NO_SENT_PLANS_YET, NO_SENT_PLAN_ON, NO_TRIPS_SENT, NO_TRIP_MATCH, TRIP_NOT_ON_PLAN, historyTitle, openDay,
  sentLater, shortDay, showingTrips, unrecordedWords, whole,
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
  const all = reads.length > 0 && loaded.length === reads.length ? loaded : null;
  const [filters, setFilters] = useState<TripFilters>(NO_TRIP_FILTERS);
  const returnFocus = useRef<HTMLElement | null>(null);

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
  const gone = selections.length > 0 && selections.every((selection) => selection.gone);
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
  const toggle = (tripId: string, _anchor: string, trigger?: HTMLElement) => {
    if (selected?.tripId === tripId) {
      setParams({ trip: null });
      return;
    }
    returnFocus.current = trigger ?? (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
    setParams({ trip: tripId });
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
      selected={selections[i]!.trip} filters={filters} setFilters={setFilters} onToggle={toggle} onOpenDate={(date) => setParams({ date, trip: null })}
      clockDay={clockDay} online={online} notice={both ? null : goneLine} className={className} returnFocus={returnFocus} />
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
        <div className="space-y-3">
          {counts ? <SummaryCards items={summaryOf(counts)} /> : loading && <FiguresSkeleton />}
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
function HistoryPart({ depot, both, me, params, query, queryKey, data, selected, filters, setFilters, onToggle, onOpenDate, clockDay, online, notice, className, returnFocus }: {
  depot: string; both: boolean; me: Me | null | undefined; params: HistoryParams | null; query: UseQueryResult<LookupHistory>; queryKey: readonly unknown[];
  data: LookupHistory | undefined; selected: HistoryTrip | null; filters: TripFilters; setFilters: (change: (held: TripFilters) => TripFilters) => void;
  onToggle: (tripId: string, anchor: string, trigger?: HTMLElement) => void; onOpenDate: (date: string) => void; clockDay: number | null; online: boolean; notice: ReactNode;
  className: string;
  returnFocus: React.RefObject<HTMLElement | null>;
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
  const toggle = (tripId: string, trigger?: HTMLElement) => onToggle(tripId, anchor, trigger);
  const lastSelected = useRef<string | null>(null);
  useEffect(() => { if (selected) lastSelected.current = selected.tripId; }, [selected]);
  const clear = () => setFilters(() => NO_TRIP_FILTERS);
  // With no plan sent for today or earlier, every plan the depot sent is for a later day, and the chips list them, so the
  // page names the soonest it lists and opens it (Q-14).
  const next = data && data.date === null ? [...data.publishedDates].sort()[0] ?? null : null;

  return (
    <div className={`${LAYOUT} ${className}`}>
      <section aria-label="Trips" className="min-w-0 space-y-2.5">
        {notice}
        {params === null ? <Note>{NOT_A_DATE}</Note>
          : !data ? (state === 'failed' ? <LoadFailed title={HISTORY_FAILED} query={read} online={online} /> : <TableSkeleton label="Loading the sent plan" cards={[4, 2]} />)
            : data.date === null ? (next
              ? <Note action={<Button variant="outline" className={plainButton('h-8 px-4 text-xs')} onClick={() => onOpenDate(next)}>{openDay(next)}</Button>}>{sentLater(next)}</Note>
              : <Note>{NO_SENT_PLANS_YET}</Note>)
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
        <Dialog.Root open={Boolean(selected && data)} onOpenChange={(open) => { if (!open && selected) toggle(selected.tripId); }}>
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 z-50 bg-foreground/30" />
            <Dialog.Popup aria-label={selected ? `Trip detail · ${selected.vehicleId} trip ${selected.tripNo}` : 'Trip detail'}
              finalFocus={() => returnFocus.current?.isConnected ? returnFocus.current : lastSelected.current ? document.querySelector<HTMLElement>(`[data-trip="${lastSelected.current}"]`) : false}
              className="fixed inset-0 z-50 overflow-y-auto bg-card outline-none sm:inset-x-6 sm:inset-y-6 sm:mx-auto sm:max-w-4xl sm:rounded-[14px] sm:shadow-xl">
              {selected && data && <HistoryDetail key={selected.tripId} trip={selected} brand={filters.brand} viewer={viewer} anchor={anchor} onClose={() => toggle(selected.tripId)} />}
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
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

function SummaryCards({ items }: { items: Figure[] }) {
  return <dl aria-label="Sent plan summary" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
    {items.map((item) => <div key={item.label} className="rounded-[12px] border bg-card px-4 py-3 shadow-sm">
      <dd className={cn('font-mono text-xl leading-7 font-bold', item.tone === 'warn' && 'text-warn-ink', item.tone === 'bad' && 'text-bad')}>{item.value}</dd>
      <dt className="mt-1 text-xs leading-4 text-muted-foreground">{item.label}</dt>
    </div>)}
  </dl>;
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
// stops with the partial, none delivered and closed ones as Live day says them (Q-45), late, short, return instructed, deferred orders and shop confirmations. On both depots
// together they are the two sent plans' added up.
function summaryOf(c: HistoryCounts): Figure[] {
  return [
    { value: whole(c.trips), label: c.trips === 1 ? 'trip' : 'trips' },
    { value: `${whole(c.delivered)} / ${whole(c.stops)}`,
      label: ['stops delivered', ...deliveredExtras({ partialStops: c.partial, noGoodsStops: c.noGoods, closedStops: c.closed })].join(' · ') },
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
// their lines are still missing (rule 6): a stage never becomes a zero it did not record. Loaded and handed over, the
// day's "how much went out", show what their recorded lines add up to so far until every line is recorded (Q-44).
const SO_FAR = new Set(['loaded', 'handed over']);
function stagesOf(counts: HistoryCounts) {
  const s = counts.stages;
  // What did not fit on the truck is said apart from the depot's shortage, when some did not (L-21).
  const stages: [string, typeof s.loaded][] = [
    ['loaded', s.loaded], ['handed over', s.handedOver], ['received', s.received], ['short from the depot', s.depotShort],
    ...(s.wontFit.units ? [['didn\'t fit on the truck', s.wontFit] as [string, typeof s.loaded]] : []),
    ['refused', s.refused], ['short on receipts', s.receiptShort], ['not delivered', s.notDelivered],
  ];
  const figures: Figure[] = [
    { value: whole(s.ordered), label: 'ordered' },
    ...stages.flatMap(([label, measure]) => (measure.units !== null ? [{ value: whole(measure.units), label }]
      : SO_FAR.has(label) ? [{ value: whole(measure.soFar), label: `${label} so far` }] : [])),
  ];
  return { figures, unrecorded: unrecordedWords(stages) };
}
