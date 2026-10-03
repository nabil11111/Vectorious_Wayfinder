import { useMemo } from 'react';
import { dayFigures, phoneView, tripFigures, type DriverDay, type DriverTrip } from '@wayfinder/contracts';
import { useSignal } from '@/lib/phone/signal';
import { recordOf, useKept, useSync, type Queued } from './queue';
import type { Figures } from './words';

// What the driver's screens show (spec 013, rule 13, D-50): the day the server last sent with the still-waiting writes
// applied by phoneView, and every number from tripFigures over it. A refused write is left out, and a write's answer
// is never shown.
export interface DriverView extends DayTrips {
  // The phone's database has been read for the signed-in account.
  ready: boolean;
  day: DriverDay | null;
  // The writes still to send, oldest first, and the ones the server refused.
  waiting: Queued[];
  refused: Queued[];
  // The waiting count: stops with something waiting, and the trip's start and end (rule 12).
  waitingRecords: number;
  refusedRecords: number;
}

// A trip with its figures.
export interface TripWithFigures { trip: DriverTrip; figures: Figures }

// Which of the day's trips the screens are at (rule 2).
export interface DayTrips {
  // The first trip that is not done, with its figures, or the last trip once every one is done.
  trip: DriverTrip | null;
  figures: Figures | null;
  allDone: boolean;
  // The trip checked in just before the open one, while the open one has not started: trip 2's Today's trip opens
  // with trip 1's close and its hand-back card (Q-29).
  closed: TripWithFigures | null;
  // Once every trip is done, the whole day: each trip's figures and the day's sums, for Day done (Q-31).
  wholeDay: ReturnType<typeof dayFigures> | null;
}

export function tripsOf(day: DriverDay): DayTrips {
  const open = day.trips.find((trip) => trip.status !== 'done') ?? null;
  const trip = open ?? day.trips.at(-1) ?? null;
  const before = open ? day.trips[day.trips.indexOf(open) - 1] : undefined;
  const closed = open && open.status !== 'out' && before?.status === 'done' ? { trip: before, figures: tripFigures(before) } : null;
  const allDone = open === null && trip !== null;
  return { trip, figures: trip ? tripFigures(trip) : null, allDone, closed, wholeDay: allDone ? dayFigures(day.trips) : null };
}

const records = (entries: Queued[]) => new Set(entries.map((entry) => recordOf(entry.write))).size;

export function useDriverView(userId: string): DriverView {
  const kept = useKept();
  const { fetched, signedOut, failure } = useSync();
  const signal = useSignal();
  return useMemo(() => {
    const ready = kept.ready && kept.userId === userId;
    const own = ready ? kept.queue : [];
    const held = own.filter((entry) => entry.state === 'waiting');
    const refused = own.filter((entry) => entry.state === 'refused');
    // Online startup must read the current run before displaying an earlier cached trip. The
    // offline copy, a failed current read and reauthentication keep the own-account cache usable.
    if (!ready || !kept.day || (signal && !fetched && !signedOut && failure === null)) {
      return {
        ready, day: null, waiting: held, refused, waitingRecords: records(held), refusedRecords: records(refused),
        trip: null, figures: null, allDone: false, closed: null, wholeDay: null,
      };
    }
    const view = phoneView(kept.day, held.map((entry) => entry.write));
    const left = new Set(view.writes.map((write) => write.writeId));
    const waiting = held.filter((entry) => left.has(entry.write.writeId));
    return { ready, day: view.day, waiting, refused, waitingRecords: records(waiting), refusedRecords: records(refused), ...tripsOf(view.day) };
  }, [kept, userId, signal, fetched, signedOut, failure]);
}
