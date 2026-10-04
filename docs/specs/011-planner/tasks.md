# 011 · Tasks

> Build record: this describes the original implementation sequence. See the [spec guide](../README.md)
> for current status and the later specs that supersede parts of this work.

Each task is one pull request. One builder does T1 to T4 in order after T0. For each task, write and commit the
criterion tests first, run them and record their failure, then implement and rerun them (D-07).

- [ ] **T0 · Input and output** · the builder, with the lead's approval. The two policy answers are D-41 and D-42.
  Add the types exactly as `plan.md`'s table lists them to `planning/types.ts`, and the export of
  `buildSuggestedPlan` to `planning/index.ts`. 010 AC-17's numeric `Problem.leaveAt` fixes are in. No contracts,
  schema or migration change belongs to 011.
- [ ] **T1 · Priority and reasons** (AC-2, AC-3, AC-17, AC-19) · after T0. Builder owns
  `planning/planner/priority.ts`, `reasons.ts` and their tests, including missing history and each reason stage.
- [ ] **T2 · Whole-order candidates** (AC-4 to AC-12) · after T1. Builder owns
  `planning/planner/candidates.ts` and its tests. Use real rows for vans, mall slots, fuel and early departures;
  verify that a candidate never breaks an accepted order on the vehicle's other trip.
- [ ] **T3 · Split proposals** (AC-13 to AC-16) · after T2. Builder owns
  `planning/planner/split.ts` and its tests. Prove conservation, whole-line priority, integer packing, existing
  child refusal and board limits without writing orders to a database.
- [ ] **T4 · Complete suggestion** (AC-1, AC-18, AC-20 to AC-22) · after T3. Builder owns
  `planning/planner/build.ts`, `build.test.ts` and `demo-fixture.test.ts`; lead adds the public export. Run every
  criterion, pin measured seed outcomes, record benchmark evidence and have a different reviewer check the diff.

Paths above are under `apps/api/src/`. The builder owns `planner/`, and in `types.ts` and `index.ts` only what T0
adds. Changes needed elsewhere return to the lead. Finish with typecheck, the full tests and build, using
the isolated database setup in AGENTS.md for the wider suite. Pure planner tests need no database.

After 011: the lead assigns the board's suggestion, review and apply work, with integration tests for the
protocol in `plan.md`, stale revisions, equal halves and interruption between split writes. No API or screen
task is hidden in this engine build.
