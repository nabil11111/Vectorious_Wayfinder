import { z } from 'zod';
import { PlanCheck } from './planning';
import { PlanRef } from './plans';

// A comparison is read-only. The same snapshot is planned twice; only one vehicle's availability changes.
export const PlanScenarioRequest = z.strictObject({
  ref: PlanRef, excludedVehicleId: z.string().min(1).max(16),
});
export type PlanScenarioRequest = z.infer<typeof PlanScenarioRequest>;
const Count = z.number().int().min(0);
export const ScenarioSummary = z.object({
  totalOrders: Count, fullyPlanned: Count, partiallyPlanned: Count, deferred: Count,
  shopsFullyPlanned: Count, vehicles: Count, trips: Count, fuelLitres: z.number().min(0), repeatedDeferrals: Count,
});
export type ScenarioSummary = z.infer<typeof ScenarioSummary>;
export const ScenarioOrder = z.object({
  // Persisted split parts are grouped under their original. Counts describe the outstanding demand in this snapshot.
  orderId: z.string(), outletId: z.string(), shopName: z.string(),
  status: z.enum(['planned', 'partial', 'deferred']), waitedBefore: z.boolean(),
  vehicleIds: z.array(z.string()), reasons: z.array(z.string()),
});
export type ScenarioOrder = z.infer<typeof ScenarioOrder>;
export const ScenarioOutcome = z.object({
  summary: ScenarioSummary, orders: z.array(ScenarioOrder), check: PlanCheck,
});
export type ScenarioOutcome = z.infer<typeof ScenarioOutcome>;
export const PlanScenario = z.object({
  depot: z.string(), date: z.iso.date(), ref: PlanRef, excludedVehicleId: z.string(),
  comparedAt: z.iso.datetime(), snapshotKey: z.string().min(1),
  baseline: ScenarioOutcome, scenario: ScenarioOutcome,
});
export type PlanScenario = z.infer<typeof PlanScenario>;
