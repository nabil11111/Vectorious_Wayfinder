import { useSyncExternalStore } from 'react';
import { wholeCount } from '@/features/loader/count';

// The unload counts (spec 013, rule 4): the driver's own tally as the cartons come off, as the loader's ticks are
// (spec 012). They are kept in memory for this tab, by stop and line, and never saved, so a reload starts them at 0.
// "Done unloading" works once every line is counted to what was loaded and no box holds anything else.

const counts = new Map<string, number>();
// What a count box holds while it is not the line's count: what is being typed, and a typed number that is not a count,
// which stays as it was typed (Q-25).
const typed = new Map<string, string>();
const listeners = new Set<() => void>();
// Goes up on every change, so a screen draws again when a count moves.
let version = 0;

const keyOf = (stopId: string, lineId: string) => `${stopId}:${lineId}`;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function changed() {
  version += 1;
  for (const listener of listeners) listener();
}

// What a count box holds (Q-25): a whole number from 0 to what was loaded is the line's count, written in digits, with an
// empty box as 0. A whole number above that is more than was loaded, and anything else, such as a minus or a fraction,
// is not a count. Neither is ever turned into another number, as the loader's flag box and the shop's quantity box
// read theirs (wholeCount).
export type BoxReading = { kind: 'count'; count: number } | { kind: 'over'; count: number } | { kind: 'not_whole' };

export function readBox(text: string, loaded: number): BoxReading {
  const count = wholeCount(text, loaded);
  if (count !== null) return { kind: 'count', count };
  const over = wholeCount(text, Number.POSITIVE_INFINITY);
  return over === null ? { kind: 'not_whole' } : { kind: 'over', count: over };
}

// A stop's tally: each line's count and what its box holds, and the three ways a box changes.
export function tallyFor(stopId: string) {
  const textOf = (lineId: string) => typed.get(keyOf(stopId, lineId));
  return {
    countOf: (lineId: string) => counts.get(keyOf(stopId, lineId)) ?? 0,
    textOf,
    // What the box holds when that is not a count from 0 to what was loaded, or null.
    wrongOf: (lineId: string, loaded: number): BoxReading | null => {
      const text = textOf(lineId);
      if (text === undefined) return null;
      const reading = readBox(text, loaded);
      return reading.kind === 'count' ? null : reading;
    },
    // − and +: the count they step to, which the box then shows.
    step: (lineId: string, count: number) => {
      counts.set(keyOf(stopId, lineId), count);
      typed.delete(keyOf(stopId, lineId));
      changed();
    },
    // Typing: the box keeps the text, and a count from 0 to what was loaded becomes the line's count.
    type: (lineId: string, text: string, loaded: number) => {
      typed.set(keyOf(stopId, lineId), text);
      const reading = readBox(text, loaded);
      if (reading.kind === 'count') counts.set(keyOf(stopId, lineId), reading.count);
      changed();
    },
    // Leaving the box shows a count as the count, "012" as 12. Anything else stays as it was typed.
    leave: (lineId: string, loaded: number) => {
      const text = textOf(lineId);
      if (text === undefined || readBox(text, loaded).kind !== 'count') return;
      typed.delete(keyOf(stopId, lineId));
      changed();
    },
  };
}

export type Tally = ReturnType<typeof tallyFor>;

export function useTally(stopId: string): Tally {
  useSyncExternalStore(subscribe, () => version);
  return tallyFor(stopId);
}

// ── A refusal's pair ─────────────────────────────────────────────────────────────────────────────────────────────

// Something's wrong's own counts for a refusal (spec 013, rule 5): per line, how many the shop refused, shown as two
// boxes, "Accepted" (what was loaded less what was refused) and "Refused", so + on one takes from the other. Each box
// keeps what is typed as the unload boxes do (Q-25): a count from 0 to what was loaded sets the pair, and anything else
// stays as it was typed until it is fixed.
export type PairBox = 'accepted' | 'refused';
export interface Pair { refused: Record<string, number>; typed: Record<string, string> }
export const NO_PAIR: Pair = { refused: {}, typed: {} };

const boxKey = (lineId: string, box: PairBox) => `${lineId}:${box}`;
const withoutLine = (typedNow: Record<string, string>, lineId: string) => Object.fromEntries(Object.entries(typedNow).filter(([key]) => !key.startsWith(`${lineId}:`)));
// The refused count a box's count stands for.
const refusedFrom = (box: PairBox, count: number, loaded: number) => (box === 'accepted' ? loaded - count : count);
const withRefused = (pair: Pair, lineId: string, refused: number, loaded: number) => ({ ...pair.refused, [lineId]: Math.min(loaded, Math.max(0, refused)) });

export const refusalPair = {
  refusedOf: (pair: Pair, lineId: string) => pair.refused[lineId] ?? 0,
  textOf: (pair: Pair, lineId: string, box: PairBox): string | undefined => pair.typed[boxKey(lineId, box)],
  // The box holds something that is not a count from 0 to what was loaded.
  isWrong: (pair: Pair, lineId: string, box: PairBox, loaded: number) => {
    const text = pair.typed[boxKey(lineId, box)];
    return text !== undefined && readBox(text, loaded).kind !== 'count';
  },
  // − and +: both boxes show the pair's new count.
  step: (pair: Pair, lineId: string, box: PairBox, count: number, loaded: number): Pair =>
    ({ refused: withRefused(pair, lineId, refusedFrom(box, count, loaded), loaded), typed: withoutLine(pair.typed, lineId) }),
  // Typing keeps the text. A count sets the pair, and the other box shows it from then on.
  type: (pair: Pair, lineId: string, box: PairBox, text: string, loaded: number): Pair => {
    const reading = readBox(text, loaded);
    if (reading.kind !== 'count') return { ...pair, typed: { ...pair.typed, [boxKey(lineId, box)]: text } };
    return { refused: withRefused(pair, lineId, refusedFrom(box, reading.count, loaded), loaded), typed: { ...withoutLine(pair.typed, lineId), [boxKey(lineId, box)]: text } };
  },
  // Leaving a box shows a count as the count. Anything else stays as it was typed.
  leave: (pair: Pair, lineId: string, box: PairBox, loaded: number): Pair => {
    const text = pair.typed[boxKey(lineId, box)];
    if (text === undefined || readBox(text, loaded).kind !== 'count') return pair;
    return { ...pair, typed: Object.fromEntries(Object.entries(pair.typed).filter(([key]) => key !== boxKey(lineId, box))) };
  },
  // A line no longer picked takes what its boxes held with it.
  drop: (pair: Pair, lineId: string): Pair => ({ ...pair, typed: withoutLine(pair.typed, lineId) }),
};
