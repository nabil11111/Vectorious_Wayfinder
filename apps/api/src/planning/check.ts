import type { PlanCheck, Problem, TripCheck, VehicleDay } from '@wayfinder/contracts';
import { vehicleFuel } from './fuel';
import { computeLoad } from './load';
import { lookup } from './lookup';
import { cargoProblems } from './rules/cargo';
import { coverageProblems } from './rules/coverage';
import { dayProblems } from './rules/day';
import { timeProblems } from './rules/time';
import { budgetMinutes, timeVehicleDay, tripsOf } from './timeline';
import type { PlanInput, TripLoad, VehicleFuel, VehicleTimes } from './types';

// The plan checker (spec 007, AC-40 to AC-46). It takes the day's orders and a plan and says whether the plan
// may be sent, every problem in plain words, and the loads, times and litres it worked out. The plan board, the
// planner and the final send all call this one function, so a rule is written once and no screen works a
// number out itself.

const compare = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

// Where a problem goes in the list (AC-43): blocks before warnings, then by vehicle, trip and stop. At every
// level the narrower comes first: a trip's stops, then what is about the whole trip, then the vehicle's next
// trip, then what is about the whole vehicle, and what is about the whole plan last.
const LAST = Number.POSITIVE_INFINITY;
const placeOf = (problem: Problem) => [
  problem.level === 'block' ? 0 : 1,
  problem.vehicleId === undefined ? 1 : 0,
  problem.vehicleId ?? '',
  problem.tripNo ?? LAST,
  problem.stopSeq ?? LAST,
] as const;
const inOrder = (a: Problem, b: Problem) => {
  const [placeA, placeB] = [placeOf(a), placeOf(b)];
  for (const [i, part] of placeA.entries()) {
    const order = compare(part, placeB[i]!);
    if (order !== 0) return order;
  }
  // Equal places keep the order the rules reported them in.
  return 0;
};

export function checkPlan(input: PlanInput): PlanCheck {
  // A vehicle, shop or order the input does not hold is a programming mistake, and every piece below throws
  // for one it is handed (AC-45). Only an order on no trip would slip through with a line that cannot be
  // weighed, so every order's lines are weighed here first.
  const orderOf = lookup(input.orders, 'order');
  for (const order of input.orders) computeLoad(order.lines, input.products);

  // Every vehicle of the plan: its trips in the order they are driven, each with its load and its times. A
  // trip's load is worked out from every line of every order on it, so rounding never piles up. A trip that
  // cannot be timed has no times, and the rules give it a block.
  const trips: TripCheck[] = [];
  const tripLoads: TripLoad[] = [];
  const vehicleTimes = new Map<string, VehicleTimes>();
  for (const vehicleId of [...new Set(input.plan.trips.map((trip) => trip.vehicleId))].sort(compare)) {
    const day = timeVehicleDay(input, vehicleId);
    vehicleTimes.set(vehicleId, day);
    for (const [i, trip] of tripsOf(input, vehicleId).entries()) {
      const timed = day.trips[i];
      if (!timed) throw new Error(`No times came back for ${vehicleId} trip ${trip.tripNo}`);
      const lines = trip.stops.flatMap((stop) => stop.orderIds).flatMap((orderId) => orderOf(orderId).lines);
      const load = computeLoad(lines, input.products);
      tripLoads.push({ vehicleId, tripNo: trip.tripNo, load });
      trips.push({ vehicleId, tripNo: trip.tripNo, load, times: timed.times });
    }
  }

  // Every vehicle of the input gets its line, so a screen can show the fuel left of a truck the plan does not
  // drive yet. The fuel rule only judges the ones this plan drives.
  const vehicles: VehicleDay[] = [];
  const vehicleFuels: VehicleFuel[] = [];
  for (const vehicle of input.vehicles) {
    const day = vehicleTimes.get(vehicle.id) ?? { vehicleId: vehicle.id, trips: [] };
    const fuel = vehicleFuel(input, day);
    vehicleFuels.push(fuel);
    // The kilometres are for the fuel rule. A screen gets the litres.
    const { kmPlan: _kmPlan, ...litres } = fuel;
    vehicles.push({ ...litres, ...budgetMinutes(input, day) });
  }

  const problems = [
    ...cargoProblems(input, tripLoads),
    ...coverageProblems(input),
    ...timeProblems(input, [...vehicleTimes.values()]),
    ...dayProblems(input, vehicleFuels),
  ].sort(inOrder);

  return { ok: problems.every((problem) => problem.level !== 'block'), problems, trips, vehicles };
}
