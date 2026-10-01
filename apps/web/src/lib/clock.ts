import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ClockState, DEMO_DAY, DEPOT_TIME_ZONE, type DemoPart, type MoveClockRequest } from '@wayfinder/contracts';
import { api, ApiRequestError } from './api';

// The app's clock on screen (spec 008, D-18). The server holds the one clock. A screen asks it for the time and
// counts on from there with performance.now(), a steady timer that the device's time and time zone cannot
// change, and shows depot time. A laptop set to another zone or a wrong time shows what everyone else sees.

export const clockKey = ['clock'] as const;
// The demo control's two changes, the move and the reset.
export const demoKey = ['demo'] as const;

// The clock as the server sent it, with the steady timer's reading when it arrived.
export type HeldClock = ClockState & { heldAt: number };

const CLOCK_KEY = 'wayfinder-clock';
const hold = (clock: ClockState): HeldClock => {
  try { localStorage.setItem(CLOCK_KEY, JSON.stringify({ clock, deviceAt: Date.now() })); }
  catch (error) { console.warn('Could not keep the clock on this phone.', error); }
  return { ...clock, heldAt: performance.now() };
};

// Across reloads the steady timer starts over. Count the saved clock on by the device's elapsed time once,
// then use the steady timer again. The server bounds times submitted after a device clock move (D-46).
function keptClock(): HeldClock | undefined {
  try {
    const text = localStorage.getItem(CLOCK_KEY);
    if (text === null) return undefined;
    const saved = JSON.parse(text) as { clock: unknown; deviceAt: unknown };
    const parsed = ClockState.safeParse(saved.clock);
    if (!parsed.success || typeof saved.deviceAt !== 'number' || !Number.isFinite(saved.deviceAt)) {
      localStorage.removeItem(CLOCK_KEY); return undefined;
    }
    const clock = parsed.data;
    const ran = Date.parse(clock.now) + Math.max(0, Date.now() - saved.deviceAt);
    const at = clock.holdsAt === null ? ran : Math.min(ran, Date.parse(clock.holdsAt));
    return { ...clock, now: new Date(at).toISOString(), heldAt: performance.now() };
  } catch (error) { console.warn('Could not read the kept clock on this phone.', error); return undefined; }
}


// The instant a held clock shows at a reading of the steady timer: the time it arrived with plus the time
// passed since, never past the point where the clock waits.
export function shownAt(clock: HeldClock, reading: number): number {
  const ran = Date.parse(clock.now) + Math.max(0, reading - clock.heldAt);
  return clock.holdsAt === null ? ran : Math.min(ran, Date.parse(clock.holdsAt));
}

const MINUTE = 60_000;

// How long after a reading of the steady timer the time on screen next changes: when the minute it shows ends, or
// when the clock reaches the point where it waits, whichever comes first. null once it waits, as nothing changes
// then until the clock is moved. The depot is a whole number of minutes from UTC, so its minutes end with UTC's.
export function nextDrawIn(clock: HeldClock, reading: number): number | null {
  const at = shownAt(clock, reading);
  const minuteEnds = at - (at % MINUTE) + MINUTE;
  if (clock.holdsAt === null) return minuteEnds - at;
  const holds = Date.parse(clock.holdsAt);
  return at >= holds ? null : Math.min(minuteEnds, holds) - at;
}

// What a drawing made at a reading shows: its minute, and whether the clock waits there.
function drawn(clock: HeldClock, reading: number) {
  const at = shownAt(clock, Math.max(reading, clock.heldAt));
  return `${Math.floor(at / MINUTE)} ${clock.holdsAt !== null && at >= Date.parse(clock.holdsAt)}`;
}

const depotFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: DEPOT_TIME_ZONE, hourCycle: 'h23',
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

// An instant at the depot, in the words the screens use: time "15:18", weekday "Wed", day "Wed 24 Jun" and
// date "Wed 24 Jun 2026".
export function inDepot(instant: number) {
  const part = Object.fromEntries(depotFormat.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    time: `${part.hour}:${part.minute}`,
    weekday: part.weekday,
    day: `${part.weekday} ${part.day} ${part.month}`,
    date: `${part.weekday} ${part.day} ${part.month} ${part.year}`,
  };
}

// A part of the demo day and when it starts, named for a button or a message: "Orders closed, 16:00". The day
// is named when the part starts on another day than the instant `from`: "Loading, Thu 02:30".
export function partAt(key: DemoPart, from: number): string {
  const part = DEMO_DAY.parts.find((p) => p.key === key)!;
  const start = inDepot(Date.parse(part.at));
  return `${part.label}, ${start.date === inDepot(from).date ? '' : `${start.weekday} `}${start.time}`;
}

export interface AppClock {
  // The clock as the server last sent it. Empty until it has arrived.
  state: HeldClock | undefined;
  // The instant on screen, or null until the clock has arrived.
  at: number | null;
  // That instant at the depot, "15:18", or "--:--" until the clock has arrived.
  time: string;
  // The clock has reached the point where it waits for someone to move it on.
  waiting: boolean;
  // The first read of the clock failed, so there is no time to show yet, and retry asks again.
  failed: boolean;
  retry: () => void;
  // The app clock read at the moment it is asked, or null until the clock has arrived. A write takes its time from
  // here at the press: `at` is the drawing's, which turns only with the minute.
  readNow: () => number | null;
}

// The time on screen. It comes from GET /clock and runs on by itself. It is drawn again the moment its minute
// ends, so it turns with the app clock and nothing stamped in that minute looks ahead of it (Q-05).
export function useAppClock(): AppClock {
  const query = useQuery({ queryKey: clockKey, initialData: keptClock, initialDataUpdatedAt: 0, networkMode: 'always', queryFn: async ({ signal }) => {
    const clock = await api<ClockState>('/clock', { signal });
    signal.throwIfAborted();
    return hold(clock);
  } });
  const state = query.data;
  const retry = () => void query.refetch();
  const [reading, setReading] = useState(() => performance.now());
  // After each drawing, and with each clock the server sends, the clock is read again. A drawing behind that
  // reading, such as one a timer read just before the minute turned with this effect running just after, is drawn
  // again at once, so no minute is skipped and the wait is never missed. Otherwise the next drawing is timed from
  // that reading, for the minute's end or the wait, whichever is first. The timer reads the clock when it fires.
  useEffect(() => {
    if (!state) return;
    const now = performance.now();
    const wait = drawn(state, reading) !== drawn(state, now) ? 0 : nextDrawIn(state, Math.max(now, state.heldAt));
    if (wait === null) return;
    const timer = window.setTimeout(() => setReading(performance.now()), wait);
    return () => window.clearTimeout(timer);
  }, [state, reading]);

  // A later read that fails leaves the clock it had running on, so only a first read that failed is shown.
  if (!state) return { state, at: null, time: '--:--', waiting: false, failed: query.isError, retry, readNow: () => null };
  // A clock that arrived after the last drawing shows the time it arrived with.
  const at = shownAt(state, Math.max(reading, state.heldAt));
  const readNow = () => shownAt(state, Math.max(performance.now(), state.heldAt));
  return { state, at, time: inDepot(at).time, waiting: state.holdsAt !== null && at >= Date.parse(state.holdsAt), failed: false, retry, readNow };
}

// Takes the clock a move or a reset answered with. "Today" changed with it, so every list is fetched again.
async function takeClock(qc: QueryClient, clock: ClockState) {
  // A read that started before the change would answer with the clock as it was.
  await qc.cancelQueries({ queryKey: clockKey });
  // A later clock can already be here: someone else moved it and the live stream fetched it while this answer
  // was on its way. Every move and every reset raises the revision, so an older answer is dropped.
  const held = qc.getQueryData<HeldClock>(clockKey);
  if (held && held.revision > clock.revision) return;
  qc.setQueryData(clockKey, hold(clock));
  void qc.invalidateQueries({ predicate: (query) => query.queryKey[0] !== clockKey[0] });
}

// Moves the clock to the start of the next part. It carries the revision the screen holds, so two people
// pressing at once cannot skip a part: the second gets stale_clock with the clock as it is now, and takes it.
// With no connection it fails at once and says so, rather than waiting to move the clock later by itself.
export function useNextPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...demoKey, 'next'],
    networkMode: 'always',
    mutationFn: (revision: number) => api<ClockState>('/demo/clock/next', { method: 'POST', json: { revision } satisfies MoveClockRequest }),
    onSuccess: (clock) => takeClock(qc, clock),
    onError: async (error) => {
      const current = ClockState.safeParse(error instanceof ApiRequestError && error.code === 'stale_clock' ? error.details : null);
      if (current.success) await takeClock(qc, current.data);
    },
  });
}

// Puts the demo day back as the seed wrote it, for everyone, with the clock on Wednesday 15:00 again.
export function useResetDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...demoKey, 'reset'],
    networkMode: 'always',
    mutationFn: () => api<ClockState>('/demo/reset', { method: 'POST', json: {} }),
    onSuccess: (clock) => takeClock(qc, clock),
  });
}
