import { useSyncExternalStore } from 'react';

// The unload counts (spec 013, rule 4): the driver's own tally as the cartons come off, as the loader's ticks are
// (spec 012). They are kept in memory for this tab, by stop and line, and never saved, so a reload starts them at 0.
// "Done unloading" works once every line is counted to what was loaded.

const counts = new Map<string, number>();
const listeners = new Set<() => void>();
// Goes up on every change, so a screen draws again when a count moves.
let version = 0;

const keyOf = (stopId: string, lineId: string) => `${stopId}:${lineId}`;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function set(stopId: string, lineId: string, count: number) {
  counts.set(keyOf(stopId, lineId), count);
  version += 1;
  for (const listener of listeners) listener();
}

export function useTally(stopId: string) {
  useSyncExternalStore(subscribe, () => version);
  return {
    countOf: (lineId: string) => counts.get(keyOf(stopId, lineId)) ?? 0,
    set: (lineId: string, count: number) => set(stopId, lineId, count),
  };
}
