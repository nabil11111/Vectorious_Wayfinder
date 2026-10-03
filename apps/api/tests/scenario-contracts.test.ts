import { describe, expect, it } from 'vitest';
import { PlanScenarioRequest, ScenarioSummary } from '@wayfinder/contracts';

describe('read-only planning scenario boundary (028 F)', () => {
  it('names one vehicle and the exact board the dispatcher is comparing', () => {
    const body = { ref: { planId: null, demoDay: 1 }, excludedVehicleId: 'VEH035' };
    expect(PlanScenarioRequest.parse(body)).toEqual(body);
    expect(PlanScenarioRequest.safeParse({ ...body, excludedVehicleId: '' }).success).toBe(false);
    expect(PlanScenarioRequest.safeParse({ ...body, ref: { planId: null } }).success).toBe(false);
    expect(PlanScenarioRequest.safeParse({ ...body, apply: true }).success).toBe(false);
  });
  it('reports service counts without pretending mixed ordering units are capacity', () => {
    const summary = { totalOrders: 3, fullyPlanned: 1, partiallyPlanned: 1, deferred: 1,
      shopsFullyPlanned: 1, vehicles: 2, trips: 2, fuelLitres: 14.3, repeatedDeferrals: 1 };
    expect(ScenarioSummary.parse(summary)).toEqual(summary);
    expect(ScenarioSummary.safeParse({ ...summary, fuelLitres: -1 }).success).toBe(false);
    expect(ScenarioSummary.safeParse({ ...summary, fullyPlanned: 1.5 }).success).toBe(false);
  });
});
