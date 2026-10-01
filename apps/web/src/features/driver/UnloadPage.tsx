import { useNavigate } from 'react-router';
import type { DriverStop, DriverTrip } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { Counter } from './parts/Counter';
import { GOODS, ICON } from './parts/icons';
import { TopArea } from './parts/TopArea';
import { ActionBar, BIG, Card, PLAIN, StopHead } from './parts/ui';
import { useTally } from './tally';
import type { DriverView } from './view';
import { brandOf, entranceOf, lineName, loaderShortLine, stopOfLine, type Figures } from './words';

// Driver · Unload at /driver once the driver has arrived (spec 013, rule 4): a card per line, chilled before dry, with
// the driver's own count against what was loaded, and the loader's shortfall under a line that went short. "Done
// unloading" works once every line is counted to what was loaded; anything less goes through "Something's wrong".
// The frame draws "Done unloading" orange whatever the count, so it stays orange while it waits for the counts.
const ALWAYS_ORANGE = 'data-disabled:bg-primary data-disabled:text-primary-foreground disabled:bg-primary disabled:text-primary-foreground';
export function UnloadPage({ view, trip, figures, stop }: { view: DriverView; trip: DriverTrip; figures: Figures; stop: DriverStop }) {
  const navigate = useNavigate();
  const tally = useTally(stop.id);
  const counts = figures.byStop[trip.stops.indexOf(stop)]!;
  const brand = brandOf(trip, stop);
  const counted = stop.lines.every((line, i) => tally.countOf(line.lineId) === counts.byLine[i]!.loaded);

  return (
    <div>
      <TopArea waitingRecords={view.waitingRecords} />
      <StopHead stopLine={stopOfLine(stop, figures)} stop={stop} brand={brand} sub={entranceOf(stop)} />
      <ul className="mt-[17px] space-y-2.5">
        {stop.lines.map((line, i) => {
          const each = counts.byLine[i]!;
          const name = lineName(line, brand);
          return (
            <li key={line.lineId}>
              <Card className="px-4 py-4">
                <div className="flex items-center gap-3">
                  <img src={GOODS[line.temp]} alt="" className="size-9 shrink-0 object-contain" />
                  <span className="min-w-0 flex-1 truncate font-heading text-lg leading-6 font-bold">{name}</span>
                  <Counter label={name} value={tally.countOf(line.lineId)} max={each.loaded} of={each.ordered} onChange={(n) => tally.set(line.lineId, n)} />
                </div>
                {each.short > 0 && (
                  <p className="mt-2.5 flex items-center gap-2 text-xs leading-4 text-muted-foreground">
                    <img src={ICON.shortfall} alt="" className="size-4 shrink-0 object-contain" />
                    {loaderShortLine(line, each)}
                  </p>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
      <ActionBar>
        <Button className={BIG(ALWAYS_ORANGE)} disabled={!counted} focusableWhenDisabled onClick={() => navigate(`/driver/proof?stop=${stop.id}`)}>Done unloading</Button>
        <Button variant="outline" className={PLAIN()} onClick={() => navigate(`/driver/wrong?stop=${stop.id}`)}>{"Something's wrong"}</Button>
      </ActionBar>
    </div>
  );
}
