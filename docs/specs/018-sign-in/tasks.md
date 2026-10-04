# 018 · Tasks

> Build record: this describes the original implementation sequence. See the [spec guide](../README.md)
> for current status and the later specs that supersede parts of this work.

- [x] T0 · Shared parts, pushed on their own before T2 starts: migration `0009_sign_in` and the `users` columns,
  `LoginRequest` and `Me.staffId`, the two error codes, `staffId` on every fixture account, `SEED_PIN` and
  `SEED_ADMIN_PIN`, a plain staff ID and PIN sign-in, the shared test sign-in helper and the test files that use it,
  and `useLogin`'s new body, so everything compiles and every test passes. · Claude server builder (the lead hands it
  the schema and contracts for this spec)
- [x] T1 · Server: rules 1 to 4 in full (the lock included), the seed's once-only step, `.env.example` and the
  compose file, and the README (accounts, walkthrough sign-ins, settings, departures). Closes AC-1 to AC-5 and AC-12.
  Depends on T0. · the same builder
- [x] T2 · Screens: `LoginPage` desktop and phone, the artwork, the PIN pad, the lines, Remember my staff ID, the
  language buttons and Contact your depot. Closes AC-6 to AC-11. Depends on T0 and the district shapes
  (`apps/web/src/lib/map/login-artwork-shapes.ts`). · Claude screens builder
- [x] T3 · Join, review by a different tool, click-through in Chrome next to the frames, pull request. · lead
