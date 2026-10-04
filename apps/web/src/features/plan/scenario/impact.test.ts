import type { PlanScenario, ScenarioOrder, ScenarioOutcome } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import { impactHeadline, scenarioImpact } from './impact';
const order = (orderId: string, status: ScenarioOrder['status'], vehicles = status === 'deferred' ? [] : ['VEH001'], waitedBefore = false): ScenarioOrder => ({ orderId, outletId: `OUT${orderId}`, shopName: `Shop ${orderId}`, status, vehicleIds: vehicles, waitedBefore, reasons: [`Actual reason for ${orderId}`] });
const outcome = (orders: ScenarioOrder[]): ScenarioOutcome => ({ orders, summary: { totalOrders: orders.length, fullyPlanned: orders.filter(o => o.status === 'planned').length, partiallyPlanned: orders.filter(o => o.status === 'partial').length, deferred: orders.filter(o => o.status === 'deferred').length, shopsFullyPlanned: 0, shopsWithWaiting: 0, vehicles: 0, trips: 0, fuelLitres: 0, repeatedDeferrals: 0 }, check: { ok: true, problems: [], trips: [], vehicles: [] } });
const result = (before: ScenarioOrder[], after: ScenarioOrder[]): PlanScenario => ({ depot: 'Peliyagoda', date: '2026-06-25', ref: { planId: null, demoDay: 1 }, excludedVehicleId: 'VEH001', comparedAt: '2026-06-25T04:00:00Z', snapshotKey: 'one', baseline: outcome(before), scenario: outcome(after) });
it('shows no change, including vehicle arrays in a different order, without fabricating lost deliveries', () => {
  const impact = scenarioImpact(result([order('1', 'planned', ['VEH001', 'VEH002'])], [order('1', 'planned', ['VEH002', 'VEH001'])]));
  expect(impact.kind).toBe('unchanged'); expect(impact.affected).toEqual([]); expect(impact.newWaiting).toBe(0); expect(impact.reassigned).toBe(0);
});
it('separates a new delay from an order already waiting in both suggestions', () => {
  const impact = scenarioImpact(result([order('1', 'planned'), order('2', 'deferred')], [order('1', 'deferred'), order('2', 'deferred')]));
  expect(impact.kind).toBe('worse'); expect(impact.newWaiting).toBe(1); expect(impact.alreadyWaiting).toBe(1); expect(impact.worsened).toBe(1);
  expect(impact.affected.map(row => row.after.orderId)).toEqual(['1']); expect(impact.waiting.map(row => row.after.orderId)).toEqual(['2']);
});
it('describes partial fulfillment and more waiting on an already partly covered order separately', () => {
  const impact = scenarioImpact(result([order('1', 'planned'), order('2', 'partial')], [order('1', 'partial', ['VEH002']), order('2', 'deferred')]));
  expect(impact.newWaiting).toBe(1); expect(impact.moreWaiting).toBe(1); expect(impact.partial).toBe(1);
  expect(impact.affected.map(row => row.kind)).toEqual(['new_waiting', 'more_waiting']);
  expect(impact.affected[0]!.explanation).toContain('part'); expect(impact.affected[1]!.explanation).toContain('already');
});
it('reports improved and mixed outcomes honestly', () => {
  const improved = scenarioImpact(result([order('1', 'deferred'), order('2', 'partial')], [order('1', 'partial', ['VEH002']), order('2', 'planned', ['VEH002'])]));
  expect(improved.kind).toBe('improved'); expect(improved.improved).toBe(2); expect(improved.worsened).toBe(0);
  const mixed = scenarioImpact(result([order('1', 'planned'), order('2', 'deferred')], [order('1', 'deferred'), order('2', 'planned', ['VEH002'])]));
  expect(mixed.kind).toBe('mixed'); expect(mixed.improved).toBe(1); expect(mixed.worsened).toBe(1);
});
it('treats truck reassignment as an affected delivery without claiming it is lost', () => {
  const impact = scenarioImpact(result([order('1', 'planned')], [order('1', 'planned', ['VEH002'])]));
  expect(impact.kind).toBe('reassigned'); expect(impact.reassigned).toBe(1); expect(impact.worsened).toBe(0); expect(impact.newWaiting).toBe(0);
  expect(impact.affected[0]!.explanation).toContain('different truck');
});
it('does not turn unchanged or reassigned partial orders into newly lost deliveries', () => {
  const impact = scenarioImpact(result([order('1', 'partial')], [order('1', 'partial', ['VEH002'])]));
  expect(impact.kind).toBe('reassigned'); expect(impact.partial).toBe(1); expect(impact.newWaiting).toBe(0); expect(impact.alreadyWaiting).toBe(1);
  expect(impact.affected[0]!.explanation).toContain('partly');
});
it('retains earlier-day waiting evidence even when today’s suggestion was fully covered', () => {
  const previous = order('1', 'planned', ['VEH001'], true); const next = order('1', 'deferred', [], true);
  const impact = scenarioImpact(result([previous], [next]));
  expect(impact.newWaiting).toBe(1); expect(impact.affected[0]!.after.waitedBefore).toBe(true); expect(impact.affected[0]!.after.reasons).toEqual(next.reasons);
});
it('keeps all reasons available for unchanged waiting orders and zero demand', () => {
  const impact = scenarioImpact(result([order('1', 'deferred')], [order('1', 'deferred')]));
  expect(impact.kind).toBe('unchanged'); expect(impact.affected).toEqual([]); expect(impact.waiting).toHaveLength(1); expect(impact.rows[0]!.before.reasons).toEqual(['Actual reason for 1']);
  expect(scenarioImpact(result([], [])).kind).toBe('empty');
});
it('uses honest, plain headlines for unchanged, improved, mixed and reassigned results', () => {
  const headline = (before: ScenarioOrder[], after: ScenarioOrder[]) => impactHeadline(scenarioImpact(result(before, after)), 'VEH001');
  expect(headline([], [])).toBe('No orders to compare.');
  expect(headline([order('1', 'partial')], [order('1', 'partial')])).toBe('The same orders are planned or waiting, using the same trucks.');
  expect(headline([order('1', 'deferred')], [order('1', 'planned')])).toBe('Some orders could receive more goods.');
  expect(headline([order('1', 'planned'), order('2', 'deferred')], [order('1', 'deferred'), order('2', 'planned')])).toContain('Others would have more waiting');
  expect(headline([order('1', 'partial')], [order('1', 'partial', ['VEH002'])])).toBe('Orders stay fully or partly planned as before, using different trucks.');
});
it('puts newly waiting shops before improvements and truck-only changes even when reassigned rows arrive first', () => {
  const value = result(
    [order('1', 'planned'), order('2', 'partial'), order('3', 'deferred'), order('4', 'planned'), order('5', 'partial')],
    [order('1', 'planned', ['VEH002']), order('2', 'partial', ['VEH002']), order('3', 'planned', ['VEH002']), order('4', 'deferred'), order('5', 'deferred')],
  );
  const impact = scenarioImpact(value);
  expect(impact.affected.map(row => row.after.shopName)).toEqual(['Shop 4', 'Shop 5', 'Shop 3', 'Shop 1', 'Shop 2']);
  expect(impact.affected.map(row => row.kind)).toEqual(['new_waiting', 'more_waiting', 'improved', 'reassigned', 'reassigned']);
  expect(impact.rows.map(row => row.after.orderId)).toEqual(['1', '2', '3', '4', '5']);
  expect(value.scenario.orders.map(row => row.orderId)).toEqual(['1', '2', '3', '4', '5']);
  expect(impact.newWaiting).toBe(1); expect(impact.moreWaiting).toBe(1); expect(impact.improved).toBe(1); expect(impact.reassigned).toBe(2);
});
