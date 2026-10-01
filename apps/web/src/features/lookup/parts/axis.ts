import type { HistoryTrip } from '@wayfinder/contracts';
import { inDepot } from '@/lib/clock';

// The static timeline History draws a sent plan's trips on (spec 017, History row): from the even depot hour before the
// earliest kept or recorded time to the even hour after the latest, at least four hours wide, marked every two hours.
// Placing a time along it is the one sum done here; nothing moves and nothing is replayed.

const HOUR = 3_600_000;
export interface Axis { start: number; end: number; ticks: number[] }

// An instant floored to an even hour at the depot. Depot offsets are whole minutes, so the minute is the device's.
function evenHourBefore(at: number) {
  const [hour, minute] = inDepot(at).time.split(':').map(Number) as [number, number];
  return at - (at % 60_000) - minute * 60_000 - (hour % 2) * HOUR;
}

export function axisOf(trips: readonly HistoryTrip[]): Axis | null {
  const times = trips.flatMap((trip) => [
    trip.schedule.leavesAt, trip.schedule.backAt, trip.leftAt, trip.backAt,
    ...trip.stops.flatMap((stop) => [stop.plannedArrival, stop.arrivedAt, stop.doneAt]),
  ]).filter((moment): moment is string => moment !== null).map(Date.parse);
  if (times.length === 0) return null;
  const first = Math.min(...times), last = Math.max(...times);
  const start = evenHourBefore(first);
  let end = evenHourBefore(last);
  if (end < last) end += 2 * HOUR;
  if (end - start < 4 * HOUR) end = start + 4 * HOUR;
  const ticks: number[] = [];
  for (let tick = start; tick <= end; tick += 2 * HOUR) ticks.push(tick);
  return { start, end, ticks };
}

// Where an instant sits along the axis, from 0 to 100.
export const placeOn = (axis: Axis, moment: string | number) => {
  const at = typeof moment === 'string' ? Date.parse(moment) : moment;
  return Math.min(100, Math.max(0, ((at - axis.start) / (axis.end - axis.start)) * 100));
};
