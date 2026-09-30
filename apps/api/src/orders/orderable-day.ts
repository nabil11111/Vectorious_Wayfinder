// The day an order placed now is for (spec 009): the first operating day whose cut-off has not passed. Plain
// values in and out, with no database and no clock, so the rule can be tested on the rows of the spec's table.

// A day's orders close at 16:00 on the operating day before it, in depot time.
export const CUTOFF_MINUTES = 16 * 60;

export interface OrderableDay {
  deliveryDate: string;
  // The operating day before it, on which its orders close at CUTOFF_MINUTES.
  cutoffDate: string;
}

// today and the operating days are 'YYYY-MM-DD' and minutesNow is minutes after midnight, all at the depot.
// null when no operating day is left to order for, which is what happens at the end of the calendar.
export function orderableDay(today: string, minutesNow: number, operatingDays: string[]): OrderableDay | null {
  const ahead = operatingDays.filter((day) => day >= today).sort();
  // Today is the day that closes the next one only while it is an operating day and it is not 16:00 yet.
  // Otherwise the next operating day closes the one after it.
  const closing = ahead[0] === today && minutesNow >= CUTOFF_MINUTES ? 1 : 0;
  const cutoffDate = ahead[closing];
  const deliveryDate = ahead[closing + 1];
  return cutoffDate && deliveryDate ? { deliveryDate, cutoffDate } : null;
}
