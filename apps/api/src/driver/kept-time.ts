export function keptTime(claimed: Date, last: Date, now: Date): Date {
  // A clock moved backwards cannot undo the order of events already kept on the trip.
  return new Date(Math.max(last.getTime(), Math.min(claimed.getTime(), now.getTime())));
}
