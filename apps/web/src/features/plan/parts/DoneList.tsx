import { useContext, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Brand, DraftTrip, TripTimes } from '@wayfinder/contracts';
import { cn } from '@/lib/utils';
import { editable, type BoardScreen } from '../board';
import { keyOf, planOf, sameTrip, tripOf, type TripKey } from '../draft';
import { countOf, figure, hhmm, whole } from '../words';
import { brandLabel, BRANDS } from './demand';
import { removeTripChange } from './changes';
import { DepotRow } from './DepotRow';
import { BoardChange, BoardUndo, useLanding } from './dragging';
import { ICON } from './icons';
import type { BoardIndex } from './lookup';
import { toneOf } from './look';
import { RowMenu } from './OrderLists';
import { ColumnHead, Figure } from './ui';

// The right column (Edit plan, planned trips): every trip but the open one, a card each with its truck named by
// its driver, its brand and district, its stops and times and figures, opening to its stops. Its title opens the trip.
export function DoneList({ screen, index, openKey, onOpen }: { screen: BoardScreen; index: BoardIndex; openKey: TripKey | null; onOpen: (key: TripKey) => void }) {
  const { draft } = screen;
  const brandOf = (trip: DraftTrip) => brandLabel(BRANDS.filter((brand) => trip.stops.some((stop) => index.shop(stop.outletId)?.brand === brand)));
  const rank = (trip: DraftTrip) => {
    const brand = brandOf(trip);
    return brand.startsWith('Mixed') ? BRANDS.length : BRANDS.indexOf(brand as Brand);
  };
  const trips = draft.trips
    .filter((trip) => keyOf(trip) !== openKey)
    .sort((a, b) => rank(a) - rank(b) || a.vehicleId.localeCompare(b.vehicleId) || a.tripNo - b.tripNo);

  return (
    <div className="flex flex-col px-3.5 pt-3.5 pb-3.5">
      <ColumnHead icon={ICON.done} title={trips.length > 0 ? `Planned trips · ${countOf(trips.length, 'trip')}` : 'Planned trips · 0'} />
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
  const driver = index.driver(trip.driverId);
  const name = index.crew(trip);
  const districts = [...new Set(trip.stops.flatMap((stop) => index.shop(stop.outletId)?.district ?? []))];
  const brands = BRANDS.filter((brand) => trip.stops.some((stop) => index.shop(stop.outletId)?.brand === brand));
  const where = [brandLabel(brands), districts.join(', ')].filter(Boolean).join(' · ');
  const state = !driver ? 'No driver' : problems.some((problem) => problem.level === 'block') ? 'Needs attention' : inStep ? 'Ready' : 'Checking';
  const title = [name, !driver && 'no driver', where].filter(Boolean).join(' · ');
  // An order or a stop dropped on the card joins this trip at the end, and the drop's Undo line shows here (spec 023).
  const { setNodeRef: landingRef, look: landingLook } = useLanding(`card:${key}`, { kind: 'card', tripKey: key }, `the card of ${index.called(trip)}`);
  const change = useContext(BoardChange);
  const undoStep = useContext(BoardUndo);
  const undo = screen.undo?.tripKey === key ? screen.undo : null;

  return (
    <li ref={landingRef} className={cn('border-t py-2.5', landingLook)}>
      <div className="flex items-start gap-2">
        <button type="button" onClick={() => onOpen(key)} className="mr-auto min-w-0 rounded-sm text-left text-xs leading-[17px] font-semibold outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
          <span className="block">{name}{!driver && <> · <span className="text-warn-ink">no driver</span></>}{where && ' ·'}</span>
          {where && <span className="block">{where}</span>}
        </button>
        {/* "Remove trip" off the card, as one step (spec 027). */}
        {change && editable(screen.board) && (
          <RowMenu label={title} items={[{ label: 'Remove trip', onClick: () => { const removed = removeTripChange(screen.draft, trip, index); change(removed.plan, removed.said); } }]} />
        )}
        {/* One chevron for both states, turned while the card is open. */}
        <button type="button" aria-expanded={open} aria-label={open ? `Hide the stops of ${title}` : `Show the stops of ${title}`} onClick={() => setOpen(!open)} className="group -mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
          <ChevronDown aria-hidden="true" className="size-3.5 transition-transform group-aria-expanded:rotate-180" />
        </button>
      </div>
      <p className={cn('mt-1 text-xs font-semibold', state === 'Ready' ? 'text-good' : state === 'No driver' || state === 'Needs attention' ? 'text-warn-ink' : 'text-muted-foreground')}>{state}</p>
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
      {undo && undoStep && (
        <div role="status" className="mt-2 flex items-center gap-2 rounded-[10px] bg-good-tint px-2.5 py-1.5">
          <p className="flex-1 text-[11px] leading-[14px] font-semibold text-good">{undo.line}</p>
          <button type="button" className="text-[11px] leading-[14px] font-semibold underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50" onClick={undoStep}>Undo</button>
        </div>
      )}
      {open && <CardStops trip={trip} times={times} depot={screen.board.depot} index={index} />}
    </li>
  );
}

// An opened card's stops, between the depot the trip leaves and the depot it comes back to (spec 022). The depot's
// rows need the checker's times, so a trip with none shows its stops alone.
export function CardStops({ trip, times, depot, index }: { trip: DraftTrip; times: TripTimes | null; depot: string; index: BoardIndex }) {
  return (
    <div className="mt-2 space-y-1.5">
      {times && <DepotRow small end="start" depot={depot} at={times.leaveAt} />}
      <ol className="space-y-1.5">
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
      {times && <DepotRow small end="end" depot={depot} at={times.backAt} />}
    </div>
  );
}
