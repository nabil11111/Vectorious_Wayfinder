import { expect, expectTypeOf, it } from 'vitest';
import { buildSuggestedPlan } from '../index';
import type { BuildSuggestedPlan, PlannerDecision, PlannerInput, PlannerOrder, PlannerResult, PlannerSplit } from '../types';

it('T0 exposes the pure planner and its engine-only hand-off types', () => {
  expect(buildSuggestedPlan).toBeTypeOf('function');
  expectTypeOf(buildSuggestedPlan).toEqualTypeOf<BuildSuggestedPlan>();
  expectTypeOf<PlannerInput['orders']>().toEqualTypeOf<PlannerOrder[]>();
  expectTypeOf<PlannerSplit['keep']>().toEqualTypeOf<{ productId: string; quantity: number }[]>();
  expectTypeOf<PlannerDecision['kind']>().toEqualTypeOf<'early_leave' | 'waited_again' | 'late_order'>();
  expectTypeOf<PlannerResult['status']>().toEqualTypeOf<'suggested' | 'needs_decision' | 'unavailable'>();
});
