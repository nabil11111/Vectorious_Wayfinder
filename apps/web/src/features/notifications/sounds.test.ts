import { afterEach, expect, it, vi } from 'vitest';
import { depotTarget, followDepotLink } from './link';
import { playUpdate, setSoundsOn, SOUND_KEY, soundsOn } from './sounds';

function memory(): Storage {
  const held = new Map<string, string>();
  return { getItem: (key) => held.get(key) ?? null, setItem: (key, value) => { held.set(key, value); }, removeItem: (key) => { held.delete(key); },
    clear: () => held.clear(), key: () => null, get length() { return held.size; } };
}

afterEach(() => vi.unstubAllGlobals());

it('spec 031 a plan warning names the depot to switch to, and every other link does not', () => {
  expect(depotTarget('/dispatcher/plan/2026-06-25?depot=Kandy')).toEqual({ path: '/dispatcher/plan/2026-06-25', depot: 'Kandy' });
  expect(depotTarget('/dispatcher/live?issue=1')).toEqual({ path: '/dispatcher/live?issue=1', depot: null });
  expect(depotTarget('/dispatcher/live?issue=1&depot=Kandy')).toEqual({ path: '/dispatcher/live?issue=1', depot: 'Kandy' });
  expect(depotTarget('/driver')).toEqual({ path: '/driver', depot: null });
});

it('a cold notification link selects its depot and keeps the issue without retrying the consumed link', () => {
  const choose = vi.fn(), replace = vi.fn();
  followDepotLink('/dispatcher/live?issue=1&depot=Kandy', 'Peliyagoda', false, choose, replace);
  expect(choose).toHaveBeenCalledWith('Kandy');
  expect(replace).toHaveBeenCalledWith('/dispatcher/live?issue=1');
  followDepotLink('/dispatcher/live?issue=1', 'Peliyagoda', false, choose, replace);
  expect(choose).toHaveBeenCalledTimes(1);
});

it('waits for the account and pending switch, ignores unknown depots and consumes a link already in scope', () => {
  const choose = vi.fn(), replace = vi.fn();
  followDepotLink('/dispatcher/live?depot=Kandy', null, false, choose, replace);
  followDepotLink('/dispatcher/live?depot=Kandy', 'Peliyagoda', true, choose, replace);
  followDepotLink('/dispatcher/live?depot=unknown', 'Peliyagoda', false, choose, replace);
  expect(choose).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  followDepotLink('/dispatcher/live?depot=Kandy', 'Kandy', false, choose, replace);
  expect(choose).not.toHaveBeenCalled();
  expect(replace).toHaveBeenCalledWith('/dispatcher/live');
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
