import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { outlets, plans, stops, trips, users, vehicles } from '../db/schema';
import { usualPairing } from './suggestion';

// Crews (spec 026, D-100): each truck of a depot with its usual driver.

// The depot's drivers in staff ID order: the order the fixed pairing and the suggestion's free drivers go by (D-97).
export const staffOf = (tx: Tx, depotId: string) => tx.select({ id: users.id, name: users.displayName }).from(users)
  .where(and(eq(users.depotId, depotId), eq(users.role, 'driver'), eq(users.active, true))).orderBy(users.staffId, users.id);

export interface Crews {
  // The depot's drivers in staff ID order.
  staff: { id: string; name: string }[];
  // Each truck of the depot, archived ones aside, to its usual driver or null.
  usual: Map<string, string | null>;
  // Each truck to the districts its trips ran on the depot's latest sent plan, in the order it ran them.
  districts: Map<string, string[]>;
}

// What the depot's latest sent plan before the day says of each truck: the driver who drove it, while he still drives
// for the depot, and the districts it ran. The usual driver comes from it, or else from the fixed pairing of the drivers
// in staff ID order with the trucks in id order. A sent plan with no trips, as the seed's are, says nothing.
export async function crewsOf(tx: Tx, depotId: string, date: string): Promise<Crews> {
  const staff = await staffOf(tx, depotId);
  const fleet = await tx.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.depotId, depotId), isNull(vehicles.archivedAt))).orderBy(vehicles.id);
  const [latest] = await tx.select({ id: plans.id }).from(plans)
    .where(and(eq(plans.depotId, depotId), eq(plans.status, 'published'), lt(plans.date, date))).orderBy(desc(plans.date)).limit(1);
  const ran = latest ? await tx.select({ id: trips.id, vehicleId: trips.vehicleId, driverId: trips.driverId }).from(trips)
    .where(eq(trips.planId, latest.id)).orderBy(trips.vehicleId, trips.tripNo) : [];
  const places = ran.length ? await tx.select({ tripId: stops.tripId, district: outlets.district }).from(stops)
    .innerJoin(outlets, eq(outlets.id, stops.outletId)).where(inArray(stops.tripId, ran.map((t) => t.id))).orderBy(stops.seq) : [];
  const drivers = new Set(staff.map((d) => d.id));
  const history = new Map<string, string>();
  const districts = new Map<string, string[]>();
  for (const trip of ran) {
    if (trip.driverId !== null && drivers.has(trip.driverId) && !history.has(trip.vehicleId)) history.set(trip.vehicleId, trip.driverId);
    const seen = districts.get(trip.vehicleId) ?? [];
    for (const { district } of places.filter((p) => p.tripId === trip.id)) if (!seen.includes(district)) seen.push(district);
    districts.set(trip.vehicleId, seen);
  }
  return { staff, usual: usualPairing(fleet.map((v) => v.id), history, staff.map((d) => d.id)), districts };
}
