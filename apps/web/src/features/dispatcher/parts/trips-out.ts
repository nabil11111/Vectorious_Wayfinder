import type { OperationsDay, OperationsTrip } from '@wayfinder/contracts';
import { allTrips } from '@/features/live/parts/rows';

export type OutTrip = OperationsTrip & { outRow: NonNullable<OperationsTrip['outRow']> };

// The trips on the road: every trip the read lists as out, in its order, problems first. The "trucks out now" tile
// counts their vehicles (counts.vehiclesOut), Trucks out now gives each a row and the district map an arrow (spec 019).
export function tripsOut(day: OperationsDay): OutTrip[] {
  const byId = new Map(allTrips(day).map((trip) => [trip.tripId, trip]));
  return day.outTripIds.map((id) => byId.get(id)).filter((trip): trip is OutTrip => Boolean(trip?.outRow));
}

// The order each depot's read lists its trips out in, so both depots' rows together keep it (spec 021): an open problem
// first, oldest first, then a missing report by its planned time, then the rest by leaving time; then the day, the
// truck and the trip.
const priority = (trip: OutTrip) => {
  const status = trip.outRow.status;
  if (status.kind === 'open_problem') return [0, status.raisedAt, status.issueId] as const;
  if (status.kind === 'departure_unreported' || status.kind === 'arrival_unreported') return [1, status.plannedAt, ''] as const;
  return [2, trip.detailRecorded ? trip.schedule.leavesAt : '~', ''] as const;
};
export function outOrder(a: OutTrip, b: OutTrip) {
  const [aa, bb] = [priority(a), priority(b)];
  return aa[0] - bb[0] || aa[1].localeCompare(bb[1]) || aa[2].localeCompare(bb[2]) || a.date.localeCompare(b.date) || a.vehicleId.localeCompare(b.vehicleId) || a.tripNo - b.tripNo;
}
