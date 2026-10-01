import type { LoadingStop, LoadingTruck } from '@wayfinder/contracts';

// The stop that can come off the truck again (Q-16): the one loaded last, which is the loaded stop with the lowest
// number, as a truck is loaded last stop first. null before any stop is loaded. The server refuses any other.
export function lastLoaded(truck: Pick<LoadingTruck, 'stops'>): LoadingStop | null {
  return truck.stops.filter((stop) => stop.loaded).sort((a, b) => a.seq - b.seq)[0] ?? null;
}
