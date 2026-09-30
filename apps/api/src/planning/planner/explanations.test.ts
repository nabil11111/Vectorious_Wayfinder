import { describe, expect, it } from 'vitest';
import { vehicle } from '../testing/shared';
import type { PlannerResult } from '../types';
import { buildSuggestedPlan } from './build';
import { plannerInput, plannerOrder } from './testing/input';

const success = (result: PlannerResult) => {
  expect(result.status).not.toBe('unavailable');
  if (result.status === 'unavailable') throw new Error('Expected checked suggestion');
  expect(result.check.ok).toBe(true);
  return result;
};
const clearReasons = (result: ReturnType<typeof success>) => {
  for (const { reason } of [...result.input.plan.deferrals, ...result.choices, ...result.decisions]) {
    expect(reason).not.toMatch(/OUT\d+|\d{4}-\d{2}-\d{2}|\bunits\b|tested stop order|after earlier choices|first feasible/i);
    expect(reason.length, reason).toBeLessThanOrEqual(200);
  }
};

describe('reviewed explanations through the complete planner', () => {
  it('AC-17 emits no_van for a van-only chilled shop when only a fridge truck is working', () => {
    const result = success(buildSuggestedPlan(plannerInput([plannerOrder('cold', 'OUT001', 'fresh-chilled-carton')], { vehicles: [vehicle('VEH001')] })));
    expect(result.input.plan.deferrals).toMatchObject([{ code: 'no_van', reason: 'No van was free for Colombo on Thursday, which takes vans only.' }]);
    clearReasons(result);
  });

  it('AC-1 says why an old chilled order ranks first and joins a run by the deciding rule', () => {
    const result = success(buildSuggestedPlan(plannerInput([
      plannerOrder('new', 'OUT030', 'fresh-chilled-carton'),
      plannerOrder('old', 'OUT030', 'fresh-chilled-carton', 1, { deliveryDate: '2026-06-23', timesDeferred: 2 }),
    ], { vehicles: [vehicle('VEH001'), vehicle('VEH004')] })));
    expect(result.choices[0]!.reason).toMatch(/Rank 1.*waited since Tuesday.*chilled.*07:59/);
    expect(result.choices[0]!.reason).toMatch(/VEH004.*(?:largest|more volume)/);
    expect(result.choices[1]!.reason).toMatch(/joined VEH004/);
    expect(result.choices[1]!.reason).toMatch(/existing|fill/);
    clearReasons(result);
  });

  it('AC-17 keeps no-slot capacity wording free of an irrelevant split limit', () => {
    const result = success(buildSuggestedPlan(plannerInput([plannerOrder('big', 'OUT006', 'fresh-dry-carton', 1000)], { vehicles: [] })));
    expect(result.input.plan.deferrals[0]!.reason).toBe('The trucks going to Colombo on Thursday were full.');
    expect(result.input.plan.deferrals[0]!.reason).not.toMatch(/999|divid|split/);
    clearReasons(result);
  });

  it('AC-17 names the sent and waiting cartons when a remainder cannot fit another on-time trip', () => {
    const result = success(buildSuggestedPlan(plannerInput([plannerOrder('waiting', 'OUT001', 'fresh-chilled-carton', 400, { deliveryDate: '2026-06-24', timesDeferred: 1 })], { vehicles: [vehicle('VEH035')] })));
    expect(result.splits).toHaveLength(1);
    expect(result.input.plan.trips).toHaveLength(1);
    expect(result.input.plan.deferrals).toHaveLength(1);
    expect(result.input.plan.deferrals[0]!.reason).toMatch(/150 of the 400 cartons.*Thursday; the other 250 wait/);
    expect(result.input.plan.deferrals[0]!.reason).toContain('cannot be divided again');
    expect(result.input.plan.deferrals[0]!.reason).not.toContain('truck was full');
    clearReasons(result);
  });

  it('AC-17 reports a late shop with its deadline and explains the refused vehicle', () => {
    const day = plannerInput([
      plannerOrder('older', 'OUT019', 'style-folded', 1, { deliveryDate: '2026-06-24', timesDeferred: 1 }),
      plannerOrder('fresh', 'OUT006'),
    ], { vehicles: [vehicle('VEH012')] });
    const result = success(buildSuggestedPlan(day));
    expect(result.input.plan.deferrals[0]).toMatchObject({ code: 'window', reason: 'No truck could reach Colombo before 08:00 on Thursday.' });
    expect(result.choices[1]!.reason).toMatch(/VEH012.*trip 2.*\d\d:\d\d/);
    clearReasons(result);
  });

  it('AC-17 reports other shops delayed by an otherwise on-time insertion through the builder', () => {
    const day = plannerInput([
      ...['OUT026', 'OUT028', 'OUT030'].map((shop) => plannerOrder(shop, shop, undefined, 1, { deliveryDate: '2026-06-22', timesDeferred: 3 })),
      plannerOrder('deadline', 'OUT010', undefined, 1, { deliveryDate: '2026-06-23', timesDeferred: 2 }),
      plannerOrder('added', 'OUT027'),
    ], { vehicles: [vehicle('VEH012')] });
    day.outlets.find((shop) => shop.id === 'OUT027')!.windowOpen = 420;
    const result = success(buildSuggestedPlan(day));
    expect(result.input.plan.deferrals).toMatchObject([{ orderId: 'added', code: 'window', reason: 'The truck that could reach Gampaha in time would then have been late for its other shops on Thursday.' }]);
    clearReasons(result);
  });

  it('AC-17 keeps no-fridge and fuel refusals in shop words through the builder', () => {
    const noFridge = success(buildSuggestedPlan(plannerInput([plannerOrder('cold', 'OUT001', 'fresh-chilled-carton')], { vehicles: [] })));
    expect(noFridge.input.plan.deferrals).toMatchObject([{ code: 'no_reefer', reason: 'No fridge truck was free for Colombo on Thursday.' }]);
    clearReasons(noFridge);
    const fuel = success(buildSuggestedPlan(plannerInput([plannerOrder('far', 'OUT060', 'fresh-chilled-carton')], { vehicles: [{ ...vehicle('VEH001'), litresUsedThisWeek: 340 }] })));
    expect(fuel.input.plan.deferrals).toMatchObject([{ code: 'fuel', reason: "The trucks that could reach Matara on Thursday did not have enough of this week's fuel left." }]);
    clearReasons(fuel);
  });

  it('does not call 40 litres remaining an exhausted weekly allowance', () => {
    const day = plannerInput([plannerOrder('fuel', 'OUT054', 'fresh-chilled-carton')], { vehicles: [{ ...vehicle('VEH001'), litresUsedThisWeek: 300 }] });
    const result = success(buildSuggestedPlan(day));
    expect(result.input.plan.deferrals).toMatchObject([{ code: 'fuel' }]);
    expect(result.input.plan.deferrals[0]!.reason).toContain("did not have enough of this week's fuel left");
    expect(result.input.plan.deferrals[0]!.reason).not.toMatch(/used up|exhaust/);
    expect(result.choices[0]!.reason).toContain('51.1 litres');
    clearReasons(result);
  });

  it('keeps a split explanation within 200 characters when the named shop needs an earlier departure', () => {
    const day = plannerInput([plannerOrder('waiting', 'OUT001', 'fresh-chilled-carton', 180, { deliveryDate: '2026-06-24', timesDeferred: 1 })], { vehicles: [vehicle('VEH035')] });
    Object.assign(day.outlets.find((shop) => shop.id === 'OUT001')!, { windowOpen: 600, windowClose: 800, name: 'Fresh Supermarket Colombo Central Distribution' });
    const result = success(buildSuggestedPlan(day));
    expect(result.splits).toHaveLength(1);
    expect(result.choices[0]!.reason).toContain('Colombo');
    expect(result.choices[0]!.reason).toMatch(/07:59|08:00/);
    clearReasons(result);
  });

  it('explains a fuel excess hidden by equal rounded needed and remaining litres', () => {
    const day = plannerInput([plannerOrder('fuel-rounding', 'OUT006')], { vehicles: [{ ...vehicle('VEH012'), weeklyFuelQuotaL: 3.5, litresUsedThisWeek: 0 }] });
    day.outlets.find((shop) => shop.id === 'OUT006')!.name = 'Fresh Supermarket Colombo Central Distribution';
    const result = success(buildSuggestedPlan(day));
    expect(result.input.plan.deferrals).toMatchObject([{ code: 'fuel' }]);
    expect(result.choices[0]!.reason).toContain('3.5 litres');
    expect(result.choices[0]!.reason).toMatch(/before rounding|less than 0\.1 litres/);
    clearReasons(result);
  });
});
