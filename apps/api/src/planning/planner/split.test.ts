import { describe, expect, it } from 'vitest';
import { computeLoad } from '../load';
import { vehicle } from '../testing/shared';
import type { PlanInput, PlannerInput, PlannerOrder } from '../types';
import { candidateSlots } from './candidates';
import { chooseAllocation, proposePart } from './split';
import { plannerInput, plannerOrder } from './testing/input';

const empty = (source: PlannerInput): PlanInput => ({ ...source, orders: [], plan: { trips: [], deferrals: [] } });
const chosen = (source: PlannerOrder, overrides: Partial<PlannerInput> = {}, effectiveCount = 1) => {
  const input = plannerInput([source], { vehicles: [vehicle('VEH035')], ...overrides });
  return chooseAllocation(empty(input), source, effectiveCount);
};

describe('planner splits and coverage limits', () => {
  it('AC-13 exhausts whole candidates before any partial allocation', () => {
    const source = plannerOrder('bulk', 'OUT006', 'fresh-chilled-carton', 180);
    const input = empty(plannerInput([], { vehicles: [vehicle('VEH035'), vehicle('VEH001')] }));
    const old = plannerOrder('old', 'OUT006', 'fresh-chilled-carton', 120);
    input.orders.push(old);
    input.plan.trips.push({ vehicleId: 'VEH035', tripNo: 1, stops: [{ outletId: old.outletId, orderIds: [old.id] }] });
    const result = chooseAllocation(input, source, 2);
    expect(result.best?.slot.vehicleId).toBe('VEH001');
    expect(result.proposal).toBeNull();
  });

  it('AC-13/14 sends 150 of 180 chilled cartons to OUT001 on VEH035 and defers the rest', () => {
    const source = plannerOrder('bulk', 'OUT001', 'fresh-chilled-carton', 180);
    const result = chosen(source);
    expect(result.best?.slot).toEqual({ vehicleId: 'VEH035', tripNo: 1, existing: false });
    expect(result.proposal?.split).toEqual({ orderId: 'bulk', keep: [{ productId: 'fresh-chilled-carton', quantity: 150 }], keptOrderId: 'split:bulk:keep', remainderOrderId: 'split:bulk:rest' });
    const products = plannerInput().products;
    expect(computeLoad(result.proposal!.kept.lines, products)).toMatchObject({ kg: 1035, m3: 5.55, units: 150 });
    expect(computeLoad(result.proposal!.remainder.lines, products)).toMatchObject({ kg: 207, m3: 1.11, units: 30 });
    expect(result.proposal!.kept).toMatchObject({ deliveryDate: source.deliveryDate, timesDeferred: 0, splitFrom: 'bulk' });
    expect(result.best!.input.orders.map((o) => o.id)).toEqual(['split:bulk:keep']);
  });

  it('AC-14 retains whole product lines first, before filling an earlier oversized line', () => {
    // Boundary override: a 10kg/10m³ van and two unit-size goods. Whole b gets 4 before a gets 6 of its 20.
    const source = plannerOrder('multi', 'OUT001', 'a', 20, { lines: [{ productId: 'b', quantity: 4 }, { productId: 'a', quantity: 20 }] });
    const products = ['b', 'a'].map((id) => ({ id, kgPerUnit: 1, m3PerUnit: 1, temp: 'chilled' as const, needsTailLift: false, keepUpright: false }));
    const result = chosen(source, { products, vehicles: [{ ...vehicle('VEH035'), weightCapKg: 10, volumeCapM3: 10 }] });
    expect(result.proposal?.split.keep).toEqual([{ productId: 'a', quantity: 6 }, { productId: 'b', quantity: 4 }]);
    expect(result.proposal?.remainder.lines).toEqual([{ productId: 'a', quantity: 14 }]);
  });

  it('AC-14 applies remaining weight and volume to aggregate accepted lines, without rounding per order', () => {
    const source = plannerOrder('new', 'OUT001', 'fresh-chilled-carton', 180);
    const old = plannerOrder('old', 'OUT001', 'fresh-chilled-carton', 50);
    const input = empty(plannerInput([], { vehicles: [vehicle('VEH035')] }));
    input.orders.push(old);
    input.plan.trips.push({ vehicleId: 'VEH035', tripNo: 1, stops: [{ outletId: 'OUT001', orderIds: ['old'] }] });
    const part = proposePart(input, source, { vehicleId: 'VEH035', tripNo: 1, existing: true })!;
    expect(part.split.keep[0]!.quantity).toBe(100);
    expect(part.remainder.lines[0]!.quantity).toBe(80);
    const volumeBound = chosen(plannerOrder('rails', 'OUT019', 'style-hanging', 80), {
      vehicles: [{ ...vehicle('VEH035'), weightCapKg: 10000, volumeCapM3: 7 }],
    });
    expect(volumeBound.proposal?.split.keep[0]!.quantity).toBe(23);
  });

  it('AC-13 chooses partial candidates by the same tuple rather than by the fraction carried', () => {
    const source = plannerOrder('huge', 'OUT006', 'fresh-dry-carton', 999);
    const fleet = [
      { ...vehicle('VEH008'), id: 'A', volumeCapM3: 20, weightCapKg: 100 },
      { ...vehicle('VEH008'), id: 'B', volumeCapM3: 10, weightCapKg: 1000 },
    ];
    const result = chosen(source, { vehicles: fleet });
    expect(result.best?.slot.vehicleId).toBe('A');
    expect(result.proposal?.split.keep[0]!.quantity).toBe(14);
  });

  it('AC-13 refuses to split an existing child but can place it whole', () => {
    const source = plannerOrder('child', 'OUT001', 'fresh-chilled-carton', 180, { splitFrom: 'parent' });
    expect(chosen(source)).toMatchObject({ best: null, proposal: null, code: 'over_capacity', detail: expect.stringContaining('cannot be split again') });
    expect(chosen({ ...source, lines: [{ productId: 'fresh-chilled-carton', quantity: 12 }] }).best?.stage).toBe('accepted');
  });

  it.each([999, 1000])('AC-13 enforces the split-write unit boundary at %i', (quantity) => {
    const result = chosen(plannerOrder('units', 'OUT001', 'fresh-chilled-carton', quantity));
    if (quantity === 999) expect(result.proposal).not.toBeNull();
    else expect(result).toMatchObject({ proposal: null, code: 'over_capacity', detail: expect.stringContaining('999') });
  });

  it.each([10, 11])('AC-13 enforces the split-write product boundary at %i lines', (count) => {
    const products = Array.from({ length: count }, (_, n) => ({ id: `p${String(n).padStart(2, '0')}`, kgPerUnit: 100, m3PerUnit: 0.1, temp: 'chilled' as const, needsTailLift: false, keepUpright: false }));
    const source = plannerOrder('lines', 'OUT001', 'p00', 20, { lines: products.map((p) => ({ productId: p.id, quantity: 20 })) });
    const result = chosen(source, { products });
    if (count === 10) expect(result.proposal).not.toBeNull();
    else expect(result).toMatchObject({ proposal: null, code: 'over_capacity', detail: expect.stringContaining('10 product lines') });
  });

  it('AC-15 gives equal halves distinct stable IDs and conserves every product exactly', () => {
    const source = plannerOrder('equal', 'OUT001', 'fresh-chilled-carton', 300);
    const result = chosen(source).proposal!;
    expect(result.kept.id).not.toBe(result.remainder.id);
    expect(result.kept.lines).toEqual(result.remainder.lines);
    expect(chosen(source).proposal).toEqual(result);
    for (const child of [result.kept, result.remainder]) {
      expect(child.lines.every((l) => Number.isInteger(l.quantity) && l.quantity > 0)).toBe(true);
      expect(new Set(child.lines.map((l) => l.productId)).size).toBe(child.lines.length);
    }
    expect(result.kept.lines[0]!.quantity + result.remainder.lines[0]!.quantity).toBe(300);
  });

  it('AC-15 includes zero quantities only in keep and never emits an empty child', () => {
    const source = plannerOrder('multi', 'OUT001', 'heavy', 1, { lines: [{ productId: 'heavy', quantity: 1 }, { productId: 'light', quantity: 2 }] });
    const products = [
      { id: 'heavy', kgPerUnit: 2000, m3PerUnit: 1, temp: 'chilled' as const, needsTailLift: false, keepUpright: false },
      { id: 'light', kgPerUnit: 1, m3PerUnit: 0.01, temp: 'chilled' as const, needsTailLift: false, keepUpright: false },
    ];
    const proposal = chosen(source, { products }).proposal!;
    expect(proposal.split.keep).toEqual([{ productId: 'heavy', quantity: 0 }, { productId: 'light', quantity: 2 }]);
    expect(proposal.kept.lines).toEqual([{ productId: 'light', quantity: 2 }]);
    expect(chosen({ ...source, lines: [{ productId: 'heavy', quantity: 1 }] }, { products })).toMatchObject({ best: null, proposal: null, code: 'over_capacity' });
  });

  it('AC-16 caps effective orders at 300, including both children', () => {
    const source = plannerOrder('bulk', 'OUT001', 'fresh-chilled-carton', 180);
    expect(chosen(source, {}, 299).proposal).not.toBeNull();
    expect(chosen(source, {}, 300)).toMatchObject({ proposal: null, code: 'over_capacity', detail: expect.stringContaining('300') });
    expect(chosen(plannerOrder('small', 'OUT001'), {}, 300).best).not.toBeNull();
  });

  it('AC-16 bounds new trips, distinct stops and IDs per stop before any trial', () => {
    const input = empty(plannerInput([], { vehicles: [vehicle('VEH012')] }));
    input.plan.trips = Array.from({ length: 76 }, (_, i) => ({ vehicleId: `taken-${i}`, tripNo: 1, stops: [] }));
    expect(candidateSlots(input, plannerOrder('new', 'OUT006')).slots).toEqual([]);
    input.plan.trips = [{ vehicleId: 'VEH012', tripNo: 1, stops: Array.from({ length: 40 }, (_, i) => ({ outletId: `shop${i}`, orderIds: [`o${i}`] })) }];
    const template = input.outlets.find((s) => s.id === 'OUT006')!;
    input.outlets.push(...Array.from({ length: 40 }, (_, i) => ({ ...template, id: `shop${i}` })));
    expect(candidateSlots(input, plannerOrder('new', 'OUT006')).slots.map((s) => s.tripNo)).toEqual([2]);
    expect(candidateSlots(input, plannerOrder('same', 'shop0')).slots.map((s) => s.tripNo)).toEqual([1, 2]);
    input.plan.trips[0]!.stops[0]!.orderIds = Array.from({ length: 300 }, (_, i) => `o${i}`);
    expect(candidateSlots(input, plannerOrder('same', 'shop0')).slots.map((s) => s.tripNo)).toEqual([2]);
  });

  it('AC-17 partial attempts cannot repair a missed window or fuel shortage and keep the correct stage', () => {
    const source = plannerOrder('large', 'OUT001', 'fresh-chilled-carton', 180);
    const input = plannerInput([source], { vehicles: [vehicle('VEH035')] });
    Object.assign(input.outlets.find((s) => s.id === 'OUT001')!, { mallOpen: 600, mallClose: 700 });
    expect(chooseAllocation(empty(input), source, 1)).toMatchObject({ best: null, proposal: null, code: 'window' });
    input.outlets.find((s) => s.id === 'OUT001')!.mallOpen = 300;
    input.vehicles[0]!.litresUsedThisWeek = input.vehicles[0]!.weeklyFuelQuotaL;
    expect(chooseAllocation(empty(input), source, 1)).toMatchObject({ best: null, proposal: null, code: 'fuel' });
  });
});

