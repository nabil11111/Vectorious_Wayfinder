# 010 · Plan board

**Status:** Done, with two open points at the bottom  ·  **Owner:**  ·  **Design:** Dispatcher · Edit plan, Edit plan · empty and View plan, and the in-screen states Edit plan · blank trip, leaves 03:15, stops swapped, find a slot · Mon and · Tue, View plan · ready to send and View plan · sent.

Piece A2 of [the map](../000-map.md). The frames are exported in `tech-triathlon-ops/design/export`. Every rule a plan must
keep is the plan checker's (spec 007), and the clock, live updates and seeded day are spec 008's.

## Why
The booklet, page 11: "Your system must assign orders to vehicles and trips and handle a day when demand exceeds
available capacity. You may use automatic allocation, assisted planning, or manual decisions with validation." Page 4:
"When demand exceeds capacity, the dispatcher must decide which orders move to the next run and record the reason."
This is the manual path with validation (D-15), and the planner (B4) later fills the same board.

## What it does
Once the next day's orders close at 16:00, the dispatcher starts trips, adds shops as stops and sees the checker's
answer after every change. An order too big for its truck can be split. Every order goes on a trip or is deferred with
a reason, and View plan sends the plan. On the seeded day Ruwan plans Thu 25 Jun at Peliyagoda from Wed 24 Jun 16:00:
102 orders (98 placed for Thursday, 4 carried over), 35 working vehicles and 3 in the workshop.

## Decisions
The lead adds these to `docs/decisions.md` in T0.
- **D-28 · The board's day** is today until 03:30, when the first trucks leave (D-19), and then the first operating day
  after today. A plan can be sent, or taken back to edit, until its trucks leave.
- **D-29 · The draft is saved whole after every change,** named by the plan's id and revision, and every answer carries
  the checker's result. A depot's planning writes queue one behind the other. One save path, like the shop's draft
  (spec 009), which the planner will use too.
- **D-30 · A split keeps the shop's order and makes two new orders from it.** The original's status becomes `split`,
  each part points to it and their lines add up to it. What the shop asked for stays on record, and each part is
  planned or deferred whole (D-17).
- **D-31 · A driver is chosen per vehicle for the day, and may be left out.** It is the account that sees the vehicle's
  trips on its phone (A4). The booklet (page 4) gives every vehicle a driver and makes driver availability no constraint.
- **D-32 · A dispatcher plans their own depot only.** Every route checks that a record belongs to the caller's depot, so
  the depot switch shows the depot and changes nothing.
- **D-33 · A sent plan can be taken back to edit until loading starts** (Nabil). The booklet says printed loading lists
  go out of date when plans change (page 5) and a dispatcher's decision should reach the loader (page 7). Once a trip
  is loading, changes go through the loader's flag and the dispatcher's answer (A3) and Live day (A7).

## Screen states
"No frame" means we draw the smallest state that fits the style guide. Loading is "Loading · skeleton", on the first
load only. What the planner adds is not drawn (see "Left for the planner").

| Screen | State | Frame | What shows |
| --- | --- | --- | --- |
| Plan board `/dispatcher/plan` | Orders still open | No frame | "Plan for Thu 25 Jun" and "Orders for Thu 25 Jun close at 16:00. The board opens then." |
|  | No trip yet | Edit plan · empty | In the top bar the depot switch with Peliyagoda selected and Kandy and Both greyed, "You plan Peliyagoda" (D-32). "Plan for Thu 25 Jun", "Unplanned · 102", "Planning · 0", "Done · 0", "Orders closed 16:00 · no plan yet", the counts of rule 12, "Mix brands · off", and View plan greyed until the first change. Left: "Unplanned orders · 102" with "brand · district" and "list" (one row per order, oldest wanted first), "Carried over · 4", then a group per brand and district, most orders first, each with its shops and "Start a trip". Below: "Unassigned trucks · 35", "5 reefer trucks · 27 dry · 3 vans · 3 in the workshop", four rows and "34 more · show", the three in the workshop last with their reasons. Middle: "No trip open" and "Start a blank trip". Right: "Done · 0 trips" and "Nothing yet". |
|  | Picking a truck | Edit plan · blank trip | "New trip · Fresh · Gampaha", "17 orders · chilled and dry · windows from 03:00", "Pick a truck", and a row per vehicle that can take another trip, fridge vehicles first when there is a chilled order: "VEH004 · reefer · 6.8 t · 33.4 m³", "fuel 62% left" or "trip 2 · ready 06:18", and "Choose". "Start a blank trip" and "Swap truck" open the same list. |
|  | A trip open | Edit plan | "Planning · VEH004 · Dilshan", "reefer 6.8 t · 33.4 m³ · trip 1 of 2", chips for brand, district and "leaves 03:30", the figures, "back 05:24 · 2 stops · 63 km", "Swap truck", "Remove trip", the timeline, the trip's problems with their fixes, "Stops in order", "+ Add a stop" and "Mark trip done". The driver's name is a menu: the depot's drivers, one on another vehicle marked "on VEH002" and not choosable, and "No driver". A stop row: number, arrival, shop, entrance and window, "waits 15 · unload 15 · off 05:45", the chips "deferred Wed" and "late", and "⋮" with "Move up", "Move down" and, per order, "Take off", "Split" and "Defer". Unplanned rows show "Add". "+ Add a stop" scrolls to the trip's brand and district and outlines that group. Right: "Done · N trips", a card per other trip, "VEH004 · Dilshan · Fresh · Gampaha", "2 stops · 03:30 to 05:24" and its figures, opening to its stops. Its title opens the trip. |
|  | Leaving time set | Edit plan · leaves 03:15 | A click on "leaves 03:30" opens a field. Enter saves a time written HH:MM, from 00:00 to 23:59, and anything else stays unsaved with "Write the time as 03:15." The chip then reads "leaves 03:07" in slate, with × to go back to the usual time, and the trip's problems include the early-leaving warning. |
|  | Stops moved | Edit plan · stops swapped | A green line "Stops 3 and 4 swapped" with "Undo", and the stops at their new times. |
|  | Find a slot | Edit plan · find a slot · Tue and · Mon | "Find a slot · Fresh Ragama", "wanted Wed 24 Jun · deferred 1×", "50 cartons chilled · 345 kg · 1.85 m³ · rear dock · 03:00 to 08:00", "Tried on every trip of this plan". A green box per slot, as in the Tue frame: "VEH004 trip 1 · stop 3 · arrives 04:56" and "Put it here". Or a red box, as in the Mon frame: "No slot on Thu 25 Jun" and each trip's first block. Then "Start a trip", which opens Pick a truck and starts the trip with this order, "Keep deferred, tell the shop" and "Close". |
|  | Deferring, splitting | No frame | A small form in place. Defer: the six reasons as chips, the sentence the shop will read, "Defer". Split: a number per line with "of 50", "Split". Deferred orders are listed under "Deferred · N" at the end of the unplanned list, each with its reason and "Undo". |
|  | Saving and after | No frame | "Saving…", then "Draft saved 16:12 · not sent", or "Not saved · trying again" in the warning colour. A refusal shows its message in red with "Try again". One line says when the plan changed, was sent or moved on elsewhere, or when orders were dropped (rule 2). |
|  | Below 1024 wide, no day left, could not load | No frame | The header and counts on top, then three tabs: Unplanned, Planning and Done. "No delivery day is left to plan." A card with "Try again". |
| View plan `/dispatcher/plan/2026-06-25` | Not ready | View plan | "View plan · Thu 25 Jun", "← Back to edit", "Send plan · N checks open" greyed, the counts, the vehicles by brand and district (each row with its trips' times, stop dots, kg and m³ and its first problem, opening to its stops), and "Checks · N" with "Not ready · N blockers": each block, then each warning, with its fix and "Open in edit". The orders on no trip are one item. Below 1024 wide the checks come first. |
|  | Ready | View plan · ready to send | "Send plan to loaders and drivers" in orange, "Checks · all clear" or the warnings, "Ready", "✓ N orders on N trips" and "✓ N deferred, each with a reason the shop will read". |
|  | Sent | View plan · sent | "✓ Sent 16:14 · loaders and 1 driver" in place of the button, "Sent 16:14" over the kept checks (none for the seed's older plans), and "← Back to edit" while the board says `canUnsend`; where it cannot, the board's `lockedReason` in its place, "Loading has started, so this plan cannot go back to edit." or "Trucks for Thu 25 Jun leave from 03:30, so its plan can no longer go back to edit." (Q-19). The address keeps the day, so a reload or a clock move still shows it, and the board goes here once its plan is sent. |

## Rules
Examples use the seeded day with the clock at Wed 24 Jun 16:00. Times are depot time.

1. **The board's day (D-28).** It is today when today is an operating day and it is before 03:30, and otherwise the
   first operating day after today. Its orders close at 16:00 on the operating day before it, and until then the board
   shows only that time. Only the board's day can be changed, once its orders are closed, and any day's board can be
   read by its date. With no operating day left there is no board.

   | The clock says | The board's day |
   | --- | --- |
   | Wed 24 Jun, 15:00 | Thu 25 Jun, opens today at 16:00 |
   | Wed 24 Jun, 16:00 | Thu 25 Jun, open |
   | Thu 25 Jun, 03:29 | Thu 25 Jun, open, its plan sent or not |
   | Thu 25 Jun, 03:30 | Fri 26 Jun, opens today at 16:00. Thursday's plan can no longer be sent or taken back. |
   | Sun 21 Jun, 10:00 | Mon 22 Jun, open since Sat 16:00, as Sunday is closed |
   | Thu 30 Apr, 17:00 | Sat 2 May, open, because Fri 1 May is a holiday |
   | Sat 27 Jun, 16:00 | none, the calendar ends on Sun 28 Jun |

2. **The day's orders.** For a draft: every order of the depot's shops that is `placed` or `deferred` and was wanted for
   the plan's day or earlier. One wanted earlier is carried over and shows how many sent plans deferred it, its
   original's included when it is a part. A shop's draft is never one, and neither is a split order, whose parts count
   instead. For a sent plan: the orders on its stops and in its deferrals. An order a draft names that is no longer one
   of its day's (a later plan took it, say) is left out of the plan the checker gets, with any stop it leaves empty,
   and the answer lists it as dropped. The next save writes the cleaned draft, and reading a board never fails.
   *OUT060's chilled order was deferred twice, and OUT001's, OUT030's and OUT054's once.*
3. **The draft (D-29).** Every change saves the whole draft: its trips (vehicle, number, leaving time, driver, stops),
   its deferrals and "Mix brands". It names the plan by id and revision, or before the first save by the demo day it
   was read under (spec 008's `day`). Anything else is `stale`, so a request from before a reset never lands on the
   new day. Blocks never stop a save, only the send. Before writing anything a save refuses, with 400 `invalid_input`,
   two trips of a vehicle with one number, a stop with no order or one order twice, an order deferred twice or both on
   a stop and deferred, a vehicle whose trips name different drivers, and a deferral with a code not in the list or a
   reason empty or over 200 characters. A record not of the depot or an order not of the day is 400 `unknown_record`,
   and one driver on two vehicles 400 `driver_taken`.
4. **Trips and stops.** A vehicle runs trip 1 and trip 2 at most (D-13). An order put on a trip goes on the stop at its
   shop when the trip has one, else on a new last stop. Taking a stop's last order off removes the stop. Removing a
   trip puts its orders back as unplanned. "Swap truck" moves a trip and its stops to another vehicle as that vehicle's
   lowest free trip number, with that vehicle's driver. A trip 2 left alone on a vehicle becomes trip 1. "Undo" reverses
   the last stop move while the plan's revision is still the one that move made. "Planning" and "Done" are only how
   the screen shows trips: one trip is open at a time, and "Mark trip done" closes it.
5. **Leaving times (D-19).** A trip with no time of its own leaves when the checker says: aimed at its first shop's
   window, never before 03:30 with a Fresh stop or 07:30 without. The dispatcher can write a time or go back to the
   usual one. When a problem's fix is a leaving time, the screen offers it as one click: the earlier time that reaches
   every stop of a late trip (spec 007, AC-47), the time a second trip can leave (`trips_overlap`) and the time that
   removes a long wait (`long_wait`). The checker gives that time as data (`leaveAt`), a small change to spec 007.
   Leaving early is a warning, never a block. *VEH002 with OUT068, OUT065, OUT069, OUT066 and OUT067 leaves at 03:30
   and reaches Fresh Alawwa at 07:53, 23 minutes after it closes at 07:30. "Leave at 03:07" reaches it at 07:30, and
   the trip warns that it leaves early.*
6. **Drivers (D-31).** The list is the depot's active driver accounts. A driver is chosen for a vehicle and written on
   both its trips. A person drives one vehicle a day, and a vehicle may have none.
7. **Deferring.** A deferred order has one of spec 007's six codes and a reason of 1 to 200 characters that the shop
   reads once the plan is sent. It gets no new date: it waits for the next plan, where it comes first as carried over.
   The form offers a sentence per code, and a carried-over order starts with its last code and reason. It defers one
   order, a shop row's orders or a whole group, each with its own deferral. "Undo" puts an order back as unplanned.
8. **Splitting (D-17, D-30).** The dispatcher chooses, line by line, what goes in the first part. The split writes
   exactly two orders that point to the original, the first with those quantities and the second with the rest: a
   product at most once in a part, at least one unit in each, and product by product they add up to the original. Both
   start `placed` with the original's shop, temperature, wanted day, note, placed time and placer. The original becomes
   `split`, keeps its lines and is never planned, and its revision goes up. The first part takes its place on its stop
   and the second starts unplanned. A part or an order deferred in the draft cannot be split (409 `cannot_split`), nor
   an order on two stops (400 `invalid_input`). "Join" works while both parts are `placed` and in no other plan,
   wherever this draft has put them: once moved, the two parts are alike, so nothing needs to know which came first.
   It takes both off their stops (and a stop left empty) and out of this draft's deferrals, deletes both, and gives the
   original back `placed`, or `deferred` if a sent plan deferred it, unplanned and with its revision up. Only this plan
   changes, and the send checks again that the parts add up.
   *OUT017's 135 boxes on VEH023, keeping the 50 boxes of folded clothing and 25 cartons of shoes: a first part of 75
   boxes, 1,050 kg and 15.5 m³, and a second of 60 boxes (45 rail boxes of hanging garments and 15 cartons of bags),
   765 kg and 15.6 m³.*
9. **What the shop sees of a split.** From the split on, its Orders list shows the two parts as two cards, after
   sending "Planned · Thu 25 Jun" or "Date changed" with the reason. The original is in none of spec 009's lists, which
   hold only placed, planned, deferred, loaded, delivered and received orders, and its next order reads only the open
   day, always after a day being planned. 009's lists do not change; a `split` chip case keeps the types whole.
10. **Find a slot.** For a carried-over order on no trip, the server tries it on every trip of the draft, placed as rule
    4 says. A trip is a slot when, with the order added, the checker reports no block about that trip's vehicle, and
    the order's stop has times. Blocks about other orders on no trip do not count. The answer lists the slots with the
    stop and arrival time, and each other trip's first block. Nothing is written, "Put it here" is an ordinary change,
    and no other day is tried. *With VEH004 on OUT026 and OUT028, OUT030's order has one slot, stop 3, arriving 04:56.
    OUT060's has none.*
11. **Sending.** The send first stores the draft cleaned as rule 2 says, stops renumbered, and checks exactly that, with
    the day's orders read afresh under the depot's lock, which a shop's placing also waits on. Only a plan the checker
    finds `ok` can be sent, and on the plan's own day only while no trip's leaving time has passed (409
    `departed_already`, naming the trip). In one transaction the plan becomes `published` at the app clock's time with
    the checker's result kept (`sent_check`), each order on a stop becomes `planned` and each deferred one `deferred`,
    each stop keeps its arrival and departure, and each trip writes its litres to `fuel_log` on the plan's day (D-20),
    a vehicle's rows adding up to its litres in the plan: the first trip writes its own and the second the rest.
    *VEH010 with two 63 km trips in Gampaha shows 11.3 litres on each and needs 22.5, so its rows are 11.3 and 11.2.*
    "Back to edit" (D-33) works while the plan is sent, every trip is `planned` and the board's day is still the
    plan's (D-28). The board says so in `canUnsend`, so the link shows only then, and says why not in `lockedReason`,
    the sentence an unsend is refused with (Q-19). Under the same locks it makes the
    plan a draft again with its revision up and `sent_check` cleared, deletes its trips' fuel rows, keeps its
    deferrals in the draft, and gives each of its orders back `placed`, or `deferred` if an earlier sent plan
    deferred it. Once a trip is `loading` or later it is refused with 409 `loading_started`.
12. **The numbers.** The API works out every number shown, from the checker's result and the tables, with whole
    percentages (halves up) and sums in tenths and thousandths as the checker makes them. The screen may group, sort
    and count rows and place stops on the timeline. It never times, weighs or adds up a load, distance, litre or percent.

    | Shown | Number | From |
    | --- | --- | --- |
    | "0 / 35 trucks" | vehicles with a trip / the depot's vehicles working that day | the plan, `vehicles`, `vehicle_days_off` |
    | "0 trips" | trips in the plan | the plan |
    | "0 / 102 orders" | the day's orders on a trip / the day's orders | the plan, rule 2 |
    | "37% fuel this week" | the litres the depot's vehicles used this week and need for this plan, over their weekly quotas | the checker's vehicles |
    | "0 / 140.7 m³ fridge space" | cubic metres on trips of fridge vehicles / the cubic metres of the fridge vehicles working that day | the checker's trips, `vehicles` |
    | "kg 21% · m³ 23% · time 29%" | a trip's load over its vehicle's limits, and its vehicle's minutes of the trip's kind over 270 (Fresh) or 480 (Style and Tech) | the checker |
    | "fuel left 250.7 L", "fuel 12% left" | a vehicle's litres left, and those over its weekly quota | the checker |
    | "2 / 2 windows met", "63 km", "2 h on the road" | stops reached in time / stops, the trips' kilometres, and their hours from leaving to back | the checker |

    A figure is red when the checker blocks on it (`over_weight` for kg, `over_volume` for m³, `fuel_over_quota` for
    fuel), yellow when it warns (`over_time_budget` for time) or at 95% and over, and green otherwise.

## Permissions and failure paths
Only a dispatcher with a depot may call. Another role is refused, and so is an admin, who has no depot.
- **Another tab, a send elsewhere, the day moving on, a reset.** The write is refused (`stale`, `plan_sent`,
  `day_moved`), and the screen loads the board with one line: "The plan was changed in another tab, so it was loaded
  again.", "This plan was sent at 16:14.", "Trucks for Thu 25 Jun leave from 03:30, so its plan can no longer be
  sent." or spec 008's reset line. Unsaved changes are dropped, unless the server holds a save whose answer was lost.
- **The signal drops.** Only a request that did not reach the server is tried again, after 2, 4, 8, then every 15
  seconds, under "Not saved · trying again". Another refusal stops with its message and "Try again". Split, join and
  send wait for the save. The board refetches on the depot's `plans` and `orders` messages, keeping unsaved changes.

## Data in and out
Eight endpoints under `/api/v1`, for dispatchers only, with shapes and steps in `plan.md`: `GET /plans` (the board's
day), `GET /plans/:date`, `PUT /plans/:date/draft`, `POST /plans/:date/split`, `/join`, `/send` and `/unsend`, and
`GET /plans/:date/slots?orderId=`. They read the plan tables, the orders and the reference tables, `fuel_log`,
`vehicle_days_off` and `users`, and write the plan tables, `orders` and `order_lines`, `fuel_log` and `audit_log`.
After each change commits, `plans` is announced to the depot (D-21). A split or a join also announces `orders` to its
shop, and a send or unsend `orders` to the depot and to each shop with an order in the plan. What loaders, drivers and
shops then show is A3 to A5's business.

## Acceptance criteria
API criteria are integration tests on the seeded day of a fresh database, clock set, each file ending with spec 008's
reset; *unit* ones use made-up data. Screens get a click-through at 1440 × 900 as `ruwan` from Wed 24 Jun 16:00.

### The board's day
- [ ] **AC-1** *Unit.* When the board's day is worked out, the system shall give the day of each row of rule 1's table.
- [ ] **AC-2** When a change arrives before the day's orders close, the system shall answer 409 `orders_open` with the
  time they close. When no day is left, the GET shall return no day and a change shall get 409 `no_plan_day`.
- [ ] **AC-3** When a change names a day that is not the board's, the system shall answer 409 `day_moved` and change
  nothing. *Thursday's send at Thu 25 Jun 03:30, with the failure paths' message.*
- [ ] **AC-4** When a date is asked for, the system shall return that day's board, draft or sent, whatever the board's
  day is. *Thursday, sent, read at Thu 25 Jun 08:30 with its kept check, and the seed's Wed 24 Jun plan with none.*

### Who may call
- [ ] **AC-5** When a request has no session, the system shall answer 401 `signed_out` on every endpoint, to a store
  manager, loader or driver 403 `forbidden`, and to an admin 403 `no_depot`.
- [ ] **AC-6** When a request names a vehicle, shop or driver of another depot, or an order that is not one of the
  day's, the system shall answer 400 `unknown_record` with that id. *Kandy's VEH039, OUT084 and `prasanna`.*

### Reading the board
- [ ] **AC-7** When `ruwan` reads the board at Wed 24 Jun 16:00, the system shall return Thu 25 Jun, open, no plan yet,
  102 orders, the counts 0 of 35 vehicles, 0 trips, 0 of 102 orders, 37% fuel and 0 of 140.7 m³ fridge space, and a
  check whose problems are 102 `order_not_planned` blocks. It shall write nothing.
- [ ] **AC-8** When the board lists the day's orders, the carried-over ones shall be OUT060's (wanted Tue 23 Jun,
  deferred twice, last "No fridge truck was left for Matara. Two were in the workshop.") and OUT001's, OUT030's and
  OUT054's (wanted Wed 24 Jun, once), and Nadeesha's draft shall not be one. *Placed, it adds two: 104.*
- [ ] **AC-9** When the board lists the vehicles, it shall hold Peliyagoda's 38, with VEH003, VEH005 and VEH036 not
  working and their workshop reasons, and each one's fuel left from the checker. *VEH001 has 12% left.*
- [ ] **AC-10** When a draft names an order that is no longer one of its day's, the read shall leave it out, list it as
  dropped and not fail, and a send shall store and check the cleaned draft. *A test sets such an order to `planned`.*

### Saving the draft
- [ ] **AC-11** When a draft is saved, the system shall replace the stored one, raise the revision by one, record the
  app clock's time and answer as the GET does. *VEH004 trip 1 with the four orders of OUT026 and OUT028: stops at 04:07
  and 04:31, back 05:24, 63 km, 14.3 litres, kg 21%, m³ 23% and time 29%. Counts: 1 of 35 vehicles, 1 trip, 4 of 102
  orders, 37% and 7.77 of 140.7 m³.*
- [ ] **AC-12** When a draft the checker blocks is saved, the system shall save it and answer with the blocks. *VEH023
  trip 1 with OUT016, OUT017, OUT018 and OUT019: `over_volume`, "VEH023 trip 1 carries 53.1 m³ and its limit is
  38 m³." with the fix "Take 15.1 m³ off this trip.", and m³ 140%.*
- [ ] **AC-13** When the first save of a day arrives, the system shall make the plan. When two arrive at once, it shall
  save one and refuse the other with 409 `stale`, never a database error, as it does a first save read before a reset.
- [ ] **AC-14** When a change names a plan id or revision that is not the plan's, the system shall answer 409 `stale`,
  and for a sent plan 409 `plan_sent`, and change nothing.
- [ ] **AC-15** When a save holds an input rule 3 refuses, the system shall answer its 400 and write nothing. *One test
  per case, and `dilshan` on VEH004 and VEH002 for `driver_taken`.*
- [ ] **AC-16** When a change is saved, the system shall announce `plans` to the depot after the commit, and a save
  shall tell no shop. When a planning write and a demo reset arrive at once, both shall finish, and the write shall be
  refused as `stale` if the reset committed first.

### Leaving times
- [ ] **AC-17** *Unit.* When a problem's fix is a leaving time, the checker shall also give it as `leaveAt`, in minutes.
  *VEH002 with OUT068, OUT065, OUT069, OUT066 and OUT067, with the seeded day's quantities, reaches Fresh Alawwa at
  07:53 with the fix "Leave by 03:07 to reach every stop in time." and `leaveAt` 187. Spec 007's chained day with trip
  2 set to 05:30 gives 378, and OUT008 first at 03:30 gives 276.*
- [ ] **AC-18** When a trip is saved with a leaving time, the checker shall time it from then, and without one from the
  usual time. *That Kurunegala trip at 03:07 reaches Fresh Alawwa at 07:30 with no block, and warns `leaves_early`
  and `over_time_budget` (278 minutes of 270).*

### Splitting
- [ ] **AC-19** When an order on a stop is split, the system shall write the parts and the original as rule 8 says,
  put the first part on the stop, and answer with the board. *OUT017 on VEH023 as in rule 8: the trip carries
  37.5 m³, m³ 99% and no block, and the second part is on no trip: "The 765 kg dry order for Style Liberty Plaza is
  on no trip and is not deferred."*
- [ ] **AC-20** When a split breaks rule 8 (a part, an order deferred in the draft or on two stops, a product the order
  lacks, a product twice, a quantity past the line's, or an empty part), the system shall refuse it and change nothing.
- [ ] **AC-21** When a split order is joined as rule 8 allows, the system shall delete the parts, change only this plan
  and give the original back its status, unplanned. Otherwise it shall answer 409 `cannot_join`.
- [ ] **AC-22** When a split order's parts do not add up to it, the send shall answer 409 `split_mismatch` and change
  nothing. *A test changes a part's line in the database.*
- [ ] **AC-23** When the shop lists its orders, the system shall return the parts and not the original. *`ishara` at
  OUT017: open orders of 75 and 60 boxes, and after sending with the second deferred, one `planned` and one `deferred`
  with its reason.*

### Find a slot
- [ ] **AC-24** When a slot is asked for, the system shall try the order on every trip, answer the slots and each
  other trip's first block, and write nothing. *With VEH004 on OUT026 and OUT028: OUT030's order has one slot, VEH004
  trip 1, stop 3, a new stop, arriving 04:56. OUT060's has none, and VEH004 trip 1 answers `cross_district`: "VEH004
  trip 1 has stops in 2 districts, Gampaha and Matara, and a trip stays inside one district."*

### Sending
- [ ] **AC-25** When a plan with a block is sent, the system shall answer 409 `not_ready` with the blocks and change
  nothing. *A shop's place holding the depot's lock makes the send wait, and its order then shows as not planned.*
  When a trip has already left at a send on its day, 409 `departed_already` naming it. *The Kurunegala trip at 03:07,
  sent at Thu 25 Jun 03:29.*
- [ ] **AC-26** When a plan with no block is sent, the system shall write what rule 11 says, raise the revision, write
  the audit row `plan.sent`, and after the commit announce `plans` and `orders` to the depot and `orders` to each shop
  with an order in the plan.
- [ ] **AC-27** When a trip is sent, the system shall write its litres to `fuel_log` on the plan's day, and a vehicle's
  rows shall add up to its litres in the plan. *VEH004 with OUT026, OUT028 and OUT030 writes 15.9. VEH010 with OUT027
  and OUT034, then OUT025 and OUT029, writes 11.3 and 11.2.*
- [ ] **AC-28** When a plan is sent twice, or by two requests at once, the system shall send it once and answer the
  other with 409 `plan_sent` or `stale`.
- [ ] **AC-29** When a sent plan is read, the system shall return its kept check, and the next day's board shall count
  its litres as used. *After Thursday goes out with VEH004's trip to OUT026, OUT028 and OUT030, Friday's check gives
  VEH004 180.9 litres used.*
- [ ] **AC-30** When a sent plan is taken back to edit while every trip is `planned`, the system shall undo the send as
  rule 11 says and announce `plans` and `orders`, and a new send shall send it again. When a trip is `loading`, it
  shall answer 409 `loading_started` and change nothing. *A test sets a trip to `loading` in the database.*

### The screens
- [ ] **AC-31** Edit plan · empty. Its row of the screen states table, with OUT060 first under "Carried over · 4" and
  "deferred 2×" in red, "Fresh · Colombo · 22" as the first group, and VEH003, VEH005 and VEH036 last among the
  trucks with their workshop reasons.
- [ ] **AC-32** Blank trip and building. "Start a trip" on Fresh · Gampaha shows its line and "Pick a truck". Choosing
  VEH004 opens the trip, and "Add" on Fresh Gampaha and Fresh Kandana gives the stops, figures, timeline and counts of
  AC-11 and "Draft saved" with the time.
- [ ] **AC-33** The driver. Choosing Dilshan for VEH004 shows him on both its trips after a reload, VEH002's menu shows
  him as "on VEH004", and "No driver" takes him off.
- [ ] **AC-34** The leaving time. On VEH002's Kurunegala trip, "03:07" and Enter sets the chip and Fresh Alawwa turns on
  time, "3.07" is not saved and shows its line, × goes back to 03:30, and "Leave at 03:07" on the late stop does the
  same in one click.
- [ ] **AC-35** Stops swapped. "Move down" on stop 3 swaps it with stop 4 and shows the green line, and "Undo" puts them
  back. After another change "Undo" is gone.
- [ ] **AC-36** Find a slot. On OUT030's order it shows the slot of AC-24, and "Put it here" makes it stop 3. On
  OUT060's it shows the red box, and "Keep deferred, tell the shop" opens the form with its last code and reason.
- [ ] **AC-37** Split, join, defer. The split of AC-19 from the stop's menu, "Join" on a part, and "Defer" on a shop
  row and on a group, listed under "Deferred · N" with "Undo".
- [ ] **AC-38** View plan. With blocks: the greyed send, "Not ready", each block with "Open in edit", which opens its
  trip, and the orders on no trip as one item. With none: the orange send, then the sent state with the time and the
  number of drivers, which a reload keeps, and "Back to edit" returns it to the board as a draft.
- [ ] **AC-39** The save queue. With the network slowed, quick changes go out one save at a time with the latest draft,
  no older answer replaces a newer board, and after a refusal as stale the unsaved changes are gone.
- [ ] **AC-40** Two tabs. A change in one shows in the other within a second. A change from the stale tab is refused and
  it reloads with its line. A send in one turns the other to the sent view.
- [ ] **AC-41** At 390 wide the board shows the counts and the tabs Unplanned, Planning and Done, and a trip can be
  built there. The other states show: before 16:00, loading, could not load, not saved with the API stopped, a
  refusal with "Try again", and no day left.
- [ ] **AC-42** Nothing from the planner shows: none of the items in "Left for the planner".
- [ ] **AC-43** No sums in the screen. A reviewer reads `features/plan` and finds no time, load, distance, litre,
  percentage or header count of rule 12 worked out there.

## Left for the planner (B4)
Spec 014 has since built "Build the suggested plan" and Edit plan · building, a "why?" that gives the planner's reason
(D-55), and on View plan "Suggested plan · 16:05" with the planner's decisions in the Suggestions card's place (D-54).
The rest of this list stays out, AC-42 covers only that rest, and the README lists it under the departures. The list as
this spec left it: "Build the suggested plan" and Edit plan ·
building; the "suggested …" lines, "came in after the suggestion" and "cannot be met from wave 1"; the "Planner: …
Add it · Skip" row; "Back to the suggestion", "Changes · 2" and the "why?" chips; "on would save 2 trips, 140 km"; "2
fit Fresh · Kalutara" and "fits all 12 · back 08:10"; the "Swap stops 5 and 6" advice; Find a slot's day tabs, "Try Tue
29" and "Plan first on VEH019"; and on View plan "Suggested plan · 16:05", Suggestions, "send ahead?", "swap to VEH001"
and "Apply all 3 fixes". B4's planner produces a `DraftPlan` that the board saves, checks and sends like a typed one
(D-29), adds `suggestion` to `PlanBoard` (when built, the `DraftPlan`, a hint per group, each change with its reason)
and may add `DEFERRAL_CODES`. Its parts go on a group row's second line, under a trip's stops, in the header and above
View plan's Checks.

## Out of scope
- Everything in "Left for the planner". Changing a plan once a trip is loading, the loader's flag and the dispatcher's
  answer (A3), and Live day and the dashboard (A7). Orders, History and Fleet (A8) keep their placeholders.
- What loaders, drivers and shops show of a sent plan, beyond what this piece writes and announces (A3 to A5).
- Kandy's board on screen, since Kandy has no dispatcher account. The API serves any depot's dispatcher.
- Drag and drop, a printed run sheet, and more than one trip open at a time.

## Departures from the design
1. Orders are named by shop, amount and wanted day. The design's order numbers (WF-2402) do not exist here.
2. The depot switch shows the dispatcher's depot and greys the others (D-32).
3. The driver is picked from the depot's driver accounts, and a vehicle may have none (D-31).
4. Moving stops shows no "12 km shorter" and no "35 min earlier", and a late stop's chip says "late" where the design
   says "5 min late". The checker's kilometres depend only on the number of stops, the screen works out no difference,
   and the minutes are in the checker's sentence under the timeline.
5. A stop's menu adds "Take off", "Split" and "Defer" for each order, a trip adds "Remove trip", and unplanned rows add
   "Add" while a trip is open.
6. A deferred order gets no new date, so the shop's "Tuesday works for me" is not built. A5 may add it.
7. Below 1024 wide the board's three columns become three tabs.
8. States the design lacks: orders still open, no day left, deferring, splitting, saving, not saved and refused.
9. View plan says "h on the road" where the design says "h driving", because the figure includes unloading.

## Open points
1. **A driver account per vehicle?** The design names a driver on every truck, and the seed has one at Peliyagoda. The
   lead's pick, with Nabil: T0 seeds one per working Peliyagoda vehicle, local names on the demo password. The rules
   keep the driver optional, so a no changes only the seed. The walkthrough puts `dilshan` on VEH035 either way.
2. **May the shop see a split before the plan is sent?** The parts are real orders at once, so the shop's list changes
   while the dispatcher is still planning. Our pick: yes. Hiding them until sending needs another order state.
