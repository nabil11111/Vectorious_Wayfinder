import { useId } from 'react';
import type { LookupFuel, LookupVehicle } from '@wayfinder/contracts';
import { CARD, Chip } from '@/features/live/parts/ui';
import { cn } from '@/lib/utils';
import type { VehicleGroup } from '../filters';
import {
  ARCHIVED, GROUP_WORDS, NO_QUOTA, NO_TRIP_TODAY, WEEK_UNAVAILABLE, fuelLeftWords, fuelTone, limitsWords, tripState, weekWords, whole, type FuelTone,
} from '../words';
import { vehiclePicture } from './icons';

// The Fleet table (Dispatcher · Fleet 112:79095, Today only): reefer trucks, dry trucks and vans in their own cards,
// each vehicle's limits, the driver and state of its recorded trip, the fuel left of its weekly quota and its sent trips
// this week. Every figure is the read's; "No trip recorded today" never claims where a vehicle is.

const COLUMNS = 'grid-cols-[24px_72px_168px_96px_minmax(170px,1fr)_168px_minmax(150px,0.8fr)]';
const HEADS = ['Vehicle', 'Limits', 'Driver', 'Today', 'Fuel left this week', 'This week'];

const FILL = { bad: 'bg-bad', warn: 'bg-warn', good: 'bg-good' } as const;
const INK = { bad: 'text-bad', warn: 'text-warn-ink', good: 'text-foreground' } as const;

export function VehicleTable({ groups, today, depot, selectedId, onSelect }: {
  groups: VehicleGroup[]; today: string; depot: string; selectedId: string | null; onSelect: (vehicleId: string) => void;
}) {
  // Its own ids, as Fleet on both depots together draws a table per depot (spec 021).
  const id = useId();
  return (
    <div className="min-w-[960px] space-y-2.5">
      <div aria-hidden="true" className={cn('grid gap-x-2.5 px-6 text-[10px] leading-3 font-semibold text-muted-foreground', COLUMNS)}>
        <span />
        {HEADS.map((head) => <span key={head}>{head}</span>)}
      </div>
      {groups.map(({ group, vehicles }) => (
        <section key={group} aria-labelledby={`${id}-${group}`} className={cn(CARD, 'px-4 pt-3 pb-2')}>
          <div className="flex items-center gap-2.5">
            <img src={vehiclePicture(vehicles[0]!)} alt="" className="size-[26px] object-contain" />
            <h2 id={`${id}-${group}`} className="text-[15px] leading-5 font-bold">{GROUP_WORDS[group]}</h2>
            <span className="text-[11px] leading-[14px] text-muted-foreground">{whole(vehicles.length)} at {depot}</span>
          </div>
          <div role="table" aria-label={GROUP_WORDS[group]} className="mt-1.5">
            <div role="rowgroup" className="sr-only">
              <div role="row">
                <span role="columnheader">Vehicle picture</span>
                {HEADS.map((head) => <span key={head} role="columnheader">{head}</span>)}
              </div>
            </div>
            <div role="rowgroup">
              {vehicles.map((vehicle) => <VehicleRow key={vehicle.id} vehicle={vehicle} today={today} selected={vehicle.id === selectedId} onSelect={onSelect} />)}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

function VehicleRow({ vehicle, today, selected, onSelect }: { vehicle: LookupVehicle; today: string; selected: boolean; onSelect: (vehicleId: string) => void }) {
  const fuel = vehicle.fuel;
  const tone = fuelTone(fuel);
  const archived = vehicle.archivedAt !== null;
  const tint = tone === 'bad' && !archived ? 'bg-bad-tint' : selected ? 'bg-selected' : null;
  return (
    <div
      role="row"
      onClick={() => onSelect(vehicle.id)}
      className={cn(
        'grid min-h-[36px] cursor-pointer items-center gap-x-2.5 rounded-[10px] px-2 py-1 text-[11px] leading-[14px] hover:bg-muted/70',
        COLUMNS, tint, selected && 'ring-[1.5px] ring-foreground ring-inset', archived && 'text-muted-foreground',
      )}
    >
      <span role="cell"><img src={vehiclePicture(vehicle)} alt="" className={cn('size-5 object-contain', archived && 'opacity-60')} /></span>
      <span role="cell" className="min-w-0">
        <button
          type="button"
          data-vehicle={vehicle.id}
          aria-expanded={selected}
          aria-controls={selected ? 'vehicle-detail' : undefined}
          onClick={(event) => { event.stopPropagation(); onSelect(vehicle.id); }}
          className="rounded-md font-mono text-xs leading-4 font-bold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {vehicle.id}
        </button>
        {archived && <Chip tone="plain" className="mt-0.5">{ARCHIVED}</Chip>}
      </span>
      <span role="cell" className="truncate">{limitsWords(vehicle)}</span>
      <span role="cell" className="truncate text-xs leading-4 font-semibold">{vehicle.selectedTrip?.driver?.name ?? <span className="font-normal text-muted-foreground">–</span>}</span>
      <span role="cell" className="min-w-0">
        <span className={cn('block truncate', !vehicle.selectedTrip && 'text-muted-foreground')}>
          {vehicle.selectedTrip ? tripState(vehicle.selectedTrip, today) : NO_TRIP_TODAY}
        </span>
        {vehicle.offReason !== null && <Chip tone="warn" className="mt-0.5 max-w-full truncate">Workshop · {vehicle.offReason}</Chip>}
      </span>
      <span role="cell"><FuelLeft fuel={fuel} tone={tone} /></span>
      <span role="cell" className="truncate text-muted-foreground">{fuel ? weekWords(fuel) : WEEK_UNAVAILABLE}</span>
    </div>
  );
}

// The bar of the quota left and the litres left, or what stands in for them. Only the drawn width is held between 0 and
// the whole bar; an over-quota figure is said as it is.
function FuelLeft({ fuel, tone }: { fuel: LookupFuel | null; tone: FuelTone }) {
  if (!fuel) return <span className="text-muted-foreground">{WEEK_UNAVAILABLE}</span>;
  const width = fuel.remainingPct === null ? 0 : Math.min(100, Math.max(0, fuel.remainingPct));
  return (
    <span className="flex items-center gap-2.5">
      {fuel.remainingPct === null ? <span className="w-[110px] text-muted-foreground">{NO_QUOTA}</span> : (
        <span role="meter" aria-label="Fuel left this week" aria-valuemin={0} aria-valuemax={100} aria-valuenow={width} className="h-1.5 w-[110px] shrink-0 overflow-hidden rounded-full bg-border">
          {width > 0 && <span className={cn('block h-full rounded-full', FILL[tone ?? 'good'])} style={{ width: `${width}%` }} />}
        </span>
      )}
      <span className={cn('font-mono text-xs leading-4 font-bold whitespace-nowrap', tone ? INK[tone] : 'text-foreground')}>{fuelLeftWords(fuel)}</span>
    </span>
  );
}
