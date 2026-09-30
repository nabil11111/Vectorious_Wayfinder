import { describe, expect, it } from 'vitest';
import { PlanInputError } from './errors';
import { computeLoad } from './load';
import { products } from './testing/shared';
import type { EngineProduct } from './types';

describe('load calculator', () => {
  it('AC-1 adds up quantity times each product and rounds once at the end', () => {
    // Plain JavaScript says 6.9 × 48 is 331.20000000000005 and 0.037 × 48 is 1.7759999999999998.
    const cartons = { productId: 'fresh-dry-carton', quantity: 48 };
    expect(computeLoad([cartons], products)).toMatchObject({ kg: 331.2, m3: 1.776, units: 48 });
    expect(computeLoad([{ productId: 'fresh-chilled-carton', quantity: 40 }], products)).toMatchObject({ kg: 276, m3: 1.48, units: 40 });
    expect(computeLoad([{ productId: 'style-hanging', quantity: 20 }, { productId: 'style-folded', quantity: 15 }], products)).toMatchObject({ kg: 460, m3: 9, units: 35 });
    expect(computeLoad([{ productId: 'tech-washer', quantity: 2 }, { productId: 'tech-tv', quantity: 1 }], products)).toMatchObject({ kg: 590, m3: 2, units: 3 });

    // A trip's load comes from every line of every order on it: the three and the four orders of the chained day.
    expect(computeLoad([cartons, cartons, cartons], products)).toMatchObject({ kg: 993.6, m3: 5.328, units: 144 });
    expect(computeLoad([cartons, cartons, cartons, cartons], products)).toMatchObject({ kg: 1324.8, m3: 7.104, units: 192 });

    // No product on the real list has a second decimal of a kilo, so this one is made up. Three lines of 0.04 kg
    // are 0.12 kg, which is 0.1, and four are 0.16 kg, which is 0.2. Rounding line by line would give 0 for both.
    const sachet: EngineProduct = { id: 'sachet', kgPerUnit: 0.04, m3PerUnit: 0.001, temp: 'dry', needsTailLift: false, keepUpright: false };
    const one = { productId: 'sachet', quantity: 1 };
    expect(computeLoad([one, one, one], [sachet])).toMatchObject({ kg: 0.1, m3: 0.003, units: 3 });
    expect(computeLoad([one, one, one, one], [sachet])).toMatchObject({ kg: 0.2, m3: 0.004, units: 4 });
  });

  it('AC-2 sets needsReefer when any line is chilled and leaves it false otherwise', () => {
    const chilled = { productId: 'fresh-chilled-carton', quantity: 40 };
    const dry = { productId: 'fresh-dry-carton', quantity: 48 };
    expect(computeLoad([chilled], products).needsReefer).toBe(true);
    // One chilled line is enough, wherever it sits among the others.
    expect(computeLoad([chilled, dry], products).needsReefer).toBe(true);
    expect(computeLoad([dry, chilled], products).needsReefer).toBe(true);
    expect(computeLoad([dry], products).needsReefer).toBe(false);
  });

  it('AC-3 sets needsTailLift and keepUpright when any line needs them', () => {
    const rails = { productId: 'style-hanging', quantity: 20 };
    const folded = { productId: 'style-folded', quantity: 15 };
    const washers = { productId: 'tech-washer', quantity: 2 };
    const television = { productId: 'tech-tv', quantity: 1 };
    // One such line is enough, wherever it sits among the others.
    for (const lines of [[rails, folded], [folded, rails]]) expect(computeLoad(lines, products)).toMatchObject({ keepUpright: true, needsTailLift: false });
    for (const lines of [[washers, television], [television, washers]]) expect(computeLoad(lines, products)).toMatchObject({ needsTailLift: true, keepUpright: false });
    expect(computeLoad([folded, television], products)).toMatchObject({ needsTailLift: false, keepUpright: false });
  });

  it('AC-4 returns zeros and every flag false when there are no lines', () => {
    expect(computeLoad([], products)).toEqual({ kg: 0, m3: 0, units: 0, needsReefer: false, needsTailLift: false, keepUpright: false });
  });

  it('AC-5 throws an error that names the product and the quantity', () => {
    const loadOf = (productId: string, quantity: number) => () => computeLoad([{ productId, quantity }], products);

    expect(loadOf('fresh-frozen-carton', 12)).toThrow(PlanInputError);
    expect(loadOf('fresh-frozen-carton', 12)).toThrow('No product fresh-frozen-carton');
    expect(loadOf('fresh-frozen-carton', 12)).toThrow('quantity 12');

    for (const quantity of [0, -3, 2.5, Number.NaN]) {
      expect(loadOf('fresh-dry-carton', quantity)).toThrow(PlanInputError);
      expect(loadOf('fresh-dry-carton', quantity)).toThrow(`Quantity ${quantity} of fresh-dry-carton`);
    }
  });
});
