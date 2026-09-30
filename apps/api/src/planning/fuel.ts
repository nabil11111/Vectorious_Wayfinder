import { lookup } from './lookup';
import type { TripKm, TripLitres, VehicleFuelOf } from './types';

// What a trip and a vehicle's day cost in kilometres and litres (spec 007, AC-15 and AC-16).
// 0.1 + 0.2 is 0.30000000000000004 in JavaScript, so kilometres and litres are worked in whole tenths, which
// hold them exactly (the travel table keeps kilometres to 1 decimal, and litres are logged and shown to 1), and
// are divided once at the end.
const tenths = (n: number) => Math.round(n * 10);

// The data has no drive back, so the way back is the drive out again.
export const tripKm: TripKm = (travel, stops) => (tenths(travel.outKm) * 2 + tenths(travel.betweenKm) * (stops - 1)) / 10;

// To 1 decimal for what is shown. The division is done on whole numbers (the vehicles table keeps km per litre
// to 2 decimals), so exactly half a tenth always goes up. Whether a plan passes a quota is decided on kilometres,
// never on these (AC-34).
export const tripLitres: TripLitres = (km, kmPerL) => Math.round((tenths(km) * 100) / Math.round(kmPerL * 100)) / 10;

export const vehicleFuel: VehicleFuelOf = (input, times) => {
  const vehicle = lookup(input.vehicles, 'vehicle')(times.vehicleId);
  let kmTenths = 0;
  for (const { times: trip } of times.trips) {
    // A trip that cannot be timed is not driven.
    if (trip) kmTenths += tenths(trip.km);
  }
  const kmPlan = kmTenths / 10;
  // The plan's litres are what all its kilometres need, rounded once. Each trip's own litres are rounded too,
  // and added up they can land 0.1 away: two trips of 11.25 litres show as 11.3 each and need 22.5 together. The
  // quota is checked on kilometres, so only this figure keeps the vehicle's line in step with that check.
  const planTenths = tenths(tripLitres(kmPlan, vehicle.kmPerL));
  // The litres used are held in tenths like the rest, so the three figures always add up to the quota.
  const usedTenths = tenths(vehicle.litresUsedThisWeek);
  const leftTenths = tenths(vehicle.weeklyFuelQuotaL) - usedTenths - planTenths;
  return {
    vehicleId: vehicle.id,
    litresBefore: usedTenths / 10,
    litresPlan: planTenths / 10,
    litresLeft: leftTenths / 10,
    quotaL: vehicle.weeklyFuelQuotaL,
    kmPlan,
  };
};
