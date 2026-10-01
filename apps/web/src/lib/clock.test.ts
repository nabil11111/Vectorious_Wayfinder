import { isValidElement } from 'react';
import { tripFigures, type DriverDay, type DriverTrip, type DriverWrite } from '@wayfinder/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TripDone } from '@/features/driver/DonePage';
import { NextStopPage } from '@/features/driver/NextStopPage';
import { TodaysTrip } from '@/features/driver/TripPage';
import type { DriverView } from '@/features/driver/view';
import * as clocks from './clock';
import { nextDrawIn, type HeldClock } from './clock';

// The time in the top bar (Q-05). It comes from the app's one clock and turns with the minute: the screen draws it
// again when the minute it shows ends, never up to 15 seconds late. A write takes its time from the clock read at
// the press, never from the minute on screen. React's state and effects, the clock's query and the steady timer are
// stand-ins here, run by the fake timers, and the driver's save takes the write it is given.

const hooks = vi.hoisted(() => ({
  clock: undefined as unknown,
  slots: [] as unknown[],
  slot: 0,
  effects: [] as (() => void | (() => void))[],
  saved: [] as unknown[],
}));
vi.mock('@/features/driver/queue', async (original) => ({
  ...await original<typeof import('@/features/driver/queue')>(),
  useSave: () => ({ save: async (write: unknown) => { hooks.saved.push(write); return true; }, saving: false, failed: false }),
}));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (first: unknown) => {
    const at = hooks.slot++;
    if (at >= hooks.slots.length) hooks.slots.push(typeof first === 'function' ? (first as () => unknown)() : first);
    return [hooks.slots[at], (value: unknown) => { hooks.slots[at] = value; }];
  },
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));
vi.mock('@tanstack/react-query', async (original) => ({
  ...await original<typeof import('@tanstack/react-query')>(),
  useQuery: () => ({ data: hooks.clock, isError: false, refetch: () => undefined }),
}));

// 15:43:20.5 on Wed 24 Jun at the depot, five and a half hours ahead of UTC, and a clock that runs on from there.
const clockAt = (now: string, holdsAt: string | null = null, heldAt = 0): HeldClock => ({
  demo: true, now, part: 'ordering', holdsAt, next: null, revision: 1, day: 1, heldAt,
});

// One drawing of a screen that shows the clock: the hook runs, then its effects, after the last drawing's cleanups.
let cleanups: (() => void)[] = [];
function draw() {
  for (const cleanup of cleanups.splice(0)) cleanup();
  hooks.slot = 0;
  hooks.effects = [];
  const shown = clocks.useAppClock();
  for (const effect of hooks.effects) {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  }
  return shown;
}

describe('Q-05 the top-bar clock turns with the minute', () => {
  it('draws again exactly when the minute it shows ends', () => {
    expect(nextDrawIn(clockAt('2026-06-24T10:13:20.500Z'), 0)).toBe(39_500);
    expect(nextDrawIn(clockAt('2026-06-24T10:13:20.500Z'), 39_500)).toBe(60_000);
    expect(nextDrawIn(clockAt('2026-06-24T10:13:59.999Z'), 0)).toBe(1);
  });

  it('draws once more when the clock reaches the point where it waits, and then not at all', () => {
    const waiting = clockAt('2026-06-24T10:29:30.000Z', '2026-06-24T10:29:59.000Z');
    expect(nextDrawIn(waiting, 0)).toBe(29_000);
    expect(nextDrawIn(waiting, 29_000)).toBeNull();
    expect(nextDrawIn(waiting, 90_000)).toBeNull();
  });

  describe('on screen', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
      vi.stubGlobal('window', {
        setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
        clearTimeout: (timer: number) => clearTimeout(timer),
        setInterval: (run: () => void, ms: number) => setInterval(run, ms),
        clearInterval: (timer: number) => clearInterval(timer),
      });
      hooks.slots = [];
      cleanups = [];
    });
    afterEach(() => {
      for (const cleanup of cleanups.splice(0)) cleanup();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    // Draws whenever the screen's state was set since the last drawing, as React does.
    async function run(ms: number) {
      let last = [...hooks.slots];
      let shown = draw();
      for (let step = 0; step < ms; step += 50) {
        await vi.advanceTimersByTimeAsync(50);
        if (hooks.slots.some((value, i) => value !== last[i])) {
          last = [...hooks.slots];
          shown = draw();
        }
      }
      return shown;
    }

    it('shows 15:44 as soon as the app clock reaches it, not seconds later', async () => {
      hooks.clock = clockAt('2026-06-24T10:13:20.500Z', null, performance.now());
      expect(draw().time).toBe('15:43');
      expect((await run(39_450)).time).toBe('15:43');
      expect((await run(100)).time).toBe('15:44');
    });

    it('keeps turning with each minute after that', async () => {
      hooks.clock = clockAt('2026-06-24T10:13:59.900Z', null, performance.now());
      expect((await run(150)).time).toBe('15:44');
      expect((await run(59_850)).time).toBe('15:44');
      expect((await run(100)).time).toBe('15:45');
    });

    it('draws the new minute when the timer read the clock just before it turned and the effect ran just after', async () => {
      const start = performance.now();
      hooks.clock = clockAt('2026-06-24T10:13:20.500Z', null, start);
      expect(draw().time).toBe('15:43');
      // The timer fires and reads 15:43:59.999; the effect of that drawing runs at 15:44:00.010.
      for (const cleanup of cleanups.splice(0)) cleanup();
      hooks.slots[0] = start + 39_499;
      vi.advanceTimersByTime(39_510);
      expect(draw().time).toBe('15:43');
      // The effect read the clock again and draws at once, so the bar turns now and the next minute is not skipped.
      vi.advanceTimersByTime(0);
      expect(draw().time).toBe('15:44');
      expect((await run(59_900)).time).toBe('15:44');
      expect((await run(100)).time).toBe('15:45');
    });

    it('marks the clock waiting when the timer read it just before the hold and the effect ran just after', () => {
      const start = performance.now();
      hooks.clock = clockAt('2026-06-24T10:29:58.000Z', '2026-06-24T10:29:59.000Z', start);
      expect(draw().waiting).toBe(false);
      for (const cleanup of cleanups.splice(0)) cleanup();
      hooks.slots[0] = start + 999;
      vi.advanceTimersByTime(1005);
      expect(draw().waiting).toBe(false);
      vi.advanceTimersByTime(0);
      expect(draw().waiting).toBe(true);
    });

    it('marks the clock waiting once it reaches the point where it waits', async () => {
      hooks.clock = clockAt('2026-06-24T10:29:58.000Z', '2026-06-24T10:29:59.000Z', performance.now());
      expect(draw().waiting).toBe(false);
      const shown = await run(1050);
      expect(shown.waiting).toBe(true);
      expect(shown.time).toBe('15:59');
    });
  });
});

// A driver's trip, ready to start, out with its stop to come, or out with its stop delivered.
const TRIP = '7a000000-0000-4000-8000-000000000001';
const STOP = '7b000000-0000-4000-8000-000000000001';
function tripOf(status: 'ready' | 'out', delivered = false): DriverTrip {
  return {
    tripId: TRIP, revision: 1, vehicleId: 'VEH035', vehicleType: 'truck', vehicleTemp: 'reefer', tripNo: 1, brand: 'Fresh', district: 'Colombo', status,
    leavesAt: '2026-06-24T23:06:00.000Z', backBy: '2026-06-25T00:40:00.000Z', backByWords: 'back by 06:10', readyAt: '2026-06-24T21:06:00.000Z',
    leftAt: status === 'out' ? '2026-06-24T22:01:00.000Z' : null, backAt: null, problems: [],
    stops: [{
      id: STOP, seq: 1, revision: 0, retriedAt: null, outletId: 'OUT001', shopName: 'Fresh Nugegoda', district: 'Colombo', dockType: 'street',
      windowOpen: '05:00', windowClose: '07:30', note: null, arrivedAt: delivered ? '2026-06-24T22:04:00.000Z' : null,
      doneAt: delivered ? '2026-06-24T22:08:00.000Z' : null, outcome: delivered ? 'delivered' : null,
      lines: [{ lineId: '7c000000-0000-4000-8000-000000000001', orderId: '7d000000-0000-4000-8000-000000000001', temp: 'chilled', productId: 'P001',
        name: 'Chilled', unit: 'carton', quantity: 12, loaded: 12, delivered: delivered ? 12 : null }],
    }],
  };
}
const dayOf = (trip: DriverTrip): DriverDay => ({ depot: 'Peliyagoda', driver: 'Dilshan', driverId: '7e000000-0000-4000-8000-000000000001', day: '2026-06-25', planSent: true, appliedWriteIds: [], trips: [trip] });
const viewOf = (trip: DriverTrip): DriverView => ({ ready: true, day: dayOf(trip), waiting: [], refused: [], waitingRecords: 0, refusedRecords: 0, trip, figures: tripFigures(trip), allDone: false, closed: null, wholeDay: null });

// The press of the button that says `label` among a screen's elements, as a tap would make it.
const textOf = (node: unknown): string =>
  (typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : isValidElement(node) ? textOf((node.props as { children?: unknown }).children) : '');
function buttonSaying(node: unknown, label: string): (() => unknown) | null {
  if (Array.isArray(node)) return node.map((child) => buttonSaying(child, label)).find(Boolean) ?? null;
  if (!isValidElement(node)) return null;
  const props = node.props as Record<string, unknown>;
  if (typeof props.onClick === 'function' && textOf(props.children) === label) return props.onClick as () => unknown;
  return Object.values(props).map((value) => buttonSaying(value, label)).find(Boolean) ?? null;
}
const press = (screen: unknown, label: string) => {
  const onPress = buttonSaying(screen, label);
  if (!onPress) throw new Error(`No button says ${label}`);
  void onPress();
};

describe('Q-05 a write takes its time from the clock at the press', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    vi.stubGlobal('window', { setTimeout: (run: () => void, ms: number) => setTimeout(run, ms), clearTimeout: (timer: number) => clearTimeout(timer) });
    hooks.clock = undefined;
    hooks.slots = [];
    hooks.saved = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // A screen drawn now, with the clock hook as its first state.
  const drawScreen = <T,>(screen: () => T) => {
    hooks.slot = 0;
    hooks.effects = [];
    return screen();
  };

  it('reads the app clock when asked, not the minute on screen', () => {
    expect(draw().readNow()).toBeNull();
    hooks.clock = clockAt('2026-06-25T03:01:00.500Z', null, performance.now());
    const shown = draw();
    vi.advanceTimersByTime(55_000);
    expect(new Date(shown.at!).toISOString()).toBe('2026-06-25T03:01:00.500Z');
    expect(new Date(shown.readNow()!).toISOString()).toBe('2026-06-25T03:01:55.500Z');
  });

  it('stamps the start, "I\'ve arrived" and "I\'m back at the depot" pressed at 03:31:55, not 03:31:00', () => {
    hooks.clock = clockAt('2026-06-24T22:01:00.500Z', null, performance.now());
    const ready = tripOf('ready');
    const out = tripOf('out');
    const done = tripOf('out', true);
    // Drawn at 03:31:00.5, and pressed 55 seconds later, before the minute turns and the screens draw again.
    const starting = drawScreen(() => TodaysTrip({ view: viewOf(ready), trip: ready, figures: tripFigures(ready) }));
    const arriving = drawScreen(() => NextStopPage({ view: viewOf(out), day: dayOf(out), trip: out, figures: tripFigures(out), stop: out.stops[0]! }));
    const finishing = drawScreen(() => TripDone({ view: viewOf(done), day: dayOf(done), trip: done, figures: tripFigures(done) }));
    vi.advanceTimersByTime(55_000);
    press(starting, 'Start trip');
    press(arriving, "I've arrived");
    press(finishing, "I'm back at the depot");
    expect((hooks.saved as DriverWrite[]).map((write) => [write.kind, write.at])).toEqual([
      ['start', '2026-06-24T22:01:55.500Z'], ['arrive', '2026-06-24T22:01:55.500Z'], ['finish', '2026-06-24T22:01:55.500Z'],
    ]);
  });

  it('every screen that stamps a write reads the clock at the press, and none stamps the minute on screen', () => {
    // Every screen's source as text.
    const sources = import.meta.glob<string>(['../features/**/*.{ts,tsx}', '!../features/**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true });
    const writes = ['../features/driver/TripPage.tsx', '../features/driver/NextStopPage.tsx', '../features/driver/ProofPage.tsx', '../features/driver/WrongPage.tsx',
      '../features/driver/DonePage.tsx', '../features/store/ReceiptForm.tsx'];
    for (const file of writes) expect(sources[file], file).toMatch(/readNow\(\)/);
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(Object.keys(sources).filter((file) => /new Date\(at\)/.test(sources[file]!))).toEqual([]);
  });
});
