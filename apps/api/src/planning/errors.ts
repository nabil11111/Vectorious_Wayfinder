// Bad input is a programming mistake, not a problem with the plan: a product, shop, vehicle or order the
// input does not hold, or a quantity that is not a whole number above 0. The message names what is wrong.
export class PlanInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanInputError';
  }
}
