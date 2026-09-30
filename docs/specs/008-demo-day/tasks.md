# 008 · Tasks

Each task is one pull request. For the API and the seed, tests come first and are seen to fail (D-07), one per
criterion with its number in the name. Server files are under `apps/api/src`, tests under `apps/api/tests`.

- [ ] **T0 · Shared parts** · lead · first. The migration, `db/schema/demo.ts`, `packages/contracts/src/demo.ts`
  and the three settings. In shared files: `app.ts` mounts the four routes (the demo ones only in demo mode) and
  keeps `/events` out of the rate limiter and the request log, `server.ts` waits for `initClock()` and calls
  `closeStreams()` before it closes, `seed.ts` ends with `seedDemoDay()`. Stubs with the final exports for the
  builders: `lib/clock.ts`, `lib/live.ts`, the route files and `db/demo-day.ts`, which writes the clock row only.
- [ ] **T1 · The clock on the server** (AC-2 to AC-7, AC-9 to AC-12, AC-8 for a move) · after T0. Files:
  `lib/clock.ts`, `routes/clock.ts`, `tests/clock.test.ts`.
- [ ] **T2 · Live updates on the server** (AC-17 to AC-22, AC-24 to AC-26) · after T0. Files: `lib/live.ts`,
  `routes/events.ts`, `tests/live.test.ts`.
- [ ] **T3 · The seeded day** (AC-1, AC-28 to AC-38) · after T0. Files: `db/demo-day.ts`,
  `tests/demo-day.test.ts`. It also writes `clearDemoDay`, which T4 calls.
- [ ] **T4 · Reset** (AC-39 to AC-41, AC-23, AC-8 for a reset) · after T1, T2 and T3. Files:
  `routes/demo-reset.ts`, `tests/demo-reset.test.ts`.
- [ ] **T5 · Clock, control and live updates on screen** (AC-14 to AC-16, AC-27, AC-42) · after T0, click-through
  after T1, T2 and T4. In `apps/web/src`: `lib/clock.ts`, `lib/live.ts`, `components/layout/DemoClock.tsx` and
  `AppShell.tsx` beside it, `main.tsx`, a sheet and a panel in `components/ui/`. Removes `lib/useNow.ts`.
- [ ] **T6 · Join and documents** · lead (AC-13) · after T1 to T5. `tests/one-clock.test.ts`. The README
  (`DEMO_MODE`, the demo day, the departure), `docs/data-model.md`, `docs/architecture.md`, `AGENTS.md`, the
  map's A0 row. Then the click-through with two browsers at 390 and 1440 wide.

T1, T2 and T3 share no file, so three builders start together after T0. T5 touches only the web app and starts as
soon as a builder is free. Nobody but the lead touches `packages/contracts`, the schema, the migration, `app.ts`,
`server.ts`, `seed.ts` or `lib/config.ts`. A builder who needs a change there stops and asks. In a test file,
sign in once per role and reuse the cookie, because one address gets ten sign-ins in 15 minutes. And put the
clock and the day back at the end, because test files share one database.
