import { levelOf, type Problem, type ProblemCode } from '@wayfinder/contracts';
import { PlanInputError } from '../errors';
import { tripLitres } from '../fuel';
import { lookup } from '../lookup';
import type { DayProblems } from '../types';
import { capital, driverOf, itsTrip, litres, vehicleCalled } from '../words';

// Fuel and the day (spec 007, AC-34 to AC-36): the weekly fuel quota, the operating day and whether each
// vehicle is available. The sentences follow spec 024: the vehicle by its kind.

type About = Pick<Problem, 'vehicleId' | 'tripNo' | 'stopSeq' | 'outletId' | 'orderId'>;

export const dayProblems: DayProblems = (input, vehicleFuel) => {
  const vehicleOf = lookup(input.vehicles, 'vehicle');
  const problems: Problem[] = [];
  const report = (code: ProblemCode, about: About, message: string, fix?: string) => {
    problems.push({ code, level: levelOf(code), message, ...(fix ? { fix } : {}), ...about });
  };

  const withFuel = new Set(vehicleFuel.map((fuel) => fuel.vehicleId));
  for (const trip of input.plan.trips) {
    const vehicle = vehicleOf(trip.vehicleId);
    // The quota is checked from the fuel figures handed in, so a vehicle without them would pass unchecked.
    if (!withFuel.has(vehicle.id)) throw new PlanInputError(`No fuel figures were given for ${vehicle.id}`);
    if (!vehicle.available) {
      report('vehicle_off', { vehicleId: vehicle.id, tripNo: trip.tripNo },
        `${capital(vehicleCalled(vehicle, trip.driverName))} has ${itsTrip(trip.tripNo) ?? 'a trip'} on a day it is not available.`, 'Move this trip to another vehicle.');
    }
  }

  for (const fuel of vehicleFuel) {
    const vehicle = vehicleOf(fuel.vehicleId);
    // Litres rounded for showing cannot say whether a plan is over (AC-34). So the plan's kilometres are
    // compared with the kilometres the litres left can cover, in whole numbers: kilometres and litres in
    // tenths and km per litre in hundredths, which is as far as the tables keep each of them.
    const kmTenths = Math.round(fuel.kmPlan * 10);
    const leftTenths = Math.round(fuel.quotaL * 10) - Math.round(fuel.litresBefore * 10);
    // A vehicle this plan does not drive cannot be taken past its quota by it.
    if (kmTenths === 0 || kmTenths * 100 <= leftTenths * Math.round(vehicle.kmPerL * 100)) continue;

    // The sentence goes by the litres all the plan's kilometres need, so that its three figures add up. When
    // the rounding hides what it is over by, it says so in words.
    const needs = tripLitres(fuel.kmPlan, vehicle.kmPerL);
    const overTenths = Math.round(needs * 10) - leftTenths;
    const by = overTenths > 0 ? litres(overTenths / 10) : 'less than 0.1 litres';
    report(
      'fuel_over_quota', { vehicleId: vehicle.id },
      `${capital(vehicleCalled(vehicle, driverOf(input.plan.trips, vehicle.id)))} has used ${litres(fuel.litresBefore)} this week and this plan needs ${litres(needs)} more, ${by} over its weekly quota of ${litres(fuel.quotaL)}.`,
      `Take ${by} of driving off this vehicle.`,
    );
  }

  if (!input.operatingDay) report('not_operating_day', {}, 'The plan is for a day that is not an operating day, so nothing can be delivered on it.');

  return problems;
};
