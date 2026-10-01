import { useState } from 'react';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import type { LookupFleet, Me } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { useMe } from '@/features/auth/api';
import { DepotHeading } from '@/features/dispatcher/parts/DepotHeading';
import { partId, useScope } from '@/features/dispatcher/scope';
import { useOnline } from '@/features/live/operations';
import { Chip } from '@/features/live/parts/ui';
import { agreed } from '@/features/live/sums';
import { plainButton } from '@/features/plan/parts/look';
import { useAppClock } from '@/lib/clock';
import { newestDemoDay, sumFleet } from './both';
import { NO_VEHICLE_FILTERS, shownVehicles, type VehicleFilters, type VehicleSort, type VehicleState, type VehicleType } from './filters';
import { VehicleTable } from './parts/VehicleTable';
import { Choices, Figures, FiguresSkeleton, LAYOUT, LoadFailed, Note, RailSkeleton, ReadLine, ScrollBox, SelectPill, TableSkeleton, type Figure } from './parts/ui';
import { currentRead, fleetOptions, readState, scopeOf, useFollowDefault, useFollowGeneration, useFollowLookupMessages, useSelection } from './queries';
import { VehicleDetail } from './VehicleDetail';
import {
  FLEET_FAILED, NO_QUOTA, NO_VEHICLES, NO_VEHICLE_MATCH, PICK_VEHICLE, WEEK_UNAVAILABLE, fleetTitle, ledgerWords, shortDay, whole,
} from './words';

const STATES: { value: VehicleState; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'out', label: 'Out now' }, { value: 'not_out', label: 'Not recorded out' }, { value: 'workshop', label: 'Workshop today' },
];
const TYPES: { value: VehicleType; label: string }[] = [
  { value: 'all', label: 'All types' }, { value: 'reefer', label: 'Reefer' }, { value: 'dry', label: 'Dry' }, { value: 'van', label: 'Van' },
];
const SORTS: { value: VehicleSort; label: string }[] = [{ value: 'fuel', label: 'Fuel left, lowest first' }, { value: 'id', label: 'Vehicle id' }];

const narrow = () => window.matchMedia('(max-width: 1023.98px)').matches;

// Fleet at /dispatcher/fleet (spec 017, Dispatcher · Fleet 112:79095): the depot's vehicles today, on the app's
// calendar date. Next 6 weeks is not built (D-87): no toggle, forecast, hire or booking. Out now is a recorded out
// trip and nothing else; fuel is litres recorded and committed this week. Every header count is the active fleet's.
// On both depots together (spec 021) each depot's fleet is a read of its own, shown as Peliyagoda's part and then
// Kandy's under their names; the filters are both parts', and the header's counts add the two fleets up.
export function FleetPage() {
  const { data: me } = useMe();
  const { depots, both } = useScope();
  const clock = useAppClock();
  const online = useOnline();
  useFollowLookupMessages();
  const options = depots.map((depot) => fleetOptions(me, depot));
  const queries = useQueries({ queries: options });
  const clockDay = clock.state?.day ?? null;
  useFollowGeneration(clockDay, newestDemoDay(queries));
  // What the page draws: each depot's read of the reset the clock shows. A read from another reset is not drawn or
  // chosen from.
  const reads = queries.map((query) => currentRead(query.data, clockDay));
  const loaded = reads.filter((read): read is LookupFleet => read !== undefined);
  const all = loaded.length === reads.length ? loaded : null;
  const today = agreed(loaded.map((read) => read.today));
  const [filters, setFilters] = useState<VehicleFilters>(NO_VEHICLE_FILTERS);
  const loading = queries.some((query, i) => readState({ ...query, data: reads[i] }, online) === 'loading');
  const clearFilters = () => setFilters((held) => ({ ...held, state: 'all', type: 'all' }));
  const part = (i: number, className: string) => (
    <FleetPart depot={depots[i]!} both={both} me={me} query={queries[i]!} queryKey={options[i]!.queryKey} data={reads[i]} filters={filters}
      onClearFilters={clearFilters} clockDay={clockDay} online={online} className={className} />
  );

  return (
    <div className="lg:-mt-[7px]">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <h1 className="text-xl leading-7 font-bold">{loaded.length ? fleetTitle(both ? 'Both depots' : loaded[0]!.depot.name) : 'Fleet'}</h1>
        {today && <Chip tone="plain" className="h-[27px] px-3.5 text-xs">Today · {shortDay(today)}</Chip>}
        <Choices label="Vehicles shown" value={filters.state} options={STATES} onChange={(state) => setFilters((held) => ({ ...held, state }))} />
        <div className="flex w-full flex-wrap items-center gap-2.5 lg:ml-auto lg:w-auto">
          <Choices label="Vehicle types" value={filters.type} options={TYPES} onChange={(type) => setFilters((held) => ({ ...held, type }))} />
          <SelectPill label="Sort vehicles" value={filters.sort} options={SORTS} onChange={(sort) => setFilters((held) => ({ ...held, sort }))} />
        </div>
      </header>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-6 gap-y-2">
        {all ? <Figures items={summaryOf(sumFleet(all.map((read) => read.summary)))} /> : loading && <FiguresSkeleton />}
        {!both && <ReadLine query={{ ...queries[0]!, data: reads[0] }} online={online} />}
      </div>

      {both ? depots.map((depot, i) => (
        <section key={depot} aria-labelledby={partId(depot)} className="mt-6">
          <DepotHeading depot={depot}><ReadLine query={{ ...queries[i]!, data: reads[i] }} online={online} /></DepotHeading>
          {part(i, 'mt-2.5')}
        </section>
      )) : part(0, 'mt-4')}
    </div>
  );
}

// One depot's fleet: its vehicles by group or what stands in for them, and beside them the selected vehicle.
function FleetPart({ depot, both, me, query, queryKey, data, filters, onClearFilters, clockDay, online, className }: {
  depot: string; both: boolean; me: Me | null | undefined; query: UseQueryResult<LookupFleet>; queryKey: readonly unknown[]; data: LookupFleet | undefined;
  filters: VehicleFilters; onClearFilters: () => void; clockDay: number | null; online: boolean; className: string;
}) {
  // Today follows the calendar past midnight.
  useFollowDefault(queryKey, data?.readAt, true, 'calendar');
  const scope = scopeOf({ userId: me?.id ?? null, depotId: depot, params: {}, generation: data?.demoDay ?? null, clockGeneration: clockDay });
  const [selectedId, select] = useSelection(scope, data?.vehicles.map((vehicle) => vehicle.id) ?? []);
  const groups = data ? shownVehicles(data.vehicles, filters) : [];
  const selected = data?.vehicles.find((vehicle) => vehicle.id === selectedId) ?? null;
  const filtered = filters.state !== 'all' || filters.type !== 'all';
  const read = { ...query, data };
  const state = readState(read, online);
  // Where the narrow page scrolls to: one detail per depot on both depots together.
  const anchor = both ? `vehicle-detail-${depot}` : 'vehicle-detail';
  const open = (vehicleId: string) => {
    select(vehicleId);
    if (narrow()) window.requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };
  const close = () => {
    const was = selectedId;
    select(null);
    if (was) window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-vehicle="${was}"]`)?.focus());
  };

  return (
    <div className={`${LAYOUT} ${className}`}>
      <section aria-label="Vehicles" className="min-w-0 space-y-2.5">
        {!data ? (state === 'failed' ? <LoadFailed title={FLEET_FAILED} query={read} online={online} /> : <TableSkeleton label="Loading the fleet" cards={[4, 6, 3]} />)
          : data.vehicles.length === 0 ? <Note>{NO_VEHICLES}</Note>
            : groups.length === 0 ? <Note action={<ClearFilters onClick={onClearFilters} />}>{NO_VEHICLE_MATCH}</Note>
              : (
                <>
                  {filtered && (
                    <p role="status" className="flex items-center gap-3 px-1 text-[11px] leading-[14px] text-muted-foreground">
                      Showing {whole(groups.reduce((n, group) => n + group.vehicles.length, 0))} of {whole(data.vehicles.length)}
                      <ClearFilters onClick={onClearFilters} />
                    </p>
                  )}
                  <ScrollBox label="Vehicles table">
                    <VehicleTable groups={groups} today={data.today} depot={data.depot.name} selectedId={selectedId} onSelect={open} />
                  </ScrollBox>
                </>
              )}
      </section>
      <aside aria-label="Vehicle detail" className="min-w-0">
        {selected && data ? <VehicleDetail key={selected.id} vehicle={selected} today={data.today} depot={data.depot.name} anchor={anchor} onClose={close} />
          : data ? data.vehicles.length > 0 && <Note className="max-lg:hidden">{PICK_VEHICLE}</Note>
            : state === 'loading' && <RailSkeleton />}
      </aside>
    </div>
  );
}

function ClearFilters({ onClick }: { onClick: () => void }) {
  return <Button variant="outline" className={plainButton('h-7 rounded-full px-3 text-[11px]')} onClick={onClick}>Clear filters</Button>;
}

// The header's counts, the active fleet only (rule 9): reefers count fridge vans too and vans count both kinds, so the
// two overlap and are never added. Fuel is the active fleet's ledger against its quota. On both depots together each
// is the two fleets' added up.
function summaryOf(s: LookupFleet['summary']): Figure[] {
  const fuel: Figure = !s.fuel ? { value: '–', label: WEEK_UNAVAILABLE }
    : s.fuel.recordedCommittedPct === null ? { value: '–', label: NO_QUOTA }
      : { value: `${whole(s.fuel.recordedCommittedPct)}%`, label: `of this week's fuel recorded and committed · ${ledgerWords(s.fuel)}` };
  return [
    { value: whole(s.active), label: s.active === 1 ? 'vehicle' : 'vehicles' },
    { value: whole(s.reefers), label: s.reefers === 1 ? 'reefer' : 'reefers' },
    { value: whole(s.vans), label: s.vans === 1 ? 'van' : 'vans' },
    { value: whole(s.recordedOut), label: 'out now' },
    { value: whole(s.notRecordedOut), label: 'not recorded out' },
    { value: whole(s.activeOffToday), label: 'in the workshop today', tone: s.activeOffToday > 0 ? 'warn' : undefined },
    { value: whole(s.activeWithoutOffToday), label: 'without a day off' },
    fuel,
  ];
}
