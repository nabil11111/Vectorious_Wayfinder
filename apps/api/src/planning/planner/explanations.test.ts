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
    expect(result.choices[1]!.reason).toMatch(/joined the reefer truck VEH004/);
    expect(result.choices[1]!.reason).toMatch(/existing|fill/);
    clearReasons(result);
  });

  it('AC-17 keeps no-slot capacity wording free of an irrelevant split limit', () => {
    const result = success(buildSuggestedPlan(plannerInput([plannerOrder('big', 'OUT006', 'fresh-dry-carton', 1000)], { vehicles: [] })));
    // No truck works at all, which is a hard limit and says so, never that the trucks were full.
    expect(result.input.plan.deferrals[0]!.reason).toBe('No truck was free for Colombo on Thursday.');
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
    // Alone on the truck's first trip the Fresh cartons would be on time, so the plan, not the truck, kept them off.
    expect(result.input.plan.deferrals[0]).toMatchObject({ code: 'window', reason: 'The order for Colombo didn\'t fit this suggested plan\'s trucks on Thursday; try it by hand on the board.' });
    expect(result.choices[1]!.reason).toMatch(/Colombo is reached at \d\d:\d\d by the second trip of the dry truck VEH012/);
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
    expect(result.input.plan.deferrals).toMatchObject([{ orderId: 'added', code: 'window', reason: 'The order for Gampaha didn\'t fit this suggested plan\'s trucks on Thursday; try it by hand on the board.' }]);
    // The choice keeps the evidence: the stop that the insertion would make late.
    expect(result.choices.find((c) => c.orderId === 'added')!.reason).toMatch(/reached at \d\d:\d\d/);
    clearReasons(result);
  });

  it('AC-17 keeps no-fridge and fuel refusals in shop words through the builder', () => {
    const noFridge = success(buildSuggestedPlan(plannerInput([plannerOrder('cold', 'OUT001', 'fresh-chilled-carton')], { vehicles: [] })));
    expect(noFridge.input.plan.deferrals).toMatchObject([{ code: 'no_reefer', reason: 'No fridge truck was free for Colombo on Thursday.' }]);
    clearReasons(noFridge);
    const fuel = success(buildSuggestedPlan(plannerInput([plannerOrder('far', 'OUT060', 'fresh-chilled-carton')], { vehicles: [{ ...vehicle('VEH001'), litresUsedThisWeek: 340 }] })));
    expect(fuel.input.plan.deferrals).toMatchObject([{ code: 'fuel', reason: "The fridge trucks that could reach Matara on Thursday did not have enough of this week's fuel left." }]);
    clearReasons(fuel);
  });

  it('AC-17 says van for a van-only shop, and fridge van for its chilled goods, through the builder', () => {
    const empty = (id: string) => ({ ...vehicle(id), litresUsedThisWeek: vehicle(id).weeklyFuelQuotaL });
    const dry = success(buildSuggestedPlan(plannerInput([plannerOrder('dry', 'OUT002')], { vehicles: [empty('VEH037')] })));
    expect(dry.input.plan.deferrals).toMatchObject([{ code: 'fuel', reason: "The vans that could reach Colombo on Thursday did not have enough of this week's fuel left." }]);
    clearReasons(dry);
    const cold = success(buildSuggestedPlan(plannerInput([plannerOrder('cold', 'OUT002', 'fresh-chilled-carton')], { vehicles: [empty('VEH035')] })));
    expect(cold.input.plan.deferrals).toMatchObject([{ code: 'fuel', reason: "The fridge vans that could reach Colombo on Thursday did not have enough of this week's fuel left." }]);
    clearReasons(cold);
  });

  it('AC-17 says fridge truck when a chilled insertion would make other shops late', () => {
    const day = plannerInput([
      ...['OUT026', 'OUT028', 'OUT030'].map((shop) => plannerOrder(shop, shop, 'fresh-chilled-carton', 1, { deliveryDate: '2026-06-22', timesDeferred: 3 })),
      plannerOrder('deadline', 'OUT010', 'fresh-chilled-carton', 1, { deliveryDate: '2026-06-23', timesDeferred: 2 }),
      plannerOrder('added', 'OUT027', 'fresh-chilled-carton'),
    ], { vehicles: [vehicle('VEH001')] });
    day.outlets.find((shop) => shop.id === 'OUT027')!.windowOpen = 420;
    const result = success(buildSuggestedPlan(day));
    expect(result.input.plan.deferrals).toMatchObject([{ orderId: 'added', code: 'window', reason: 'The order for Gampaha didn\'t fit this suggested plan\'s fridge trucks on Thursday; try it by hand on the board.' }]);
    clearReasons(result);
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
    // The van is named once in full; the remainder's refusal then calls it "its" (spec 024), which keeps the cap.
    expect(result.choices[0]!.reason).toBe('Rank 1: waited since Wed; chilled; Colombo by 07:59; 150 cartons on the reefer van VEH035 (only usable run); 30 wait: Colombo is reached at 11:34 by its second trip, after the 08:00 deadline.');
    clearReasons(result);
  });

  it('spec 026 keeps long drivers\' names in a split explanation by tightening it first, within 200 characters', () => {
    const result = success(buildSuggestedPlan(plannerInput([
      plannerOrder('new', 'OUT002', 'fresh-chilled-carton', 30),
      plannerOrder('waiting', 'OUT001', 'fresh-chilled-carton', 180, { deliveryDate: '2026-06-24', timesDeferred: 1 }),
    ], { vehicles: [{ ...vehicle('VEH035'), driverName: 'Chaminda Kumara Wickramasinghe' }, { ...vehicle('VEH036'), driverName: 'Dilshan Pradeep Jayawardena' }] })));
    expect(result.choices.map((choice) => choice.reason)).toEqual([
      // With both names the short form is 206 characters, so the reason is tightened, the deciding rules left out, and both
      // vans keep their drivers' names (review of 026: names give way last).
      'Rank 1: waited since Wed; chilled; Colombo by 07:30; 150 cartons on Chaminda Kumara Wickramasinghe\'s reefer van; 30 cartons on Dilshan Pradeep Jayawardena\'s reefer van',
      // This one fits with its driver's name, so it keeps it.
      'Rank 2: new order; chilled; Colombo due 07:59; Fresh, vans only; joined Dilshan Pradeep Jayawardena\'s reefer van on its run to Colombo, fills an existing run',
    ]);
    clearReasons(result);
  });

  it('keeps a Kandy split explanation within 200 characters by leaving out its deciding rule, last of all', () => {
    // A review case: five large waiting orders on three of Kandy's fridge trucks. Even tight, the explanation for
    // OUT092 was 203 characters, so it leaves out "(only usable run)" and keeps every truck, trip, quantity and limit.
    const waiting = { deliveryDate: '2026-06-24', timesDeferred: 1 };
    const result = success(buildSuggestedPlan(plannerInput([
      plannerOrder('OUT084', 'OUT084', 'fresh-dry-carton', 620, waiting),
      plannerOrder('OUT112', 'OUT112', 'fresh-chilled-carton', 806, waiting),
      plannerOrder('OUT092', 'OUT092', 'style-hanging', 674, waiting),
      plannerOrder('OUT089', 'OUT089', 'style-hanging', 851, waiting),
      plannerOrder('OUT116', 'OUT116', 'fresh-chilled-carton', 973, waiting),
    ], { depotId: 'Kandy', vehicles: [vehicle('VEH039'), vehicle('VEH042'), vehicle('VEH043')] })));
    expect(result.choices.find((choice) => choice.orderId === 'OUT092')!.reason)
      .toBe('Rank 5: waited since Wed; dry; Kandy by 17:00; 88 boxes on reefer truck VEH043\'s second trip; 586 wait: Reefer truck VEH042 carries 9,590 kg on its second trip, over its 6,180 kg limit.');
    // The others fit sooner and keep their deciding rules.
    expect(result.choices.find((choice) => choice.orderId === 'OUT112')!.reason)
      .toBe('Rank 2: waited since Wed; chilled; Badulla by 07:45; 713 cartons on reefer truck VEH043 (only usable run); 93 wait: reached at 09:44 by reefer truck VEH039\'s second trip, after 07:45.');
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
