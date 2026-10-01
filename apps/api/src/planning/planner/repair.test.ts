import { describe, expect, it } from 'vitest';
import { checkPlan } from '../check';
import { computeLoad } from '../load';
import type { PlannerInput, PlannerResult } from '../types';
import { buildSuggestedPlan } from './build';
import { freeRunFor } from './repair';
import { kandyFixture } from './testing/demo';

// Spec 011, AC-23 and D-102: before an order waits, a run is freed for it from goods the plan already carries.
type Built = Exclude<PlannerResult, { status: 'unavailable' }>;
const built = (result: PlannerResult): Built => {
  if (result.status === 'unavailable') throw new Error('Expected a checked suggestion');
  return result;
};
const at = (result: Built, input: PlannerInput, vehicleId: string, tripNo: number) => {
  const trip = result.input.plan.trips.find((t) => t.vehicleId === vehicleId && t.tripNo === tripNo)!;
  return trip.stops.map((stop) => [stop.outletId, stop.orderIds.map((id) => {
    const order = result.input.orders.find((o) => o.id === id)!;
    return computeLoad(order.lines, input.products).needsReefer ? 'chilled' : 'dry';
  })]);
};
const reasonAt = (result: Built, input: PlannerInput, outletId: string, temp: 'dry' | 'chilled') => {
  const order = input.orders.find((o) => o.outletId === outletId && computeLoad(o.lines, input.products).needsReefer === (temp === 'chilled'))!;
  return result.choices.find((c) => c.orderId === order.id)!;
};

describe('freeing a run before an order waits', () => {
  it('AC-23 serves Kandy\'s seeded day by sharing two stops: OUT082 on one van, OUT088 whole, and OUT093 on the freed van', async () => {
    const { input } = await kandyFixture();
    const result = built(buildSuggestedPlan(input));
    expect(result.input.plan.deferrals).toEqual([]);
    // OUT082's dry cartons join its chilled ones on VEH057's second trip, which frees VEH060's second trip for OUT088. Its
    // first part joins the rest of its boxes there, so the split is not needed and the order goes whole.
    expect(at(result, input, 'VEH057', 2)).toEqual([['OUT082', ['chilled', 'dry']]]);
    expect(at(result, input, 'VEH060', 2)).toEqual([['OUT088', ['dry']]]);
    expect(at(result, input, 'VEH058', 2)).toEqual([['OUT093', ['dry']]]);
    expect(result.splits).toEqual([]);
    expect(result.input.orders).toHaveLength(64);
    // Each moved order's reason says where it is now and why; the order that took the freed run says so.
    expect(reasonAt(result, input, 'OUT082', 'dry').reason).toMatch(/; joined the reefer van VEH057 on its second trip to Kandy, shares a stop to free a run$/);
    expect(reasonAt(result, input, 'OUT088', 'dry')).toMatchObject({ resultOrderIds: [expect.any(String)], reason: expect.stringMatching(/; new second trip on the van VEH060 to Kandy, takes a run freed for it$/) });
    expect(reasonAt(result, input, 'OUT093', 'dry').reason).toMatch(/; new second trip on the reefer van VEH058 to Kandy, takes a run freed for it$/);
    expect(result.check).toEqual(checkPlan(result.input));
  });

  it('AC-20/23 repeats Kandy\'s result with shuffled seed rows and lines', async () => {
    const { input } = await kandyFixture();
    const shuffled = structuredClone(input);
    for (const key of ['orders', 'outlets', 'vehicles', 'products', 'travel', 'allowances'] as const) shuffled[key].reverse();
    shuffled.orders.forEach((order) => order.lines.reverse());
    expect(buildSuggestedPlan(shuffled)).toEqual(buildSuggestedPlan(input));
  });

  it('AC-23 moves goods only onto a run that stops at their shop, and leaves every other run and departure as it was', async () => {
    // Kandy's day planned without OUT093: OUT088's first part rides VEH058's second trip and the rest VEH060's.
    const { input } = await kandyFixture();
    const plan = built(buildSuggestedPlan({ ...input, orders: input.orders.filter((o) => o.outletId !== 'OUT093') })).input;
    const tech = input.orders.find((o) => o.outletId === 'OUT093')!;
    const freed = freeRunFor(plan, tech)!;
    expect(freed.freed).toEqual({ vehicleId: 'VEH058', tripNo: 2 });
    const kept = plan.plan.trips.find((t) => t.vehicleId === 'VEH058' && t.tripNo === 2)!.stops[0]!.orderIds;
    expect(freed.moves).toEqual([{ orderIds: kept, to: { vehicleId: 'VEH060', tripNo: 2 }, whole: false }]);
    // Nothing is left behind, and only the run the goods joined differs from the plan before, departures included.
    const onTrips = (trips: typeof plan.plan.trips) => trips.flatMap((t) => t.stops.flatMap((s) => s.orderIds)).sort();
    expect(onTrips(freed.trips)).toEqual(onTrips(plan.plan.trips.filter((t) => !(t.vehicleId === 'VEH058' && t.tripNo === 2))).concat(kept).sort());
    const touched = (t: { vehicleId: string; tripNo: number }) => ['VEH058:2', 'VEH060:2'].includes(`${t.vehicleId}:${t.tripNo}`);
    expect(freed.trips.filter((t) => !touched(t))).toEqual(plan.plan.trips.filter((t) => !touched(t)));
    expect(freed.attempt).toMatchObject({ stage: 'accepted', slot: { vehicleId: 'VEH058', tripNo: 2, existing: false } });
    // A day with nothing to share out leaves the order waiting.
    const alone = { ...plan, plan: { ...plan.plan, trips: plan.plan.trips.filter((t) => !t.stops.some((s) => s.outletId === 'OUT088')) } };
    alone.orders = alone.orders.filter((o) => o.outletId !== 'OUT088');
    const full = { ...alone, vehicles: alone.vehicles.filter((v) => v.type !== 'van' || alone.plan.trips.filter((t) => t.vehicleId === v.id).length === 2) };
    expect(freeRunFor(full, tech)).toBeNull();
  });
});
