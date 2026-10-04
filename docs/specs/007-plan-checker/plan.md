# 007 · Plan

> Build record: this describes the original implementation sequence. See the [spec guide](../README.md)
> for current status and the later specs that supersede parts of this work.

## Data changes
None. A vehicle's `available` and `litresUsedThisWeek` come from spec 008's tables, read by A2.

## Contracts
The shapes a screen receives are in `packages/contracts/src/planning.ts`: `Problem`, `PlanCheck` with
`TripCheck`, `TripTimes`, `StopTime`, `Load` and `VehicleDay`, the lists `BLOCK_CODES`, `WARN_CODES` and
`DEFERRAL_CODES`, and `levelOf(code)`. New in this revision: the block code `no_travel_data` (AC-49). The
checker's input types and the signature of every function below are in `apps/api/src/planning/types.ts`.

## How it works
Everything is in `apps/api/src/planning` and imports only from that folder and `@wayfinder/contracts` (AC-46).
The one exception is the test helper `testing/shared.ts`, which reads `data/shared` and the product list.

| File | What it holds |
| --- | --- |
| `types.ts`, `settings.ts`, `errors.ts`, `words.ts` | Input types and signatures, `DEFAULT_SETTINGS`, `PlanInputError`, and how messages write times and amounts. |
| `load.ts` | `computeLoad(lines, products)`. |
| `timeline.ts` | `defaultLeaveAt`, `timeTrip`, `timeVehicleDay` (a vehicle's trips in order) and `budgetMinutes`. |
| `fuel.ts` | `tripKm`, `tripLitres` and `vehicleFuel`. |
| `rules/cargo.ts` | Weight, volume, fridge, van only, depot, tail lift, mixed brands. |
| `rules/coverage.ts` | Every order on one stop or deferred, deferrals complete, order at its own shop, empty trips, a shop twice on a trip. |
| `rules/time.ts` | District, travel figures, trip numbers, overlap, windows, mall slots, budgets, leaving early, waiting. |
| `rules/day.ts` | Fuel quota, operating day, vehicle available. |
| `check.ts`, `index.ts` | `checkPlan(input)`, which runs everything and builds the result, and what the folder exports. |

- **`checkPlan` in four steps.** Index the input by id, and throw `PlanInputError` for anything the plan names
  that is missing. For each vehicle, sort its trips by number, work out each load, time the trips in order and
  work out the fuel. A trip that cannot be timed gets `times: null`. Run `cargoProblems(input, tripLoads)`,
  `coverageProblems(input)`, `timeProblems(input, vehicleTimes)` and `dayProblems(input, vehicleFuel)`. Sort
  the problems (AC-43) and set `ok`.
- **Whole numbers inside.** 6.9 × 48 is 331.20000000000005 in JavaScript. So a load is added up in hundredths
  of a kilo and thousandths of a cubic metre and divided once at the end. Limits are compared in the same
  whole units, so a load exactly at the limit passes.
- **Fuel.** Litres are rounded to 1 decimal only for what is shown: each trip's litres, and a vehicle's litres
  in the plan, which are what all its kilometres need, rounded once. The quota check never uses them (AC-34).
  It asks whether the plan's
  kilometres are more than the litres left can cover, which is litres left × km per litre, worked in tenths
  so both sides are whole numbers. For this `vehicleFuel` also hands the plan's kilometres to the quota rule.
- **Late.** A stop's `late` is true when it is reached after its closing time, when its mall slot and window
  do not overlap, or when it is a Fresh shop reached at 08:00 or later (AC-11, AC-32). `windowOpen` and
  `windowClose` stay the shop's own times, with the mall slot applied.
- **Messages.** One sentence that names the vehicle and the shop, gives both numbers and uses no code words:
  "VEH035 trip 1 carries 1,242 kg and its limit is 1,040 kg." An order is called by its weight, chilled or
  dry, and its shop. Times read as 07:54. A Fresh stop reached at 08:00
  or later is told that Fresh shops must be reached before 08:00. Codes with a `fix`: `over_weight` and
  `over_volume` (how much to take off), `fuel_over_quota` (the litres over, or "less than 0.1 litres" when
  that rounds to 0.0), `trips_overlap` and `long_wait` (the leaving time), and the two late codes (AC-47).
- **The earlier leaving time (AC-47).** Leaving earlier never makes a stop later. So the rule steps the leaving
  time back one minute at a time, times the trip again, and stops at the first time with no late stop. It
  never goes before midnight or before the vehicle is ready from its earlier trip.

## Risks
- A screen works a number out differently. Screens show `PlanCheck` as it is, and a reviewer checks for it.
- D-23 and D-24 are our rules, not the booklet's. Each is one small rule function, easy to change.
- Tests pass on made-up rows. The worked examples run on the real rows in `data/shared`.

## Test plan
Every criterion is a unit test beside its code, with its number in the test name, written first and seen to
fail (D-07). No database is needed. AC-46 also fails on an engine file that imports from outside the folder.

| Criteria | Test file |
| --- | --- |
| AC-1 to AC-5 | `load.test.ts` |
| AC-6 to AC-14 | `timeline.test.ts` |
| AC-15, AC-16 | `fuel.test.ts` |
| AC-17 to AC-23 | `rules/cargo.test.ts` |
| AC-24 to AC-28, AC-48 | `rules/coverage.test.ts` |
| AC-29 to AC-33, AC-37 to AC-39, AC-47, AC-49 | `rules/time.test.ts` |
| AC-34 to AC-36 | `rules/day.test.ts` |
| AC-40 to AC-46 | `check.test.ts` |
