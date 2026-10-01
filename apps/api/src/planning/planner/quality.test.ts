import { describe, expect, it } from 'vitest';
import { checkPlan } from '../check';
import { computeLoad } from '../load';
import { vehicle } from '../testing/shared';
import type { EngineProduct, PlanInput, PlannerInput, PlannerOrder, PlannerResult } from '../types';
import { buildSuggestedPlan } from './build';
import { demoFixture, kandyFixture } from './testing/demo';
import { plannerInput, plannerOrder } from './testing/input';

// Quality, not only validity. The checker proves a plan keeps the rules; these cases prove the planner does not leave
// goods behind that a plan within the same rules carries. Each measures the goods served, the deferrals and the time
// the build takes together, so a fix that serves more cannot quietly cost the time limits of spec 011 (AC-22).

type Built = Exclude<PlannerResult, { status: 'unavailable' }>;
const built = (result: PlannerResult): Built => {
  if (result.status === 'unavailable') throw new Error('Expected a checked suggestion');
  expect(result.check.ok).toBe(true);
  return result;
};
const measured = (input: PlannerInput) => {
  const start = performance.now();
  const result = built(buildSuggestedPlan(input));
  const elapsedMs = performance.now() - start;
  const onTrips = new Set(result.input.plan.trips.flatMap((t) => t.stops.flatMap((s) => s.orderIds)));
  const served = result.input.orders.filter((o) => onTrips.has(o.id));
  return {
    result, elapsedMs,
    served: computeLoad(served.flatMap((o) => o.lines), input.products),
    all: computeLoad(input.orders.flatMap((o) => o.lines), input.products),
    deferrals: result.input.plan.deferrals.length,
    trips: result.input.plan.trips.length,
    blocks: result.check.problems.filter((p) => p.level === 'block').length,
    warnings: result.check.problems.filter((p) => p.level === 'warn').map((p) => `${p.code} ${p.vehicleId ?? ''}`).sort(),
  };
};

// The audit's checked alternative for Kandy's seeded Thursday, written out: the plan the planner gave on 2 October with
// three changes. OUT082's dry cartons join its chilled ones on VEH057's second trip, which frees VEH060's second trip
// for all of OUT088's boxes, and that frees VEH058's second trip for OUT093's Tech order. c is the chilled order of a
// shop and d its dry one.
const KANDY_ALTERNATIVE: [vehicleId: string, tripNo: number, stops: [outletId: string, temps: string][]][] = [
  ['VEH039', 1, [['OUT085', 'c'], ['OUT086', 'c']]],
  ['VEH040', 1, [['OUT099', 'c'], ['OUT101', 'c'], ['OUT098', 'c'], ['OUT096', 'c']]],
  ['VEH041', 1, [['OUT112', 'c'], ['OUT111', 'c'], ['OUT113', 'c']]],
  ['VEH042', 1, [['OUT116', 'c'], ['OUT118', 'c'], ['OUT119', 'c']]],
  ['VEH043', 1, [['OUT105', 'c'], ['OUT108', 'c'], ['OUT106', 'c']]],
  ['VEH044', 1, [['OUT113', 'd']]],
  ['VEH045', 1, [['OUT094', 'd'], ['OUT095', 'd']]],
  ['VEH046', 1, [['OUT103', 'd']]],
  ['VEH047', 1, [['OUT112', 'd'], ['OUT110', 'd'], ['OUT111', 'd']]],
  ['VEH048', 1, [['OUT089', 'd'], ['OUT091', 'd'], ['OUT092', 'd']]],
  ['VEH049', 1, [['OUT114', 'd']]],
  ['VEH050', 1, [['OUT099', 'd'], ['OUT101', 'd'], ['OUT097', 'd'], ['OUT098', 'd'], ['OUT100', 'd'], ['OUT096', 'd']]],
  ['VEH051', 1, [['OUT085', 'd'], ['OUT086', 'd'], ['OUT087', 'd'], ['OUT084', 'd']]],
  ['VEH052', 1, [['OUT115', 'd']]],
  ['VEH053', 1, [['OUT105', 'd'], ['OUT108', 'd'], ['OUT104', 'd'], ['OUT107', 'd'], ['OUT106', 'd']]],
  ['VEH054', 1, [['OUT116', 'd'], ['OUT117', 'd'], ['OUT118', 'd'], ['OUT119', 'd']]],
  ['VEH055', 1, [['OUT102', 'd']]],
  ['VEH056', 1, [['OUT109', 'd']]],
  ['VEH057', 1, [['OUT079', 'c'], ['OUT083', 'c'], ['OUT076', 'c']]],
  ['VEH057', 2, [['OUT082', 'cd']]],
  ['VEH058', 1, [['OUT078', 'c'], ['OUT081', 'c']]],
  ['VEH058', 2, [['OUT093', 'd']]],
  ['VEH059', 1, [['OUT077', 'd'], ['OUT079', 'd'], ['OUT083', 'd']]],
  ['VEH059', 2, [['OUT081', 'd'], ['OUT080', 'd']]],
  ['VEH060', 1, [['OUT076', 'd'], ['OUT078', 'd']]],
  ['VEH060', 2, [['OUT088', 'd']]],
];

describe('F8 the planner\'s quality on the seeded days', () => {
  it('F1 the checked Kandy alternative carries every seeded order on the same 26 trips with no block', async () => {
    const { input } = await kandyFixture();
    const chilled = (order: PlannerOrder) => computeLoad(order.lines, input.products).needsReefer;
    const orderAt = (outletId: string, temp: string) => {
      const found = input.orders.filter((o) => o.outletId === outletId && chilled(o) === (temp === 'c'));
      expect(found, `${outletId} ${temp}`).toHaveLength(1);
      return found[0]!.id;
    };
    const plan: PlanInput = {
      ...input,
      plan: {
        trips: KANDY_ALTERNATIVE.map(([vehicleId, tripNo, stops]) => ({
          vehicleId, tripNo, stops: stops.map(([outletId, temps]) => ({ outletId, orderIds: [...temps].map((temp) => orderAt(outletId, temp)) })),
        })),
        deferrals: [],
      },
    };
    const check = checkPlan(plan);
    expect(check.problems.filter((p) => p.level === 'block')).toEqual([]);
    expect(check.problems.filter((p) => p.level === 'warn').map((p) => `${p.code} ${p.vehicleId}`).sort())
      .toEqual(['over_time_budget VEH041', 'over_time_budget VEH047']);
    expect(plan.plan.trips.flatMap((t) => t.stops.flatMap((s) => s.orderIds)).sort()).toEqual(input.orders.map((o) => o.id).sort());
  });

  it.fails('F1 the planner serves all of Kandy\'s seeded goods on 26 trips, with no new block or warning, within a second', async () => {
    const { input } = await kandyFixture();
    const run = measured(input);
    expect(run.deferrals).toBe(0);
    expect(run.trips).toBe(26);
    expect(run.served).toEqual(run.all);
    expect(run.blocks).toBe(0);
    expect(run.warnings).toEqual(['over_time_budget VEH041', 'over_time_budget VEH047']);
    expect(run.elapsedMs).toBeLessThan(1000);
  });

  it('F1 the planner leaves no more of Peliyagoda\'s seeded goods behind, within a second', async () => {
    // The six Kurunegala and Puttalam chilled orders were the deferrals before this search; it may serve more, never fewer.
    const { input } = await demoFixture();
    const run = measured(input);
    expect(run.deferrals).toBeLessThanOrEqual(6);
    expect(run.served.units).toBeGreaterThanOrEqual(4658);
    expect(run.blocks).toBe(0);
    expect(run.elapsedMs).toBeLessThan(1000);
  });

  it.fails('F2 tries the new stop before an existing one when the closing-time order misses a window', () => {
    // Two Colombo shops on one truck. A takes deliveries 10:00 to 10:10 and B 09:00 to 10:20; unloading takes 20 minutes
    // and the drive between them 10. A then B reaches B at 10:30, and leaving earlier does not help, as A opens at 10:00.
    // B then A serves both.
    const input = plannerInput([plannerOrder('a', 'OUT019', 'style-folded'), plannerOrder('b', 'OUT020', 'style-folded')], {
      vehicles: [vehicle('VEH012')],
    });
    Object.assign(input.outlets.find((s) => s.id === 'OUT019')!, { windowOpen: 600, windowClose: 610 });
    Object.assign(input.outlets.find((s) => s.id === 'OUT020')!, { windowOpen: 540, windowClose: 620 });
    input.allowances = input.allowances.map((row) => (row.brand === 'Style' ? { ...row, minutes: 20 } : row));
    input.travel = input.travel.map((row) => (row.district === 'Colombo' ? { ...row, betweenMin: 10 } : row));
    const run = measured(input);
    expect(run.deferrals).toBe(0);
    expect(run.result.input.plan.trips.map((t) => t.stops.map((s) => s.outletId))).toEqual([['OUT020', 'OUT019']]);
    expect(run.served).toEqual(run.all);
    expect(run.blocks).toBe(0);
  });

  it.fails('F3 rebalances a split\'s two parts when the first remainder fits no truck', () => {
    // Two trucks of 1,000 kg, one of 10 m³ and one of 5 m³, and a shop open only long enough for one run each. The order
    // has two A items of 500 kg and 1 m³ and two B items of 100 kg and 4 m³. Both A items on the larger truck leave
    // both B items, 8 m³, for the smaller one. Two parts that each fit their truck serve everything.
    const products: EngineProduct[] = [
      { id: 'a', kgPerUnit: 500, m3PerUnit: 1, temp: 'dry', needsTailLift: false, keepUpright: false },
      { id: 'b', kgPerUnit: 100, m3PerUnit: 4, temp: 'dry', needsTailLift: false, keepUpright: false },
    ];
    const order = plannerOrder('mixed', 'OUT019', 'a', 2, { lines: [{ productId: 'a', quantity: 2 }, { productId: 'b', quantity: 2 }] });
    const input = plannerInput([order], {
      products,
      vehicles: [
        { ...vehicle('VEH012'), id: 'BIG', weightCapKg: 1000, volumeCapM3: 10 },
        { ...vehicle('VEH012'), id: 'SMALL', weightCapKg: 1000, volumeCapM3: 5 },
      ],
    });
    Object.assign(input.outlets.find((s) => s.id === 'OUT019')!, { windowOpen: 600, windowClose: 620 });
    const run = measured(input);
    expect(run.deferrals).toBe(0);
    expect(run.result.splits).toHaveLength(1);
    expect(run.result.input.orders.map((o) => o.id)).toEqual(['split:mixed:keep', 'split:mixed:rest']);
    expect(run.result.input.plan.trips.map((t) => t.vehicleId).sort()).toEqual(['BIG', 'SMALL']);
    expect(run.served).toEqual(run.all);
    expect(run.blocks).toBe(0);
  });
});
