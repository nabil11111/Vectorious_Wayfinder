import type { DraftDeferral, DraftPlan, DraftTrip, PlanBoard } from '@wayfinder/contracts';

// Every change the board makes to a plan, as a function from one draft to the next (spec 010, rules 4 to 7).
// They only move orders, stops and trips about. Nothing here reads the clock or works out a time, a load or a
// rule: the checker judges whatever comes out, when the draft is saved.

// A trip as the address names it: "VEH004-1".
export type TripKey = string;
export const keyOf = (trip: { vehicleId: string; tripNo: number }): TripKey => `${trip.vehicleId}-${trip.tripNo}`;
export const tripOf = (plan: DraftPlan, key: TripKey | null) => (key === null ? null : plan.trips.find((trip) => keyOf(trip) === key) ?? null);

// What the draft needs to know of an order: which it is and which shop it goes to.
export interface OrderRef { id: string; outletId: string }

// The draft inside a board.
export const planOf = (board: PlanBoard): DraftPlan => ({ mixBrands: board.plan.mixBrands, trips: board.plan.trips, deferrals: board.plan.deferrals });

// The lowest trip number a vehicle has free, 1 before 2, or null when it runs both (D-13).
export function freeTripNo(plan: DraftPlan, vehicleId: string): 1 | 2 | null {
  const taken = new Set(plan.trips.filter((trip) => trip.vehicleId === vehicleId).map((trip) => trip.tripNo));
  return !taken.has(1) ? 1 : !taken.has(2) ? 2 : null;
}

// Takes orders off their stops, a stop left with no order going too.
function offStops(trips: DraftTrip[], ids: Set<string>): DraftTrip[] {
  return trips.map((trip) => ({
    ...trip,
    stops: trip.stops.map((stop) => ({ ...stop, orderIds: stop.orderIds.filter((id) => !ids.has(id)) })).filter((stop) => stop.orderIds.length > 0),
  }));
}

// Takes orders out of wherever the draft has them: off their stops and out of the deferrals.
function without(plan: DraftPlan, ids: Set<string>): DraftPlan {
  return { ...plan, trips: offStops(plan.trips, ids), deferrals: plan.deferrals.filter((deferral) => !ids.has(deferral.orderId)) };
}

// Puts orders on a trip (rule 4): on the stop at the order's shop when the trip has one, else on a new stop, the last
// one unless a drop puts it before stop `at` (spec 023). New stops keep the orders' order.
function onto(trip: DraftTrip, orders: OrderRef[], at = trip.stops.length): DraftTrip {
  const stops = trip.stops.map((stop) => ({ ...stop, orderIds: [...stop.orderIds] }));
  let next = Math.min(Math.max(at, 0), stops.length);
  for (const order of orders) {
    const stop = stops.find((s) => s.outletId === order.outletId);
    if (stop) {
      stop.orderIds.push(order.id);
    } else {
      stops.splice(next, 0, { outletId: order.outletId, orderIds: [order.id] });
      next += 1;
    }
  }
  return { ...trip, stops };
}

// A trip 2 left alone on its vehicle becomes trip 1 (rule 4).
function renumber(trips: DraftTrip[], vehicleId: string): DraftTrip[] {
  if (trips.some((trip) => trip.vehicleId === vehicleId && trip.tripNo === 1)) return trips;
  return trips.map((trip) => (trip.vehicleId === vehicleId && trip.tripNo === 2 ? { ...trip, tripNo: 1 } : trip));
}

// A crew (spec 026): a truck and the driver picked with it, or null when it has none.
export interface CrewRef { vehicleId: string; driverId: string | null }

// Puts a driver on every trip of a vehicle (rule 6). A driver who drives another vehicle moves: that vehicle's trips
// are left with no driver, so nobody drives two (spec 026, rule 2).
function drivenBy(trips: DraftTrip[], vehicleId: string, driverId: string | null): DraftTrip[] {
  return trips.map((trip) => (trip.vehicleId === vehicleId ? { ...trip, driverId } : driverId !== null && trip.driverId === driverId ? { ...trip, driverId: null } : trip));
}

// The crew's driver on its truck, or, for a crew with none, the driver the truck already has.
const crewDriver = (trips: DraftTrip[], crew: CrewRef) => crew.driverId ?? trips.find((trip) => trip.vehicleId === crew.vehicleId && trip.driverId !== null)?.driverId ?? null;

// Starts a trip on a crew (spec 026, rule 1): on its truck, as the truck's lowest free trip number, leaving at the
// usual time, with the crew's driver on every trip of the truck, in one change. It holds the orders given, if any. null
// when the truck runs two trips already.
export function startTrip(plan: DraftPlan, crew: CrewRef, orders: OrderRef[] = []): { plan: DraftPlan; key: TripKey } | null {
  const tripNo = freeTripNo(plan, crew.vehicleId);
  if (tripNo === null) return null;
  const rest = without(plan, new Set(orders.map((order) => order.id)));
  const trip = onto({ vehicleId: crew.vehicleId, tripNo, leaveAt: null, driverId: null, stops: [] }, orders);
  return { plan: { ...rest, trips: drivenBy([...rest.trips, trip], crew.vehicleId, crewDriver(rest.trips, crew)) }, key: keyOf(trip) };
}

// Puts orders on a trip, new stops at the end or, for a drop, before stop `at`. An order the draft had elsewhere, on
// another stop or deferred, comes off there first, so the draft never names an order twice.
export function addOrders(plan: DraftPlan, key: TripKey, orders: OrderRef[], at?: number): DraftPlan {
  const rest = without(plan, new Set(orders.map((order) => order.id)));
  return { ...rest, trips: rest.trips.map((trip) => (keyOf(trip) === key ? onto(trip, orders, at) : trip)) };
}

// Takes orders off their stops. They are unplanned again, and a stop left empty goes (rule 4).
export const takeOff = (plan: DraftPlan, orderIds: string[]): DraftPlan => ({ ...plan, trips: offStops(plan.trips, new Set(orderIds)) });

// Removes a trip. Its orders are unplanned again, and a trip 2 left alone becomes trip 1 (rule 4).
export function removeTrip(plan: DraftPlan, key: TripKey): DraftPlan {
  const gone = tripOf(plan, key);
  if (!gone) return plan;
  return { ...plan, trips: renumber(plan.trips.filter((trip) => keyOf(trip) !== key), gone.vehicleId) };
}

// Moves a stop up (by below 0) or down: one place from the menu, which swaps it with its neighbour, and as many as a
// drag takes it (spec 023). A move to nowhere changes nothing.
export function moveStop(plan: DraftPlan, key: TripKey, index: number, by: number): DraftPlan {
  return {
    ...plan,
    trips: plan.trips.map((trip) => {
      const to = index + by;
      if (keyOf(trip) !== key || by === 0 || index < 0 || index >= trip.stops.length || to < 0 || to >= trip.stops.length) return trip;
      const stops = [...trip.stops];
      const [moved] = stops.splice(index, 1);
      stops.splice(to, 0, moved!);
      return { ...trip, stops };
    }),
  };
}

// Moves a trip and its stops to a crew (rule 4, spec 026): onto its truck, as the truck's lowest free trip number, with
// the crew's driver on every trip of the truck, in one change. A trip 2 the move leaves alone becomes trip 1. null when
// the truck runs two trips.
export function swapTruck(plan: DraftPlan, key: TripKey, crew: CrewRef): { plan: DraftPlan; key: TripKey } | null {
  const trip = tripOf(plan, key);
  if (!trip) return null;
  const rest: DraftPlan = { ...plan, trips: renumber(plan.trips.filter((t) => keyOf(t) !== key), trip.vehicleId) };
  const tripNo = freeTripNo(rest, crew.vehicleId);
  if (tripNo === null) return null;
  const moved: DraftTrip = { ...trip, vehicleId: crew.vehicleId, tripNo, driverId: null };
  return { plan: { ...rest, trips: drivenBy([...rest.trips, moved], crew.vehicleId, crewDriver(rest.trips, crew)) }, key: keyOf(moved) };
}

// Sets a trip's leaving time in minutes after midnight, or null for the usual time (rule 5).
export const setLeaveAt = (plan: DraftPlan, key: TripKey, leaveAt: number | null): DraftPlan =>
  ({ ...plan, trips: plan.trips.map((trip) => (keyOf(trip) === key ? { ...trip, leaveAt } : trip)) });

// The vehicle other than this one that a driver drives in the draft, or null.
export const vehicleOfDriver = (plan: DraftPlan, driverId: string, besides: string) =>
  plan.trips.find((trip) => trip.driverId === driverId && trip.vehicleId !== besides)?.vehicleId ?? null;

// Chooses a vehicle's driver, written on both its trips, or null for none (rule 6). A driver who drives another
// vehicle moves here, and that vehicle is left with no driver (spec 026, rule 2).
export const setDriver = (plan: DraftPlan, vehicleId: string, driverId: string | null): DraftPlan => ({ ...plan, trips: drivenBy(plan.trips, vehicleId, driverId) });

// Defers orders, each with its own code and reason (rule 7). A deferred order leaves its stop.
export function defer(plan: DraftPlan, deferrals: DraftDeferral[]): DraftPlan {
  const rest = without(plan, new Set(deferrals.map((deferral) => deferral.orderId)));
  return { ...rest, deferrals: [...rest.deferrals, ...deferrals] };
}

// Puts a deferred order back as unplanned (rule 7).
export const undefer = (plan: DraftPlan, orderId: string): DraftPlan =>
  ({ ...plan, deferrals: plan.deferrals.filter((deferral) => deferral.orderId !== orderId) });

export const setMixBrands = (plan: DraftPlan, mixBrands: boolean): DraftPlan => ({ ...plan, mixBrands });

// Where the draft has each order: on a trip's stop, or deferred. An order it names nowhere is unplanned.
export type Place = { kind: 'stop'; key: TripKey; stop: number } | { kind: 'deferred'; deferral: DraftDeferral };
export function placesOf(plan: DraftPlan): Map<string, Place> {
  const places = new Map<string, Place>();
  for (const trip of plan.trips) {
    for (const [stop, { orderIds }] of trip.stops.entries()) for (const id of orderIds) places.set(id, { kind: 'stop', key: keyOf(trip), stop });
  }
  for (const deferral of plan.deferrals) places.set(deferral.orderId, { kind: 'deferred', deferral });
  return places;
}

// Two drafts hold the same plan when their trips, stops, times, drivers and deferrals are the same, whatever
// order the trips and deferrals are listed in. The server keeps a vehicle's only trip as trip 1 (the contract's
// DraftPlan note), so a lone trip 2 on screen is the same trip as the board's trip 1.
const canonical = (plan: DraftPlan) => ({
  mixBrands: plan.mixBrands,
  trips: plan.trips.map((trip) => ({ ...trip, tripNo: plan.trips.filter((t) => t.vehicleId === trip.vehicleId).length === 1 ? 1 : trip.tripNo }))
    .sort((a, b) => keyOf(a).localeCompare(keyOf(b))).map((trip) => ({
      key: keyOf(trip), leaveAt: trip.leaveAt, driverId: trip.driverId,
      stops: trip.stops.map((stop) => ({ outletId: stop.outletId, orderIds: [...stop.orderIds].sort() })),
    })),
  deferrals: [...plan.deferrals].sort((a, b) => a.orderId.localeCompare(b.orderId)).map((d) => ({ orderId: d.orderId, code: d.code, reason: d.reason.trim() })),
});
export const sameDraft = (a: DraftPlan, b: DraftPlan) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// The same trip in two drafts: the same stops in the same order and the same leaving time. The checker's times
// for a trip are shown only while they are for the trip on screen.
export const sameTrip = (a: DraftTrip | null, b: DraftTrip | null) =>
  a !== null && b !== null && keyOf(a) === keyOf(b) && a.leaveAt === b.leaveAt
  && JSON.stringify(a.stops.map((s) => [s.outletId, [...s.orderIds].sort()])) === JSON.stringify(b.stops.map((s) => [s.outletId, [...s.orderIds].sort()]));
