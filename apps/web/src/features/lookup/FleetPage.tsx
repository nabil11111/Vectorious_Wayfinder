import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LookupFleet } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { useMe } from '@/features/auth/api';
import { useOnline } from '@/features/live/operations';
import { Chip } from '@/features/live/parts/ui';
import { plainButton } from '@/features/plan/parts/look';
import { useAppClock } from '@/lib/clock';
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
export function FleetPage() {
  const { data: me } = useMe();
  const clock = useAppClock();
  const online = useOnline();
  useFollowLookupMessages();
  const options = fleetOptions(me);
  const query = useQuery(options);
  const clockDay = clock.state?.day ?? null;
  useFollowGeneration(clockDay, query.data?.demoDay ?? null);
  // What the page draws: the read of the reset the clock shows. A read from another reset is not drawn or chosen from.
  const data = currentRead(query.data, clockDay);
  const read = { ...query, data };
  // Today follows the calendar past midnight.
  useFollowDefault(options.queryKey, data?.readAt, true, 'calendar');
  const [filters, setFilters] = useState<VehicleFilters>(NO_VEHICLE_FILTERS);
  const scope = scopeOf({ userId: me?.id ?? null, depotId: me?.depotId ?? null, params: {}, generation: data?.demoDay ?? null, clockGeneration: clockDay });
  const [selectedId, select] = useSelection(scope, data?.vehicles.map((vehicle) => vehicle.id) ?? []);
  const groups = data ? shownVehicles(data.vehicles, filters) : [];
  const selected = data?.vehicles.find((vehicle) => vehicle.id === selectedId) ?? null;
  const filtered = filters.state !== 'all' || filters.type !== 'all';
  const state = readState(read, online);

  const open = (vehicleId: string) => {
    select(vehicleId);
    if (narrow()) window.requestAnimationFrame(() => document.getElementById('vehicle-detail')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };
  const close = () => {
    const was = selectedId;
    select(null);
    if (was) window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-vehicle="${was}"]`)?.focus());
  };
  const clearFilters = () => setFilters((held) => ({ ...held, state: 'all', type: 'all' }));

  return (
    <div className="lg:-mt-[7px]">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <h1 className="text-xl leading-7 font-bold">{data ? fleetTitle(data.depot.name) : 'Fleet'}</h1>
        {data && <Chip tone="plain" className="h-[27px] px-3.5 text-xs">Today · {shortDay(data.today)}</Chip>}
        <Choices label="Vehicles shown" value={filters.state} options={STATES} onChange={(state) => setFilters((held) => ({ ...held, state }))} />
        <div className="flex w-full flex-wrap items-center gap-2.5 lg:ml-auto lg:w-auto">
          <Choices label="Vehicle types" value={filters.type} options={TYPES} onChange={(type) => setFilters((held) => ({ ...held, type }))} />
          <SelectPill label="Sort vehicles" value={filters.sort} options={SORTS} onChange={(sort) => setFilters((held) => ({ ...held, sort }))} />
        </div>
      </header>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-6 gap-y-2">
        {data ? <Figures items={summaryOf(data)} /> : state === 'loading' && <FiguresSkeleton />}
        <ReadLine query={read} online={online} />
      </div>

      <div className={`${LAYOUT} mt-4`}>
        <section aria-label="Vehicles" className="min-w-0 space-y-2.5">
          {!data ? (state === 'failed' ? <LoadFailed title={FLEET_FAILED} query={read} online={online} /> : <TableSkeleton label="Loading the fleet" cards={[4, 6, 3]} />)
            : data.vehicles.length === 0 ? <Note>{NO_VEHICLES}</Note>
              : groups.length === 0 ? <Note action={<ClearFilters onClick={clearFilters} />}>{NO_VEHICLE_MATCH}</Note>
                : (
                  <>
                    {filtered && (
                      <p role="status" className="flex items-center gap-3 px-1 text-[11px] leading-[14px] text-muted-foreground">
                        Showing {whole(groups.reduce((n, group) => n + group.vehicles.length, 0))} of {whole(data.vehicles.length)}
                        <ClearFilters onClick={clearFilters} />
                      </p>
                    )}
                    <ScrollBox label="Vehicles table">
                      <VehicleTable groups={groups} today={data.today} depot={data.depot.name} selectedId={selectedId} onSelect={open} />
                    </ScrollBox>
                  </>
                )}
        </section>
        <aside aria-label="Vehicle detail" className="min-w-0">
          {selected && data ? <VehicleDetail key={selected.id} vehicle={selected} today={data.today} depot={data.depot.name} onClose={close} />
            : data ? data.vehicles.length > 0 && <Note className="max-lg:hidden">{PICK_VEHICLE}</Note>
              : state === 'loading' && <RailSkeleton />}
        </aside>
      </div>
    </div>
  );
}

function ClearFilters({ onClick }: { onClick: () => void }) {
  return <Button variant="outline" className={plainButton('h-7 rounded-full px-3 text-[11px]')} onClick={onClick}>Clear filters</Button>;
}

// The header's counts, the active fleet only (rule 9): reefers count fridge vans too and vans count both kinds, so the
// two overlap and are never added. Fuel is the active fleet's ledger against its quota.
function summaryOf(data: LookupFleet): Figure[] {
  const s = data.summary;
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
