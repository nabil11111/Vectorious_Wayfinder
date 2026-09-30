import type { BoardDriver, BoardOrder, BoardShop, BoardVehicle, Brand, PlanBoard, Problem, TripCheck, TripFigures, VehicleDay } from '@wayfinder/contracts';
import { countOf } from '../words';

// A group of the unplanned list: a brand and a district.
export const groupKey = (brand: Brand, district: string) => `${brand}-${district}`;

// One item of the checks: a problem, or all the orders on no trip together.
export interface CheckItem { key: string; level: Problem['level']; title: string; fix?: string; trip?: string }

// The checks as View plan lists them (spec 010, View plan): each block, then each warning, in the checker's order,
// with the orders on no trip as one item. Counting the items is the screen's; every sentence is the checker's.
export function checkItems(problems: Problem[]): CheckItem[] {
  const unplanned = problems.filter((problem) => problem.code === 'order_not_planned');
  const items: CheckItem[] = [];
  for (const level of ['block', 'warn'] as const) {
    for (const [i, problem] of problems.entries()) {
      if (problem.level !== level || problem.code === 'order_not_planned') continue;
      items.push({
        key: `${level}-${i}`,
        level,
        title: problem.message,
        fix: problem.fix,
        trip: problem.vehicleId !== undefined && problem.tripNo !== undefined ? `${problem.vehicleId}-${problem.tripNo}` : undefined,
      });
    }
    if (level === 'block' && unplanned.length > 0) {
      items.push({ key: 'unplanned', level: 'block', title: `${countOf(unplanned.length, 'order is', 'orders are')} on no trip and not deferred.`, fix: 'Put each on a trip or defer it with a reason.' });
    }
  }
  return items;
}

// The board's records by id, and the checker's answer by trip, so the parts can find what a draft names. Only
// lookups: nothing here adds anything up.
export interface BoardIndex {
  shop: (id: string) => BoardShop | null;
  order: (id: string) => BoardOrder | null;
  vehicle: (id: string) => BoardVehicle | null;
  driver: (id: string | null) => BoardDriver | null;
  // The checker's load and times for a trip, as the last answer had it.
  trip: (vehicleId: string, tripNo: number) => TripCheck | null;
  figures: (vehicleId: string, tripNo: number) => TripFigures | null;
  vehicleDay: (vehicleId: string) => VehicleDay | null;
  // A trip's problems: those about it, its stops and its orders, and those about its whole vehicle.
  problems: (vehicleId: string, tripNo: number) => Problem[];
}

const byId = <T extends { id: string }>(rows: T[]) => {
  const map = new Map(rows.map((row) => [row.id, row]));
  return (id: string | null) => (id === null ? null : map.get(id) ?? null);
};

export function indexOf(board: PlanBoard): BoardIndex {
  const trips = new Map((board.check?.trips ?? []).map((trip) => [`${trip.vehicleId}-${trip.tripNo}`, trip]));
  const figures = new Map((board.figures ?? []).map((figure) => [`${figure.vehicleId}-${figure.tripNo}`, figure]));
  const days = new Map((board.check?.vehicles ?? []).map((day) => [day.vehicleId, day]));
  const problems = board.check?.problems ?? [];
  const shop = byId(board.shops);
  const order = byId(board.orders);
  const vehicle = byId(board.vehicles);
  const driver = byId(board.drivers);
  return {
    shop: (id) => shop(id),
    order: (id) => order(id),
    vehicle: (id) => vehicle(id),
    driver,
    trip: (vehicleId, tripNo) => trips.get(`${vehicleId}-${tripNo}`) ?? null,
    figures: (vehicleId, tripNo) => figures.get(`${vehicleId}-${tripNo}`) ?? null,
    vehicleDay: (vehicleId) => days.get(vehicleId) ?? null,
    problems: (vehicleId, tripNo) => problems.filter((p) => p.vehicleId === vehicleId && (p.tripNo === undefined || p.tripNo === tripNo)),
  };
}
