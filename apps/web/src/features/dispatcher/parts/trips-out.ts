import type { OperationsDay, OperationsTrip } from '@wayfinder/contracts';
import { allTrips } from '@/features/live/parts/rows';

export type OutTrip = OperationsTrip & { outRow: NonNullable<OperationsTrip['outRow']> };

// The trips on the road: every trip the read lists as out, in its order, problems first. The "trucks out now" tile
// counts their vehicles (counts.vehiclesOut), Trucks out now gives each a row and the district map an arrow (spec 019).
export function tripsOut(day: OperationsDay): OutTrip[] {
  const byId = new Map(allTrips(day).map((trip) => [trip.tripId, trip]));
  return day.outTripIds.map((id) => byId.get(id)).filter((trip): trip is OutTrip => Boolean(trip?.outRow));
}
