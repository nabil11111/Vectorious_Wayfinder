# 010 · Tasks

One pull request per task. The API tasks write their tests from the criteria first (D-07).

- [x] **T0 · Shared parts** · lead, on `nabil/plan-board` cut from `main` once shop orders is merged there. The
  migration and schema, `packages/contracts/src/plans.ts`, `split` in `ORDER_STATUSES` with its `statusChip` case,
  `TRIP_STATUSES`, `leaveAt` on `Problem`, an empty `routes/plans.ts` with the role and depot checks mounted as
  `/plans`, a top bar slot and a full-width page in `AppShell`, the icons, the driver accounts of open point 1 in the
  seed, D-28 to D-33 in `docs/decisions.md`, and the Out of scope line of spec 009.
- [x] **T1 · The board's day and reading the board** (AC-1, AC-5, AC-7 to AC-9) · after T0.
  Files: `apps/api/src/plans/board-day.ts` and its test, `plans/board.ts`, the two GETs in `routes/plans.ts`, and
  `apps/api/tests/plan-board.test.ts`.
- [x] **T2 · Saving and leaving times** (AC-2, AC-3, AC-6, AC-10 to AC-18) · after T1.
  Files: `plans/draft.ts`, the save route, `planning/rules/time.ts` and `rules/time.test.ts`, and
  `apps/api/tests/plan-save.test.ts`.
- [x] **T3 · Split, join, send and back to edit** (AC-4, AC-19 to AC-23, AC-25 to AC-30) · after T2.
  Files: `plans/split.ts`, `plans/send.ts`, their four routes, `apps/api/tests/plan-split.test.ts`, `plan-send.test.ts`,
  and spec 009's depot lock in `orders/store-orders.ts` with its test in `apps/api/tests/store-orders.test.ts`.
- [x] **T4 · Find a slot** (AC-24) · after T2. Files: `plans/slots.ts`, its route and `apps/api/tests/plan-slots.test.ts`.
- [x] **T5 · The board** (AC-31 to AC-35, AC-39, AC-41, and the board's part of AC-40 and AC-42) · after T0. It needs
  spec 008's screen task on `main` for the clock and live updates. Files: `features/dispatcher/DispatcherHome.tsx`
  and `DepotSwitch.tsx`, and in `features/plan/`: `PlanBoardPage.tsx`, `board.ts`, `draft.ts`, `words.ts` and
  `parts/`, except the parts T6 and T7 name.
- [x] **T6 · Defer, split and find a slot** (AC-36, AC-37) · after T5.
  Files: `parts/DeferForm.tsx`, `parts/SplitForm.tsx`, `parts/FindSlot.tsx`, and the calls they add to `board.ts` and
  `draft.ts`.
- [x] **T7 · View plan, sending and back to edit** (AC-38, the rest of AC-40 and AC-42) · after T5.
  Files: `ViewPlanPage.tsx`, `parts/VehicleRow.tsx`, `parts/ChecksPanel.tsx`, and the send and unsend calls in `board.ts`.
- [x] **T8 · Join and click through** · lead · after T3, T4, T6 and T7. AC-43's read, every click-through next to the
  frames, the README's departures and B4 list, and A2 in the map. The walkthrough, on a fresh reset: Nadeesha places
  her draft, the clock moves to 16:00, and Ruwan puts OUT001's three orders and OUT002's two on VEH035 with Dilshan,
  defers every other group and sends. Check the send succeeds, VEH035 leaving at 04:36, before moving the clock to
  loading. Two stops let the loader (spec 012) show the last stop going in first.

**At the same time.** Both builders branch from `nabil/plan-board` after T0. The API builder does T1, T2, then T3 and
T4. The web builder does T5, then T6 and T7, against the contracts, and no screen is done before T8 meets real data.

Nobody but the lead touches `packages/contracts`, `apps/api/src/db`, `apps/api/drizzle`, `apps/api/src/app.ts`,
`components/layout/AppShell.tsx`, `apps/web/src/app/router.tsx` or `features/store`, and a builder who needs a change
there stops and asks. A test file signs in once per account, because one address gets ten sign-ins in 15 minutes.
