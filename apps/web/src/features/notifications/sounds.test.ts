import { afterEach, expect, it, vi } from 'vitest';
import { depotTarget } from './link';
import { playUpdate, setSoundsOn, SOUND_KEY, soundsOn } from './sounds';

function memory(): Storage {
  const held = new Map<string, string>();
  return { getItem: (key) => held.get(key) ?? null, setItem: (key, value) => { held.set(key, value); }, removeItem: (key) => { held.delete(key); },
    clear: () => held.clear(), key: () => null, get length() { return held.size; } };
}

afterEach(() => vi.unstubAllGlobals());

it('spec 031 a plan warning names the depot to switch to, and every other link does not', () => {
  expect(depotTarget('/dispatcher/plan/2026-06-25?depot=Kandy')).toEqual({ path: '/dispatcher/plan/2026-06-25', depot: 'Kandy' });
  expect(depotTarget('/dispatcher/live?issue=1')).toEqual({ path: '/dispatcher/live', depot: null });
  expect(depotTarget('/driver')).toEqual({ path: '/driver', depot: null });
});

it('spec 031 plays a new update unless sounds were turned off', () => {
  const play = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('Audio', class { play = play; });
  const storage = memory();
  expect(soundsOn(storage)).toBe(true);
  playUpdate('warn', storage);
  expect(play).toHaveBeenCalledOnce();
  setSoundsOn(false, storage);
  expect(storage.getItem(SOUND_KEY)).toBe('off');
  playUpdate('bad', storage);
  expect(play).toHaveBeenCalledOnce();
  setSoundsOn(true, storage);
  playUpdate('good', storage);
  expect(play).toHaveBeenCalledTimes(2);
});
