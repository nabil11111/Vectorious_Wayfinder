import { useSyncExternalStore } from 'react';

// The tick boxes beside a stop's lines (spec 012, rule 4): the loader's own checklist while the goods go on. They
// are kept in memory for this tab, by trip and line, and never saved, so a reload clears them. The truck and the
// flag form read the same ticks.

const ticked = new Set<string>();
const listeners = new Set<() => void>();
// Goes up on every change, so a screen draws again when a box is ticked.
let version = 0;

const keyOf = (tripId: string, lineId: string) => `${tripId}:${lineId}`;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function toggle(tripId: string, lineId: string) {
  const key = keyOf(tripId, lineId);
  if (!ticked.delete(key)) ticked.add(key);
  version += 1;
  for (const listener of listeners) listener();
}

export function useTicks(tripId: string) {
  useSyncExternalStore(subscribe, () => version);
  return {
    isTicked: (lineId: string) => ticked.has(keyOf(tripId, lineId)),
    toggle: (lineId: string) => toggle(tripId, lineId),
  };
}
