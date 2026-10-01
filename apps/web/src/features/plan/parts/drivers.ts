import type { BoardDriver, DraftPlan } from '@wayfinder/contracts';
import type { Undo } from '../board';
import { setDriver, vehicleOfDriver, type TripKey } from '../draft';

// The driver menu's rows and what choosing one does (rule 6, spec 022), a driver from another vehicle moving here
// (spec 026, rule 2).

// "drives VEH004 now; it will have no driver": what a driver on another vehicle's row says before the press, after
// their name. The crew picker says it the same way.
export const movesLine = (vehicleId: string) => `drives ${vehicleId} now; it will have no driver`;

// A driver in the menu: chosen when it drives this vehicle, and with the other vehicle it drives, which choosing it
// leaves with no driver. Every row can be chosen.
export interface DriverRow { id: string; name: string; chosen: boolean; movesFrom: string | null; note: string | null }

// The depot's drivers by name, for a vehicle whose driver is driverId.
export function driverRows(plan: DraftPlan, vehicleId: string, drivers: BoardDriver[], driverId: string | null): DriverRow[] {
  return [...drivers].sort((a, b) => a.name.localeCompare(b.name)).map((driver) => {
    const movesFrom = vehicleOfDriver(plan, driver.id, vehicleId);
    return { id: driver.id, name: driver.name, chosen: driver.id === driverId, movesFrom, note: movesFrom ? movesLine(movesFrom) : null };
  });
}

// Choosing the open trip's driver as one change of the draft (rule 2), named for the history (spec 027). A driver from
// another vehicle leaves it with no driver, so the trip shows the line with Undo, which puts him back there.
export function driverChange(plan: DraftPlan, tripKey: TripKey, vehicleId: string, driver: BoardDriver | null): { plan: DraftPlan; undo: Undo } {
  const other = driver === null ? null : vehicleOfDriver(plan, driver.id, vehicleId);
  const next = setDriver(plan, vehicleId, driver?.id ?? null);
  if (driver === null) return { plan: next, undo: { line: 'Driver taken off the truck', tripKey: null } };
  return other === null ? { plan: next, undo: { line: `${driver.name} chosen as the driver`, tripKey: null } }
    : { plan: next, undo: { line: `${driver.name} moved from ${other}, which has no driver now`, tripKey } };
}
