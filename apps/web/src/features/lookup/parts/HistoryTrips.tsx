import { useId } from 'react';
import type { Brand, HistoryStop, HistoryTrip, LookupHistory } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { CARD, Chip } from '@/features/live/parts/ui';
import { plainButton } from '@/features/plan/parts/look';
import { cn } from '@/lib/utils';
import { RETURN_INSTRUCTED, TRIP_STATUS_WORDS, clockTime, tripLine, tripName, whole } from '../words';
import { placeOn, type Axis } from './axis';
import { brandIcon, vehiclePicture } from './icons';

// History's trips (Dispatcher · History 112:78211): a card per brand, its districts, and one row per trip of the sent
// plan in the server's order, each on one static timeline. The kept schedule is a thin track with open marks; what was
// recorded is solid marks, labelled. There is no Play, speed or moving cursor (D-82).

const ROW = 'grid items-center gap-x-2 grid-cols-[24px_150px_200px_minmax(260px,1fr)_118px_64px]';
const LINE_CELL = 'col-start-4';
const tripAnchor = (tripId: string) => `history-trip-${tripId}`;

export function HistoryTrips({ read, trips, axis, selectedId, onToggle }: {
  read: LookupHistory; trips: HistoryTrip[]; axis: Axis | null; selectedId: string | null; onToggle: (tripId: string, trigger?: HTMLElement) => void;
}) {
  // Its own ids, as History on both depots together draws the trips per depot (spec 021).
  const id = useId();
  const shown = new Set(trips.map((trip) => trip.tripId));
  const byBrand = new Map<Brand | null, LookupHistory['groups']>();
  for (const group of read.groups) {
    if (!group.tripIds.some((id) => shown.has(id))) continue;
    byBrand.set(group.brand, [...(byBrand.get(group.brand) ?? []), group]);
  }
  return (
    <div className="min-w-[940px] space-y-2.5">
      {axis && <AxisRow axis={axis} />}
      {[...byBrand].map(([brand, groups]) => {
        const count = groups.reduce((n, group) => n + group.tripIds.filter((id) => shown.has(id)).length, 0);
        return (
          <section key={brand ?? 'mixed'} aria-labelledby={`${id}-${brand ?? 'mixed'}`} className={cn(CARD, 'px-4 pt-3 pb-2')}>
            <div className="flex items-center gap-2.5">
              <img src={brandIcon(brand)} alt="" className="size-[26px] object-contain" />
              <h2 id={`${id}-${brand ?? 'mixed'}`} className="text-[15px] leading-5 font-bold">{brand ?? 'Mixed'}</h2>
              <span className="text-[11px] leading-[14px] text-muted-foreground">{whole(count)} {count === 1 ? 'trip' : 'trips'}</span>
            </div>
            {groups.map((group) => (
              <div key={`${brand ?? 'mixed'}:${group.district}`} className="mt-2">
                <h3 className="px-2.5 font-sans text-[11px] leading-[14px] font-semibold">{group.district}</h3>
                <ol className="mt-1">
                  {group.tripIds.filter((id) => shown.has(id)).map((id) => read.trips.find((trip) => trip.tripId === id)!).map((trip) => (
                    <TripRow key={trip.tripId} trip={trip} axis={axis} selected={trip.tripId === selectedId} onToggle={onToggle} />
                  ))}
                </ol>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

// The hours above the rows, with the marks' legend, aligned with every row's timeline.
function AxisRow({ axis }: { axis: Axis }) {
  return (
    <div aria-hidden="true" className={cn(ROW, 'h-[22px] px-6')}>
      <div className="col-span-3 flex items-center gap-3 text-[10px] leading-3 text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full border-[1.5px] border-good bg-card" />Planned</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-good" />Recorded</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-warn" />After window</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full border-2 border-bad bg-card" />Refused or closed</span>
      </div>
      <div className={cn(LINE_CELL, 'relative h-full')}>
        {axis.ticks.map((tick) => (
          <span key={tick} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-[10px] leading-3 whitespace-nowrap text-muted-foreground" style={{ left: `${placeOn(axis, tick)}%` }}>
            {clockTime(new Date(tick).toISOString())}
          </span>
        ))}
      </div>
    </div>
  );
}

function TripRow({ trip, axis, selected, onToggle }: { trip: HistoryTrip; axis: Axis | null; selected: boolean; onToggle: (tripId: string, trigger?: HTMLElement) => void }) {
  const tint = trip.flags.returned || trip.flags.short ? 'bg-bad-tint' : trip.flags.late ? 'bg-warn-tint' : selected ? 'bg-selected' : null;
  return (
    <li id={tripAnchor(trip.tripId)} className={cn(ROW, 'min-h-[52px] scroll-mt-28 rounded-[10px] px-2 py-2 transition-colors hover:bg-muted focus-within:bg-muted focus-within:ring-2 focus-within:ring-ring/50', tint, selected && 'ring-[1.5px] ring-foreground ring-inset')}>
      <img src={vehiclePicture({ type: trip.vehicleType, temp: trip.vehicleTemp })} alt="" className="size-5 object-contain" />
      <button
        type="button"
        data-trip={trip.tripId}
        aria-expanded={selected}
        aria-haspopup="dialog"
        onClick={(event) => onToggle(trip.tripId, event.currentTarget)}
        className="min-w-0 truncate rounded-md text-left text-xs leading-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="font-mono font-bold">{trip.tripNo > 1 ? `${trip.vehicleId} trip ${trip.tripNo}` : trip.vehicleId}</span>
        {trip.driver && <span className="ml-1.5 font-semibold">{trip.driver.name}</span>}
      </button>
      <p className="min-w-0 truncate text-[11px] leading-[14px] text-muted-foreground">
        {tripLine(trip)}{trip.archived ? ' · archived vehicle' : ''}
      </p>
      {axis ? <TripLine trip={trip} axis={axis} className={LINE_CELL} /> : <span className={LINE_CELL} />}
      <TripFlags trip={trip} />
      <div className="flex justify-end">
        <Button variant="outline" aria-haspopup="dialog" aria-label={`${selected ? 'Close' : 'Open'} ${tripName(trip)}`} className={plainButton('h-8 w-[60px] rounded-full text-xs')} onClick={(event) => onToggle(trip.tripId, event.currentTarget)}>
          {selected ? 'Close' : 'Open'}
        </Button>
      </div>
    </li>
  );
}

// The trip's flags in words: return instructed and short in red, late in yellow, else on time, or its recorded state
// while no arrival is recorded. Quiet, beside the detail's own status chip, it says only the flags and on time.
export function TripFlags({ trip, quiet = false }: { trip: Pick<HistoryTrip, 'flags' | 'status'>; quiet?: boolean }) {
  const chips = [
    trip.flags.returned && <Chip key="returned" tone="bad">{RETURN_INSTRUCTED}</Chip>,
    trip.flags.short && <Chip key="short" tone="bad">Short</Chip>,
    trip.flags.late === true && <Chip key="late" tone="warn">Late</Chip>,
  ].filter(Boolean);
  if (chips.length > 0) return <span className="flex flex-wrap gap-1">{chips}</span>;
  if (quiet && trip.flags.late !== false) return null;
  return <span className="text-[11px] leading-[14px] text-muted-foreground">{trip.flags.late === false ? 'on time' : TRIP_STATUS_WORDS[trip.status].toLowerCase()}</span>;
}

const MARK = 'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full';

function TripLine({ trip, axis, className }: { trip: HistoryTrip; axis: Axis; className?: string }) {
  const at = (moment: string) => ({ left: `${placeOn(axis, moment)}%` });
  const recorded = [trip.leftAt, ...trip.stops.flatMap((stop) => [stop.arrivedAt, stop.doneAt]), trip.backAt].filter((m): m is string => m !== null);
  const last = recorded.length ? recorded.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a)) : null;
  const from = placeOn(axis, trip.schedule.leavesAt), to = placeOn(axis, trip.schedule.backAt);
  return (
    <span className={cn('relative block h-[18px]', className)}>
      <span aria-hidden="true">
        <span className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-good-tint" style={{ left: `${from}%`, width: `${Math.max(0, to - from)}%` }} />
        <span title={`Planned departure ${clockTime(trip.schedule.leavesAt)}`} className={cn(MARK, 'size-3 border-2 border-foreground bg-card')} style={at(trip.schedule.leavesAt)} />
        {trip.stops.map((stop) => <span key={stop.id} title={`${stop.outlet.name} planned ${clockTime(stop.plannedArrival)}`} className={cn(MARK, 'size-2.5 border-[1.5px] border-good bg-card')} style={at(stop.plannedArrival)} />)}
        {trip.leftAt && last && (
          <span className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-good" style={{ left: `${placeOn(axis, trip.leftAt)}%`, width: `${Math.max(0.6, placeOn(axis, last) - placeOn(axis, trip.leftAt))}%` }} />
        )}
        {trip.leftAt && <span title={`Left ${clockTime(trip.leftAt)}`} className={cn(MARK, 'size-2 bg-good')} style={at(trip.leftAt)} />}
        {trip.stops.map((stop) => <Recorded key={stop.id} stop={stop} at={at} />)}
        {trip.backAt && <span title={`Back ${clockTime(trip.backAt)}`} className={cn(MARK, 'size-2.5 bg-foreground')} style={at(trip.backAt)} />}
      </span>
      <span className="absolute top-full mt-0.5 font-mono text-[10px] leading-3 text-muted-foreground" style={{ left: `${Math.min(80, from)}%` }}>Plan leave {clockTime(trip.schedule.leavesAt)}</span>
      <span className="sr-only">{describe(trip)}</span>
    </span>
  );
}

function Recorded({ stop, at }: { stop: HistoryStop; at: (moment: string) => { left: string } }) {
  const problem = stop.outcome === 'refused' || stop.outcome === 'closed';
  return (
    <>
      {stop.arrivedAt && <span title={`${stop.outlet.name} arrived ${clockTime(stop.arrivedAt)}`} className={cn(MARK, 'size-2', stop.flags.late ? 'bg-warn' : 'bg-good')} style={at(stop.arrivedAt)} />}
      {stop.doneAt && (
        <span title={`${stop.outlet.name} ${stop.outcome ?? 'done'} ${clockTime(stop.doneAt)}`} className={cn(MARK, 'z-[1]', problem ? 'size-3.5 border-2 border-bad bg-card' : 'size-2.5 bg-good')} style={at(stop.doneAt)} />
      )}
    </>
  );
}

// The marks in words for a screen reader: the kept schedule, then what was recorded.
function describe(trip: HistoryTrip) {
  const planned = [`leaves ${clockTime(trip.schedule.leavesAt)}`, ...trip.stops.map((stop) => `${stop.outlet.name} ${clockTime(stop.plannedArrival)}`), `back ${clockTime(trip.schedule.backAt)}`];
  const recorded = [
    trip.leftAt && `left ${clockTime(trip.leftAt)}`,
    ...trip.stops.flatMap((stop) => [stop.arrivedAt && `${stop.outlet.name} arrived ${clockTime(stop.arrivedAt)}${stop.flags.late ? ' after its window' : ''}`, stop.doneAt && `${stop.outcome ?? 'done'} ${clockTime(stop.doneAt)}`]),
    trip.backAt && `back ${clockTime(trip.backAt)}`,
  ].filter(Boolean);
  return `Planned: ${planned.join(', ')}. ${recorded.length ? `Recorded: ${recorded.join(', ')}.` : 'Nothing recorded yet.'}`;
}
