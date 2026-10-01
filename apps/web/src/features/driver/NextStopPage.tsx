import type { DriverDay, DriverStop, DriverTrip } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { newWriteId } from '@/features/loader/loading';
import { useAppClock } from '@/lib/clock';
import { cn } from '@/lib/utils';
import { ICON, shopIcon } from './parts/icons';
import { TopArea } from './parts/TopArea';
import { TopLines } from './parts/TopLine';
import { TripBar } from './parts/TripBar';
import { ActionBar, BIG, Card, Problem } from './parts/ui';
import { useSave } from './queue';
import type { DriverView } from './view';
import { aboutStop, backByLine, brandOf, isLate, leftLine, NOT_SAVED, shopLine, stopOfLine, unloadLine, whole, windowLine, type Figures } from './words';

// Driver · Next stop at /driver (spec 013): the top line or the signal's bar, the shop and its window as the biggest
// thing, what to unload, the shop's note, the trip bar and "I've arrived". The stop is the trip's next one by
// nextStop, so a stop the dispatcher sent back comes after the others (rule 4).
export function NextStopPage({ view, day, trip, figures, stop }: { view: DriverView; day: DriverDay; trip: DriverTrip; figures: Figures; stop: DriverStop }) {
  const { at } = useAppClock();
  const { save, saving, failed } = useSave();
  const counts = figures.byStop[trip.stops.indexOf(stop)]!;
  const brand = brandOf(trip, stop);
  const late = isLate(trip, stop, at);

  // "I've arrived" records the arrival at the app clock's time, naming the stop's revision on screen.
  const arrive = () => {
    if (at === null) return;
    void save({ kind: 'arrive', writeId: newWriteId(), tripId: trip.tripId, stopId: stop.id, at: new Date(at).toISOString(), revision: stop.revision }, aboutStop(stop));
  };

  return (
    <div className="flex min-h-[calc(100dvh-61px-102px)] flex-col">
      <TopArea waitingRecords={view.waitingRecords}>
        <TopLines day={day} trip={trip} figures={figures} waiting={view.waiting} waitingRecords={view.waitingRecords} noSignalBar />
      </TopArea>
      {failed && <Problem>{NOT_SAVED}</Problem>}
      <p className="text-center text-xs leading-4 font-semibold text-muted-foreground">{stopOfLine(stop, figures)}</p>

      <div className="flex flex-1 flex-col justify-center py-5">
        <h1 className="flex items-center justify-center gap-3 text-[22px] leading-7 font-bold">
          <img src={shopIcon(brand)} alt="" className="size-[30px] shrink-0 object-contain" />
          {stop.shopName}
        </h1>
        <p className="mt-2.5 text-center text-[13px] leading-4 text-muted-foreground">{shopLine(stop)}</p>
        <p className="mt-[22px] text-center font-mono text-[36px] leading-[44px] font-bold tracking-tight whitespace-nowrap">{windowLine(stop)}</p>
        <p className="mt-2 text-center text-[13px] leading-4 text-muted-foreground">
          window · <span className={cn('font-semibold', late ? 'text-bad' : 'text-good')}>{late ? 'late' : 'on time'}</span>
        </p>
        <div className="mt-[18px] flex flex-wrap items-center justify-center gap-2">
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs leading-[17px] font-semibold text-secondary-foreground">{unloadLine(brand, counts)}</span>
          {brand === 'Fresh' && counts.byTemp.chilled.loaded > 0 && (
            <span className="rounded-full bg-info-tint px-2.5 py-1 text-xs leading-[17px] font-semibold text-info">{whole(counts.byTemp.chilled.loaded)} chilled</span>
          )}
          {brand === 'Fresh' && counts.byTemp.dry.loaded > 0 && (
            <span className="rounded-full px-2.5 py-1 text-xs leading-[17px] font-semibold">{whole(counts.byTemp.dry.loaded)} dry</span>
          )}
        </div>
        {stop.note && (
          <Card className="mt-2 px-4 pt-[15px] pb-4">
            <p className="flex items-center gap-2.5 text-[11px] leading-[14px] font-semibold text-muted-foreground">
              <img src={ICON.storeManager} alt="" className="size-5 object-contain" />
              Note
            </p>
            <p className="mt-2.5 text-sm leading-[18px]">{stop.note}</p>
          </Card>
        )}
      </div>

      <TripBar trip={trip} current={stop} left={leftLine(day, trip)} back={backByLine(trip)} />
      <ActionBar>
        <Button className={BIG()} disabled={saving || at === null} focusableWhenDisabled onClick={arrive}>
          {saving ? 'Saving…' : "I've arrived"}
        </Button>
      </ActionBar>
    </div>
  );
}
