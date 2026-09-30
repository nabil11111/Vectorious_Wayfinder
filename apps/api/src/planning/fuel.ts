import { lookup } from './lookup';
import type { TripKm, TripLitres, VehicleFuelOf } from './types';

// What a trip and a vehicle's day cost in kilometres and litres (spec 007, AC-15 and AC-16).
// 10.3 + 5.3 is 15.600000000000001 in JavaScript, so kilometres and litres are added up in whole tenths, which
// hold them exactly (the travel table keeps kilometres to 1 decimal, and litres are logged and shown to 1), and
// are divided once at the end.
const tenths = (n: number) => Math.round(n * 10);

// The data has no drive back, so the way back is the drive out again.
export const tripKm: TripKm = (travel, stops) => (tenths(travel.outKm) * 2 + tenths(travel.betweenKm) * (stops - 1)) / 10;

// To 1 decimal for what is shown. The division is done on whole numbers (the vehicles table keeps km per litre
// to 2 decimals), so exactly half a tenth always goes up. The quota rule never reads litres, it compares
// kilometres (AC-34).
export const tripLitres: TripLitres = (km, kmPerL) => Math.round((tenths(km) * 100) / Math.round(kmPerL * 100)) / 10;

export const vehicleFuel: VehicleFuelOf = (input, times) => {
  const vehicle = lookup(input.vehicles, 'vehicle')(times.vehicleId);
  let kmTenths = 0;
  let planTenths = 0;
  for (const { times: trip } of times.trips) {
    // A trip that cannot be timed is not driven.
    if (!trip) continue;
    kmTenths += tenths(trip.km);
    // The plan's litres are the trips' shown litres added up, so the lines on a screen add up to the total.
    planTenths += tenths(trip.litres);
  }
  const leftTenths = tenths(vehicle.weeklyFuelQuotaL) - tenths(vehicle.litresUsedThisWeek) - planTenths;
  return {
    vehicleId: vehicle.id,
    litresBefore: vehicle.litresUsedThisWeek,
    litresPlan: planTenths / 10,
    litresLeft: leftTenths / 10,
    quotaL: vehicle.weeklyFuelQuotaL,
    kmPlan: kmTenths / 10,
  };
};
