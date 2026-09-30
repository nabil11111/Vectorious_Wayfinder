# 007 · Tasks

Each task is one pull request, small enough to review in 15 minutes, and names the criteria it closes. In
every task the tests are written from the criteria first and seen to fail, then the code is written (D-07).

- [ ] **T0 · Shared parts** · lead · closes nothing, every other task depends on it.
  The shapes in `packages/contracts` (`PROBLEM_CODES`, `DEFERRAL_CODES`, `Problem`, `StopTime`, `TripTimes`,
  `Load`, `TripCheck`, `VehicleDay`, `PlanCheck`). In `apps/api/src/planning`: `types.ts` with the input types
  and the signatures of the four rule functions, `settings.ts` with `DEFAULT_SETTINGS`, and
  `testing/shared.ts`, which reads `data/shared` and the product list into engine input for the tests.
- [ ] **T1 · Load calculator** (closes: AC-1 to AC-5) · depends on T0.
  Files: `planning/load.ts`, `planning/load.test.ts`.
- [ ] **T2 · Trip timeline and fuel** (closes: AC-6 to AC-16) · depends on T0.
  Files: `planning/timeline.ts`, `planning/fuel.ts` and their tests.
- [ ] **T3 · Rules for what a vehicle carries and for every order being accounted for** (closes: AC-17 to
  AC-28, AC-48) · depends on T1.
  Files: `planning/rules/cargo.ts`, `planning/rules/coverage.ts` and their tests.
- [ ] **T4 · Rules for time, fuel and the day** (closes: AC-29 to AC-39, AC-47) · depends on T2.
  Files: `planning/rules/time.ts`, `planning/rules/day.ts` and their tests.
- [ ] **T5 · The checker** (closes: AC-40 to AC-46) · depends on T3 and T4.
  Files: `planning/check.ts`, `planning/check.test.ts`, `planning/index.ts`.

## What can run at the same time

No two tasks touch the same file. T1 and T2 can run together, and so can T3 and T4. That makes two builders:
one does T1 and then T3 on top of it, the other does T2 and then T4. T5 joins their work and runs last.

Nobody but the lead touches `packages/contracts`, `planning/types.ts` or `planning/settings.ts`. A builder who
needs a change there stops and asks.

## After this spec

- The code that reads orders, vehicles and plans from the database and calls `checkPlan` is part of A2.
- B4, the suggested plan, gets its own criteria and tasks before it is built.
- Specs 001 and 002 are replaced by this one.
