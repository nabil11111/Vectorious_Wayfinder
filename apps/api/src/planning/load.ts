import { PlanInputError } from './errors';
import type { ComputeLoad } from './types';

// The load of an order, or of a whole trip when given every line of every order on it.
// 6.9 × 48 is 331.20000000000005 in JavaScript, so nothing is added up in kilos or cubic metres. The sums are
// kept in hundredths of a kilo and in litres, which hold a product's figures exactly (the products table keeps
// kilos to 2 decimals and cubic metres to 3), and are divided once at the end.
export const computeLoad: ComputeLoad = (lines, products) => {
  const byId = new Map(products.map((product) => [product.id, product]));
  let kgHundredths = 0;
  let litres = 0;
  let units = 0;
  let needsReefer = false;
  let needsTailLift = false;
  let keepUpright = false;

  for (const { productId, quantity } of lines) {
    const product = byId.get(productId);
    if (!product) throw new PlanInputError(`No product ${productId} in the product list, on a line with quantity ${quantity}`);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new PlanInputError(`Quantity ${quantity} of ${productId} is not a whole number above 0`);
    kgHundredths += Math.round(product.kgPerUnit * 100) * quantity;
    litres += Math.round(product.m3PerUnit * 1000) * quantity;
    units += quantity;
    needsReefer ||= product.temp === 'chilled';
    needsTailLift ||= product.needsTailLift;
    keepUpright ||= product.keepUpright;
  }

  // Kilos are rounded to 1 decimal here and nowhere else, so rounding never piles up. Whole litres are already
  // cubic metres to 3 decimals.
  return { kg: Math.round(kgHundredths / 10) / 10, m3: litres / 1000, units, needsReefer, needsTailLift, keepUpright };
};
