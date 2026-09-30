import { buildSuggestedPlan } from './build';
import { demoFixture, threeHundredOrders } from './testing/demo';
import type { PlannerInput } from '../types';

// From the repo root: DATABASE_URL=postgres://wayfinder:wayfinder@localhost:5433/wf_planner
// npx tsx apps/api/src/planning/planner/bench.ts
// Node 22+ is required. This development entry point is never imported by the production planner.
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('The planner benchmark requires Node 22 or later.');
const { input: demo } = await demoFixture();
const larger = threeHundredOrders(demo);
const measure = (input: PlannerInput, limitMs: number) => {
  const warm = buildSuggestedPlan(input);
  if (warm.status === 'unavailable' || !warm.check.ok) throw new Error('The benchmark fixture did not produce a valid suggestion.');
  const elapsedMs: number[] = [];
  for (let run = 0; run < 10; run += 1) {
    const start = performance.now();
    const result = buildSuggestedPlan(input);
    elapsedMs.push(performance.now() - start);
    if (result.status === 'unavailable' || !result.check.ok) throw new Error('A measured run did not produce a valid suggestion.');
  }
  const sorted = [...elapsedMs].sort((a, b) => a - b);
  const medianMs = (sorted[4]! + sorted[5]!) / 2;
  return { orders: input.orders.length, limitMs, medianMs, elapsedMs, passes: medianMs < limitMs };
};
const cases = [measure(demo, 1000), measure(larger, 2000)];
console.log(JSON.stringify({
  runtime: process.version, platform: process.platform, architecture: process.arch,
  fixture: 'Thu 25 Jun 2026 seed; 300-order case cycles seed rows with unique IDs and the same fleet',
  warmupsPerCase: 1, measurementsPerCase: 10, fixtureLoadingTimed: false, cases,
}, null, 2));
if (cases.some((result) => !result.passes)) process.exitCode = 1;
