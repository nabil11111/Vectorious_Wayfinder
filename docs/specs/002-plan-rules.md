# 002 · Plan rules as tests

**Status:** Ready  ·  **Owner:**  ·  **Design:** Dispatcher · Edit plan, View plan (checks and deferrals)

## Why
The booklet says plans must respect capacity, temperature, outlet access, delivery windows and fuel quotas, and
say which orders are deferred. One validator decides whether a plan is allowed. Before it is written, every
rule becomes a test case, so the validator has a clear exam to pass.

## What it does
`apps/api/src/planning/validator.test.ts` lists every rule as a pending test (`it.todo`) in plain words,
grouped by rule, with a comment pointing to the booklet line it comes from.

## Data in and out
None yet. The cases describe inputs (a plan, its vehicles, outlets and orders) and the expected verdict.

## Acceptance criteria
- [ ] Capacity: over the vehicle's weight cap fails; over its volume cap fails.
- [ ] Temperature: a chilled order on an ambient vehicle fails.
- [ ] Access: a `van_only` outlet on a truck fails; a `mall_dock` outlet outside its mall window fails.
- [ ] Windows: arriving after the outlet's window closes fails.
- [ ] Trips: a third trip for one vehicle in a day fails; a trip over the time budget fails.
- [ ] Fuel: planned fuel over the vehicle's weekly quota fails.
- [ ] Deferral: every order is either on a stop or deferred with a reason, never both, never neither.
- [ ] Each group cites the booklet section it comes from.

## Out of scope
Writing the validator itself.
