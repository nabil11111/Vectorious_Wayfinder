# 009 · Tasks

> Build record: this describes the original implementation sequence. See the [spec guide](../README.md)
> for current status and the later specs that supersede parts of this work.

One pull request per task. The API tasks write their tests from the criteria first (D-07).

- [x] **T0 · Shared parts** · lead. The migration in `plan.md`, the shapes and error codes in
  `packages/contracts/src/store.ts`, an empty `routes/store.ts` with the role and outlet checks mounted in
  `app.ts`, the icons, and the seed additions in `plan.md`.
- [x] **T1 · The delivery day rule** (AC-1 to AC-5) · after T0.
  Files: `apps/api/src/orders/orderable-day.ts` and its test.
- [x] **T2 · Next order, draft and place** (AC-6 to AC-8, AC-10 to AC-23, AC-38) · after T1, the load
  calculator (007 T1) and the app clock and announcement (008).
  Files: `orders/store-orders.ts`, `routes/store.ts` and `apps/api/tests/store-orders.test.ts`.
- [x] **T3 · The lists** (AC-9, AC-24 to AC-27, AC-39) · after T2, because it adds a route to the same file.
  Files: `orders/store-lists.ts`, `apps/api/tests/store-lists.test.ts` and one route in `routes/store.ts`.
- [x] **T4 · The store area, Today and Help** (AC-28, AC-34, the Today part of AC-36) · after T0.
  Files in `apps/web/src/features/store/`: `StoreHome.tsx`, `TodayPage.tsx`, `HelpPage.tsx`, `parts/`, `words.ts`,
  the reading hooks and placeholder pages for the other routes. `chip.tsx`, `segmented.tsx` and `skeleton.tsx`
  in `components/ui/`.
- [x] **T5 · New order and the confirmation** (AC-29 to AC-32, AC-35, AC-37, the form part of AC-36) · after T4.
  Files: `NewOrderPage.tsx`, `OrdersPlacedPage.tsx`, the save and place hooks, `parts/QuantityStepper.tsx`.
- [x] **T6 · Orders, open and past** (AC-33, the lists part of AC-36) · after T4.
  Files: `OrdersPage.tsx`, `orders.ts`.
- [x] **T7 · Join and click through** · lead · after T3, T5 and T6. Every click-through at 390 and 1440 wide on
  the seeded day, next to the frames. The departures go into the README and A1 is marked in the map.

**At the same time.** One builder does T1, T2 and T3 in order. A second does T4 and then T5, and a third can
take T6 once T4 is in. A screen task is not called done before T7, where it first meets real data.

Nobody but the lead touches `packages/contracts`, `apps/api/src/db`, `apps/api/src/app.ts` or
`apps/web/src/app/router.tsx`. A builder who needs a change there stops and asks.
