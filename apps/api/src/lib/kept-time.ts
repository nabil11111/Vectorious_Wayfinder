// The time kept for a time a phone recorded (D-46, D-57): the phone's own when it lies between what the record
// follows, `last`, and the server's clock read once the trip is locked, `now`, and otherwise the nearer of the two. For
// a driver write `last` is the trip's last event, and for a shop's receipt the stop's handover.
export function keptTime(claimed: Date, last: Date, now: Date): Date {
  // A clock moved backwards cannot undo the order of events already kept on the trip.
  return new Date(Math.max(last.getTime(), Math.min(claimed.getTime(), now.getTime())));
}
