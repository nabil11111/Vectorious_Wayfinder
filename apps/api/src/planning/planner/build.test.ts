import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DraftPlan } from '@wayfinder/contracts';
import * as checker from '../check';
import { computeLoad } from '../load';
import { PlanInputError } from '../errors';
import { vehicle } from '../testing/shared';
import type { PlannerInput, PlannerResult } from '../types';
import { buildSuggestedPlan } from './build';
import { prepareInput } from './priority';
import { plannerInput, plannerOrder } from './testing/input';

const success = (result: PlannerResult) => {
  expect(result.status).not.toBe('unavailable');
  if (result.status === 'unavailable') throw new Error('Expected a suggestion');
  expect(result.check.ok).toBe(true);
  expect(result.check).toEqual(checker.checkPlan(result.input));
  return result;
};
const freeze = (value: unknown): void => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
};
const reverse = (input: PlannerInput) => {
  const next = structuredClone(input);
  for (const key of ['orders', 'outlets', 'vehicles', 'products', 'travel', 'allowances'] as const) next[key].reverse();
  next.orders.forEach((o) => o.lines.reverse());
  return next;
};

describe('the complete suggested plan', () => {
  it('AC-1 returns a complete checked plan and one ranked explanation per original order', () => {
    const input = plannerInput([plannerOrder('new', 'OUT006'), plannerOrder('old', 'OUT001', 'fresh-chilled-carton', 180, { deliveryDate: '2026-06-24', timesDeferred: 1 })], { vehicles: [vehicle('VEH035'), vehicle('VEH012')] });
    const result = success(buildSuggestedPlan(input));
    expect(result.choices.map((c) => [c.orderId, c.rank, c.resultOrderIds])).toEqual([
      ['old', 1, ['split:old:keep', 'split:old:rest']], ['new', 2, ['new']],
    ]);
    expect(result.choices.every((c) => c.reason.trim().length > 0)).toBe(true);
    expect(result.splits).toHaveLength(1);
    expect(result.input.orders.map((o) => o.id)).toEqual(['split:old:keep', 'split:old:rest', 'new']);
    expect(result.input.plan.deferrals).toEqual([]);
    expect(result.status).toBe('suggested');
    expect(result.decisions).toEqual([]);
    expect(result.input.plan.trips.find((trip) => trip.vehicleId === 'VEH035' && trip.tripNo === 2)?.stops[0]!.orderIds).toEqual(['split:old:rest']);
  });

  it('AC-3 reports window deferrals and repeated waiting without giving new orders their shop\'s old priority', () => {
    const input = plannerInput([
      plannerOrder('current', 'OUT001', 'fresh-chilled-carton', 10),
      plannerOrder('old', 'OUT001', 'fresh-chilled-carton', 180, { deliveryDate: '2026-06-24', timesDeferred: 1 }),
      plannerOrder('other-waiting', 'OUT006', 'fresh-dry-carton', 1, { deliveryDate: '2026-06-24', timesDeferred: 1 }),
    ], { vehicles: [] });
    const result = success(buildSuggestedPlan(input));
    expect(result.choices.map((c) => c.orderId)).toEqual(['old', 'other-waiting', 'current']);
    expect(result.decisions.map((d) => 'orderId' in d ? d.orderId : '')).toEqual(['old', 'other-waiting']);
    const window = plannerInput([plannerOrder('late', 'OUT017', 'style-folded')], { vehicles: [vehicle('VEH012')] });
    Object.assign(window.outlets.find((s) => s.id === 'OUT017')!, { windowOpen: 600, windowClose: 620, mallOpen: 700, mallClose: 750 });
    const missed = success(buildSuggestedPlan(window));
    expect(missed.input.plan.deferrals[0]!.code).toBe('window');
    expect(missed.status).toBe('needs_decision');
    expect(missed.decisions).toMatchObject([{ kind: 'late_order', orderId: 'late' }]);
  });

  it('AC-9 asks for an early departure even when it is after the brand minimum', () => {
    const input = plannerInput([plannerOrder('late-opening', 'OUT006')], { vehicles: [vehicle('VEH012')] });
    // Boundary: Fresh opens after its arrival deadline. Earlier arrival and waiting are checker-valid.
    Object.assign(input.outlets.find((s) => s.id === 'OUT006')!, { windowOpen: 600, windowClose: 800 });
    const result = success(buildSuggestedPlan(input));
    expect(result.input.plan.trips[0]!.leaveAt).toBe(455);
    expect(result.check.problems.some((p) => p.code === 'leaves_early')).toBe(false);
    expect(result.status).toBe('needs_decision');
    expect(result.decisions).toMatchObject([{ kind: 'early_leave', vehicleId: 'VEH012', tripNo: 1, leaveAt: 455 }]);
  });

  it('AC-9 returns the numeric early decision once for the final Badulla trip', () => {
    const input = plannerInput(['OUT110', 'OUT112', 'OUT111', 'OUT113'].map((s) => plannerOrder(s, s)), { depotId: 'Kandy', vehicles: [vehicle('VEH044')] });
    const result = success(buildSuggestedPlan(input));
    expect(result.input.plan.trips).toHaveLength(1);
    expect(result.decisions).toEqual([{ kind: 'early_leave', vehicleId: 'VEH044', tripNo: 1, leaveAt: 179, reason: expect.stringContaining('02:59') }]);
  });

  it('AC-9 gives the fourth Badulla order an idle truck before asking to leave early', () => {
    const input = plannerInput(['OUT110', 'OUT112', 'OUT111', 'OUT113'].map((s, i) => plannerOrder(`order-${i}`, s)), {
      depotId: 'Kandy', vehicles: [vehicle('VEH044'), { ...vehicle('VEH044'), id: 'VEH045' }],
    });
    const result = success(buildSuggestedPlan(input));
    expect(result.input.plan.trips.map((t) => [t.vehicleId, t.tripNo])).toEqual([['VEH044', 1], ['VEH045', 1]]);
    expect(result.decisions.filter((d) => d.kind === 'early_leave')).toEqual([]);
    expect(result.choices[3]!.reason).toMatch(/usual|earlier departure/);
  });

  it('AC-9 names the insertion that forced the final early departure', () => {
    const input = plannerInput(['OUT110', 'OUT112', 'OUT111', 'OUT113'].map((s, i) => plannerOrder(`order-${i}`, s)), {
      depotId: 'Kandy', vehicles: [vehicle('VEH044')],
    });
    const result = success(buildSuggestedPlan(input));
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]!.reason).toMatch(/rank 4.*Badulla/i);
    expect(result.decisions[0]!.reason).toContain('02:59');
  });

  it('spec 024 words the early departure with the order first and the truck by its kind, and no trip number', () => {
    const input = plannerInput(['OUT110', 'OUT112', 'OUT111', 'OUT113'].map((s, i) => plannerOrder(`order-${i}`, s)), {
      depotId: 'Kandy', vehicles: [vehicle('VEH044')],
    });
    expect(success(buildSuggestedPlan(input)).decisions.map((d) => d.reason))
      .toEqual(['The rank 4 order for Badulla makes the dry truck VEH044 leave at 02:59 instead of 03:30.']);
  });

  it('spec 026 names the truck by the driver the input gives its vehicle, in the reasons and the final check', () => {
    const input = plannerInput(['OUT110', 'OUT112', 'OUT111', 'OUT113'].map((s, i) => plannerOrder(`order-${i}`, s)), {
      depotId: 'Kandy', vehicles: [{ ...vehicle('VEH044'), driverName: 'Prasanna' }],
    });
    const result = success(buildSuggestedPlan(input));
    expect(result.decisions.map((d) => d.reason)).toEqual(['The rank 4 order for Badulla makes Prasanna\'s dry truck leave at 02:59 instead of 03:30.']);
    expect(result.choices[0]!.reason).toContain('new run on Prasanna\'s dry truck to Badulla');
    // The plan's trips carry the driver, so the checker's warnings name him.
    expect(result.input.plan.trips.map((t) => t.driverName)).toEqual(['Prasanna']);
    expect(result.check.problems.find((p) => p.code === 'leaves_early')!.message)
      .toBe('Prasanna\'s dry truck leaves at 02:59, and a trip with a Fresh shop normally leaves at 03:30 or later.');
  });

  it('spec 026 plans with a blank usual driver as with none, and words the truck by its kind and id', () => {
    const input = plannerInput(['OUT110', 'OUT112', 'OUT111', 'OUT113'].map((s, i) => plannerOrder(`order-${i}`, s)), {
      depotId: 'Kandy', vehicles: [{ ...vehicle('VEH044'), driverName: '   ' }],
    });
    const result = success(buildSuggestedPlan(input));
    expect(result.decisions.map((d) => d.reason)).toEqual(['The rank 4 order for Badulla makes the dry truck VEH044 leave at 02:59 instead of 03:30.']);
    expect(result.input.plan.trips[0]).not.toHaveProperty('driverName');
    expect(result.check.problems.find((p) => p.code === 'leaves_early')!.message)
      .toBe('The dry truck VEH044 leaves at 02:59, and a trip with a Fresh shop normally leaves at 03:30 or later.');
  });

  it('AC-13 carries a waiting remainder whole on the idle van before considering new goods', () => {
    const input = plannerInput([
      plannerOrder('new', 'OUT002', 'fresh-chilled-carton', 30),
      plannerOrder('waiting', 'OUT001', 'fresh-chilled-carton', 180, { deliveryDate: '2026-06-24', timesDeferred: 1 }),
    ], { vehicles: [vehicle('VEH035'), vehicle('VEH036')] });
    const result = success(buildSuggestedPlan(input));
    expect(result.splits).toHaveLength(1);
    expect(result.input.plan.trips.find((t) => t.vehicleId === 'VEH036')!.stops[0]!.orderIds).toContain('split:waiting:rest');
    expect(result.input.plan.deferrals.some((d) => d.orderId === 'split:waiting:rest')).toBe(false);
    expect(result.decisions.some((d) => d.kind === 'waited_again')).toBe(false);
    expect(result.choices[0]!.reason).toMatch(/waited since Wed/);
    expect(result.choices[0]!.reason).toContain('VEH036');
  });

  it('AC-12 builds the mall run through the public planner', () => {
    const input = plannerInput(['OUT019', 'OUT017', 'OUT015'].map((s) => plannerOrder(s, s, 'style-folded')), {
      vehicles: [vehicle('VEH023')],
    });
    const result = success(buildSuggestedPlan(input));
    expect(result.input.plan.trips).toHaveLength(1);
    expect(result.input.plan.trips[0]!.stops.map((s) => s.outletId)).toEqual(['OUT015', 'OUT017', 'OUT019']);
    const timed = result.check.trips[0]!.times!;
    expect(timed.leaveAt).toBe(516);
    expect(timed.stops[1]).toMatchObject({ arriveAt: 607, waitMin: 23, startAt: 630 });
    expect(timed.stops[2]!.arriveAt).toBe(697);
  });

  it('AC-20 orders a kept part early decision before its waiting remainder', () => {
    const input = plannerInput([plannerOrder('old', 'OUT001', 'fresh-chilled-carton', 180, {
      deliveryDate: '2026-06-24', timesDeferred: 1,
    })], { vehicles: [vehicle('VEH035')] });
    Object.assign(input.outlets.find((s) => s.id === 'OUT001')!, { windowOpen: 600, windowClose: 800 });
    const result = success(buildSuggestedPlan(input));
    expect(result.decisions.map((d) => d.kind)).toEqual(['early_leave', 'waited_again', 'late_order']);
  });

  it('AC-16 covers each effective order once and fits the board after temporary IDs are resolved', () => {
    const input = plannerInput([plannerOrder('big', 'OUT001', 'fresh-chilled-carton', 300), plannerOrder('dry', 'OUT006')]);
    const result = success(buildSuggestedPlan(input));
    const ids = [...result.input.plan.trips.flatMap((t) => t.stops.flatMap((s) => s.orderIds)), ...result.input.plan.deferrals.map((d) => d.orderId)];
    expect([...ids].sort()).toEqual(result.input.orders.map((o) => o.id).sort());
    expect(new Set(ids).size).toBe(ids.length);
    const idMap = new Map(result.input.orders.map((o, i) => [o.id, `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`]));
    const draft = {
      mixBrands: input.settings.mixBrands,
      trips: result.input.plan.trips.map((t) => ({ ...t, leaveAt: t.leaveAt ?? null, driverId: null, stops: t.stops.map((s) => ({ ...s, orderIds: s.orderIds.map((id) => idMap.get(id)!) })) })),
      deferrals: result.input.plan.deferrals.map((d) => ({ ...d, orderId: idMap.get(d.orderId)! })),
    };
    expect(DraftPlan.safeParse(draft).success).toBe(true);
    expect(computeLoad(result.input.orders.flatMap((o) => o.lines), input.products)).toEqual(computeLoad(input.orders.flatMap((o) => o.lines), input.products));
  });

  it('AC-16 handles the 300-order bound with whole deferrals when a split cannot be represented', () => {
    const input = plannerInput(Array.from({ length: 300 }, (_, i) => plannerOrder(`o${i}`, 'OUT001', 'fresh-chilled-carton', 180)), { vehicles: [vehicle('VEH035')] });
    const result = success(buildSuggestedPlan(input));
    expect(result.splits).toEqual([]);
    expect(result.input.orders).toHaveLength(300);
    expect(result.input.plan.deferrals).toHaveLength(300);
    expect(result.input.plan.deferrals.every((d) => d.code === 'over_capacity' && d.reason.includes('300-order limit'))).toBe(true);
  });

  it('AC-18 returns checked empty input and a fully deferred operating day without vehicles', () => {
    expect(success(buildSuggestedPlan(plannerInput())).status).toBe('suggested');
    const result = success(buildSuggestedPlan(plannerInput([plannerOrder('cold', 'OUT001', 'fresh-chilled-carton'), plannerOrder('dry', 'OUT006')], { vehicles: [] })));
    expect(result.status).toBe('suggested');
    expect(result.input.plan.trips).toEqual([]);
    expect(result.input.plan.deferrals.map((d) => d.code)).toEqual(['no_reefer', 'over_capacity']);
  });

  it('AC-17 reports fuel when one vehicle passes timing but another only has fuel left', () => {
    const input = plannerInput([
      plannerOrder('older-style', 'OUT019', 'style-folded', 1, { deliveryDate: '2026-06-24', timesDeferred: 1 }),
      plannerOrder('new-chilled', 'OUT006', 'fresh-chilled-carton', 1),
    ], { vehicles: [{ ...vehicle('VEH004'), litresUsedThisWeek: vehicle('VEH004').weeklyFuelQuotaL }, vehicle('VEH001')] });
    // The old Style order takes VEH001's first trip. Its second cannot reach Fresh in time; VEH004 can,
    // but has no fuel left. A window rejection must not erase the other vehicle's timing survivor.
    const result = success(buildSuggestedPlan(input));
    expect(result.input.plan.deferrals).toMatchObject([{ orderId: 'new-chilled', code: 'fuel' }]);
    expect(result.decisions).toEqual([]);
    expect(result.input.plan.trips[0]!.stops[0]!.orderIds).toEqual(['older-style']);
  });

  it('AC-18 returns unavailable on nonoperating days with no applicable plan', () => {
    const result = buildSuggestedPlan(plannerInput([plannerOrder('a', 'OUT006')], { operatingDay: false }));
    expect(result.status).toBe('unavailable');
    expect(result).not.toHaveProperty('input');
    expect(result.check.ok).toBe(false);
    expect(result.check.problems.map((p) => p.code)).toContain('not_operating_day');
  });

  it('AC-18 preserves the final checker failure instead of deleting accepted orders', () => {
    const original = checker.checkPlan;
    const finalCheck = vi.spyOn(checker, 'checkPlan').mockImplementation((input) => {
      const check = original(input);
      return input.vehicles.length === 2 && input.orders.length === 2
        ? { ...check, ok: false, problems: [...check.problems, { code: 'fuel_over_quota', level: 'block', message: 'Injected final check failure.' }] }
        : check;
    });
    try {
      const result = buildSuggestedPlan(plannerInput([plannerOrder('a', 'OUT006'), plannerOrder('b', 'OUT007')], { vehicles: [vehicle('VEH012'), vehicle('VEH008')] }));
      expect(result.status).toBe('unavailable');
      expect(result).not.toHaveProperty('input');
      expect(result.check.problems).toContainEqual(expect.objectContaining({ message: 'Injected final check failure.' }));
      expect(result.check.trips.reduce((n, t) => n + t.load.units, 0)).toBe(2);
    } finally { finalCheck.mockRestore(); }
  });

  it('AC-19 validates history before trying to plan', () => {
    const input = plannerInput([plannerOrder('missing', 'OUT001')]);
    delete (input.orders[0] as Partial<typeof input.orders[number]>).timesDeferred;
    expect(() => buildSuggestedPlan(input)).toThrow(PlanInputError);
  });

  it('AC-20 is identical for frozen or shuffled rows and lines, with canonical output ordering', () => {
    const input = plannerInput([
      plannerOrder('new', 'OUT019', 'style-folded', 3, { lines: [{ productId: 'style-folded', quantity: 3 }, { productId: 'style-bags', quantity: 1 }] }),
      plannerOrder('old', 'OUT001', 'fresh-chilled-carton', 300, { deliveryDate: '2026-06-24', timesDeferred: 1 }),
      plannerOrder('far', 'OUT060', 'fresh-chilled-carton', 39),
      plannerOrder('dry', 'OUT006', 'fresh-dry-carton', 10),
    ], { vehicles: [vehicle('VEH035'), vehicle('VEH012'), { ...vehicle('VEH001'), litresUsedThisWeek: 300 }] });
    const before = structuredClone(input);
    freeze(input);
    const result = success(buildSuggestedPlan(input));
    expect(buildSuggestedPlan(input)).toEqual(result);
    expect(buildSuggestedPlan(reverse(input))).toEqual(result);
    expect(input).toEqual(before);
    expect(result.choices.map((c) => c.orderId)).toEqual(prepareInput(input).orders.map((o) => o.id));
    expect(result.input.plan.trips.map((t) => `${t.vehicleId}:${t.tripNo}`)).toEqual(result.input.plan.trips.map((t) => `${t.vehicleId}:${t.tripNo}`).sort());
    expect(result.status === 'needs_decision').toBe(result.decisions.length > 0);
  });

  it('AC-20/22 keeps the search independent of external state and elapsed time', () => {
    for (const file of ['build', 'priority', 'candidates', 'split', 'reasons']) {
      const source = readFileSync(new URL(`./${file}.ts`, import.meta.url), 'utf8');
      expect(source).not.toMatch(/performance\.|Date\.now|new Date\(|Math\.random|setTimeout|fetch\(/);
      for (const [, from] of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) expect(from!.startsWith('.') || from === '@wayfinder/contracts').toBe(true);
    }
  });
});
