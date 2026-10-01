# 014 · Tasks

One pull request per task. The API task writes its tests from the criteria first (D-07).

- [x] **T0 · Shared parts** · lead, on a branch cut from `main` once PR #15 (spec 011) is merged there, with this
  spec's commits on it. It follows `nabil/loading` if that has landed, for `lib/day-lock.ts`; until then `openPlan`
  takes the same two locks itself. The migration `suggested-plan` and `plans.suggestion` in the schema, the shapes and
  the two error codes in `packages/contracts/src/plans.ts`, the design's Second trip picture as
  `assets/icons/icon-second-trip.png`, `plans.suggestion` in `docs/data-model.md`, and B4 as "Building" in the map.
  D-51 to D-55 are in `docs/decisions.md` already.
- [x] **T1 · The build, the accept and the send's refusal** (AC-1 to AC-13) · after T0. Files:
  `apps/api/src/plans/suggestion.ts` and `suggestion.test.ts`, `plans/suggest.ts`, `plans/split.ts` (the two helpers,
  with spec 010's split and join tests unchanged and green), `plans/board.ts` (the suggestion on the board),
  `plans/send.ts` (`decisions_open`), the two routes in `routes/plans.ts`, and `apps/api/tests/plan-suggest.test.ts`.
- [x] **T2 · The screens** (AC-14 to AC-20) · after T0. Files in `apps/web/src/features/plan/`: `PlanBoardPage.tsx`,
  `ViewPlanPage.tsx`, `board.ts` and `words.ts`, and in `parts/`: `TripPanel.tsx`, `StopRow.tsx`, `OrderLists.tsx`,
  `ChecksPanel.tsx`, `lookup.ts` and `icons.ts`, with the new `BuildPanel.tsx`, `Why.tsx` and `Decisions.tsx`.
- [x] **T3 · Join and click through** · lead · after T1 and T2. The click-throughs of AC-14 to AC-20 in Nabil's Chrome
  next to the frames, on a fresh reset, with View plan reloaded before accepting for AC-18, and AC-20's read. The
  walkthrough's numbers are read again from spec 011's merged pin. The README keeps the judge walkthrough's hand-built
  plan and gains the planner's short walkthrough after it, with the departures, and the map marks B4. A second tool
  that did not build it reviews the diff against each criterion.

**At the same time.** Both builders branch from T0's branch. The API builder does T1. The web builder does T2 against
the contracts, and no screen is done before T3 meets real data.

Nobody but the lead touches `packages/contracts`, `apps/api/src/db`, `apps/api/drizzle`, `lib/day-lock.ts`, spec 011's
`apps/api/src/planning`, `apps/web/src/app/router.tsx` or `features/store`. The API builder touches no screen and the
web builder no API file, and a builder who needs a change outside their files stops and asks. A test file signs in once
per account, because one address gets ten sign-ins in 15 minutes.
