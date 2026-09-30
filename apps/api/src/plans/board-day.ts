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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A day as the screens write it, 'Thu 25 Jun', for the sentences the API sends.
export function dayLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return `${WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]} ${day} ${MONTHS[month - 1]}`;
}

// A whole percentage, halves up (rule 12). Rounding the quotient to six places first takes away floating-point
// noise, so 35.91 of 38, exactly 94.5%, is 95 and not 94.
export const percent = (value: number, total: number) => total ? Math.round(Number(((value * 100) / total).toFixed(6))) : 0;

