import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as clocks from './clock';
import { nextDrawIn, type HeldClock } from './clock';

// The time in the top bar (Q-05). It comes from the app's one clock and turns with the minute: the screen draws it
// again when the minute it shows ends, never up to 15 seconds late. React's state and effects, the clock's query and
// the steady timer are stand-ins here, run by the fake timers.

const hooks = vi.hoisted(() => ({
  clock: undefined as unknown,
  slots: [] as unknown[],
  slot: 0,
  effects: [] as (() => void | (() => void))[],
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

    it('marks the clock waiting once it reaches the point where it waits', async () => {
      hooks.clock = clockAt('2026-06-24T10:29:58.000Z', '2026-06-24T10:29:59.000Z', performance.now());
      expect(draw().waiting).toBe(false);
      const shown = await run(1050);
      expect(shown.waiting).toBe(true);
      expect(shown.time).toBe('15:59');
    });
  });
});
