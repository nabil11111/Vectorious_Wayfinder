# 001 · Load calculator

**Status:** Ready  ·  **Owner:**  ·  **Design:** Shop · New orders (summary), Loader · Load a truck (weight and volume)

## Why
The planner, the shop's order screen and the loader all need the same numbers for an order: kilos, cubic
metres, and whether it needs a fridge truck or a tail lift. One function, tested, so nobody works it out twice.

## What it does
`computeLoad(lines, products)` in `apps/api/src/planning/load.ts` returns
`{ kg, m3, units, needsReefer, needsTailLift, keepUpright }` for a list of `{ productId, quantity }`.
Weight and volume are quantity times the product's per-unit figures (`products` table, `docs/product-list.md`).

## Data in and out
Pure function, no database. Products are passed in.

## Acceptance criteria
- [ ] kg and m3 are the sums of quantity × per-unit figures, rounded only at the end (kg 1 decimal, m3 3).
- [ ] `needsReefer` is true when any product is chilled.
- [ ] `needsTailLift` and `keepUpright` are true when any product says so.
- [ ] An empty order returns zeros and all flags false.
- [ ] An unknown product, or a quantity of 0 or less, throws a clear error.
- [ ] Tests are committed before the implementation.

## Out of scope
Which truck the order goes on. That is the planner's job.
