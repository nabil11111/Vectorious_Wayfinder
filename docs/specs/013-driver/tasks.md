# 013 · Tasks

One pull request per task. The API tasks, and T0's two functions, write their tests from the criteria first (D-07).

- [ ] **T0 · Shared parts** · lead, on `nabil/driver` brought up to date with `main` once spec 012 is merged there, because
  A4 reads its loaded counts, problems and locks. The migration `driver` and its schema (plan.md, Data changes);
  `packages/contracts/src/driver.ts` with its shapes and error codes and `applyDriverWrite` and `tripFigures`, their unit
  tests written first (AC-8, `apps/api/src/driver/rules.test.ts`); the kinds, reasons, answers and `Issue` fields in
  `issues.ts`; the empty `routes/driver.ts` behind the driver role and the depot check, mounted as `/driver`. For the web:
  `idb` and `vite-plugin-pwa` in `apps/web/package.json`, the service worker in `vite.config.ts`, the kept clock in
  `lib/clock.ts`, the kept account in `features/auth/api.ts`, a `status` slot in `AppShell.tsx` with the demo chip's short
  form beside it, and the seven icons in `assets/icons/`. The new tables in `docs/data-model.md`, and A4 as "Building" in
  the map. D-43 to D-50 are in `docs/decisions.md` already.
- [ ] **T1 · Reading the driver's day** (AC-1 to AC-5) · after T0.
  Files: `apps/api/src/driver/day.ts`, the GET route in `routes/driver.ts`, the `driver` announcement in spec 012's
  `loading/writes.ts` and spec 010's `plans/send.ts`, and `apps/api/tests/driver-plan.ts` and `driver-read.test.ts`.
- [ ] **T2 · The driver's writes** (AC-6, AC-7, AC-9 to AC-22) · after T1.
  Files: `driver/kept-time.ts` and its test, `driver/writes.ts`, `driver/photo.ts`, the POST route in `routes/driver.ts`,
  and `apps/api/tests/driver-writes.test.ts` and `driver-sync.test.ts`.
- [ ] **T3 · The answers and the photo** (AC-23 to AC-28) · after T2, whose problems its tests raise.
  Files: spec 012's `issues/read.ts` and `issues/decide.ts`, the photo route in `routes/issues.ts`, and
  `apps/api/tests/driver-answers.test.ts`.
- [ ] **T4 · The phone's store and sending** (the phone's part of AC-31 and AC-34, AC-36) · after T0.
  Files: `apps/web/src/features/driver/store.ts`, `sender.ts`, `signal.ts` and `photo.ts`, and in `parts/` the status
  chip and the waiting sheet.
- [ ] **T5 · The driver's screens** (AC-29 to AC-31, the driver's part of AC-32 to AC-34, AC-35, AC-36) · after T4. It
  uses spec 012's `features/loader/words.ts`. Files: everything else in `apps/web/src/features/driver/`.
- [ ] **T6 · Live day's card for the driver's problems** (the dispatcher's part of AC-32 and AC-33) · after T5.
  Files: spec 012's `features/live/IssueCard.tsx` and the problem words it uses.
- [ ] **T7 · Join and click through** · lead · after T3 and T6. Build the app and run it as it runs hosted, since the
  service worker is off on the development server. Then the click-throughs of AC-29 to AC-37 in Nabil's Chrome next to
  the frames, on a fresh reset through the walkthroughs of specs 009, 010 and 012 and then this one, with the network
  turned off in DevTools for AC-31 and AC-34 and a reload while it is off. The README gets the walkthrough's steps, how to
  turn the network off, and the departures; spec 008's out-of-scope line changes (plan.md); the map marks A4; and a second
  tool that did not build it reviews the diff against each criterion.

**At the same time.** Both builders branch from `nabil/driver` after T0. The API builder does T1, T2 and T3 in order. The
web builder does T4, T5 and T6 against the contracts and their two functions, and no screen is done before T7 meets real
data.

Nobody but the lead touches `packages/contracts`, `apps/api/src/db`, `apps/api/drizzle`, `apps/api/src/app.ts`,
`lib/day-lock.ts`, `apps/web/vite.config.ts`, `apps/web/package.json`, `lib/clock.ts`, `features/auth/api.ts`,
`AppShell.tsx` or `app/router.tsx`, and nobody touches `features/plan`, `features/store` or `features/loader`. A builder
who needs a change there stops and asks. A test file signs in once per account.

Not in this piece: the loader's flag photo (spec 012, open question 1). Once A4 is joined it is a small task on `photos`,
with the flag's problem id.
