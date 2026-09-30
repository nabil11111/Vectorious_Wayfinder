import type { StopTime } from '@wayfinder/contracts';
import { PlanInputError } from './errors';
import { tripKm, tripLitres } from './fuel';
import { lookup } from './lookup';
import type {
  BudgetMinutes, DefaultLeaveAt, EngineOutlet, Minutes, PlanInput, PlanSettings, PlanTrip, TimeTrip, TimeVehicleDay, VehicleTimes,
} from './types';

// When a vehicle leaves, reaches each shop, waits, unloads, is back at the depot and can leave again (spec 007,
// AC-6 to AC-14). Every time is minutes after midnight on the plan date.

// The booklet: "Fresh deliveries must arrive before stores open at 8 AM", whatever a shop's own window says.
export const FRESH_DEADLINE: Minutes = 480;

// The earliest a trip leaves by itself (D-19). A trip with a Fresh stop goes by the Fresh time, and any other
// trip by the earliest time among the brands of its shops.
export const earliestLeaveFor = (settings: PlanSettings, shops: EngineOutlet[]): Minutes =>
  shops.some((shop) => shop.brand === 'Fresh')
    ? settings.earliestLeave.Fresh
    : Math.min(...shops.map((shop) => settings.earliestLeave[shop.brand]));

// A mall shop takes deliveries only while its own window and its mall's slot are both open (AC-11). When the
// two never overlap, this window opens after it closes.
const windowOf = (shop: EngineOutlet) => ({
  open: Math.max(shop.windowOpen, shop.mallOpen ?? shop.windowOpen),
  close: Math.min(shop.windowClose, shop.mallClose ?? shop.windowClose),
});

const allowanceOf = (input: PlanInput, shop: EngineOutlet): number => {
  const row = input.allowances.find((a) => a.brand === shop.brand && a.dockType === shop.dockType);
  if (!row) throw new PlanInputError(`No unloading allowance for ${shop.brand} at ${shop.dockType} in the input`);
  return row.minutes;
};

// What a trip needs to be timed: its shops in stop order and the drive to their district. There is none for a
// trip with no stops, for stops in more than one district (D-23), or when the data has no drive from the plan's
// depot to the district.
const routeOf = (input: PlanInput, trip: PlanTrip) => {
  const outletOf = lookup(input.outlets, 'shop');
  const shops = trip.stops.map((stop) => outletOf(stop.outletId));
  const [first] = shops;
  if (!first || shops.some((shop) => shop.district !== first.district)) return null;
  const travel = input.travel.find((row) => row.depotId === input.depotId && row.district === first.district);
  return travel ? { shops, first, travel } : null;
};

// A vehicle's trips in the order they are driven and timed: by trip number, and as the plan lists them when
// two share a number. Whatever pairs a trip with its times goes through this, so the pairing cannot drift.
export const tripsOf = (input: PlanInput, vehicleId: string): PlanTrip[] =>
  // filter makes a new list, so sorting it leaves the plan as it came.
  input.plan.trips.filter((trip) => trip.vehicleId === vehicleId).sort((a, b) => a.tripNo - b.tripNo);

export const defaultLeaveAt: DefaultLeaveAt = (input, trip, readyAt) => {
  const route = routeOf(input, trip);
  // A trip that cannot be timed has no first stop to aim at, so all it waits for is the vehicle.
  if (!route) return readyAt ?? 0;
  const aimed = windowOf(route.first).open - route.travel.outMin;
  return Math.max(aimed, earliestLeaveFor(input.settings, route.shops), readyAt ?? 0);
};

export const timeTrip: TimeTrip = (input, trip, leaveAt) => {
  const vehicle = lookup(input.vehicles, 'vehicle')(trip.vehicleId);
  const route = routeOf(input, trip);
  if (!route) return null;
  const { shops, travel } = route;

  const stops: StopTime[] = [];
  // The booklet's trip minutes leave out waiting and the drive back, so they are added up beside the clock.
  let tripMin = travel.outMin + travel.betweenMin * (shops.length - 1);
  let clock = leaveAt;
  for (const [i, shop] of shops.entries()) {
    const arriveAt = clock + (i === 0 ? travel.outMin : travel.betweenMin);
    const { open, close } = windowOf(shop);
    const startAt = Math.max(arriveAt, open);
    const unloadMin = allowanceOf(input, shop);
    clock = startAt + unloadMin;
    tripMin += unloadMin;
    // Arrival is what counts, and arriving exactly at closing time is on time (AC-32).
    const late = arriveAt > close || open > close || (shop.brand === 'Fresh' && arriveAt >= FRESH_DEADLINE);
    stops.push({ seq: i + 1, outletId: shop.id, arriveAt, waitMin: startAt - arriveAt, startAt, leaveAt: clock, windowOpen: open, windowClose: close, late });
  }

  // The data has no drive back, so it takes as long as the drive out (AC-12).
  const backAt = clock + travel.outMin;
  const km = tripKm(travel, shops.length);
  return {
    district: travel.district, leaveAt, stops, lastDoneAt: clock, backAt, readyAgainAt: backAt + input.settings.reloadMin,
    tripMin, km, litres: tripLitres(km, vehicle.kmPerL),
  };
};

export const timeVehicleDay: TimeVehicleDay = (input, vehicleId) => {
  const vehicle = lookup(input.vehicles, 'vehicle')(vehicleId);
  const trips = tripsOf(input, vehicle.id);
  const timed: VehicleTimes['trips'] = [];
  // When the vehicle is ready again after the trip before. A trip that cannot be timed holds nothing up.
  let readyAt: Minutes | null = null;
  for (const trip of trips) {
    const times = timeTrip(input, trip, trip.leaveAt ?? defaultLeaveAt(input, trip, readyAt));
    if (times) readyAt = times.readyAgainAt;
    timed.push({ tripNo: trip.tripNo, times });
  }
  return { vehicleId: vehicle.id, trips: timed };
};

export const budgetMinutes: BudgetMinutes = (input, times) => {
  const outletOf = lookup(input.outlets, 'shop');
  let freshMin = 0;
  let styleTechMin = 0;
  for (const { times: trip } of times.trips) {
    if (!trip) continue;
    // A trip with a Fresh stop counts as a Fresh trip (AC-37).
    if (trip.stops.some((stop) => outletOf(stop.outletId).brand === 'Fresh')) freshMin += trip.tripMin;
    else styleTechMin += trip.tripMin;
  }
  return { freshMin, styleTechMin };
};
