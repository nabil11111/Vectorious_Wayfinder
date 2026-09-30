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

const hold = (clock: ClockState): HeldClock => ({ ...clock, heldAt: performance.now() });

// The instant a held clock shows at a reading of the steady timer: the time it arrived with plus the time
// passed since, never past the point where the clock waits.
export function shownAt(clock: HeldClock, reading: number): number {
  const ran = Date.parse(clock.now) + Math.max(0, reading - clock.heldAt);
  return clock.holdsAt === null ? ran : Math.min(ran, Date.parse(clock.holdsAt));
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
}

// The time on screen. It comes from GET /clock, runs on by itself and is drawn again every 15 seconds.
export function useAppClock(): AppClock {
  const { data: state } = useQuery({ queryKey: clockKey, queryFn: async () => hold(await api<ClockState>('/clock')) });
  const [reading, setReading] = useState(() => performance.now());
  useEffect(() => {
    const timer = window.setInterval(() => setReading(performance.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!state) return { state, at: null, time: '--:--', waiting: false };
  // A clock that arrived after the last drawing shows the time it arrived with.
  const at = shownAt(state, Math.max(reading, state.heldAt));
  return { state, at, time: inDepot(at).time, waiting: state.holdsAt !== null && at >= Date.parse(state.holdsAt) };
}

// Takes the clock a move or a reset answered with. "Today" changed with it, so every list is fetched again.
async function takeClock(qc: QueryClient, clock: ClockState) {
  // A read that started before the change would answer with the clock as it was.
  await qc.cancelQueries({ queryKey: clockKey });
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
