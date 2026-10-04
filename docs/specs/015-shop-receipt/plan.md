# 015 · Plan

> Build record: this describes the original implementation sequence. See the [spec guide](../README.md)
> for current status and the later specs that supersede parts of this work.

## Data changes
One migration, `receipt`, written by the lead in T0 once spec 013 is merged, because A5 reads the driver's stops, handed
over counts, problems and photos, and sends through the driver's queue.

| Table | Change | Why |
| --- | --- | --- |
| `issue_kind` | Value `receipt`, added with `alter type … add value` and not used in the migration, as Postgres requires. | The shop's report (D-58). |
| `orders` | `received_at timestamptz`, when the shop confirmed, as rule 8 keeps it. `receipt_sent_at timestamptz`, the app clock when the receipt reached the server. `arrived_cold boolean`, on a chilled order of a receipt whether it arrived cold, else empty. All three empty until the receipt. | "Confirmed at 08:31", "Sent at 08:33" and the cold check, on the order every card reads (D-61). People see the two times, so they come from the app clock (D-18). |
| `orders` | `replaces_issue_id uuid` pointing at `issues`, with the index `orders_replaces`. | A replacement points at the problem it answers (D-59): the shop's "Replacement for Thu 25 Jun", the dispatcher's green line, and the shop's next order leaving it out. |
| `order_lines` | `received_qty integer`, with the check `order_lines_received_qty`: `received_qty between 0 and delivered_qty`. Empty until the receipt. | Counts follow the goods: what the shop counted sits beside what was loaded and what was handed over. |
| `driver_writes` | Spec 013's table, which A4 merged as it is, keeps its SQL names: the table `driver_writes`, its column `driver_id`, the index `driver_writes_driver` and its keys. Only the Drizzle schema's TypeScript names change, to `phoneWrites` and `userId` mapped to those SQL names, so no migration renames anything (the lead's call: drizzle-kit asks interactively about a rename, and nothing here can answer it). | One table of applied phone writes for every account that writes from a phone (D-57). A receipt's row holds the shop's account in `driver_id`, the stop's trip, kind `receipt` and the hash of its body. |

`photos` does not change: a report's photo names its problem, as a refusal's does. A reset's truncate reaches the new
columns with their tables (spec 008), and `issues` and `orders` go together.

**The seed** (D-62), as a block "Spec 015 · the shop's receipt" in `seedDemoDay`: OUT001's 24 received orders get each
line's `received_qty` at its quantity, `received_at` at 07:00 plus 3 minutes × (the day of the month mod 10) on the day
the order was for, and `arrived_cold` true when chilled. Wednesday's 6 dry cartons become `received` at Wed 07:42 with 6
received. `receipt_sent_at` stays empty for the history, which never travelled through the app. OUT001's received orders
then add up to 25 orders, 205 cartons, 1,414.5 kg and 7.585 m³. A reset brings it back. `seedDemoDay` writes nothing once
the day is seeded, so an existing install takes this through a demo reset, Reset the demo day in the demo clock or an
empty database, and the README's setup says so (T7).

## Contracts
The lead writes `packages/contracts/src/receipt.ts`, passed on by `index.ts`, and changes `store.ts` and `issues.ts`. Days
are `YYYY-MM-DD` and moments ISO strings.

| Shape | What it holds |
| --- | --- |
| `RECEIPT_REASONS` | `['missing', 'damaged', 'not_cold']`, with its Zod enum: a report's reason. The shop picks one of the first two, and `not_cold` is the reason when nothing is short. |
| `StoreDeliveryLine` | `lineId`, `orderId`, `temp`, `productId`, `name`, `unit`, `ordered`, `loaded`, `delivered` (handed over) and `received`, null until confirmed. |
| `StoreDelivery` | `stopId`, `revision` (the stop's), `day` (the sent plan's date), `vehicleId`, `driver` (a name, or null), `arrivedAt`, `doneAt`, `outcome` (`delivered` or `refused`), `late`, `refusalReason` (null unless refused), `lines` in spec 012's order, and `receipt`: null until confirmed, else `at`, `sentAt` (null while the receipt waits on the phone), `cold` (null when no chilled line came) and `report`: null, or `id`, `reason`, `decision` (null while open), `decidedAt` and `replacement` (`day` and `units`, or null). |
| `StoreDeliveries` | `outlet`, `today` (the app clock's day), `appliedWriteIds` (every phone write the account had applied, or answered again, in the last 48 hours, D-45) and `deliveries`: those to confirm, oldest handover first, then those confirmed today, latest first. |
| `MAX_STOP_ORDERS`, `MAX_ORDER_LINES`, `MAX_STOP_LINES` | 300, the orders a stop can hold, which `DraftStop` already allows; 20, the lines an order can hold, which the shop's draft already allows; and their product, 6,000. T0 names the first two once in the contracts, and `DraftStop`, `SaveDraftRequest` and `ReceiptWrite` use them, so the receipt's limit cannot drift from the stop's. |
| `MAX_LINE_UNITS` | 999, the most a line holds: a shop's line and what a receipt counts on one. `OrderLineInput`, `ReceiptWrite` and the replacements use it, so no replacement line is one the shop cannot confirm (D-59). |
| `ReceiptWrite` | `kind` (`receipt`), `writeId` (a UUID made on the phone), `stopId`, `at` (the app clock on the phone), `revision` (the stop's), `lines` (1 to `MAX_STOP_LINES` of `lineId` and `received`, 0 to 999, each line once), `cold` (a boolean, or null when no chilled line came), `reason` (`missing`, `damaged`, or null when nothing is short) and `photo`, which may be left out: a data URL of a JPEG, as spec 013's. |
| `deliveryFigures(delivery)` | Per line `expected` (handed over), `received`, `short` (expected less received, 0 until confirmed), `shortFromDepot` (ordered less loaded) and `refused` (loaded less handed over); the totals; and `chilled`, whether a chilled line came with something on it, which decides the cold check on the phone and on the server. |
| `applyReceipt(deliveries, write)` | The deliveries as the server answers once the receipt is applied, on plain values: rules 4 and 5 with `at` as the time and `sentAt` null, the stop's revision up by one, the write's id added to `appliedWriteIds`, and the list in the server's order (those to confirm first, then those confirmed, latest first). A receipt whose id is listed, or whose delivery is not in the list, changes nothing. |
| `receiptView(deliveries, writes)` | The receipts the deliveries do not list as applied, in order, and the deliveries with them applied by `applyReceipt`: what the phone shows and what it still has to send. It is spec 013's `phoneView` for the shop. |

In `store.ts`:

| Shape | Change |
| --- | --- |
| `StoreOrder` | Gains `delivery`: null until the order's latest stop on a sent plan is done, else `stopId`, `vehicleId`, `driver`, `arrivedAt`, `doneAt`, `outcome`, `late`, `delivered` (this order's units handed over, null when nobody was at the shop), `shortFromDepot`, `refused` and `refusalReason`. `receipt`: null unless the order is received with its counts, else `at`, `sentAt` (null for the seeded history), `units` received and `short` (ordered less received). `problems`: for each problem of kind `refused`, `closed` or `receipt` at that stop that counts the order, `kind`, `units` (counted on this order), `decision` (null while open) and `replacementDay`. `replacementFor`: the day of the delivery a replacement replaces, for the replacement and for either part of it when the plan splits it, else null. |

In `issues.ts`:

| Shape | Change |
| --- | --- |
| Kinds, reasons, answers | `ISSUE_KINDS` gains `receipt`. `RECEIPT_REASONS` join `IssueReason`. `REFUSAL_DECISIONS` gains `send_replacements`, and `RECEIPT_DECISIONS` are `send_replacements` and `no_replacement`. Both join `IssueDecision` and `DECISIONS_BY_KIND`. |
| `IssueLine` | Gains `received`, null until the shop confirms. |
| `Issue` | Gains `cold` (for a report whether the chilled goods arrived cold, else null) and `replacement` (the `day` and `units` of the orders an answer placed, else null). |
| `IssueList` | Gains `replaceOn`: the day a replacement placed now would be for, or null when no day is open. |
| `DecideIssueRequest` | Unchanged: `revision` and `decision`. |

New error codes, with a sentence the screens show as it is:

| Code | Status | Details | For example |
| --- | --- | --- | --- |
| `not_delivered` | 409 | none | "This delivery has not been handed over." |
| `other_account` | 409 | none | "This record was saved by another account. Sign in as that account to send it." On `/driver/writes` too. |

Codes used again, with the sentences of the spec's refusals table: `unknown_record` 400 with `id`, `stale` 409, spec 013's
`write_reused` 409 with `writeId`, `invalid_input` 400, spec 009's `no_delivery_day` 409, `no_outlet` 403 and `no_depot`
403.

## How it works
| File | What it holds |
| --- | --- |
| `apps/api/src/lib/phone-writes.ts` (T0) | `reserveWrite(tx, { writeId, userId, tripId, kind, body })`: spec 013's write id step in one place, with the SHA-256 of the parsed write as JSON with its keys sorted, photo included. It answers `new` or `repeat` and throws `write_reused`. `appliedWriteIdsOf(tx, userId)`: the account's ids answered in the last 48 hours of real time. Spec 013's writes and day call both. `requireWriteOwner`: on `/driver/writes` and `/store/receipts`, after the session and role checks, `other_account` unless the request's `X-Wayfinder-Account` header (`PHONE_ACCOUNT_HEADER`) names the session's account. |
| `apps/api/src/lib/kept-time.ts`, `lib/jpeg.ts` (T0) | Spec 013's `keptTime` and `jpegOf`, moved from `driver/` with their tests. |
| `apps/api/src/orders/deliveries.ts` | `deliveriesOf(tx, shop, at, where)`, which every read and the receipt answer with, `getDeliveries` and `getDelivery`. |
| `apps/api/src/orders/receipt.ts` | `confirmDelivery(caller, write)`. |
| `apps/api/src/orders/order-facts.ts` | `factsOf(tx, shop, orderIds)`: each order's delivery, receipt, problems and replacement, which `readOrders` adds to every `StoreOrder`. |
| `apps/api/src/orders/store-orders.ts` (spec 009) | `readOrders` adds the facts, the next order's `placed` leaves out a replacement and the parts of one, and `openDayAt` is exported for the replacements. |
| `apps/api/src/issues/read.ts`, `issues/decide.ts` (specs 012 and 013) | The report's fields, `replaceOn`, and the answers of kind `receipt` and `send_replacements`. |
| `apps/api/src/issues/replace.ts` | `placeReplacements(tx, problem, caller, at)`. |
| `apps/api/src/routes/store.ts` (spec 009) | The three routes behind spec 009's role and shop checks. |
| `apps/api/src/app.ts` (T0) | Parses `POST /api/v1/store/receipts` with a 2 MB body limit, ahead of the 1 MB parser every other route keeps: 6,000 lines are about 390 KB, and a photo up to 700,000 characters. |
| `apps/web/src/lib/phone/` (T0) | Spec 013's store, sender, signal and photo, moved from `features/driver/` and each taking a queue's parts, with the other-tab line and the photo tile as shared parts (Changes to other specs). `shop.ts` holds the shop's queue, which `StoreHome.tsx` starts at T0, so its parts sit here and not in `features/store/deliveries.ts`. |
| `apps/web/src/features/store/StoreHome.tsx` (T0) | Starts the shop's queue when the shop's area opens, and the routes `deliveries` and `deliveries/:stopId` in place of the placeholder. |
| `apps/web/src/features/store/` | `DeliveriesPage`, `ReceiptForm`, `ReceiptStatus`, `deliveries.ts` (the page's hooks over `lib/phone/shop.ts`'s queue) and `parts/` (the line card and the status card); the cards' new lines in `parts/OrderCard.tsx`, `parts/StatusChip.tsx` and `words.ts`; Past from `?list=past` and a card that opens its receipt in `OrdersPage.tsx`. |
| `apps/web/src/features/live/` (spec 012) | `IssueCard` for the report and the replacement answer, with the problem words it uses in `features/loader/words.ts`. |
| `apps/web/src/features/driver/words.ts` (spec 013) | The driver's line for a refusal answered with replacements. |

**Reading**, `GET /store/deliveries`, in one read-only snapshot (`snapshot` from `orders/store-orders.ts`, which takes the
`orders` table's lock first):
1. The shop, and the app clock's today.
2. The shop's stops on `published` plans whose outcome is `delivered` or `refused` and whose orders at the stop are still
   `delivered`, or were received on today's date.
3. For each, its trip, vehicle and driver; its lines with their products and counts in spec 012's order (`byLoadOrder`);
   its receipt from its orders' `received_at`, `receipt_sent_at` and `arrived_cold`; its report, the stop's problem of
   kind `receipt`, with the replacement orders that point at it; the refusal's reason from the stop's problem of kind
   `refused`; and `late`, an arrival after the shop's window closed, narrowed to its mall slot as spec 013's stops are.
4. `appliedWriteIds` from `appliedWriteIdsOf`, whatever deliveries steps 2 and 3 found.

`GET /store/deliveries/:stopId` answers one stop through the same builder, whatever its day: a stop of the caller's shop on
a sent plan, delivered or refused, else `unknown_record`.

**A receipt**, `POST /store/receipts`, in one transaction:
1. `lockDay(tx)`: in demo mode the `demo_day` row for share, so a receipt and a reset take turns (spec 012).
2. The trip of the named stop, where the stop is at the caller's shop and its plan is `published`, locked `for update`:
   the lock every driver write and every answer on that trip takes (spec 013). None is `unknown_record`. This statement
   reads nothing else of the stop.
3. Only now the clock instant `now`, read from the locked `demo_day` row (spec 013's `read()`).
4. Only now the stop, its lines with their counts and its orders with their receipt facts, in statements of their own. In
   read committed a statement sees what was committed before it started, so a receipt that waited for the lock judges
   what the write before it left, as the driver's writes read their trip after locking it (spec 013). Values read with
   the lock's own statement would be from before the wait.
5. `reserveWrite` with kind `receipt` and the stop's trip: a repeat is answered with `deliveriesOf` as it is and nothing
   else changes, and anything else under that id is `write_reused`. Two copies sent at once queue on the trip's lock, so
   the second finds the first's row.
6. A delivery already confirmed, its orders `received`, is `stale`, "This delivery was already confirmed.", whatever
   revision the receipt names. Two receipts with different ids sent at once queue on the trip's lock, and the second
   finds the first's counts in step 4 and stops here.
7. The revision must be the stop's (`stale`, "This delivery changed after this phone read it.").
8. The stop's outcome must be `delivered` or `refused` (`not_delivered`).
9. The checks, in this order: every line named is on the stop (`unknown_record`), and every line of the stop is named once
   (`invalid_input`); each count from 0 to what was handed over; `cold` set exactly when a chilled line came with something
   on it; `reason` set exactly when a line is short; a photo only with a report, and `jpegOf` on it (`invalid_input`).
10. The time kept: `keptTime(at, stop.done_at, now)`. The trip's `last_event_at` is not touched.
11. Each line's `received_qty`; each order of the stop `received` with `received_at` the time kept, `receipt_sent_at` set
   to `now`, `arrived_cold` on the chilled ones, and its revision up; the stop's revision up by one. With a report: the
   problem with the write's id, kind `receipt`, its reason, raised by the caller at the time kept, its lines (rule 5) and
   the photo with the write's id. The audit row `stop.received`, before the stop's revision, after the write's id, the
   counts, the phone's time and the time kept.
12. Answer `deliveriesOf` from inside the transaction. After the commit announce `orders` to the shop and its depot, and
   `issues` to the depot when there is a report.

**The cards' facts.** `factsOf` reads, for every order of a list at once: its latest stop on a `published` plan (the plan
with the latest date), that stop's trip, vehicle and driver, the order's lines' counts, the stop's problems of kinds
`refused`, `closed` and `receipt` with their lines on this order, and the replacement orders that point at each problem;
and, for an order with `replaces_issue_id`, or a part whose original has one, the date of its problem's plan. One step
through `split_from` is enough, because a part is never split again (spec 010), and a join deletes the parts and gives
the original back. A problem's replacement, its day and units, is read from the orders that point at it whatever their
status, so a replacement the plan splits still counts whole: a split original keeps its lines (D-30). A closed stop's
counts come from its problem, as spec 013's day reads them. One query per kind of fact, not one per order.

**An answer.** Spec 012's `decideIssue` with spec 013's steps, in one transaction:
1. `lockDay`, then for `send_replacements`, as for spec 013's `bring_back`, the caller's depot's row for share, as a shop's
   place takes it, so a plan's send sees the replacements whole or not at all.
2. The problem with its stop, trip and plan: another depot's is `unknown_record`. The trip's row for update, then the
   problem's.
3. A revision not the problem's, or a problem not open, is `stale`. An answer not in `DECISIONS_BY_KIND` for the kind is
   `invalid_input`, and `send_replacements` on a problem that counts nothing is `invalid_input` too.
4. `send_replacements`: `placeReplacements`. `no_replacement`: nothing but the decision. Spec 013's answers do what spec 013
   says.
5. The decision, `decided_by`, `decided_at` and the revision up. Audit `issue.decided`, with the replacement orders' ids.
6. Answer the open list with `replaceOn` and the decided problem. Announce `issues` to the depot, `orders` to the shop and
   the depot, and for a driver's problem `driver` to the depot.

**Replacements**, `placeReplacements`: the open day from `openDayAt` at the answer's clock instant (spec 009, rule 2); none
is `no_delivery_day`. For each temperature with units counted on the problem's lines, one order for the stop's shop, and
another for each 999 units of one item beyond the first: that day, `placed`, `placed_at` the clock instant, `placed_by`
and `created_by` the dispatcher, `replaces_issue_id` the problem, and a line per item with the units counted on it, at
most `MAX_LINE_UNITS`, the 999 a receipt counts on a line. Two of a stop's orders can each hold 999 of one item, so
combined they can pass it, and the rest goes on the next order. Spec 009's checks on items do not apply: the items were on
an order already.

**The phone** (D-57). `lib/phone/` takes a queue: its `name` (`driver` or `shop`), which names the lock `wayfinder-<name>`
and the phone's records; the address of its day (`/driver`, `/store/deliveries`) and of its writes (`/driver/writes`,
`/store/receipts`); its query key (`['driver']`, `['orders', 'deliveries']`); and its view function (`phoneView`,
`receiptView`). The phone's database keeps, per account and queue, the last day the server sent and the writes not yet
applied or refused, as spec 013's plan says. Each record also keeps `shown`, a copy of what the role's screen needs to
draw it without the day: for a receipt, the delivery as the form showed it.
- **The loop.** The shop's area starts the shop's queue when it opens, so the tab that holds `wayfinder-shop` runs spec
  013's loop while any shop page is open in it: fetch the deliveries within 15 seconds; keep them, in one database
  transaction with taking off every receipt they list; send the oldest waiting receipt within 15 seconds; start again. No
  answer, a 5xx or a 429 waits for the retry schedule and starts again from the fetch, with the same receipt. Each send,
  the driver's too, names the account that saved the write in `X-Wayfinder-Account`. A 401, or `other_account` for a
  send that carried another account's session, stops the loop with the receipt still waiting. Any other refusal marks it
  refused with its code and sentence. The key starts
  with `orders`, so the live stream's `orders` message starts the fetch, and so do a `clock` or `demo` message and the
  minute's refetch.
- **Confirming.** The button makes the receipt: a v4 UUID from `crypto.getRandomValues`, the app clock's time, the stop's
  revision from the delivery on screen, every line's count, the cold answer, the reason and the photo. It goes into the
  phone's database, and only then does the screen move on and the loop start at once. A save that fails shows "Could not
  save on this phone. Try again.", the form keeps its counts, and nothing is sent. With no clock known yet, the button
  waits.
- **What the page shows.** `receiptView` of the kept deliveries and the waiting receipts, and every number from
  `deliveryFigures`. A receipt record, waiting or refused, is drawn from the record itself: `applyReceipt` of its own
  request on its `shown` copy, whether or not the fetched deliveries still hold its stop, so a reset or a reload never
  hides it. A waiting receipt shows as "Sending…" while the phone has a signal and no send of it went unanswered, and as
  saved on this phone otherwise. A refused one shows "Not accepted" until "Clear" takes the record off the phone. A
  write's answer is never shown.
- **The pages.** `/store/deliveries` opens, with replace, the stop of the first receipt record on the phone, waiting or
  refused, else the first delivery to confirm, and with neither says nothing is waiting. `/store/deliveries/:stopId`
  shows the record for that stop when there is one, else the stop from the kept deliveries, else from `GET
  /store/deliveries/:stopId`, online.
- **The form** keeps its counts, reason, cold answer and photo in the page, as the loader's flag form does, so a fetch or a
  refusal leaves them. The photo is spec 013's: at most 1280 px and 500 KB, kept as a data URL.
- **Opening with no signal** is spec 013's: the service worker, the kept account and the kept clock. The shop's queue then
  shows Deliveries at once from what the phone kept. Today, Orders and New order stay online screens.

**Words**, in `features/store/words.ts`, which may use the formats of `features/loader/words.ts`:
- The form: "12 expected", "Received", "1 carton missing" and "2 cartons damaged", "1 short from the depot", "2 refused at
  the door", and "Arrived 03:34 · VEH035 · Dilshan", with the day before the time when it is not today ("Arrived Wed 24
  Jun 06:58 · …"). A line's name is "Chilled cartons" or "Dry cartons" for Fresh and the item's name for Style and Tech.
- The saved and sent screens of the screen states, with the line cards in spec 012's line words: "12 chilled cartons
  expected", "10 boxes · Folded clothing expected".
- The cards' lines of rule 11, and the chips "Received 08:31", "All 8 received" and "11 received · 1 short".
- Live day, in the problem words of `features/loader/words.ts`: the titles "1 chilled carton missing", "1 chilled carton
  damaged" and "Chilled goods not cold"; "Received · 11 of 12 chilled cartons"; "Cold on arrival · yes"; "Send 1
  replacement on Fri 26 Jun" with "The shop gets it on the next run." ("them" for more); "No replacement" with "Nothing
  more is sent. The shop is told."; "Send to shop"; the green lines of the screen states; and for a refusal the second
  option and "Send to driver and shop".
- The driver, in `features/driver/words.ts`: "Ruwan, dispatcher · 03:52 · Bring the 2 chilled cartons back to Peliyagoda.
  The shop gets 2 replacements on the next run."
- Icons from the design, all in `assets/icons/` once A4's T0 is in: `icon-chilled`, `icon-goods-dry`, the brand pictures,
  `icon-shortfall` under a line short from the depot, `icon-proof-photo` on the photo tile, `icon-offline-queue` (the
  tray) on the saved screen, `icon-order-delivered` (the box with the signed receipt) on the sent screen, and
  `icon-person-store-manager` on Live day's "Shop" row. No new icon is needed.

## Changes to other specs
- **Spec 013, in A5's T0.** A4 merges as it is, and its builders do not change course. Once it is on `main`, the lead
  changes A4's shared parts in T0 so the receipt reuses them, with A4's tests green and its offline click-throughs (its
  AC-40 and AC-43 to AC-48) run again after the move:
  1. `driverWrites` becomes `phoneWrites` with `userId` in place of `driverId` in `db/schema/driver.ts`, over the same
     SQL table `driver_writes` and column `driver_id` (Data changes), and the id step and the applied ids move into
     `lib/phone-writes.ts`, which `driver/writes.ts` and `driver/day.ts` then call.
  2. `keptTime` and `jpegOf` move to `lib/kept-time.ts` and `lib/jpeg.ts`, with their tests.
  3. The driver's day reads only problems of kinds `refused` and `closed`. `driverTripsOf` takes every kind but `loading`,
     so a shop's report on a stop of the trip would reach the driver's phone and fail `DriverProblem`'s kind.
  4. The phone's store, sender, signal and photo move from `features/driver/` to `apps/web/src/lib/phone/`, each taking a
     queue's parts and keeping each record's `shown` copy, with the other-tab line and the photo tile as shared parts.
     The driver's area passes the driver's queue, and its screens work as before.
  5. Every answer to a driver's problem also announces `orders` to the stop's shop and its depot, since the shop's card
     now shows it.

  In its own tasks A5 then adds `send_replacements` to a refusal's answers (T3), the refusal card's second option, "Send
  to driver and shop" on the refusal and closed-shop cards and "Dilshan and the shop told" in their green lines (T6), and
  the driver's line for a refusal answered with replacements (T6). Spec 013's departure 6 shrinks in the README at T7.
- **Spec 012.** `issuesOf` reads the report's fields and the replacement, `issueListOf` adds `replaceOn` (T3), and
  `IssueCard` draws the report (T6). The loader's answers stay as they are (design question 4).
- **Spec 010 and spec 014.** Nothing changes. Their splits, by hand and by the planner, already give each part
  `split_from`, which the cards follow, and their joins give the original back.
- **Spec 009.** `StoreOrder` and its card grow (rule 11). The next order's `placed` leaves out replacements and their
  parts. Orders opens Past from `?list=past`, and a card whose receipt reported something opens it. Deliveries replaces
  its placeholder. Its plan's seed note on Wednesday's dry order changes (D-62): the order is in Past now, not Open, and
  spec 009's AC-33 click-through reads so.
- **Spec 008.** The seed block, and `tests/demo-day.test.ts`, which then expects Wednesday's order `received` at 07:42 and
  25 received orders with 205 cartons, 1,414.5 kg and 7.585 m³, where it now counts 24 with 199, 1,373.1 kg and 7.363 m³
  (T0).
- **The map.** A5 and A6 point here.
- **README.** At T7: the walkthrough's steps, the departures, "Shop cards show only what exists so far" no longer listing
  "All 6 received", and in the setup a line that an install seeded before this piece resets the demo day once to take the
  received history (D-62).

## Risks
- A5 builds on A4's queue, phone writes, photos, stops and problems, none of them merged yet. T0 starts once A4 is merged
  and follows A4's code as it landed, not this plan, where the two differ.
- T0 changes code A4 has just merged: the rename, the two moves, the narrower read of problems, the announcement and the
  queue's move to `lib/phone/`. A4's tests stay green through each, and A4's offline click-throughs run again in T0
  before any shop screen is built on the moved queue.
- One account in two browsers can confirm one delivery twice. The later receipt is refused `stale` and its phone says so,
  and nothing counts twice.
- The seed change moves Wednesday's order from Open to Past, and any test or click-through that names it changes in T0.
- A replacement placed for a day whose plan was already sent waits unplanned on the board, as a shop's own order placed
  after the send does (spec 010).
- AC-29 builds a suggested plan, so it needs spec 014 on `main`. If 014 is later than T3, AC-29 waits for it as a task of
  its own, and the rest of T3 does not.
- A store manager with two tabs open sees the other-tab line on Deliveries only. Where a browser lacks Web Locks every
  tab runs the loop, and the server's ids keep a receipt from counting twice (spec 013).
- The 48 hours of listed ids are real time (spec 013). A phone that kept a receipt longer sends it again, and the server
  answers it as done and lists it again.
- The receipt's times repeat on every order of the delivery. One statement writes them, so they never differ.
- A receipt for the largest stop, with a photo, is about 1.1 MB, so its route takes 2 MB while every other route keeps 1
  MB. A real delivery is a few lines, and the limit only has to let the largest legal one through.

## Test plan
| Criteria | Kind | Where |
| --- | --- | --- |
| AC-5 | Unit, on the contracts' functions | `apps/api/src/orders/receipt-rules.test.ts` |
| AC-1 to AC-4 | Integration | `apps/api/tests/receipt-read.test.ts` |
| AC-6 to AC-11 | Integration | `apps/api/tests/receipt-writes.test.ts` |
| AC-12 to AC-20 | Integration | `apps/api/tests/receipt-sync.test.ts` |
| AC-21 to AC-27 | Integration | `apps/api/tests/receipt-answers.test.ts` |
| AC-28 to AC-30 | Integration, through spec 010's split and join and spec 014's build | `apps/api/tests/receipt-replacements.test.ts` |
| AC-31, AC-32 | Integration | `apps/api/tests/store-cards.test.ts` |
| AC-33 | Integration, the seed | `apps/api/tests/demo-day.test.ts` |
| AC-34 to AC-40 | Click-through in Nabil's Chrome on the built app, at 390 wide and 1440 × 900 as `nadeesha` with the network turned off in DevTools, at 1440 × 900 as `ruwan`, two browsers for AC-36 to AC-39, and for AC-39 two tabs, DevTools' storage quota, the session cookie deleted and a reset | The lead, on the joined branch |
| AC-41 | A read of `features/store`, `features/live` and `lib/phone` | The lead and the reviewer |

Integration tests run in the builder's own seeded database (AGENTS.md) and assert the seeded day's numbers. Each file
starts from the seeded day, puts it back at its end with spec 008's `clearDemoDay` and `seedDemoDay` in one transaction,
and lets the clock go. `apps/api/tests/receipt-plan.ts` runs spec 013's `readyWalkthrough` and Dilshan's writes through
the driver's endpoint: the start at 03:31, the arrival at Nugegoda at 03:34 and its delivery with a photo at 03:38, and,
when asked, Wellawatte's refusal at 03:48. It sets the clock to Thu 08:30 and gives a function that makes and sends a
receipt. AC-11 makes its stop of 41 orders in the database. AC-15 sends two receipts at once. AC-16 holds the trip's row
in a transaction of its own, as spec 013's AC-27 does, while it writes stop 1's delivery and moves the clock. AC-17 sets
one `answered_at` back 49 hours. AC-20 races a receipt against a reset as spec 012's AC-24 does. AC-24, AC-28 to AC-30
and AC-32 make a store manager at OUT002, as spec 009's tests do. AC-29 builds Friday's suggested plan through spec 014's
endpoint. A file signs in once per account, because one address gets ten sign-ins in 15 minutes.
