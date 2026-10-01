import { useState } from 'react';
import type { DriverDay, DriverTrip } from '@wayfinder/contracts';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { newWriteId } from '@/features/loader/loading';
import { truckIcon } from '@/features/loader/parts/icons';
import { useAppClock } from '@/lib/clock';
import { TopArea } from './parts/TopArea';
import { ActionBar, BIG, Card, PLAIN, Problem } from './parts/ui';
import { readAgain, retrySync, useSave, useSync } from './sender';
import type { DriverView } from './view';
import {
  aboutTrip, brandOf, COULD_NOT_READ, leavingLine, loadedLine, noTripLine, NOT_SAVED, notReadyChip, NOTHING_SENT_UNTIL_READ, placeLine, startWhenLoaded,
  stopsCount, stopUnitsLine, tripDayLine, windowLine, type Figures,
} from './words';

// Driver · Today's trip at /driver (spec 013): the trip and its stops in plan order, and "Start trip" once the loader
// has marked the truck ready. Until then the chip says "Not loaded yet" or "Being loaded" and the button waits.
export function TodaysTrip({ view, trip, figures }: { view: DriverView; trip: DriverTrip; figures: Figures }) {
  const { at } = useAppClock();
  const { save, saving, failed } = useSave();
  const ready = trip.status === 'ready';

  // "Start trip" makes the ready trip out, at the app clock's time, naming the trip's revision on screen (rule 3).
  const start = () => {
    if (at === null) return;
    void save({ kind: 'start', writeId: newWriteId(), tripId: trip.tripId, at: new Date(at).toISOString(), revision: trip.revision }, aboutTrip(trip, 'start'));
  };

  return (
    <div>
      <TopArea waitingRecords={view.waitingRecords} />
      {failed && <Problem>{NOT_SAVED}</Problem>}
      <p className="text-xs leading-4 font-semibold text-muted-foreground">{tripDayLine(trip)}</p>

      <Card className="mt-2.5 px-3.5 pt-[15px] pb-[13px]">
        <div className="flex items-start gap-2.5">
          <img src={truckIcon(trip)} alt="" className="mt-0.5 h-[34px] w-10 shrink-0 object-contain" />
          <div className="min-w-0">
            <h1 className="text-lg leading-[22px] font-bold">{trip.vehicleId}</h1>
            <p className="mt-[5px] text-[13px] leading-4 font-semibold">{leavingLine(trip, at)}</p>
          </div>
        </div>
        <p className="mt-2.5 text-[11px] leading-[14px] text-muted-foreground">{placeLine(trip)}</p>
        {ready ? (
          <p className="mt-[7px] inline-flex max-w-full items-center gap-1 rounded-full bg-good-tint px-2.5 py-1 text-[11px] leading-[15px] font-semibold text-good">
            {/* The design draws a plain tick here, so it is the outline set's. */}
            <Check className="size-3 shrink-0 stroke-[3]" aria-hidden="true" />
            {loadedLine(trip, figures)}
          </p>
        ) : (
          <p className="mt-[7px] inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-[11px] leading-[15px] font-semibold text-muted-foreground">{notReadyChip(trip)}</p>
        )}
      </Card>

      <h2 className="mt-3 text-[17px] leading-[22px] font-bold">{stopsCount(trip.stops.length)}</h2>
      <Card className="mt-[11px] p-3.5">
        <ol>
          {trip.stops.map((stop, i) => (
            <li key={stop.id} className="flex h-[53px] items-center gap-2.5 border-t">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] leading-none font-bold tabular-nums">{stop.seq}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm leading-[18px] font-semibold">{stop.shopName}</span>
                <span className="mt-0.5 block font-mono text-[11px] leading-[14px] text-muted-foreground">{windowLine(stop)}</span>
              </span>
              <span className="shrink-0 font-mono text-xs leading-4 text-muted-foreground">{stopUnitsLine(brandOf(trip, stop), stop, figures.byStop[i]!)}</span>
            </li>
          ))}
        </ol>
      </Card>

      <ActionBar>
        {!ready && <p className="text-center text-[13px] leading-4 text-muted-foreground">{startWhenLoaded(trip)}</p>}
        <Button className={BIG()} disabled={!ready || saving || at === null} focusableWhenDisabled onClick={start}>
          {saving ? 'Saving…' : 'Start trip'}
        </Button>
      </ActionBar>
    </div>
  );
}

// No trip (no frame): before the plan is sent, a sent plan with no trip for this driver, and no day left.
export function NoTrip({ view, day }: { view: DriverView; day: DriverDay }) {
  return (
    <div>
      <TopArea waitingRecords={view.waitingRecords} />
      <Card className="px-5 py-5">
        <p className="text-[15px] leading-5 font-semibold">{noTripLine(day)}</p>
      </Card>
    </div>
  );
}

// Could not load (no frame), only when nothing is kept on the phone.
export function CouldNotLoad({ view }: { view: DriverView }) {
  const { failure } = useSync();
  return (
    <div>
      <TopArea waitingRecords={view.waitingRecords} />
      <Card role="alert" className="px-5 py-5">
        <h1 className="font-sans text-[15px] leading-5 font-semibold">Could not load your trip.</h1>
        <p className="mt-1.5 text-[13px] leading-4 text-muted-foreground">{failure ?? 'Could not reach Wayfinder. Check the connection and try again.'}</p>
        <Button variant="outline" className={PLAIN('mt-4')} onClick={retrySync}>Try again</Button>
      </Card>
    </div>
  );
}

// Could not read (no frame): the phone's database would not give back what it kept for this account. Nothing is sent
// or saved until it does, so a record kept earlier never goes after a newer one. The loop tries again by itself too.
export function CouldNotRead() {
  const [reading, setReading] = useState(false);
  const again = async () => {
    setReading(true);
    await readAgain();
    setReading(false);
  };
  return (
    <div>
      <TopArea waitingRecords={0} />
      <Card role="alert" className="px-5 py-5">
        <h1 className="font-sans text-[15px] leading-5 font-semibold">{COULD_NOT_READ}</h1>
        <p className="mt-1.5 text-[13px] leading-4 text-muted-foreground">{NOTHING_SENT_UNTIL_READ}</p>
        <Button variant="outline" className={PLAIN('mt-4')} disabled={reading} onClick={() => { void again(); }}>{reading ? 'Reading…' : 'Try again'}</Button>
      </Card>
    </div>
  );
}

// Loading · skeleton: grey blocks for the day line, the card and two rows, on the first load with nothing kept.
export function TripSkeleton() {
  return (
    <div role="status" aria-label="Loading your trip">
      <Skeleton className="h-3 w-[100px] rounded-full" />
      <Card className="mt-2.5 px-3.5 py-4">
        <div className="flex items-center gap-2.5">
          <Skeleton soft className="h-[34px] w-10 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5 rounded-full" />
            <Skeleton className="h-3 w-3/5 rounded-full" />
          </div>
        </div>
        <Skeleton className="mt-4 h-2.5 w-1/2 rounded-full" />
        <Skeleton soft className="mt-3 h-[23px] w-4/5 rounded-full" />
      </Card>
      <Skeleton className="mt-4 h-4 w-16 rounded-full" />
      <Card className="mt-3 p-3.5">
        {[0, 1].map((i) => (
          <div key={i} className="flex h-[53px] items-center gap-2.5 border-t">
            <Skeleton soft className="size-6 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-2/5 rounded-full" />
              <Skeleton soft className="h-2.5 w-1/4 rounded-full" />
            </div>
            <Skeleton soft className="h-3 w-16 rounded-full" />
          </div>
        ))}
      </Card>
    </div>
  );
}
