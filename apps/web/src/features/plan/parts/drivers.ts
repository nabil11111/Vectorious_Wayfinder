import type { BoardDriver, DraftPlan } from '@wayfinder/contracts';
import type { Undo } from '../board';
import { setDriver, vehicleOfDriver, type TripKey } from '../draft';

// The driver menu's rows and what choosing one does (rule 6, spec 022).

// A driver in the menu: chosen when it drives this vehicle, and with the other vehicle it drives, which choosing it
// swaps with. Every row can be chosen.
export interface DriverRow { id: string; name: string; chosen: boolean; swapWith: string | null; note: string | null }

// The depot's drivers by name, for a vehicle whose driver is driverId.
export function driverRows(plan: DraftPlan, vehicleId: string, drivers: BoardDriver[], driverId: string | null): DriverRow[] {
  return [...drivers].sort((a, b) => a.name.localeCompare(b.name)).map((driver) => {
    const swapWith = vehicleOfDriver(plan, driver.id, vehicleId);
    return { id: driver.id, name: driver.name, chosen: driver.id === driverId, swapWith, note: swapWith ? `on ${swapWith} · swap` : null };
  });
}

// Choosing the open trip's driver as one change of the draft (D-97). A driver from another vehicle swaps the two
// vehicles' drivers on every trip of each, so the trip shows the line with Undo, which puts both back.
export function driverChange(plan: DraftPlan, tripKey: TripKey, vehicleId: string, driverId: string | null): { plan: DraftPlan; undo?: Undo } {
  const other = driverId === null ? null : vehicleOfDriver(plan, driverId, vehicleId);
  const next = setDriver(plan, vehicleId, driverId);
  return other === null ? { plan: next } : { plan: next, undo: { before: plan, line: `Drivers of ${vehicleId} and ${other} swapped`, tripKey } };
}
