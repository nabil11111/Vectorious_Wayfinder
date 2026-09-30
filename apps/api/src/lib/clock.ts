import { DEMO_DAY, DEPOT_TIME_ZONE, type ClockState, type Me } from '@wayfinder/contracts';
import { sql } from 'drizzle-orm';
import { db, type Tx } from '../db/client';
import { auditLog, demoDay } from '../db/schema';
import { config } from './config';
import { HttpError } from './errors';
import { announce } from './live';

// The app's one clock (spec 008, D-18). Every time a person sees, and every time the app saves about the
// work (placed at, sent at, arrived at), comes from now(). A device's own clock is never used for a time.
// Sessions, created_at, updated_at and the audit log stay on the real time.
//
// In demo mode it is the demo clock (D-25). The one row of demo_day holds it as two times, the app's time
// when it was last set and the real time at that moment, so it carries on from there after a restart. With
// demo mode off there is no row and the clock is the real time.

// The one place that reads the system time.
export function realNow(): Date {
  return new Date();
}

type StoredClock = Pick<typeof demoDay.$inferSelect, 'clockBase' | 'clockSetAt' | 'revision' | 'day'>;

// The row, kept in memory so that now() needs no database call. Only this process changes the row, and a
// move takes the copy afresh from the row it locks, so the copy does not stay behind. It is empty until
// initClock() has read the row, which it never does with demo mode off, and while it is empty the clock is
// the real time.
let stored: StoredClock | null = null;

const NOT_SEEDED = 'The demo clock has no row in demo_day. Run the seed first (npm run db:seed).';
const PARTS = DEMO_DAY.parts.map((part) => ({ key: part.key, at: new Date(part.at).getTime() }));
const ENDS_AT = new Date(DEMO_DAY.endsAt).getTime();

// The demo clock at a real time, worked out from the stored row alone. Inside a part of the day it runs at
// real speed from the time it was set to. One second before the next part it waits until someone moves it
// on, and in the last part it stops at the end of the delivery day. The real time is an argument, so a test
// passes minutes, days or a restart without waiting.
export function demoClockAt(clock: StoredClock, real: Date): ClockState {
  const base = clock.clockBase.getTime();
  // The part the clock is in is the last one that had started at the time it was set to.
  const index = PARTS.filter((part) => part.at <= base).length - 1;
  const next = PARTS[index + 1];
  const holdsAt = next ? next.at - 1000 : ENDS_AT;
  // A real clock that was put back must not take the day back before the time it was set to.
  const ran = base + Math.max(0, real.getTime() - clock.clockSetAt.getTime());
  return {
    demo: true,
    now: new Date(Math.min(ran, holdsAt)).toISOString(),
    part: PARTS[index]?.key ?? null,
    holdsAt: new Date(holdsAt).toISOString(),
    next: next ? { part: next.key, at: new Date(next.at).toISOString() } : null,
    revision: clock.revision,
    day: clock.day,
  };
}

let frozen: Date | null = null;

// A test freezes the clock at an instant and lets it go again with null. While frozen there is no running
// and no waiting point. A test file that sets the clock lets it go in afterAll.
export function setClockForTests(instant: Date | null): void {
  frozen = instant ? new Date(instant) : null;
}

// The app's time. A plain function with no database call, so every route and service can call it freely.
export function now(): Date {
  return new Date(clockState().now);
}

// Reads the clock row into memory. server.ts waits for it before it listens, and the reset calls it again
// after its commit. With demo mode off there is no row and it does nothing. In demo mode a missing row stops
// the server before it serves a wrong time.
export async function initClock(): Promise<void> {
  if (!config.DEMO_MODE) return;
  const [row] = await db.select().from(demoDay);
  if (!row) throw new Error(NOT_SEEDED);
  stored = row;
}

// What GET /clock answers: the time, the part of the day, the instant the clock waits at, the next part, the
// revision and the day. A time a test has set replaces the clock's, and nothing holds it.
export function clockState(): ClockState {
  const real = realNow();
  const state: ClockState = stored
    ? demoClockAt(stored, real)
    : { demo: false, now: real.toISOString(), part: null, holdsAt: null, next: null, revision: 0, day: 1 };
  return frozen ? { ...state, now: frozen.toISOString(), holdsAt: null } : state;
}

// Moves the clock to the start of the next part, writes the audit row demo.clock_moved and, after the commit,
// announces `clock` to everyone. Refuses with 409 stale_clock (details: the current ClockState) when the
// revision is not the clock's, and with 409 no_next_part in the last part.
export async function moveToNextPart(user: Me, revision: number): Promise<ClockState> {
  const moved = await db.transaction(async (tx) => {
    // The lock makes two people who press Next at once take turns. The second then sees the first one's
    // revision and is refused, so nobody skips a part by accident.
    const [row] = await tx.select().from(demoDay).for('update');
    if (!row) throw new Error(NOT_SEEDED);
    // What is read under the lock is the clock. Keeping it puts right a copy in memory that fell behind, as
    // after a commit whose answer was lost, even when this move is then refused.
    stored = row;
    const real = realNow();
    const before = demoClockAt(row, real);
    if (revision !== row.revision) throw new HttpError(409, 'stale_clock', 'The clock was already moved.', before);
    if (!before.next) throw new HttpError(409, 'no_next_part', 'The demo day is over. Reset to start again.');

    const clock = { ...row, clockBase: new Date(before.next.at), clockSetAt: real, revision: row.revision + 1 };
    await tx.update(demoDay).set({ clockBase: clock.clockBase, clockSetAt: clock.clockSetAt, revision: clock.revision });
    const after = demoClockAt(clock, real);
    await tx.insert(auditLog).values({ actorId: user.id, action: 'demo.clock_moved', entity: 'demo_day', entityId: String(row.id), before, after });
    return { clock, after };
  });
  stored = moved.clock;
  announce({ topic: 'clock' });
  return moved.after;
}

// Writes the clock back to the first part's start and raises both the revision and the day, inside the
// caller's transaction. It answers with the clock as it will be once that transaction commits, for the
// reset's audit row. The reset calls initClock() after its commit to read the new row into memory.
export async function restartClock(tx: Tx): Promise<ClockState> {
  const real = realNow();
  const [row] = await tx.update(demoDay)
    .set({ clockBase: new Date(DEMO_DAY.parts[0].at), clockSetAt: real, revision: sql`${demoDay.revision} + 1`, day: sql`${demoDay.day} + 1` })
    .returning();
  if (!row) throw new Error(NOT_SEEDED);
  return demoClockAt(row, real);
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
