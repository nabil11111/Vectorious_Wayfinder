import type {
  BoardDriver, BoardOrder, BoardShop, BoardSuggestion, BoardVehicle, Brand, PlanBoard, Problem, SuggestionChoice, TripCheck, TripFigures, VehicleDay,
} from '@wayfinder/contracts';
import { countOf, crewName, truckCalled } from '../words';

// One of the planner's decisions as the board answers it (spec 014).
export type BoardDecision = BoardSuggestion['decisions'][number];

// The decisions the screens list: open ones and accepted ones. A decision an edit has ended is not listed (rule 6).
export const listed = (decision: BoardDecision) => decision.open || decision.acceptedAt !== null;
export const decisionsOf = (board: PlanBoard): BoardDecision[] => board.suggestion?.decisions.filter(listed) ?? [];

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
  // The planner's choice for this order, so both parts of a split find their original's (spec 014). null for an order
  // the planner never saw, such as a part split by hand after the build.
  choice: (orderId: string) => SuggestionChoice | null;
  // The planner's decisions about this order, listed or not, in the planner's order.
  decisions: (orderId: string) => BoardDecision[];
  // A trip's truck named by its driver (spec 026): on a card or header, "Chaminda · dry truck", and in a sentence,
  // "Chaminda's dry truck".
  crew: (trip: TripRef) => string;
  called: (trip: TripRef) => string;
}

// A trip as a name needs it: its truck, its number and its driver.
export interface TripRef { vehicleId: string; tripNo: number; driverId: string | null }

// The name of the shop a decision's order goes to, or null for an early departure or an order the board no longer has.
export function decisionShop(index: BoardIndex, decision: BoardDecision): string | null {
  const order = decision.orderId === null ? null : index.order(decision.orderId);
  return order ? index.shop(order.outletId)?.name ?? null : null;
}

// The trip an early departure is about, in a sentence's words with the draft's driver (spec 026), or null for a decision
// about an order.
export function decisionTruck(index: BoardIndex, plan: Pick<PlanBoard['plan'], 'trips'>, decision: BoardDecision): string | null {
  if (decision.vehicleId === null || decision.tripNo === null) return null;
  const driverId = plan.trips.find((trip) => trip.vehicleId === decision.vehicleId)?.driverId ?? null;
  return index.called({ vehicleId: decision.vehicleId, tripNo: decision.tripNo, driverId });
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
  // By the orders each choice became, and by the order the planner got, which an original joined back by hand is again.
  const choices = new Map((board.suggestion?.choices ?? []).flatMap((choice) => [choice.orderId, ...choice.resultOrderIds].map((id) => [id, choice] as const)));
  const decided = new Map<string, BoardDecision[]>();
  for (const decision of board.suggestion?.decisions ?? []) {
    if (decision.orderId !== null) decided.set(decision.orderId, [...(decided.get(decision.orderId) ?? []), decision]);
  }
  return {
    shop: (id) => shop(id),
    order: (id) => order(id),
    vehicle: (id) => vehicle(id),
    driver,
    trip: (vehicleId, tripNo) => trips.get(`${vehicleId}-${tripNo}`) ?? null,
    figures: (vehicleId, tripNo) => figures.get(`${vehicleId}-${tripNo}`) ?? null,
    vehicleDay: (vehicleId) => days.get(vehicleId) ?? null,
    problems: (vehicleId, tripNo) => problems.filter((p) => p.vehicleId === vehicleId && (p.tripNo === undefined || p.tripNo === tripNo)),
    choice: (orderId) => choices.get(orderId) ?? null,
    decisions: (orderId) => decided.get(orderId) ?? [],
    // A truck the board does not list goes by its number.
    crew: (trip) => {
      const truck = vehicle(trip.vehicleId);
      return truck ? crewName(truck, driver(trip.driverId)?.name ?? null, trip.tripNo) : trip.vehicleId;
    },
    called: (trip) => {
      const truck = vehicle(trip.vehicleId);
      return truck ? truckCalled(truck, driver(trip.driverId)?.name ?? null, trip.tripNo) : trip.vehicleId;
    },
  };
}
