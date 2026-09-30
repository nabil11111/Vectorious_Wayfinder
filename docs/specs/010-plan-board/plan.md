# 010 · Plan

## Data changes
One migration, `plan-board`, written by the lead in T0.

| Table | Change | Why |
| --- | --- | --- |
| `orders` | Status `split` added to `order_status`, last, as it is in `ORDER_STATUSES`. | The original of a split order (rule 8). |
| `orders` | Column `split_from uuid` pointing at `orders`, and index `orders_split_from` on it. | A part's link to its original. |
| `plans` | Column `saved_at timestamptz`, written from the app clock. | "Draft saved 16:12". People see it (D-18). |
| `plans` | Column `mix_brands boolean not null default false`. | The checker's setting for this plan (D-09, D-23). |
| `plans` | Column `sent_check jsonb`, the `PlanCheck` at sending, empty for a draft and for the seed's older plans. | A sent plan shows what was sent. |
| `trips` | Column `status`, a new `trip_status` (planned, loading, ready, out, done), default `planned`. | The map's trip states. A3 moves them, and D-33 reads them. |

`trips.depart_at` stays the time the dispatcher set, empty for the usual time, and `stops.planned_arrival` and
`planned_depart` are written at sending. The migration adds the enum value without using it, as Postgres requires.
T0's seed change is open point 1's driver accounts. A reset removes plans, parts and fuel rows (spec 008).

## Contracts
The lead writes these into `packages/contracts/src/plans.ts`. A time of day is minutes after midnight on the plan's
day, as in `PlanCheck`. Days are `YYYY-MM-DD`, moments ISO strings. A write's day is in its path.

| Shape | What it holds |
| --- | --- |
| `DraftStop`, `DraftTrip`, `DraftDeferral`, `DraftPlan` | A stop: `outletId` and `orderIds` (1 to 10). A trip: `vehicleId`, `tripNo` (1 or 2), `leaveAt` (0 to 1439, or null for the usual time), `driverId` or null, and `stops` (up to 40). A deferral: `orderId`, `code` (`DeferralCode`) and `reason` (trimmed, 1 to 200). The plan: `mixBrands`, `trips` (up to 76) and `deferrals` (up to 300). |
| `PlanRef` | `{ planId, revision }`, or `{ planId: null, demoDay }` before the first save, `demoDay` being the clock's `day` the board was read under. |
| `SavePlanRequest`, `SplitOrderRequest`, `JoinOrderRequest`, `SendPlanRequest`, `UnsendPlanRequest` | Each is a `PlanRef`. The save adds a `DraftPlan`. The split adds `orderId` and `keep`, the first part's lines (`productId`, quantity 0 to 999, up to 10 lines). The join adds the original's `orderId`. |
| `BoardOrder` | `id`, `outletId`, `temp`, `deliveryDate` (the day the shop wanted), `lines` (`OrderLine`), `load` (`Load`), `carriedOver`, `timesDeferred`, `lastDeferral` (`code`, `reason`) or null, and `splitFrom` and `originalUnits`, or null. |
| `BoardShop`, `BoardVehicle`, `BoardDriver` | A shop: `id`, `name`, `brand`, `district`, `dockType`, `parking`, `windowOpen`, `windowClose`, `mallOpen` and `mallClose` or null, and `unloadMin`. A vehicle: `id`, `type`, `temp`, `weightCapKg`, `volumeCapM3`, `working`, `offReason` or null, `litresLeft` and `fuelLeftPct`. A driver: `id` and `name`. |
| `TripFigures`, `BoardCounts` | Per trip `vehicleId`, `tripNo`, `kgPct`, `m3Pct` and `timePct`. The counts of rule 12: `vehiclesUsed`, `vehiclesWorking`, `trips`, `ordersDue`, `ordersOnTrips`, `ordersDeferred`, `ordersUnplanned`, `fuelWeekPct`, `fridgeM3Used`, `fridgeM3Working`, `stops`, `stopsOnTime`, `km`, `hoursOnRoad` and `drivers`. |
| `PlanBoard` | `depot`, `demoDay`, `day` (`date`, `cutoffAt`, `open`) or null, `plan` (a `DraftPlan` with `id` or null, `revision`, `status`, `savedAt`, `sentAt` and whether every trip is `planned`), `dropped` (order ids, rule 2), `check`, `orders`, `shops`, `vehicles`, `drivers`, `figures` and `counts`. `check`, `figures` and `counts` are null for a sent plan with no kept check. |
| `SlotSearch` | `orderId`, `revision`, `slots` (`vehicleId`, `tripNo`, `stopSeq`, `newStop`, `arriveAt`) and `refused` (`vehicleId`, `tripNo`, `problem`). |

Changed shapes: `ORDER_STATUSES` gains `split` (`store.ts`), `TRIP_STATUSES` is new, and `Problem` gains `leaveAt`, an
optional whole number (`planning.ts`). New error codes: `no_depot` 403, `orders_open` 409 with `date` and `cutoffAt`,
`no_plan_day` 409, `day_moved` 409 with `date`, `plan_sent` 409, `unknown_record` 400 with `id`, `driver_taken` 400,
`cannot_split` 409, `cannot_join` 409, `not_ready` 409 with the blocks, `split_mismatch` 409 with `orderId`,
`departed_already` 409 and `loading_started` 409, each naming its trip.

## How it works
| File | What it holds |
| --- | --- |
| `apps/api/src/plans/board-day.ts` | `boardDay(today, minutesNow, operatingDays)`: rule 1 on plain values, with no database and no `Date`. It uses `CUTOFF_MINUTES` from `orders/orderable-day.ts`. |
| `apps/api/src/plans/board.ts` | `getBoard(caller, date?)`, and `boardOf(tx, depotId, date)`, which every write answers with. |
| `apps/api/src/plans/draft.ts` | `saveDraft`, and `openPlan(tx, caller, date, ref)`, the steps every write shares. |
| `apps/api/src/plans/split.ts`, `send.ts`, `slots.ts` | `splitOrder`, `joinOrder` and `partsAddUp`; `sendPlan` and `unsendPlan`; `findSlots`. |
| `apps/api/src/routes/plans.ts` | The eight routes behind `requireRole('dispatcher')` and the depot check. The lead mounts it as `/plans`. |
| `apps/api/src/planning/rules/time.ts` | The two late codes, `trips_overlap` and `long_wait` give the time their fix names as `leaveAt`. |
| `apps/web/src/features/dispatcher/DispatcherHome.tsx`, `DepotSwitch.tsx` | The routes `/dispatcher/plan` and `/dispatcher/plan/:date` beside the placeholders, so `app/router.tsx` does not change, and the switch. |
| `apps/web/src/features/plan/` | `PlanBoardPage`, `ViewPlanPage`, `board.ts` (the queries, the save queue and the calls), `draft.ts` (each change as a function from one `DraftPlan` to the next), `words.ts`, and `parts/` (header, lists, trip panel, stop row, timeline, done list, pick a truck, driver menu, leaving-time field, find a slot, forms, vehicle row, checks). |

**Reading**, in one read-only snapshot (`snapshot` from `orders/store-orders.ts`). `GET /plans` finds the board's day
from the app clock and the operating days (rule 1), and `GET /plans/:date` is given it. Both answer `boardOf`:
1. The depot's plan row for the day, with its trips, stops and deferrals as a `DraftPlan`. No row reads as no plan.
2. A sent plan: its orders are those it names, and `check` is its `sent_check`. A draft: the day's orders (rule 2),
   each with its lines, a load from `computeLoad` and its deferrals in sent plans, a part's original's included. Any
   order the draft names that is not among them is taken out, with a stop left empty and the stops renumbered, and
   listed in `dropped`, so the checker's input holds every order the plan names and `checkPlan` cannot throw.
3. The checker's input: every shop of the depot, every vehicle with `available` (not archived, no day off) and
   `litresUsedThisWeek` (its `fuel_log` litres in the plan day's ISO week, before that day), the depot's travel rows,
   the unloading allowances, every product, and `DEFAULT_SETTINGS` with the plan's `mixBrands`.
4. `checkPlan` for a draft, then the figures and counts of rule 12.

**Every write**, in one transaction:
1. In demo mode, lock the `demo_day` row `for share` and read the clock and its `day` from it. Then lock the depot's
   row `for no key update`, which lets a reset's reseed check its foreign keys. A reset locks `demo_day` `for update`
   first, so writes and resets take the same order, and every planning write of the depot, for any day, queues here.
2. The path's day must be the board's (`no_plan_day`, `day_moved`) with its orders closed (`orders_open`).
3. With a `planId`, the depot's plan for that day must have that id (`stale`), be a draft (`plan_sent`) and have that
   revision (`stale`). Without one, no plan may exist for that day and `demoDay` must be the clock's `day` (`stale`),
   and the plan row is made, by the caller.
4. Do the work below, raise the revision, set `saved_at`, answer with `boardOf` from inside the transaction, and
   announce after the commit.

- **Save.** Refuse, before writing, what rule 3 lists, with its code. Delete the plan's trips, which takes their stops,
  and its deferrals, then insert the request's.
- **Split.** Check the order and `keep` as rule 8 says. Set the original to `split` with its revision up, insert both
  parts with their lines, and put the first part in the original's place on its stop. `partsAddUp` must hold before
  the commit. Write the audit row `order.split` and announce `orders` to the shop too.
- **Join.** Check as rule 8 says. Remove both parts' deferrals in this draft and the first from its stop, and the stop
  if left empty, delete both parts, and give the original back its status with its revision up. Write `order.joined`
  and announce `orders` to the shop too.
- **Send.** Store the draft as `boardOf` cleans it, then check it: not `ok` is `not_ready` with the blocks, a split whose
  parts do not add up is `split_mismatch`, and on the plan's day a trip leaving before the clock is `departed_already`.
  Then write rule 11: the plan `published` with `published_at` and `sent_check`, the stops' times, the orders' statuses
  with each revision up by one, and one `fuel_log` row per trip with the note "Sent plan". Audit `plan.sent`.
- **Unsend.** Step 3 wants the plan sent, not a draft (else `stale`), and a trip past `planned` is `loading_started`.
  Then undo the send as rule 11 says, audit `plan.unsent`, and announce as a send does.

**Slots.** `GET /plans/:date/slots?orderId=` reads in the snapshot. For each trip of the draft the order is not on, a
copy of the input with the order moved there as rule 4 says goes to the checker. The trip is a slot when the copy has
no block with that trip's vehicle and the order's stop has times, and otherwise it answers with the first such block.

**The screen.**
- `/dispatcher/plan` reads `GET /plans` under `['plans', 'board']` and edits that day, and once its plan is sent goes
  to `/dispatcher/plan/:date`, which reads `GET /plans/:date` under `['plans', date]` and shows View plan, so a reload
  or a clock move keeps the day. Slots are `['plans', date, 'slots', orderId]`. The board's queries are fetched again
  on the depot's `plans` and `orders` messages, and the minute timer does the rest (spec 008).
- **The save queue** is the shop form's (`features/store/draft-form.ts` on `nabil/shop-orders`). One save is in flight;
  a change made meanwhile goes into the local draft and rides the next save. A write's answer counts only if its plan
  id and `demoDay` match the board on screen and its revision is newer. A refetch waits while a change is pending,
  unless it shows another plan, day or `demoDay`: that is a reset or a new day, which drops pending changes and answers
  on their way. Every save sent without an answer is kept, and on `stale`, if the server's draft equals one of them,
  the screen carries on from it and sends the pending changes. Otherwise `stale`, `plan_sent` and `day_moved` drop the
  pending changes and load the board with the line of the failure paths. Only a request that did not reach the server
  (no answer, 5xx or 429) is retried, with the form's backoff. Another refusal stops, keeps the changes and shows its
  message with "Try again". Split, join and send wait until nothing is pending.
- The open trip is in the address, `?trip=VEH004-1`. "Undo" holds the draft from before the last stop move and saves
  it while the plan's revision is still the one that move's save made. After any other change it is gone.

**Words**, in `features/plan/words.ts`, which may use the day, time and unit formats of `features/store/words.ts`:
- "Plan for Thu 25 Jun", "03:30", "6.8 t", "33.4 m³", "1,050 kg", "250.7 L", "88%". A vehicle is "reefer" (a fridge
  truck), "dry" (a truck), "van reefer" or "van". A group row drops the brand from the shop's name, chilled first:
  "Gampaha · 53 cartons chilled, 58 dry". Style counts "boxes" and Tech "items", as the shop's cards do.
- Under a shop: "window 05:30 to 08:00 · rear dock", "van only", "mall bay 10:30 to 12:30". A carried-over order:
  "wanted Wed 24 Jun · <its last reason>" and "deferred 2×", red from two. On a stop, "deferred Wed", the weekday it
  was wanted. A part: "split · 60 of 135".
- The truck list: fridge vehicles first, then by id, and those in the workshop last with their reason. Pick a truck:
  fridge vehicles first when the orders include a chilled one and dry ones first otherwise, then by id.
- The six reasons and the sentence each starts with: `no_reefer` "No fridge truck" ("No fridge truck was left for
  Gampaha."), `over_capacity` "No room on a truck" ("The trucks for Gampaha were full."), `no_van` "No van free" ("The
  van that reaches this shop was full."), `window` "Window cannot be met" ("No truck could reach the shop before its
  window closed at 07:30."), `fuel` "Fuel quota" ("The trucks for Matara had used their fuel for the week."), and
  `dispatcher_choice` "Our choice" (empty, the dispatcher writes it).
- Icons, copied by the lead into `assets/icons/`: the design's Reefer lorry, Lorry, Van, Fresh and Route.

## Changes to other specs
Spec 009. The lead replaces the Out of scope line that ends "and the dispatcher's view of orders. A2." with: 'The new
date on a "Date changed" card, "… works for me", Shop · Deferred date accepted and "plan updated 16:10": A5 may add
them. A deferred order gets no new date; it waits for the next plan, where it comes first (spec 010). The dispatcher's
view of orders: A8.' And `placeOrders` locks its depot's row `for share` before the shop's row, so a send and a place
never interleave. The A2 API builder makes that change and its test in `apps/api/tests/store-orders.test.ts`.

## Risks
- The board is the largest screen so far. T5 lands the layout, the lists and the trip panel first, so the click-through
  can start before the forms are in.
- Every answer is the whole board, about 100 KB, and Find a slot runs the checker once per trip. Both are fine for one
  dispatcher and one process (D-01), and T4 keeps a slot search with 25 trips under a second.
- Until the planner lands, a whole day by hand means placing or deferring 104 orders. Deferring a whole group at once
  keeps the walkthrough short, and T8 writes its recipe.

## Test plan
| Criteria | Kind | Where |
| --- | --- | --- |
| AC-1 | Unit | `apps/api/src/plans/board-day.test.ts` |
| AC-17 | Unit, on spec 007's test data | `apps/api/src/planning/rules/time.test.ts` |
| AC-5, AC-7 to AC-9 | Integration | `apps/api/tests/plan-board.test.ts` |
| AC-2, AC-3, AC-6, AC-10 to AC-16, AC-18 | Integration | `apps/api/tests/plan-save.test.ts` |
| AC-19 to AC-23 | Integration | `apps/api/tests/plan-split.test.ts` |
| AC-24 | Integration | `apps/api/tests/plan-slots.test.ts` |
| AC-4, AC-25 to AC-30 | Integration | `apps/api/tests/plan-send.test.ts` |
| AC-31 to AC-43 | Click-through at 1440 × 900 and at 390 wide, two browsers for AC-40, and a read of `features/plan` for AC-43 | The lead, on the joined branch |

Integration tests run in the builder's own seeded database (AGENTS.md) and assert the seeded day's numbers. Each file
starts from the seeded day, puts it back at its end with spec 008's `clearDemoDay` and `seedDemoDay` in one
transaction, and lets the clock go. They sign in once each as `ruwan`, `nadeesha`, `ishara`, `kasun`, `dilshan` and
`admin`. Unit tests use spec 007's test data (`planning/testing/shared.ts`) and made-up orders, never the database.
