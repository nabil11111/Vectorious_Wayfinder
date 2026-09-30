import { TEMPS, type PlanCheck, type Temp } from '@wayfinder/contracts';
import { PRODUCTS } from '../db/fixtures';
import { depotInstant } from '../lib/clock';
import { CUTOFF_MINUTES } from '../orders/orderable-day';

// The loader's list on plain values (spec 012): which day it shows, when and where each truck goes, and the order of
// a stop's lines. Nothing here reads a clock or a database.

// The loader's day (rule 1, D-34): today while today is an operating day and it is not 16:00 yet, and otherwise the
// first operating day after today. By 16:00 the day's trucks have left and the next day is being planned. Dates are
// YYYY-MM-DD and minutesNow is depot time. null when no operating day is left.
export function loaderDay(today: string, minutesNow: number, operatingDays: string[]): string | null {
  return [...operatingDays].sort().find((day) => day > today || (day === today && minutesNow < CUTOFF_MINUTES)) ?? null;
}

// Where and when a sent trip goes (rule 2): its district and its leaving time in its plan's kept check (spec 010), as
// an instant on the plan's day. A send keeps the times of every trip, so a sent trip without them is a broken plan.
export function sentTrip(planDate: string, check: PlanCheck | null, vehicleId: string, tripNo: number): { leavesAt: Date; district: string } {
  const times = check?.trips.find((t) => t.vehicleId === vehicleId && t.tripNo === tripNo)?.times;
  if (!times) throw new Error(`The sent plan for ${planDate} keeps no times for ${vehicleId} trip ${tripNo}.`);
  return { leavesAt: depotInstant(planDate, times.leaveAt), district: times.district };
}

// A stop's lines in the order the loader reads them: chilled before dry, then the order placed first, then the
// product list's order. An item that is not on the list comes last, as on the shop's screens.
interface Placed { temp: Temp; placedAt: Date | null; orderId: string; productId: string }
const placeInList = (id: string) => {
  const place = PRODUCTS.findIndex((product) => product.id === id);
  return place === -1 ? PRODUCTS.length : place;
};
const placedTime = (at: Date | null) => at?.getTime() ?? Number.MAX_SAFE_INTEGER;
export const byLoadOrder = (a: Placed, b: Placed): number => TEMPS.indexOf(a.temp) - TEMPS.indexOf(b.temp)
  || placedTime(a.placedAt) - placedTime(b.placedAt) || a.orderId.localeCompare(b.orderId) || placeInList(a.productId) - placeInList(b.productId);
