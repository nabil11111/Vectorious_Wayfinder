import { inputFor, order } from '../../testing/shared';
import type { PlannerInput, PlannerOrder } from '../../types';

export function plannerOrder(
  id: string, outletId: string, productId = 'fresh-dry-carton', quantity = 1, overrides: Partial<PlannerOrder> = {},
): PlannerOrder {
  return structuredClone({ ...order(id, outletId, productId, quantity), deliveryDate: '2026-06-25', timesDeferred: 0, splitFrom: null, ...overrides });
}

export function plannerInput(orders: PlannerOrder[] = [], overrides: Partial<PlannerInput> = {}): PlannerInput {
  const { plan: _plan, ...shared } = inputFor('Peliyagoda');
  return structuredClone({ ...shared, date: '2026-06-25', orders, ...overrides });
}
