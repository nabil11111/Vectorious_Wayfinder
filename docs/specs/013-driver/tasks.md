# 013 · Tasks

> Build record: this describes the original implementation sequence. See the [spec guide](../README.md)
> for current status and the later specs that supersede parts of this work.

One pull request per task. The API tasks, and T0's functions, write their tests from the criteria first (D-07).

- [x] **T0 · Shared parts** · lead, on `nabil/driver` brought up to date with `main` once spec 012 is merged there, because
  A4 reads its loaded counts, problems and locks. The migration `driver` and its schema (plan.md, Data changes).
  `packages/contracts/src/driver.ts` with its shapes and error codes and `applyDriverWrite`, `nextStop`, `tripFigures`
  and `phoneView`, their unit tests written first (AC-9, `apps/api/src/driver/rules.test.ts`); the kinds, reasons,
  answers and `Issue` fields in `issues.ts`, and `LoadingIssue` in `loading.ts`. In spec 012's code, `already_flagged`
  scoped to the flag's own trip in `loading/writes.ts` and the flags of `loading/day.ts` narrowed to kind `loading`, with
  spec 012's loading and issues tests green (AC-7). `lib/day-lock.ts` able to read the clock from its locked row when
  asked. The empty `routes/driver.ts` behind the driver role and the depot check, mounted as `/driver`. For the web: `idb`
  and `vite-plugin-pwa` in `apps/web/package.json`, the service worker in `vite.config.ts`, the account and the clock kept
  in `localStorage` and read at once on start, with `networkMode: 'always'`, in `features/auth/api.ts` and `lib/clock.ts`,
  a `status` slot in `AppShell.tsx` with the demo chip's short form beside it, and the seven icons in `assets/icons/`. The
  new tables in `docs/data-model.md`, and A4 as "Building" in the map. D-43 to D-50 are in `docs/decisions.md` already.
- [x] **T1 · Reading the driver's day** (AC-1 to AC-5) · after T0, with the account's applied ids and a closed stop's lines
  read from its problem. Files: `apps/api/src/driver/day.ts`, the GET route in `routes/driver.ts`, the `driver`
  announcement in spec 012's `loading/writes.ts` and spec 010's `plans/send.ts`, and `apps/api/tests/driver-plan.ts` and
  `driver-read.test.ts`.
- [x] **T2 · The driver's writes** (AC-6, AC-8, AC-10 to AC-21) · after T1.
  Files: `driver/kept-time.ts` and `driver/photo.ts` with their tests, `driver/writes.ts`, the POST route in
  `routes/driver.ts`, and `apps/api/tests/driver-writes.test.ts`.
- [x] **T3 · Saved once** (AC-22 to AC-29) · after T2: the write ids and their hashes, a lost answer, the ids listed past
  16:00 and after 48 hours, the clock read under the trip's lock, and the reset. Files: `driver/writes.ts`,
  `driver/day.ts` and `apps/api/tests/driver-sync.test.ts`.
- [x] **T4 · The answers and the photo** (AC-30 to AC-37) · after T3, whose problems its tests raise.
  Files: spec 012's `issues/read.ts` and `issues/decide.ts`, the photo route in `routes/issues.ts`, and
  `apps/api/tests/driver-answers.test.ts`.
- [x] **T5 · The phone's store and sync loop** (the phone's part of AC-40, AC-43 to AC-48, AC-50) · after T0: the one tab
  that owns the driver's app, the loop that fetches, keeps and sends, and the signal. Files:
  `apps/web/src/features/driver/store.ts`, `sender.ts`, `signal.ts` and `photo.ts`, and in `parts/` the status chip and
  the waiting sheet.
- [x] **T6 · The driver's screens** (AC-38 to AC-40, the driver's part of AC-41 and AC-42, the other tab's line of AC-48,
  AC-49, AC-50) · after T5. It uses spec 012's `features/loader/words.ts`. Files: everything else in
  `apps/web/src/features/driver/`.
- [x] **T7 · Live day's card for the driver's problems** (the dispatcher's part of AC-41 and AC-42) · after T6.
  Files: spec 012's `features/live/IssueCard.tsx` and the problem words it uses.
- [x] **T8 · Join and click through** · lead · after T4 and T7. Build the app and run it as it runs hosted, since the
  service worker is off on the development server. Then the click-throughs of AC-38 to AC-49 in Nabil's Chrome next to
  the frames, on a fresh reset through the walkthroughs of specs 009, 010 and 012 and then this one: the network turned
  off in DevTools and a cold reload for AC-40, two browsers for AC-41 to AC-43, DevTools' storage quota for AC-44, the
  session cookie deleted and request blocking for AC-45, the hosted app for AC-46, a latency profile and the day's own
  address blocked for AC-47, and two tabs for AC-48; and the reads of AC-50 and AC-51. The README gets the walkthrough's
  steps, how to turn the network off, and the departures; spec 008's out-of-scope line changes (plan.md); the map marks
  A4; and a second tool that did not build it reviews the diff against each criterion.

**At the same time.** Both builders branch from `nabil/driver` after T0. The API builder does T1, T2, T3 and T4 in order.
The web builder does T5, T6 and T7 against the contracts and their functions, and no screen is done before T8 meets real
data.

Nobody but the lead touches `packages/contracts`, `apps/api/src/db`, `apps/api/drizzle`, `apps/api/src/app.ts`,
`lib/day-lock.ts`, `apps/web/vite.config.ts`, `apps/web/package.json`, `lib/clock.ts`, `features/auth/api.ts`,
`AppShell.tsx` or `app/router.tsx`, and nobody touches `features/plan`, `features/store` or `features/loader`. A builder
who needs a change there stops and asks. A test file signs in once per account.

Not in this piece: the loader's flag photo (spec 012, design question 1). Once A4 is joined it is a small task on `photos`,
with the flag's problem id.
