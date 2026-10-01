import { useMemo } from 'react';
import { phoneView, tripFigures, type DriverDay, type DriverTrip } from '@wayfinder/contracts';
import { recordOf, useKept, type Queued } from './queue';
import type { Figures } from './words';

// What the driver's screens show (spec 013, rule 13, D-50): the day the server last sent with the still-waiting writes
// applied by phoneView, and every number from tripFigures over it. A refused write is left out, and a write's answer
// is never shown.
export interface DriverView {
  // The phone's database has been read for the signed-in account.
  ready: boolean;
  day: DriverDay | null;
  // The writes still to send, oldest first, and the ones the server refused.
  waiting: Queued[];
  refused: Queued[];
  // The waiting count: stops with something waiting, and the trip's start and end (rule 12).
  waitingRecords: number;
  refusedRecords: number;
  // The first trip that is not done (rule 2), with its figures, or the last trip once every one is done.
  trip: DriverTrip | null;
  figures: Figures | null;
  allDone: boolean;
}

const records = (entries: Queued[]) => new Set(entries.map((entry) => recordOf(entry.write))).size;

export function useDriverView(userId: string): DriverView {
  const kept = useKept();
  return useMemo(() => {
    const ready = kept.ready && kept.userId === userId;
    const own = ready ? kept.queue : [];
    const held = own.filter((entry) => entry.state === 'waiting');
    const refused = own.filter((entry) => entry.state === 'refused');
    if (!ready || !kept.day) {
      return { ready, day: null, waiting: held, refused, waitingRecords: records(held), refusedRecords: records(refused), trip: null, figures: null, allDone: false };
    }
    const view = phoneView(kept.day, held.map((entry) => entry.write));
    const left = new Set(view.writes.map((write) => write.writeId));
    const waiting = held.filter((entry) => left.has(entry.write.writeId));
    const open = view.day.trips.find((trip) => trip.status !== 'done') ?? null;
    const trip = open ?? view.day.trips.at(-1) ?? null;
    return {
      ready, day: view.day, waiting, refused, waitingRecords: records(waiting), refusedRecords: records(refused),
      trip, figures: trip ? tripFigures(trip) : null, allDone: open === null && trip !== null,
    };
  }, [kept, userId]);
}
