import { CUTOFF_MINUTES } from '../orders/orderable-day';

export interface BoardDay {
  date: string;
  cutoffDate: string;
  open: boolean;
}

// The board stays on today's operating day until the first trucks leave at 03:30. After that it moves
// to the next operating day, whose orders close at 16:00 on the operating day before it (D-28).
// Dates are YYYY-MM-DD and minutesNow is depot time. This rule needs neither a clock nor a database.
export function boardDay(today: string, minutesNow: number, operatingDays: string[]): BoardDay | null {
  const days = [...operatingDays].sort();
  const index = days.findIndex((day) => day > today || (day === today && minutesNow < 3 * 60 + 30));
  const date = days[index];
  const cutoffDate = days[index - 1];
  if (!date || !cutoffDate) return null;
  return {
    date,
    cutoffDate,
    open: today > cutoffDate || (today === cutoffDate && minutesNow >= CUTOFF_MINUTES),
  };
}
