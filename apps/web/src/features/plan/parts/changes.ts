import type { DraftPlan, DraftTrip } from '@wayfinder/contracts';
import type { Undo } from '../board';
import { keyOf, removeTrip, takeOff } from '../draft';
import type { BoardIndex } from './lookup';

// Spec 027's removals, each one change of the draft named for the board's history. Nothing here judges the plan.

// A trip off the plan, from the open trip's "Remove trip" or its card's ⋮ in Done: its orders back in Unplanned.
export const removeTripChange = (plan: DraftPlan, trip: DraftTrip, index: BoardIndex): { plan: DraftPlan; said: Undo } =>
  ({ plan: removeTrip(plan, keyOf(trip)), said: { line: `Trip on ${index.called(trip)} removed`, tripKey: null } });

// A stop off the open trip, from its ×: every order of it back in Unplanned, said on the trip with its Undo.
export function takeStopOffChange(plan: DraftPlan, trip: DraftTrip, stop: number, index: BoardIndex): { plan: DraftPlan; said: Undo } {
  const at = trip.stops[stop];
  if (!at) throw new Error(`${keyOf(trip)} has no stop ${stop + 1}.`);
  return { plan: takeOff(plan, at.orderIds), said: { line: `${index.shop(at.outletId)?.name ?? at.outletId} taken off ${index.called(trip)}`, tripKey: keyOf(trip) } };
}

// Start over: every trip and deferral off the draft, Mix brands as it was. Undo brings it all back in one step.
export const startOverChange = (plan: DraftPlan): { plan: DraftPlan; said: Undo } =>
  ({ plan: { mixBrands: plan.mixBrands, trips: [], deferrals: [] }, said: { line: 'Plan started over', tripKey: null } });
