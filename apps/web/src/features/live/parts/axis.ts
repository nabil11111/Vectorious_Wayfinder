import type { OperationsTimeline } from '@wayfinder/contracts';
import { depotDay } from '../words';

// Where an instant sits along the axis, from 0 to 100.
export function placeOn(timeline: OperationsTimeline, moment: string | number) {
  const start = Date.parse(timeline.start);
  const end = Date.parse(timeline.end);
  const at = typeof moment === 'string' ? Date.parse(moment) : moment;
  return Math.min(100, Math.max(0, ((at - start) / (end - start)) * 100));
}

// The app clock's instant as a now line: only on the section's own day and inside its axis.
export function nowOn(timeline: OperationsTimeline, date: string, at: number | null) {
  if (at === null || depotDay(at) !== date) return null;
  return at >= Date.parse(timeline.start) && at <= Date.parse(timeline.end) ? at : null;
}

// The rows' columns, shared by the axis, the now line and every trip row, so the timelines line up. Below 1280 the
// sentence sits under the truck; from 1280 it has its column, as the 1440 frame draws it.
export const ROW = 'grid items-center gap-x-2 grid-cols-[24px_168px_minmax(0,1fr)_84px] xl:grid-cols-[24px_132px_208px_minmax(0,1fr)_96px_80px]';
export const LINE_CELL = 'col-start-3 xl:col-start-4';
