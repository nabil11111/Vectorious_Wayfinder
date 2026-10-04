import type { PlanCheck, PlanOutcome } from '@wayfinder/contracts';

// Coverage and fuel, counted once so a split or a second trip cannot improve the headline by itself.

export interface CoverageOrder { id: string; splitFrom: string | null }

export interface Coverage {
  originalDue: number;
  originalFull: number;
  originalPart: number;
  originalDeferred: number;
  originalWaiting: number;
}

export function coverageOf(orders: readonly CoverageOrder[], placed: ReadonlySet<string>, deferred: ReadonlySet<string>): Coverage {
  const groups = new Map<string, string[]>();
  for (const order of orders) {
    const key = order.splitFrom ?? order.id;
    groups.set(key, [...(groups.get(key) ?? []), order.id]);
  }
  let originalFull = 0;
  let originalPart = 0;
  let originalDeferred = 0;
  let originalWaiting = 0;
  for (const ids of groups.values()) {
    const onTrip = ids.filter((id) => placed.has(id)).length;
    const held = ids.filter((id) => deferred.has(id)).length;
    if (onTrip === ids.length) originalFull += 1;
    else if (onTrip > 0) originalPart += 1;
    else if (held === ids.length) originalDeferred += 1;
    else originalWaiting += 1;
  }
  return { originalDue: groups.size, originalFull, originalPart, originalDeferred, originalWaiting };
}

export interface FuelFigures { fuelL: number | null; km: number | null; vehicleHours: number | null; waitHours: number | null }

// Litres are the checker's vehicle-day totals, summed once. A trip with no times makes the estimate unknown.
export function fuelFigures(check: PlanCheck | null, vehicleIds: ReadonlySet<string>): FuelFigures {
  if (!check || vehicleIds.size === 0) return { fuelL: null, km: null, vehicleHours: null, waitHours: null };
  const trips = check.trips.filter((trip) => vehicleIds.has(trip.vehicleId));
  if (trips.length === 0 || trips.some((trip) => trip.times === null)) return { fuelL: null, km: null, vehicleHours: null, waitHours: null };
  const timed = trips.flatMap((trip) => (trip.times ? [trip.times] : []));
  const tenths = (n: number) => Math.round(n * 10);
  const fuelL = check.vehicles.filter((vehicle) => vehicleIds.has(vehicle.vehicleId)).reduce((sum, vehicle) => sum + tenths(vehicle.litresPlan), 0) / 10;
  const km = timed.reduce((sum, trip) => sum + tenths(trip.km), 0) / 10;
  const vehicleHours = timed.reduce((sum, trip) => sum + (trip.backAt - trip.leaveAt), 0) / 60;
  const waitHours = timed.reduce((sum, trip) => sum + trip.stops.reduce((n, stop) => n + stop.waitMin, 0), 0) / 60;
  return { fuelL, km, vehicleHours, waitHours };
}

// The busiest trip of each refrigerated vehicle. Second trips do not add the vehicle's capacity twice.
export function fridgePeak(check: PlanCheck, reeferIds: ReadonlySet<string>): number {
  const peak = new Map<string, number>();
  for (const trip of check.trips) {
    if (!reeferIds.has(trip.vehicleId)) continue;
    peak.set(trip.vehicleId, Math.max(peak.get(trip.vehicleId) ?? 0, trip.load.m3));
  }
  return Math.round([...peak.values()].reduce((sum, m3) => sum + m3, 0) * 1000) / 1000;
}

export function outcomeOf(parts: {
  orders: readonly CoverageOrder[];
  placed: ReadonlySet<string>;
  deferred: ReadonlySet<string>;
  vehicles: number;
  trips: number;
  stops: number;
  stopsOnTime: number;
  fuel: FuelFigures;
  blockers: number;
  warnings: number;
  driversMissing: number;
}): PlanOutcome {
  return {
    ...coverageOf(parts.orders, parts.placed, parts.deferred),
    vehicles: parts.vehicles, trips: parts.trips, stops: parts.stops, stopsOnTime: parts.stopsOnTime,
    fuelL: parts.fuel.fuelL, km: parts.fuel.km, vehicleHours: parts.fuel.vehicleHours,
    blockers: parts.blockers, warnings: parts.warnings, driversMissing: parts.driversMissing,
  };
}

// current minus suggested. Positive means the suggestion uses less estimated fuel. Null when either estimate is unknown.
export function fuelDelta(current: number | null, suggested: number | null): number | null {
  if (current === null || suggested === null) return null;
  return Math.round((current - suggested) * 10) / 10;
}

export function comparisonSummary(current: PlanOutcome, suggested: PlanOutcome | null, unavailable: string | null): string {
  if (!suggested) return unavailable ?? 'No suggested plan could be checked.';
  const same = current.originalFull === suggested.originalFull && current.originalPart === suggested.originalPart
    && current.originalDeferred === suggested.originalDeferred && current.originalWaiting === suggested.originalWaiting;
  const delta = fuelDelta(current.fuelL, suggested.fuelL);
  if (!same && suggested.originalFull + suggested.originalPart < current.originalFull + current.originalPart && delta !== null && delta > 0) {
    return 'Lower estimated fuel because less demand is covered';
  }
  if (!same && suggested.originalFull > current.originalFull && delta !== null && delta < 0) return 'More demand covered with additional fuel';
  if (!same && suggested.originalFull > current.originalFull && delta !== null && delta >= 0) return 'More demand covered without more estimated fuel';
  if (!same) return 'The plans cover different demand';
  if (delta === null) return 'Fuel cannot be estimated for both plans';
  if (delta > 0) return 'Lower estimated fuel for the same demand covered';
  if (delta < 0) return 'Your plan uses less estimated fuel';
  return 'No meaningful change';
}
