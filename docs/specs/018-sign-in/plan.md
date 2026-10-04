# 018 · Plan

> Build record: this describes the original implementation sequence. See the [spec guide](../README.md)
> for current status and the later specs that supersede parts of this work.

## Data changes
Migration `0009_sign_in`:
- `users.staff_id text unique`, `users.pin_hash text`: nullable only because rows seeded before this spec have
  neither until the seed's once-only step fills them; the sign-in treats a row without both as unknown.
- `users.failed_pins smallint not null default 0`, `users.locked_until timestamptz`: wrong PINs in a row, and when
  the lock ends.
- `users.password_hash` is dropped. `username` stays as the fixtures' and tests' handle; nobody types it any more.

## Contracts
- `LoginRequest = { staffId, pin }`: `staffId` trimmed, 1 to 16 characters, upper-cased; `pin` exactly four digits
  (`/^\d{4}$/`). A staff ID that is not a letter, a dash and three digits is simply unknown (401), not a 400.
- `Me` gains `staffId`.
- Error codes: `bad_credentials` (401, "Staff ID or PIN isn't correct. Try again."), `locked` (429, "Too many
  tries. Wait 15 minutes, or contact your depot.").

## How it works
**Sign-in** (`apps/api/src/routes/auth.ts`). Find the active user by `staff_id`. A row locked until later than now
is answered `locked` without checking the PIN. Otherwise verify the PIN against `pin_hash`, or against the made-up
hash when there is no such user, so both take as long. A wrong PIN adds one to `failed_pins` in one statement; the
fifth sets `locked_until` 15 minutes on, sets the count back to 0, and is itself answered `locked`. A right PIN sets
the count back to 0, clears the lock and opens the session as today. The lock and the session use real time, which
this file is already allowed to read (`tests/one-clock.test.ts`). The address limit is unchanged.

**Seed** (`apps/api/src/db/seed.ts`, `fixtures.ts`, `lib/config.ts`). `DEMO_USERS` gain `staffId`. The demo PIN
(`SEED_PIN`, default `1234`) and admin's (`SEED_ADMIN_PIN`, default `9024`) are hashed once each. New rows get their
staff ID and PIN hash; then, for rows seeded before this spec, one update per demo account fills `staff_id` and
`pin_hash` where they are null and touches nothing else. This replaces `admin-password.ts`. `SEED_PASSWORD` and
`SEED_ADMIN_PASSWORD` go from the config, `.env.example`, the compose file and the README.

**Screens** (`apps/web/src/features/auth/`). `LoginPage` draws the desktop split from 1024 wide (`lg:`) and the
phone frame below it. The artwork draws `ARTWORK_DISTRICTS` from `@/lib/map/login-artwork-shapes` (merged first,
`docs/map-data.md`) in the colours of spec.md. The PIN is one piece of state shared by the desktop field and the
phone pad. `useLogin` sends `{ staffId, pin }`; the page picks its line from the error's code, and a fetch that never
reaches the server is the No signal line. Remember my staff ID keeps the staff ID under one `localStorage` key,
read and written inside `try`/`catch`. The wordmark has a light version for the dark panel.

**Tests.** One helper, `apps/api/tests/sign-in.ts`, signs a fixture account in by its username, so the 19 test files
that post to `/auth/login` change in one mechanical way.

## Risks
- Every API test file that signs in changes: the helper keeps it mechanical, and the whole suite must pass.
- A stranger's five wrong PINs lock a judge out for 15 minutes. Accepted: the README prints the PIN, so nobody
  needs to guess, and the lock protects admin's PIN on the hosted app.
- An old install that never reruns the seed cannot sign in: `docker compose up` always seeds, and the README's
  setup line says to run `npm run db:seed` after pulling.

## Test plan
- AC-1 to AC-5: integration tests on a seeded database (`apps/api/tests/auth.test.ts` and the seed's test).
- AC-6 to AC-11: web unit tests for the PIN, the pad, the lines and Remember my staff ID; then a click-through in
  Chrome at 1440, 820 and 390 wide next to the frames.
- AC-12: read in review.
