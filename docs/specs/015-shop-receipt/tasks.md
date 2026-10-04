# 015 · Tasks

> Build record: this describes the original implementation sequence. See the [spec guide](../README.md)
> for current status and the later specs that supersede parts of this work.

One pull request per task. The API tasks, and T0's functions, write their tests from the criteria first (D-07).

- [x] **T0 · Shared parts** · lead, on `nabil/receipt` brought up to date with `main` once spec 013 is merged there as it
  is, because A5 reads the driver's stops, counts, problems and photos and sends through the driver's queue. First the
  five changes to A4's shared parts (plan.md, Changes to other specs), each with spec 013's tests green, and A4's offline
  click-throughs run again after the queue moves to `apps/web/src/lib/phone/`. Then the migration `receipt` and its
  schema, with the rename of `driver_writes` (plan.md, Data changes); `MAX_STOP_ORDERS` and `MAX_ORDER_LINES` named once
  in the contracts; and in `apps/api/src/app.ts` the receipt route's 2 MB body limit.
  `packages/contracts/src/receipt.ts` with its shapes and `deliveryFigures`, `applyReceipt` and `receiptView`, their unit
  tests written first (AC-5, `apps/api/src/orders/receipt-rules.test.ts`); the `StoreOrder` fields in `store.ts`; the
  kind, reasons, answers, `Issue` fields and `replaceOn` in `issues.ts`; and the code `not_delivered`. The seed block
  (D-62), with spec 008's `tests/demo-day.test.ts` and any spec 009 test that names Wednesday's order brought up to date
  (AC-33). In `apps/web/src/features/store/StoreHome.tsx` the shop's queue started when the area opens and the routes
  `deliveries` and `deliveries/:stopId` to empty pages. The new columns and `phone_writes` in `docs/data-model.md`, and A5
  and A6 as "Building" in the map. D-56 to D-62 are in `docs/decisions.md` already.
- [x] **T1 · Reading the deliveries and the cards' facts** (AC-1 to AC-4, AC-32, and AC-31 up to the receipt) · after T0,
  with a replacement read through `split_from` and left out of the next order with its parts. Files:
  `apps/api/src/orders/deliveries.ts`, `orders/order-facts.ts`, `readOrders` and the next order's `placed` in
  `orders/store-orders.ts`, the two GET routes in `routes/store.ts`, and `apps/api/tests/receipt-plan.ts`,
  `receipt-read.test.ts` and `store-cards.test.ts`.
- [x] **T2 · The receipt** (AC-6 to AC-20) · after T1: the checks, a delivery confirmed once, the stop read again after the
  trip's lock, the report and its photo, the write ids and their hashes, a lost answer, the time kept and the reset.
  Files: `apps/api/src/orders/receipt.ts`, the POST route in `routes/store.ts`, and
  `apps/api/tests/receipt-writes.test.ts` and `receipt-sync.test.ts`.
- [x] **T3 · The answers and replacements** (AC-21 to AC-30, and the rest of AC-31) · after T2, whose receipts its tests
  raise. Files: spec 012's `apps/api/src/issues/read.ts` and `issues/decide.ts`, `issues/replace.ts`, the export of
  `openDayAt` in `orders/store-orders.ts`, `apps/api/tests/receipt-answers.test.ts` and `receipt-replacements.test.ts`,
  and the rest of `store-cards.test.ts`. AC-29 builds Friday's plan through spec 014: if 014 is not on `main` when T3 is
  ready, T3 closes the rest, and AC-29 is a small task of its own as soon as 014 merges.
- [x] **T4 · Deliveries** (AC-34 to AC-36, the shop's part of AC-37 and AC-39, and the receipt part of AC-41) · after T0. It
  uses `apps/web/src/lib/phone/` as T0 leaves it, with each receipt record's `shown` copy. Files in
  `apps/web/src/features/store/`: `DeliveriesPage.tsx`, `ReceiptForm.tsx`, `ReceiptStatus.tsx`, `deliveries.ts`, the new
  files in `parts/`, and the receipt's words in `words.ts`.
- [x] **T5 · The shop's cards** (the cards of AC-37, and AC-40) · after T4, whose words it shares. Files in
  `apps/web/src/features/store/`: `parts/OrderCard.tsx`, `parts/StatusChip.tsx`, `words.ts`, `OrdersPage.tsx` and
  `TodayPage.tsx`.
- [x] **T6 · Live day and the driver's line** (the dispatcher's part of AC-37, AC-38, and the Live day part of AC-41) ·
  after T5. Files: spec 012's `apps/web/src/features/live/IssueCard.tsx` and `features/live/issues.ts`, the problem words
  in `features/loader/words.ts`, and spec 013's `features/driver/words.ts`.
- [x] **T7 · Join and click through** · lead · after T3 and T6. Build the app and run it as it runs hosted, since the service
  worker is off on the development server. Then the click-throughs of AC-34 to AC-40 in Nabil's Chrome next to the
  frames, on a fresh reset through the walkthroughs of specs 009, 010, 012 and 013 and then this one: the network turned
  off in DevTools and a cold reload for AC-35, a reset from another browser and a reload for AC-36, two browsers for
  AC-36 to AC-39, and for AC-39 two tabs, DevTools' storage quota at its smallest and the session cookie deleted; and the
  read of AC-41. The README gets the walkthrough's steps, the departures and the setup line that an install seeded before
  this piece resets the demo day once (D-62), spec 013's departure 6 shrinks, the map marks A5 and A6, and a second tool
  that did not build it reviews the diff against each criterion.

**At the same time.** Both builders branch from `nabil/receipt` after T0. The API builder does T1, T2 and T3 in order. The
web builder does T4, T5 and T6 against the contracts and their functions, and no screen is done before T7 meets real data.

Nobody but the lead touches `packages/contracts`, `apps/api/src/db`, `apps/api/drizzle`, `apps/api/src/app.ts`, and in
`apps/api/src/lib` `day-lock.ts`, `phone-writes.ts`, `kept-time.ts` and `jpeg.ts`; and on the web `apps/web/src/lib/phone/`,
`apps/web/src/lib/clock.ts`, `apps/web/vite.config.ts`, `apps/web/package.json`, `features/auth/api.ts`, `AppShell.tsx`,
`features/store/StoreHome.tsx` and `app/router.tsx`. Nobody touches `features/plan`, `features/loader` beyond its problem
words, or `features/driver` beyond its words. A builder who needs a change there stops and asks. A test file signs in once
per account, because one address gets ten sign-ins in 15 minutes.
