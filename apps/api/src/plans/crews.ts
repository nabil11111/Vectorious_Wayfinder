import { CREW_MISFITS, type Crew, type CrewList, type CrewMisfit, type CrewQuery, type PlanBoard } from '@wayfinder/contracts';
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { outlets, plans, stops, trips, users, vehicles } from '../db/schema';
import { HttpError } from '../lib/errors';
import { snapshot } from '../orders/store-orders';
import { checkPlan, computeLoad, type PlanInput } from '../planning';
import type { Planner } from '../routes/plans';
import { readBoard } from './board';
import { usualPairing } from './suggestion';

// Crews (spec 026, D-100): each truck of a depot with its usual driver, and the crew picker's read, which lists every
// truck for a trip's orders by whether it takes them, the district it ran last time and its fuel.

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

const FITS = new Set<string>(CREW_MISFITS);
const misfitOf = (code: string) => CREW_MISFITS.find((c) => c === code)!;

// The picker's order (spec 026): the crews that can be picked first, those whose truck takes the orders before those
// that do not, then those that ran the orders' district, then the most fuel left, then by truck. The ones that cannot
// be picked come last, by truck.
function pickerOrder(a: Crew, b: Crew) {
  if ((a.unavailable === null) !== (b.unavailable === null)) return a.unavailable === null ? -1 : 1;
  const first = a.unavailable === null ? Number(b.fits) - Number(a.fits) || Number(b.ranHere) - Number(a.ranHere) || b.fuelLeftPct - a.fuelLeftPct : 0;
  return first || a.vehicleId.localeCompare(b.vehicleId);
}

// GET /plans/:date/crews?orders=…: every crew of the caller's depot for the orders, read from the board's own snapshot.
// A crew's driver is the one the draft gives its truck, or its usual driver when the draft has no trip on it and he
// drives no other truck there; a truck in the workshop names none (L-05). Whether its
// truck takes the orders is the checker's cargo rules on a trip of it carrying these orders alone (rule 12).
export function findCrews(caller: Planner, date: string, { orders: asked }: CrewQuery): Promise<CrewList> {
  return snapshot(async (tx) => {
    const { board, input } = await readBoard(tx, caller.depotId, date);
    if (board.plan.status === 'published') throw new HttpError(409, 'plan_sent', 'This plan has been sent.');
    if (!input) throw new Error('A dated plan board has no checker input.');
    const orderIds = [...new Set(asked)];
    const orders = orderIds.map((id) => {
      const order = board.orders.find((o) => o.id === id);
      if (!order) throw new HttpError(400, 'unknown_record', 'That order is not one of this depot\'s orders for the day.', { id });
      return order;
    });
    const { usual, districts } = await crewsOf(tx, caller.depotId, date);
    const here = new Set(orders.map((order) => shopOf(board, order.outletId).district));
    const misfitsOf = trialOf(input, orders);
    // A driver is on one row only, the truck he drives on the draft (L-05). A truck the draft has no trip on takes its
    // usual driver while he drives none there, and a truck in the workshop names nobody.
    const driving = new Set(board.plan.trips.flatMap((t) => (t.driverId === null ? [] : [t.driverId])));
    const driverOf = (vehicle: PlanBoard['vehicles'][number], own: PlanBoard['plan']['trips']) => {
      if (!vehicle.working) return null;
      if (own[0]) return own[0].driverId;
      const usualDriver = usual.get(vehicle.id) ?? null;
      return usualDriver !== null && !driving.has(usualDriver) ? usualDriver : null;
    };
    const crews = board.vehicles.filter((vehicle) => usual.has(vehicle.id)).map((vehicle): Crew => {
      const own = board.plan.trips.filter((t) => t.vehicleId === vehicle.id);
      const ran = districts.get(vehicle.id) ?? [];
      const misfits = misfitsOf(vehicle.id);
      return {
        vehicleId: vehicle.id, driverId: driverOf(vehicle, own),
        type: vehicle.type, temp: vehicle.temp, weightCapKg: vehicle.weightCapKg, volumeCapM3: vehicle.volumeCapM3, fuelLeftPct: vehicle.fuelLeftPct,
        lastDistricts: ran, ranHere: ran.some((district) => here.has(district)), fits: misfits.length === 0, misfits,
        unavailable: vehicle.working ? (own.length >= 2 ? { kind: 'two_trips' } : null) : { kind: 'workshop', reason: offReasonOf(vehicle) },
      };
    });
    const load = computeLoad(input.orders.filter((o) => orderIds.includes(o.id)).flatMap((o) => o.lines), input.products);
    return { orderIds, revision: board.plan.revision, load: { kg: load.kg, m3: load.m3 }, crews: crews.sort(pickerOrder) };
  });
}

const shopOf = (board: PlanBoard, outletId: string) => {
  const shop = board.shops.find((s) => s.id === outletId);
  if (!shop) throw new Error(`No shop ${outletId} on the board.`);
  return shop;
};

// A truck of the fleet that is not working is in the workshop on the day, and the board says why.
const offReasonOf = (vehicle: PlanBoard['vehicles'][number]) => {
  if (vehicle.offReason === null) throw new Error(`${vehicle.id} is not working, and the board gives no reason.`);
  return vehicle.offReason;
};

// The checker on a trip of a truck carrying the orders alone, one stop a shop in the orders' own order: the cargo rules
// of spec 007 that the truck breaks. No orders, nothing to break.
function trialOf(input: PlanInput, orders: { id: string; outletId: string }[]) {
  const tripStops: { outletId: string; orderIds: string[] }[] = [];
  for (const order of orders) {
    const stop = tripStops.find((s) => s.outletId === order.outletId);
    if (stop) stop.orderIds.push(order.id);
    else tripStops.push({ outletId: order.outletId, orderIds: [order.id] });
  }
  const named = new Set(orders.map((o) => o.id));
  const day: PlanInput = { ...input, orders: input.orders.filter((o) => named.has(o.id)) };
  return (vehicleId: string): CrewMisfit[] => (orders.length === 0 ? [] : checkPlan({ ...day, plan: { trips: [{ vehicleId, tripNo: 1, stops: tripStops }], deferrals: [] } }).problems
    .filter((p) => p.vehicleId === vehicleId && FITS.has(p.code))
    .map((p) => ({ code: misfitOf(p.code), orderId: p.orderId ?? null, outletId: p.outletId ?? null })));
}
