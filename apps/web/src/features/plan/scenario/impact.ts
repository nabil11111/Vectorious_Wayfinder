import type { PlanScenario, ScenarioOrder } from '@wayfinder/contracts';

export type DeliveryChange = {
  before: ScenarioOrder;
  after: ScenarioOrder;
  kind: 'new_waiting' | 'more_waiting' | 'improved' | 'reassigned' | 'still_waiting' | 'unchanged';
  explanation: string;
};
const coverage = { planned: 2, partial: 1, deferred: 0 } as const;
const trucks = (order: ScenarioOrder) => [...order.vehicleIds].sort().join(',');
const urgency: Record<DeliveryChange['kind'], number> = {
  new_waiting: 0, more_waiting: 0, improved: 1, reassigned: 2, still_waiting: 3, unchanged: 3,
};

/** Compare coverage categories, not quantities: the response has no per-order split amounts. */
export function scenarioImpact(result: PlanScenario) {
  const beforeById = new Map(result.baseline.orders.map(order => [order.orderId, order]));
  const rows: DeliveryChange[] = result.scenario.orders.flatMap(after => {
    const before = beforeById.get(after.orderId);
    if (!before) return [];
    let kind: DeliveryChange['kind'];
    let explanation: string;
    if (coverage[after.status] < coverage[before.status]) {
      kind = before.status === 'planned' ? 'new_waiting' : 'more_waiting';
      explanation = before.status === 'partial' ? 'More goods on an already partly covered order would wait.'
        : after.status === 'partial' ? 'Only part of this order could be delivered; some goods would wait.'
          : 'This order would wait, with no delivery suggested.';
    } else if (coverage[after.status] > coverage[before.status]) {
      kind = 'improved';
      explanation = after.status === 'partial' ? 'Part of this waiting order could now be delivered.'
        : before.status === 'partial' ? 'The rest of this order could also be delivered.' : 'This waiting order could now be fully delivered.';
    } else if (trucks(before) !== trucks(after)) {
      kind = 'reassigned';
      explanation = after.status === 'partial' ? 'Still partly covered, using different trucks.' : 'Delivery is still suggested, on a different truck.';
    } else {
      kind = after.status === 'planned' ? 'unchanged' : 'still_waiting';
      explanation = after.status === 'planned' ? 'Delivery stays covered in both suggestions.'
        : after.status === 'partial' ? 'Still partly covered in both suggestions.' : 'Still waiting in both suggestions.';
    }
    return [{ before, after, kind, explanation }];
  });
  const count = (kind: DeliveryChange['kind']) => rows.filter(row => row.kind === kind).length;
  const newWaiting = count('new_waiting');
  const moreWaiting = count('more_waiting');
  const worsened = newWaiting + moreWaiting;
  const improved = count('improved');
  const reassigned = count('reassigned');
  const kind = !rows.length ? 'empty' : worsened && improved ? 'mixed' : worsened ? 'worse'
    : improved ? 'improved' : reassigned ? 'reassigned' : 'unchanged';
  return {
    kind,
    rows,
    // Stable within each group; newly waiting goods must appear before truck-only moves.
    affected: rows.filter(row => row.kind !== 'unchanged' && row.kind !== 'still_waiting')
      .sort((a, b) => urgency[a.kind] - urgency[b.kind]),
    waiting: rows.filter(row => row.kind === 'still_waiting'),
    newWaiting, moreWaiting, worsened, improved, reassigned,
    alreadyWaiting: rows.filter(row => row.before.status !== 'planned' && row.after.status !== 'planned').length,
    partial: rows.filter(row => row.after.status === 'partial').length,
  };
}

export function impactHeadline(impact: ReturnType<typeof scenarioImpact>, vehicle: string) {
  switch (impact.kind) {
    case 'worse': return `More goods would wait without ${vehicle}.`;
    case 'improved': return 'Some orders could receive more goods.';
    case 'mixed': return 'Some orders could receive more goods; others would have more waiting.';
    case 'reassigned': return 'Orders stay fully or partly planned as before, using different trucks.';
    case 'empty': return 'No orders to compare.';
    case 'unchanged': return 'The same orders are planned or waiting, using the same trucks.';
  }
}
