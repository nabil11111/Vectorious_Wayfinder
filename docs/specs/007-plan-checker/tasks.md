# 007 · Tasks

> Build record: this describes the original implementation sequence. See the [spec guide](../README.md)
> for current status and the later specs that supersede parts of this work.

Each task is one pull request and names the criteria it closes. Tests are written from the criteria first and
seen to fail, then the code is written (D-07).

- [x] **T0 · Shared parts** · lead. The shapes in `packages/contracts/src/planning.ts`, including the block
  code `no_travel_data`. In `apps/api/src/planning`: `types.ts` (input types and function signatures),
  `settings.ts`, `errors.ts`, `words.ts` and the test helper `testing/shared.ts`.
- [x] **T1 · Load calculator** (AC-1 to AC-5) · after T0. `load.ts` and its test.
- [x] **T2 · Trip timeline and fuel** (AC-6 to AC-16) · after T0. `timeline.ts`, `fuel.ts` and their tests.
- [x] **T3 · Rules for what a vehicle carries and for every order** (AC-17 to AC-28, AC-48) · after T1.
  `rules/cargo.ts`, `rules/coverage.ts` and their tests.
- [x] **T4 · Rules for time, fuel and the day** (AC-29 to AC-39, AC-47, AC-49) · after T2. `rules/time.ts`,
  `rules/day.ts` and their tests.
- [x] **T5 · The checker** (AC-40 to AC-46) · after T3 and T4. `check.ts`, `check.test.ts`, `index.ts`.

No two tasks touch the same file. One builder does T1 and then T3, a second does T2 and then T4, and T5 joins
their work. Only the lead touches `packages/contracts`, `types.ts`, `settings.ts`, `errors.ts` and `words.ts`.
A builder who needs a change there stops and asks.

After this spec: A2 reads orders, vehicles and plans from the database and calls `checkPlan`. B4, the planner,
gets its own criteria and tasks before it is built.
