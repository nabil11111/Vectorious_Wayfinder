import { DEPOT_TIME_ZONE, type ClockState, type Me } from '@wayfinder/contracts';
import type { Tx } from '../db/client';
import { HttpError } from './errors';

// The app's one clock (spec 008, D-18). Every time a person sees, and every time the app saves about the
// work (placed at, sent at, arrived at), comes from now(). A device's own clock is never used for a time.
// Sessions, created_at, updated_at and the audit log stay on the real time.
//
// The names and what they take and return are fixed here so every piece can build on them. The demo clock
// itself (the stored row, the parts of the day, the waiting point, moving on) is task T1 of spec 008.

// The one place that reads the system time.
export function realNow(): Date {
  return new Date();
}

let frozen: Date | null = null;

// A test freezes the clock at an instant and lets it go again with null. While frozen there is no running
// and no waiting point. A test file that sets the clock lets it go in afterAll.
export function setClockForTests(instant: Date | null): void {
  frozen = instant ? new Date(instant) : null;
}

// The app's time. A plain function with no database call, so every route and service can call it freely.
// T1: in demo mode it is the earlier of clock_base + (realNow - clock_set_at) and the waiting point.
export function now(): Date {
  return frozen ? new Date(frozen) : realNow();
}

// Reads the clock row into memory. server.ts waits for it before it listens, and the reset calls it again
// after its commit. With demo mode off there is no row and it does nothing.
// T1: in demo mode a missing row is an error that says to run the seed first.
export async function initClock(): Promise<void> {}

// What GET /clock answers.
// T1: the part of the day, the instant the clock waits at, the next part, the revision and the day.
export function clockState(): ClockState {
  return { demo: false, now: now().toISOString(), part: null, holdsAt: null, next: null, revision: 0, day: 1 };
}

// Moves the clock to the start of the next part, writes the audit row demo.clock_moved and, after the commit,
// announces `clock` to everyone. Refuses with 409 stale_clock (details: the current ClockState) when the
// revision is not the clock's, and with 409 no_next_part in the last part.
export async function moveToNextPart(_user: Me, _revision: number): Promise<ClockState> {
  throw new HttpError(501, 'not_built', 'The demo clock is not built yet.');
}

// Writes the clock back to the first part's start and raises both the revision and the day, inside the
// caller's transaction. It answers with the clock as it will be once that transaction commits, for the
// reset's audit row. The reset calls initClock() after its commit to read the new row into memory.
export async function restartClock(_tx: Tx): Promise<ClockState> {
  throw new HttpError(501, 'not_built', 'The demo clock is not built yet.');
}

// Depot time. Intl does the work with the zone named, so the answer is the same whatever time zone the
// server runs in: CI runs in UTC and our laptops in +05:30.
const depotFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: DEPOT_TIME_ZONE, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function inDepot(instant: Date) {
  const part = Object.fromEntries(depotFormat.formatToParts(instant).map((p) => [p.type, p.value]));
  return { date: `${part.year}-${part.month}-${part.day}`, hour: Number(part.hour), minute: Number(part.minute), second: Number(part.second) };
}

// The depot's date at an instant, as '2026-06-25'.
export function depotDate(instant: Date): string {
  return inDepot(instant).date;
}

// Minutes after midnight at the depot, the form the plan checker takes. 00:15 is 15.
export function depotMinutes(instant: Date): number {
  const { hour, minute } = inDepot(instant);
  return hour * 60 + minute;
}

// The other way round: the instant of a depot date and minutes after its midnight. depotInstant('2026-06-24',
// 960) is 16:00 that day at the depot. Minutes may pass 1440, which lands on the next day.
export function depotInstant(date: string, minutes: number): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(minutes)) throw new Error(`Not a depot date and minutes: ${date}, ${minutes}`);
  // Read the depot's wall time as if it were UTC, then take off how far the depot is ahead at that moment.
  const wall = new Date(`${date}T00:00:00Z`).getTime() + minutes * 60_000;
  const ahead = (at: number) => {
    const d = inDepot(new Date(at));
    return new Date(`${d.date}T00:00:00Z`).getTime() + ((d.hour * 60 + d.minute) * 60 + d.second) * 1000 - at;
  };
  return new Date(wall - ahead(wall - ahead(wall)));
}
