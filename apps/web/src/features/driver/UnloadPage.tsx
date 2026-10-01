import { useNavigate } from 'react-router';
import type { DriverStop, DriverTrip } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { Counter } from './parts/Counter';
import { GOODS, ICON } from './parts/icons';
import { TopArea } from './parts/TopArea';
import { ActionBar, BIG, Card, PLAIN, StopHead } from './parts/ui';
import { useTally } from './tally';
import type { DriverView } from './view';
import { brandOf, entranceOf, lineName, loaderShortLine, overLoadedLine, stopOfLine, wholeCountsLine, type Figures } from './words';

// Driver · Unload at /driver once the driver has arrived (spec 013, rule 4): a card per line, chilled before dry, with
// the driver's own count against what was loaded, and the loader's shortfall under a line that went short. "Done
// unloading" works once every line is counted to what was loaded; anything less goes through "Something's wrong". A
// box that holds more than was loaded, a minus or a fraction keeps it as typed, with a line under it that says so, and
// "Done unloading" waits until it is a count (Q-25).
export function UnloadPage({ view, trip, figures, stop }: { view: DriverView; trip: DriverTrip; figures: Figures; stop: DriverStop }) {
  const navigate = useNavigate();
  const tally = useTally(stop.id);
  const counts = figures.byStop[trip.stops.indexOf(stop)]!;
  const brand = brandOf(trip, stop);
  const loadedOf = (i: number) => counts.byLine[i]!.loaded;
  const wrong = stop.lines.map((line, i) => tally.wrongOf(line.lineId, loadedOf(i)));
  const counted = stop.lines.every((line, i) => tally.countOf(line.lineId) === loadedOf(i)) && wrong.every((reading) => reading === null);

  return (
    <div>
      <TopArea waitingRecords={view.waitingRecords} />
      <StopHead stopLine={stopOfLine(stop, figures)} stop={stop} brand={brand} sub={entranceOf(stop)} />
      <ul className="mt-[17px] space-y-2.5">
        {stop.lines.map((line, i) => {
          const each = counts.byLine[i]!;
          const name = lineName(line, brand);
          const reading = wrong[i];
          const fix = reading ? `fix-${line.lineId}` : undefined;
          return (
            <li key={line.lineId}>
              <Card className="px-4 py-4">
                <div className="flex items-center gap-3">
                  <img src={GOODS[line.temp]} alt="" className="size-9 shrink-0 object-contain" />
                  <span className="min-w-0 flex-1 truncate font-heading text-lg leading-6 font-bold">{name}</span>
                  <Counter
                    label={name}
                    value={tally.countOf(line.lineId)}
                    text={tally.textOf(line.lineId)}
                    max={each.loaded}
                    of={each.ordered}
                    invalid={fix}
                    onStep={(n) => tally.step(line.lineId, n)}
                    onType={(text) => tally.type(line.lineId, text, each.loaded)}
                    onLeave={() => tally.leave(line.lineId, each.loaded)}
                  />
                </div>
                {reading && (
                  <p id={fix} role="alert" className="mt-2.5 text-[13px] leading-4 font-semibold text-bad">
                    {reading.kind === 'over' ? overLoadedLine(reading.count, each.loaded, brand) : wholeCountsLine(each.loaded)}
                  </p>
                )}
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
        <Button className={BIG()} disabled={!counted} focusableWhenDisabled onClick={() => navigate(`/driver/proof?stop=${stop.id}`)}>Done unloading</Button>
        <Button variant="outline" className={PLAIN()} onClick={() => navigate(`/driver/wrong?stop=${stop.id}`)}>{"Something's wrong"}</Button>
      </ActionBar>
    </div>
  );
}
