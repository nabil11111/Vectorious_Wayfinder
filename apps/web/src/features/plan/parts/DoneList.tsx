import { useState } from 'react';
import type { Brand, DraftTrip } from '@wayfinder/contracts';
import { cn } from '@/lib/utils';
import type { BoardScreen } from '../board';
import { keyOf, planOf, sameTrip, tripOf, type TripKey } from '../draft';
import { countOf, figure, hhmm, whole } from '../words';
import { ICON } from './icons';
import type { BoardIndex } from './lookup';
import { toneOf } from './look';
import { ColumnHead, Figure } from './ui';

const BRANDS: Brand[] = ['Fresh', 'Style', 'Tech'];

// The right column (Edit plan, "Done · N trips"): every trip but the open one, a card each with its vehicle,
// driver, brand and district, its stops and times and figures, opening to its stops. Its title opens the trip.
export function DoneList({ screen, index, openKey, onOpen }: { screen: BoardScreen; index: BoardIndex; openKey: TripKey | null; onOpen: (key: TripKey) => void }) {
  const { draft } = screen;
  const brandOf = (trip: DraftTrip) => (trip.stops[0] ? index.shop(trip.stops[0].outletId)?.brand : undefined);
  const rank = (trip: DraftTrip) => {
    const brand = brandOf(trip);
    return brand ? BRANDS.indexOf(brand) : BRANDS.length;
  };
  const trips = draft.trips
    .filter((trip) => keyOf(trip) !== openKey)
    .sort((a, b) => rank(a) - rank(b) || a.vehicleId.localeCompare(b.vehicleId) || a.tripNo - b.tripNo);

  return (
    <div className="flex flex-col px-3.5 pt-3.5 pb-3.5">
      <ColumnHead icon={ICON.done} title={trips.length > 0 ? `Done · ${countOf(trips.length, 'trip')}` : 'Done · 0 trips'} />
      {trips.length === 0
        ? <p className="mt-3 text-xs text-muted-foreground">Nothing yet</p>
        : <ul className="mt-3">{trips.map((trip) => <DoneCard key={keyOf(trip)} screen={screen} index={index} trip={trip} onOpen={onOpen} />)}</ul>}
    </div>
  );
}

function DoneCard({ screen, index, trip, onOpen }: { screen: BoardScreen; index: BoardIndex; trip: DraftTrip; onOpen: (key: TripKey) => void }) {
  const [open, setOpen] = useState(false);
  const key = keyOf(trip);
  const inStep = sameTrip(trip, tripOf(planOf(screen.board), key));
  const times = inStep ? index.trip(trip.vehicleId, trip.tripNo)?.times ?? null : null;
  const figures = index.figures(trip.vehicleId, trip.tripNo);
  const problems = inStep ? index.problems(trip.vehicleId, trip.tripNo) : [];
  const has = (code: string) => problems.some((problem) => problem.code === code);
  const vehicle = index.vehicle(trip.vehicleId);
  const driver = index.driver(trip.driverId);
  const shop = trip.stops[0] ? index.shop(trip.stops[0].outletId) : null;
  const title = [trip.tripNo === 2 ? `${trip.vehicleId} trip 2` : trip.vehicleId, driver?.name, shop?.brand, shop?.district, vehicle?.type === 'van' && 'van'].filter(Boolean).join(' · ');

  return (
    <li className="border-t py-2.5">
      <div className="flex items-start gap-2">
        <button type="button" onClick={() => onOpen(key)} className="min-w-0 flex-1 rounded-sm text-left text-xs leading-[15px] font-semibold outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
          {title}
        </button>
        <button type="button" aria-expanded={open} aria-label={open ? `Hide the stops of ${title}` : `Show the stops of ${title}`} onClick={() => setOpen(!open)} className="-mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-sm font-bold text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
          {open ? '⌃' : '⌄'}
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-[14px] text-muted-foreground">
        {countOf(trip.stops.length, 'stop')}{times ? ` · ${hhmm(times.leaveAt)} to ${hhmm(times.backAt)}` : ''}
      </p>
      {figures && (
        <div className={cn('mt-1.5 flex flex-wrap gap-1.5', !inStep && 'opacity-60')}>
          <Figure small label="time" value={`${figure(figures.timePct)}%`} tone={toneOf(figures.timePct, false, has('over_time_budget'))} />
          <Figure small label="kg" value={`${figure(figures.kgPct)}%`} tone={toneOf(figures.kgPct, has('over_weight'))} />
          <Figure small label="m³" value={`${figure(figures.m3Pct)}%`} tone={toneOf(figures.m3Pct, has('over_volume'))} />
        </div>
      )}
      {open && (
        <ol className="mt-2 space-y-1.5">
          {trip.stops.map((stop, i) => {
            const at = index.shop(stop.outletId);
            const time = times?.stops[i];
            return (
              <li key={stop.outletId} className="flex items-center gap-2 text-[11px] leading-[14px]">
                <span className={cn('flex size-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold', time?.late ? 'bg-bad text-white' : 'bg-muted')}>{whole(i + 1)}</span>
                <span className={cn('w-9 shrink-0 font-mono', time?.late && 'text-bad')}>{time ? hhmm(time.arriveAt) : '--:--'}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{at?.name ?? stop.outletId}</span>
                {at && <span className="shrink-0 text-[10px] text-muted-foreground">{hhmm(time?.windowOpen ?? at.windowOpen)} to {hhmm(time?.windowClose ?? at.windowClose)}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </li>
  );
}
