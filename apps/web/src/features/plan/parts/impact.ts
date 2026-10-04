import type { BoardCounts } from '@wayfinder/contracts';

// The effect of one saved edit, from the board's own counts. A zero change is said. Unknown fuel is not zero.
const tenth = (n: number) => Math.round(n * 10) / 10;

export function impactLine(before: BoardCounts, after: BoardCounts, problems?: { before: number; after: number }): string {
  const parts: string[] = [];
  const covered = after.originalFull - before.originalFull;
  if (covered === 1) parts.push('One more original order fully covered');
  else if (covered === -1) parts.push('One fewer original order fully covered');
  else if (covered !== 0) parts.push(`${Math.abs(covered)} ${covered > 0 ? 'more' : 'fewer'} original orders fully covered`);
  const trips = after.trips - before.trips;
  if (trips === 1) parts.push('one additional trip');
  else if (trips === -1) parts.push('one fewer trip');
  else if (trips !== 0) parts.push(`${Math.abs(trips)} ${trips > 0 ? 'more' : 'fewer'} trips`);
  if (before.planFuelL === null || after.planFuelL === null) parts.push('fuel estimate not available yet');
  else {
    const delta = tenth(after.planFuelL - before.planFuelL);
    if (delta > 0) parts.push(`fuel estimate up ${delta} L`);
    else if (delta < 0) parts.push(`fuel estimate down ${Math.abs(delta)} L`);
    else parts.push('fuel estimate unchanged');
  }
  if (before.vehicleHours !== null && after.vehicleHours !== null) {
    const hours = tenth(after.vehicleHours - before.vehicleHours);
    if (hours > 0) parts.push(`vehicle-hours up ${hours.toFixed(1)}`);
    else if (hours < 0) parts.push(`vehicle-hours down ${Math.abs(hours).toFixed(1)}`);
  }
  if (problems) {
    const changed = problems.after - problems.before;
    if (changed === 1) parts.push('1 new problem');
    else if (changed > 1) parts.push(`${changed} new problems`);
    else if (changed === -1) parts.push('1 problem cleared');
    else if (changed < -1) parts.push(`${Math.abs(changed)} problems cleared`);
  }
  const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  return parts.length > 0 ? parts.map(sentence).join('. ') : 'No change in coverage, trips or estimated fuel';
}
