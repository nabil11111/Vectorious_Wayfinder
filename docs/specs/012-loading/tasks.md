# 012 · Tasks

One pull request per task. The API tasks write their tests from the criteria first (D-07).

- [ ] **T0 · Shared parts** · lead, on `nabil/loading` brought up to date with `main` once spec 010 is merged there,
  because A3 reads sent plans and takes 010's locks. The migration `loading` and its schema (the columns on `trips`, `stops` and
  `order_lines`, the tables `issues` and `issue_lines`, and the enums `issue_kind` and `issue_status`), the shapes and
  error codes in `packages/contracts/src/issues.ts` and `loading.ts` with their exports, `lib/day-lock.ts` with step 1
  of 010's writes moved into it and 010's tests still green, the empty `routes/loading.ts` and `routes/issues.ts` with
  the role and depot checks mounted as `/loading` and `/issues`, the two new tables in `docs/data-model.md`, and A3 as
  "Building" in the map. D-34 to D-40 are in `docs/decisions.md` already.
- [ ] **T1 · The loader's day and reading it** (AC-1 to AC-6, AC-8) · after T0.
  Files: `apps/api/src/loading/loader-day.ts`, `loading/going.ts` and their tests, `loading/day.ts`, `issues/read.ts`,
  the GET route in `routes/loading.ts`, the two `loading` announcements in `plans/send.ts`, and
  `apps/api/tests/loading-plan.ts` and `loading-read.test.ts`.
- [ ] **T2 · Start, stops, flags and ready** (AC-7, AC-9 to AC-17, AC-22 to AC-24) · after T1.
  Files: `loading/writes.ts`, the four POST routes in `routes/loading.ts`, and `apps/api/tests/loading-start.test.ts`
  and `loading-writes.test.ts`.
- [ ] **T3 · What needs the dispatcher, and the answer** (AC-18 to AC-21) · after T2, whose flags its tests raise.
  Files: `issues/decide.ts`, the two routes in `routes/issues.ts`, and `apps/api/tests/issues.test.ts`.
- [ ] **T4 · The loader's screens** (AC-25 to AC-27, AC-30, the loader's part of AC-29, AC-31 and AC-32) · after T0.
  It uses spec 010's `features/plan/words.ts`. Files: everything in `apps/web/src/features/loader/`.
- [ ] **T5 · Live day's column and the bell** (AC-28, the dispatcher's part of AC-29, AC-31 and AC-32) · after T4,
  whose `words.ts` it imports. It uses spec 010's depot switch. Files: everything in `apps/web/src/features/live/`,
  the Live day route in `features/dispatcher/DispatcherHome.tsx`, `components/layout/Bell.tsx`, and the one line in
  `AppShell.tsx` that renders it in place of the plain bell.
- [ ] **T6 · Join and click through** · lead · after T3 and T5. The click-throughs of AC-25 to AC-32 in Nabil's Chrome
  next to the frames, on a fresh reset through spec 010's walkthrough and then this spec's. The README gets the
  walkthrough's steps and the departures, the map marks A3, and a second tool that did not build it reviews the diff
  against each criterion.

**At the same time.** Both builders branch from `nabil/loading` after T0. The API builder does T1, T2 and T3 in
order. The web builder does T4 and then T5 against the contracts, and no screen is done before T6 meets real data.

Nobody but the lead touches `packages/contracts`, `apps/api/src/db`, `apps/api/drizzle`, `apps/api/src/app.ts`,
`lib/day-lock.ts` or `apps/web/src/app/router.tsx`, and nobody touches `features/plan` or `features/store`. A builder
who needs a change there stops and asks. A test file signs in once per account, because one address gets ten sign-ins
in 15 minutes.
