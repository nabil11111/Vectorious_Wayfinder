import { describe, expect, it } from 'vitest';
import { inputFor, order } from '../testing/shared';
import type { PlannerInput, PlannerOrder } from '../types';
import { deferralDecisions, deferralFor, furthestRejection, type PlannerDeferralCode } from './reasons';

const source: PlannerOrder = { ...order('a', 'OUT001', 'fresh-chilled-carton', 180), deliveryDate: '2026-06-24', timesDeferred: 1, splitFrom: null };
const input = (): PlannerInput => {
  const { plan: _plan, ...base } = inputFor('Peliyagoda');
  return { ...structuredClone(base), date: '2026-06-25', orders: [structuredClone(source)] };
};

describe('planner reasons', () => {
  it('AC-17 chooses the first exhausted stage across all attempts, independently of their order', () => {
    expect(furthestRejection([])).toBe('over_capacity');
    expect(furthestRejection(['over_capacity'])).toBe('over_capacity');
    expect(furthestRejection(['window', 'over_capacity'])).toBe('window');
    // One candidate clears windows but fails fuel; another fails its window even though it has fuel.
    expect(furthestRejection(['window', 'fuel'])).toBe('fuel');
    expect(furthestRejection(['fuel', 'window', 'over_capacity'])).toBe('fuel');
  });

  it.each<[PlannerDeferralCode, RegExp]>([
    ['no_reefer', /fridge/], ['no_van', /van/], ['over_capacity', /room|trip/],
    ['window', /window|mall/], ['fuel', /fuel/],
  ])('AC-17 explains %s with shop, wanted day, goods and the limit of this search', (code, named) => {
    const deferred = deferralFor(input(), source, code);
    expect(deferred).toMatchObject({ orderId: 'a', code });
    expect(deferred.reason).toContain('OUT001');
    expect(deferred.reason).toContain('2026-06-24');
    expect(deferred.reason).toContain('180');
    expect(deferred.reason).toContain('chilled');
    expect(deferred.reason).toMatch(named);
    expect(deferred.reason).toContain('after earlier choices');
    expect(deferred.reason).not.toMatch(/tomorrow|next day|impossible|dispatcher_choice/i);
    expect(deferred.reason).toBe(deferred.reason.trim());
    expect(deferred.reason.length).toBeLessThanOrEqual(200);
  });

  it('AC-17 names binding split limits and the units sent and left without losing the original identity', () => {
    expect(deferralFor(input(), source, 'over_capacity', { detail: 'this existing child cannot be split again' }).reason).toContain('cannot be split again');
    expect(deferralFor(input(), source, 'over_capacity', { detail: 'splitting would exceed the 300-order limit' }).reason).toContain('300-order limit');
    const rest = { ...source, id: 'split:a:rest', lines: [{ productId: 'fresh-chilled-carton', quantity: 30 }], splitFrom: 'a' };
    const deferred = deferralFor(input(), rest, 'over_capacity', { split: { keptUnits: 150, remainingUnits: 30 } });
    expect(deferred.reason).toMatch(/150 sent.*30 left/);
    expect(deferred.reason).toContain('OUT001');
    expect(deferred.reason).toContain('2026-06-24');
    expect(deferred.reason).toContain('chilled');
    expect(deferred.reason.length).toBeLessThanOrEqual(200);
  });

  it('AC-17 bounds a long shop name and detail while preserving the reason and goods', () => {
    const day = input();
    day.outlets.find((o) => o.id === source.outletId)!.name = 'A long shop name '.repeat(30);
    const result = deferralFor(day, source, 'window', { detail: 'the mall slot closes too soon '.repeat(30) });
    expect(result.reason.length).toBeLessThanOrEqual(200);
    expect(result.reason).toContain('2026-06-24');
    expect(result.reason).toContain('180 chilled units');
    expect(result.reason).toContain('mall slot');
    expect(result.reason).toContain('after earlier choices');
    expect(result.reason.endsWith('.')).toBe(true);
  });

  it('AC-3 flags a waiting original and a waiting split remainder again', () => {
    for (const waiting of [source, { ...source, id: 'split:a:rest', splitFrom: 'a' }, { ...source, deliveryDate: '2026-06-25' }, { ...source, timesDeferred: 0 }]) {
      const d = deferralFor(input(), waiting, 'over_capacity');
      expect(deferralDecisions(input(), waiting, d)).toEqual([{ kind: 'waited_again', orderId: waiting.id, reason: d.reason }]);
    }
  });

  it('AC-3 flags every window deferral and both reasons when an old order misses its window', () => {
    const current = { ...source, deliveryDate: '2026-06-25', timesDeferred: 0 };
    expect(deferralDecisions(input(), current, deferralFor(input(), current, 'fuel'))).toEqual([]);
    expect(deferralDecisions(input(), current, deferralFor(input(), current, 'window')).map((d) => d.kind)).toEqual(['late_order']);
    expect(deferralDecisions(input(), source, deferralFor(input(), source, 'window')).map((d) => d.kind)).toEqual(['waited_again', 'late_order']);
  });
});
