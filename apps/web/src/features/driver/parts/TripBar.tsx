import type { DriverStop, DriverTrip } from '@wayfinder/contracts';
import { cn } from '@/lib/utils';

// Where a dot sits along the bar: the dots run from 10 px inside one end of the line to 10 px inside the other.
const along = (share: number) => `calc(10px + (100% - 20px) * ${share})`;

// The trip bar on Next stop (spec 013): a dot per stop in plan order, filled when done and ringed for the one the
// driver goes to now, on a line that is green to halfway past the last stop done. Under it, when the truck left and
// when it is due back.
export function TripBar({ trip, current, left, back }: { trip: DriverTrip; current: DriverStop; left: string; back: string }) {
  const stops = [...trip.stops].sort((a, b) => a.seq - b.seq);
  const gaps = Math.max(1, stops.length - 1);
  const lastDone = stops.reduce((last, stop, i) => (stop.outcome !== null ? i : last), -1);
  const filled = lastDone < 0 ? null : lastDone >= stops.length - 1 ? 1 : (lastDone + 0.5) / gaps;
  return (
    <div>
      <div className="relative h-[18px]" role="img" aria-label={`Stop ${current.seq} of ${stops.length}`}>
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-border" />
        {filled !== null && <div className="absolute top-1/2 left-0 h-2 -translate-y-1/2 rounded-full bg-good" style={{ width: filled === 1 ? '100%' : along(filled) }} />}
        {stops.map((stop, i) => {
          const now = stop.id === current.id;
          return (
            <span
              key={stop.id}
              className={cn(
                'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full',
                now ? 'size-[18px] border-[2.5px] border-foreground bg-card' : stop.outcome !== null ? 'size-3 bg-good' : 'size-3 border-[1.5px] border-muted-foreground/60 bg-card',
              )}
              style={{ left: along(stops.length > 1 ? i / gaps : 0) }}
            />
          );
        })}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="text-[13px] leading-4">{left}</span>
        <span className="font-mono text-[13px] leading-4 text-muted-foreground">{back}</span>
      </div>
    </div>
  );
}
