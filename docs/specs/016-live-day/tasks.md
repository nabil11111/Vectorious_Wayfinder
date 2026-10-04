# 016 · Tasks

> Build record: this describes the original implementation sequence. See the [spec guide](../README.md)
> for current status and the later specs that supersede parts of this work.

One pull request per task, from the lead's integration branch after T0. Tests first (D-07); each task names its
criteria in [plan.md](plan.md). This document assigns future implementation; the spec PR changes documents only.

- [x] **T0 · Shared parts** · lead, after spec 013's server and screens are joined, with 014/015's landed contracts
  reconciled. Add/export `operations.ts`,
  widen `LoadingDay` with the publication fields and demo generation, mount
  an empty dispatcher/depot-protected `routes/operations.ts` in `app.ts`. Keep the existing loading responses valid
  while widening them: T0 owns the minimal `loading/day.ts` and `loading/writes.ts` signature/metadata work and its
  tests **AC-20** before the API builder starts. Add the operations invalidation fan-out to the existing
  `apps/web/src/lib/live.ts`, tests first (**AC-24**). No schema or migration. Agree the precise shapes and null/legacy
  states in plan.md; copy a missing icon only from the existing exported asset, without redrawing it. Mark A7 Building
  only once this implementation starts. Push this shared commit before either builder branches.
  **Files:** `packages/contracts/src/operations.ts`, `loading.ts`, `index.ts`; `apps/api/src/app.ts`,
  `routes/operations.ts` (empty mount), `loading/day.ts`, `loading/writes.ts`,
  `apps/api/tests/loading-publication.test.ts`, `loading-read.test.ts` (existing exact-shape assertions);
  `apps/web/src/lib/live.ts`, `lib/live.test.ts`,
  `assets/icons/` if an existing icon is missing; implementation status in `docs/specs/000-map.md`.

- [x] **T1 · The dispatcher reads the day** · API builder, after T0 (**AC-1 to AC-7, AC-10 to AC-12, AC-14 to AC-16, AC-25, AC-36, AC-37**).
  Write and run the failing reads/counts/attention tests before implementing the read model. Include the fresh-reset
  legacy plan, depot isolation, absent day and snapshot/reset race. AC-37 asserts Friday demand 0 → 99 → 0 through
  the real Thursday Send/Back to edit; the tile shows the future cutoff without a closed state. Reuse 013's read
  helpers and counts; no new writes.
  **Files:** `apps/api/src/operations/read.ts`, `figures.ts`, `figures.test.ts`, `attention.ts`,
  `attention.test.ts`; GET `/` in `apps/api/src/routes/operations.ts`;
  `apps/api/tests/operations-plan.ts`, `operations-read.test.ts`. API builder owns this route after T0's handoff.

- [x] **T2 · Attempts and events** · same API builder, after T1 (**AC-8, AC-9, AC-13, AC-17, AC-18**).
  Tests first for closed → bring back → replan, Try again, late/repeated writes, event ordering/reset and depot
  scoping. Complete the event fields, including a raised event for each joined problem kind (015's receipt too)
  and the noninteractive photo marker. No event-table shortcut or proof endpoint.
  **Files:** `apps/api/src/operations/read.ts`, `events.ts`, `routes/operations.ts`;
  `apps/api/tests/operations-plan.ts`, `operations-read.test.ts` (AC-13's depot read checks),
  `operations-attempts.test.ts`, `operations-events.test.ts`.

- [x] **T3 · Dashboard and Live day** · screens builder, alongside T1/T2 after T0 (**AC-26 to AC-29, AC-32 to AC-34**,
  dispatcher part of **AC-35**). Replace the two placeholders, share one operations query, reuse Needs you/cards,
  add navigation/filter/detail behavior and all No frame states, including the named Live day loading skeleton.
  Render brand totals and tile-specific progress from the read, the defined Trucks out columns/order, all full
  Needs you cards and answered rows marked Decided. Write AC-34's request-ordering test
  first. Use the contract against the API as it lands; fixtures may live in tests only. This task is not done until
  the joined screens meet real records.
  **Files:** `apps/web/src/features/dispatcher/DispatcherHome.tsx`, new `DashboardPage.tsx` and dashboard-only
  `parts/`; `apps/web/src/features/live/LiveDayPage.tsx`, new `operations.ts`, `operations.test.ts`, `words.ts` and
  `parts/`. Limited changes to `NeedsYou.tsx` for focus ids/Open next. **No edit to `features/live/issues.ts`**:
  T0's `issues` fan-out already refetches operations after a committed answer. Preserve `IssueCard.tsx`'s answers
  and `Bell.tsx`'s shared issue query; no ownership of their business changes while 013/015 join.

- [x] **T4 · The loader's changed publication** · same screens builder, after T3 (**AC-21 to AC-23, AC-30, AC-31**,
  loader part of **AC-33, AC-35**). Test comparison and session lifecycle before code. Extend the existing loader
  area with the full change page, changed chips and local badge, retaining Start's errors and no automatic form loss.
  Pair an exact-order whole-trip move into one row/bell 1; keep the old list only in storage during withdrawal.
  Put this notice/comparison's new words in its own `changes.ts`, not the shared loader `words.ts` owned by 015.
  **Files in `apps/web/src/features/loader/`:** new `changes.ts`, `changes.test.ts`, `PlanChangedPage.tsx`,
  `parts/PlanChangeBell.tsx`; existing `LoaderHome.tsx`, `TrucksPage.tsx`, `TruckPage.tsx`, `loading.ts`,
  `parts/NextOutCard.tsx` and `parts/TruckRow.tsx` for both changed chips. It does not own `features/auth/api.ts` or the app router: observe the
  existing account state and keep routes inside `LoaderHome`.

- [x] **T5 · Join, click through and review** · lead, after T2 and T4 (**AC-26 to AC-33, AC-35**).
  Join API and screens, run typecheck/full tests/build on a freshly migrated/seeded private database, then the named
  checks in plan.md in **Nabil's visible Chrome on the built app**, next to the frames. Use 1440 × 900, 1024, 820
  and 390 for the dispatcher, 1180 × 820 and 390 for the loader, normal/private Chrome sessions for live updates
  and offline sync. Check the unchanged 012 start/unsend race and 013
  queue/answer tests too. A second tool/person that did not build it reviews every criterion and source.
  **Files:** resolve joins in the already assigned files; add actual evidence to
  `docs/specs/016-live-day/verification.md`, update spec checkboxes/status, README walkthrough/departures,
  `docs/specs/README.md`, `000-map.md` and the specific prior-spec scope lines in plan.md. Do not rewrite reserved
  decisions or unrelated specs. Only mark Done after all checks pass; Nabil merges.

**Parallel work:** API T1 → T2 and screens T3 → T4 branch from the pushed T0 and run side by side. T0's contracts,
loading metadata and stream fan-out belong to the lead alone; any required shared correction returns to that owner
and is pushed before both builders adopt it. The API builder touches no web files; the screens builder touches no
API files. T3 and T4 share one screens owner, so they do not race on their own files or routes. AC-19 is removed;
the other 35 retain their ids and AC-37 adds the publication transition, making 36 criteria with task owners.
No task assigns a file owned by spec 015: its issue hook,
IssueCard, loader problem words, driver words and store/receipt files remain outside this piece.

Nobody else changes `packages/contracts`, `apps/api/src/app.ts`, `loading/day.ts`, `loading/writes.ts`,
`apps/web/src/lib/live.ts` or the T0 tests while T0 is open. Nobody adds a migration or changes the schema, seed,
clock, `lib/day-lock.ts`, planning/suggestion commands, driver writes/sync, shop receipt commands, shared AppShell,
app router or packages. Reuse those boundaries; request a lead-owned change only if joined code makes it necessary.
`AGENTS.md`, `.env`, booklet text and local data stay out of commits. Each integration file uses its own builder's
database and one sign-in per account, and puts the day back at the end.
