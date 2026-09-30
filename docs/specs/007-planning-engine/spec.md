# 007 · Planning engine: load, timeline and rule checker

**Status:** Ready  ·  **Owner:**  ·  **Design:** no screens of its own. Its numbers and checks show on Dispatcher · Edit plan and View plan, Shop · New orders (summary) and Loader · Load a truck.

Pieces B1, B2 and B3 of [the map](../000-map.md). This spec replaces 001 and 002.

## Why
The booklet says plans "must account for capacity, temperature requirements, outlet access, delivery windows,
and fuel quotas", and that the system must name the orders it defers. We keep all of that in one place. The
plan board, the suggested plan and the final send all call the same checker, so a rule is written once and no
screen works a number out by itself.

## What it does
Three pieces of plain logic in `apps/api/src/planning`. Plain data goes in and plain data comes out. They
never touch the database, the clock or the network, so every rule is tested in milliseconds.

1. **Load calculator.** The kilos, cubic metres and handling needs of an order, or of a whole trip.
2. **Trip timeline and fuel.** When a vehicle leaves, reaches each shop, waits, unloads, gets back to the depot
   and can leave again, and the kilometres and litres that costs.
3. **Rule checker.** Takes the day's orders and a plan. Returns whether the plan may be sent, every problem in
   plain words, and the timeline, loads and fuel it worked out.

A problem is a **block** or a **warning**. A block is a rule that must hold, most of them the booklet's
operating constraints, and a plan with a block cannot be sent. A warning is one of our own defaults (D-09,
D-19). The dispatcher sees it and can still send.

## Screen states
None. This spec has no screens.

## Rules, with worked examples

Every number below comes from `data/shared` and the product list. The acceptance criteria further down list
every rule once, each with its own example.

### Load
An order's load is quantity times the product's figures in `docs/product-list.md`. We add everything up first
and round once at the end, kilos to 1 decimal and cubic metres to 3. A trip's load is worked out the same way
from every line of every order on it, so rounding never piles up.

- 40 chilled cartons: 40 × 6.9 = 276.0 kg and 40 × 0.037 = 1.48 m³. Needs a fridge vehicle.
- 20 rail boxes of hanging garments and 15 boxes of folded clothing: 280 + 180 = 460.0 kg and 6 + 3 = 9.0 m³.
  Keep upright.
- 2 crates of washing machines and 1 pallet of televisions: 420 + 170 = 590.0 kg and 1.4 + 0.6 = 2.0 m³.
  Needs a tail lift.

### Timeline
Times are minutes after midnight on the plan date, in depot time, so 03:30 is 210. A trip runs like this:

1. **Leave.** At the time the plan gives. If it gives none, the vehicle leaves so that it reaches the first
   shop as its window opens, but not before 03:30 when the trip has a Fresh stop and not before 07:30 when it
   has none (D-19), and not before it is back and reloaded from its first trip.
2. **Drive out.** The district's `depot_to_district_freeflow_min`, once.
3. **At each stop.** Arrive. If the window is not open yet, wait. Unload for the `service_allowance` of the
   shop's brand and dock type. Drive `inter_stop_freeflow_min` to the next stop.
4. **Drive back.** The data has no figure for it, so we use the drive out again.
5. **Reload.** 30 minutes (D-08, a setting). After that the vehicle can leave on its second trip.

Colombo is 24 minutes from Peliyagoda and Galle is 103, so the leaving time works out like this:

| First stop | Window opens | Leaves | Arrives |
| --- | --- | --- | --- |
| OUT005, Fresh, Colombo | 04:00 | 03:36 | 04:00 |
| OUT006, Fresh, Colombo | 03:00 | 03:30 | 03:54 |
| OUT057, Style, Galle | 09:00 | 07:30 | 09:13 |

**The booklet's trip minutes** are drive out + between stops × (stops - 1) + unloading, with no waiting and no
drive back. Its own example, Fresh to Gampaha with two rear docks and one street stop, is
37 + 9 × 2 + 15 + 15 + 16 = **101**. The booklet counts per order, because in Task 2B every order is its own
stop. We count per stop, which is the same number whenever a stop carries one order. We report these minutes
and hold them against the two budgets: 270 a day for a vehicle's Fresh trips, 480 for its Style and Tech trips.

**A chained day.** Dry truck VEH012 runs the booklet's two example trips one after the other.

| Step | Time |
| --- | --- |
| Trip 1 leaves for Gampaha | 03:30 |
| OUT026, rear dock | 04:07 to 04:22 |
| OUT030, rear dock | 04:31 to 04:46 |
| OUT028, street | 04:55 to 05:11 |
| Back at the depot, 37 minutes later | 05:48 |
| Reloaded, 30 minutes later | 06:18 |
| Trip 2 leaves for Colombo | 06:18 |
| OUT006, OUT004, OUT007 and OUT014, all street | reached at 06:42, 07:06, 07:30 and 07:54 |
| Last shop done | 08:10 |
| Back at the depot | 08:34 |

The trip minutes are 101 and 24 + 8 × 3 + 16 × 4 = 112, so 213 of the 270 Fresh minutes. Every one of these
shops closes at 08:00 and is reached before that, so the day is allowed.

Now swap the last stop for OUT010, which closes at 07:30. The budget still passes, with 212 of 270. The
timeline says OUT010 is reached at 07:54, 24 minutes after it closed, so the plan is blocked. Put OUT010 first
and it is reached at 06:42. This is why windows are checked on the real timeline (D-08) and the budget is only
a warning.

### Windows and mall slots
A shop takes goods only inside its delivery window. A vehicle that is early waits. A vehicle that arrives after
closing time is late, and one that arrives exactly at closing time is on time. We judge by the arrival, as the
booklet does ("Lateness refers to arrival after the window closes"), so unloading may run past closing time.

In `outlets.csv` all 12 mall shops have `parking_constraint = mall_dock`, `dock_type = mall_bay`, and a
`mall_window` that is the same as their delivery window. OUT017 has 10:30 to 12:30 in both. We still take the
later opening and the earlier closing of the two, so an edit to one of them can never let a truck in outside
the mall's hours.

Style in Colombo, with OUT015 (mall, 09:00 to 11:00), OUT017 (mall, 10:30 to 12:30) and then OUT019: the truck
leaves at 08:36, is at OUT015 from 09:00 to 09:59, reaches OUT017 at 10:07, waits 23 minutes, unloads until
11:29 and reaches OUT019 at 11:37. Swap the two malls and OUT015 is reached at 11:37, 37 minutes after its
slot closed.

### Fuel
A trip's kilometres are the drive out twice, for out and back, plus `inter_stop_km` × (stops - 1). Litres are
kilometres ÷ the vehicle's `km_per_l`, to 1 decimal. A vehicle's week is what it has used from Monday up to
the day before the plan (D-20) plus this plan's trips, and that must not pass its `weekly_fuel_quota_l`.

Five Fresh stops in Galle on fridge truck VEH006 (4.4 km per litre, 380 litres a week):
120 + 10 × 4 + 120 = 280 km, which is 63.6 litres. With 300 litres used this week it ends on 363.6 and has
16.4 left. With 330 used it would end on 393.6, which is 13.6 over, and the plan is blocked.

On the chained day VEH012 (6.8 km per litre) drives 70 km for 10.3 litres on trip 1 and 36 km for 5.3 litres
on trip 2.

## Permissions
None here. The endpoints that call the engine check the role (A2).

## Failure paths
- **A plan that names something unknown.** A vehicle, shop, order or product that is not in the input is a
  programming mistake, not a plan problem. The engine throws an error that names it.
- **A trip that cannot be timed.** A trip with no stops, with stops in two districts, or with a stop its depot
  has no travel figures for has no timeline. The checker reports the block, leaves that trip's times empty and
  skips the rules that need them.
- **Bad numbers.** Times are whole minutes from 0 and quantities are whole numbers above 0. The shapes in
  `packages/contracts` refuse anything else before the engine is called.

## Data in and out
No endpoints and no tables. Everything is passed in.

**In.** The depot and whether the plan date is an operating day. The settings. The products. The day's
orders, which are the placed orders for that date plus the ones carried over, each with its shop and lines.
The shops, with brand, district, depot, dock type, parking rule, window and mall slot. The vehicles, with
type, fridge or dry, limits, km per litre, weekly quota, depot, whether they are available that day and the
litres they have used this week. The travel and unloading figures. The plan: trips (vehicle, trip number, an
optional leaving time, stops in order with their orders) and deferrals (order, code, reason).

**Out.** `ok`, the list of problems, one entry per trip with its load, times, kilometres and litres, and one
entry per vehicle with its minutes against each budget and its litres before, in this plan and left.

The shapes that cross the wire live in `packages/contracts`: `Problem`, `PlanCheck` and the two code lists.
They are in `plan.md`. `available` comes from the table `vehicle_days_off` and the litres used this week from
`fuel_log`. Both tables belong to spec 008. Reading them and calling the engine is A2's job.

## Acceptance criteria

### Load calculator (B1)
- [ ] **AC-1** When given order lines, the system shall return kilos, cubic metres and units as the sums of
  quantity times each product's per-unit figures, rounded once at the end, kilos to 1 decimal and cubic metres
  to 3. *48 dry cartons are 331.2 kg and 1.776 m³. Plain JavaScript would say 331.20000000000005.*
- [ ] **AC-2** When any line's product is chilled, the system shall set `needsReefer`. Otherwise it is false.
- [ ] **AC-3** When any line's product needs a tail lift or must stay upright, the system shall set
  `needsTailLift` or `keepUpright`.
- [ ] **AC-4** When there are no lines, the system shall return zeros and every flag false.
- [ ] **AC-5** When a line names a product that is not in the list, or a quantity that is not a whole number
  above 0, the system shall throw an error that names the product and the quantity.

### Trip timeline and fuel (B2)
- [ ] **AC-6** When a trip has no leaving time, the system shall set it so the vehicle reaches the first stop
  as its window opens, but not before 03:30 for a trip with a Fresh stop or 07:30 for a trip with none.
  *The three rows of the leaving-time table.*
- [ ] **AC-7** When a trip has a leaving time, the system shall use it unchanged.
- [ ] **AC-8** When timing a stop, the system shall set its arrival to the leaving time before it plus the
  drive: the district's depot-to-district minutes for the first stop, its between-stops minutes after that.
- [ ] **AC-9** When a vehicle arrives before the window opens, the system shall record the minutes it waits
  and start unloading when the window opens. Otherwise unloading starts on arrival. *OUT017 on the Style trip
  above: arrives 10:07, waits 23, starts 10:30.*
- [ ] **AC-10** When unloading, the system shall take the allowance for the shop's brand and dock type, and
  the vehicle leaves that stop when it ends. *Style at a mall bay is 59 minutes, so 10:30 to 11:29.*
- [ ] **AC-11** When a shop has a mall slot, the system shall use the later of its two opening times and the
  earlier of its two closing times as its window. *A shop with a window of 09:00 to 17:00 and a slot of 10:30
  to 12:30 is treated as 10:30 to 12:30.*
- [ ] **AC-12** When a trip is timed, the system shall give when the last stop is done, when the vehicle is
  back at the depot (that time plus the depot-to-district minutes) and when it is ready again (back plus the
  reload minutes). *Trip 1 of the chained day: 05:11, 05:48, 06:18.*
- [ ] **AC-13** When a trip is timed, the system shall give the booklet's trip minutes: depot-to-district
  minutes + between-stops minutes × (stops - 1) + every stop's allowance, with no waiting and no drive back.
  *The Gampaha trip is 101.*
- [ ] **AC-14** When a vehicle has two trips, the system shall time them in trip-number order, and a second
  trip with no leaving time shall not leave before the first is ready again. *06:18 on the chained day.*
- [ ] **AC-15** When a trip is timed, the system shall give its kilometres as depot-to-district km × 2 +
  between-stops km × (stops - 1), and its litres as kilometres ÷ the vehicle's km per litre, to 1 decimal.
  *280 km and 63.6 litres for the Galle trip on VEH006.*
- [ ] **AC-16** When a vehicle's day is summed, the system shall give its litres used before this plan, the
  litres in this plan and the litres left, which is the quota minus both. *300 + 63.6 leaves 16.4 of 380.*

### Rule checker (B3): what each vehicle carries
- [ ] **AC-17** When a trip's load is heavier than the vehicle's weight limit, the system shall report
  `over_weight` (block) and say how many kilos to take off. A load exactly at the limit is allowed. *Three
  chilled orders of 60 cartons on van VEH035: 1,242.0 kg against 1,040 kg, 202 kg over, while their 6.66 m³
  fits in its 7.0 m³.*
- [ ] **AC-18** When a trip's load is bigger than the vehicle's volume limit, the system shall report
  `over_volume` (block) and say how many cubic metres to take off. *80 rail boxes of hanging garments on
  VEH008: 24.0 m³ against 22.0 m³, while the 1,120.0 kg is well inside its 3,800 kg.*
- [ ] **AC-19** When an order with chilled goods is on a vehicle that is not a fridge vehicle, the system
  shall report `needs_reefer` (block). A fridge vehicle carrying dry goods is fine. *A chilled order on dry
  truck VEH012 is refused. The same order next to a dry one on fridge truck VEH003 is allowed.*
- [ ] **AC-20** When a stop at a `van_only` shop is on a truck, the system shall report `van_only` (block).
  *OUT001 on truck VEH008 is refused. On van VEH035 it is allowed.*
- [ ] **AC-21** When a trip's vehicle belongs to another depot than the plan, or a stop's shop belongs to
  another depot than the vehicle, the system shall report `wrong_depot` (block). *OUT084 belongs to Kandy, so
  it is refused on Peliyagoda's VEH008.*
- [ ] **AC-22** When an order with a tail-lift item is on a van, the system shall report `no_tail_lift`
  (warning, D-24). *Two crates of washing machines, 420.0 kg, for OUT093 on van VEH059.*
- [ ] **AC-23** When a trip has shops of more than one brand and the "mix brands" setting is off, the system
  shall report `mixed_brands` (warning). With the setting on it reports nothing. *OUT019 (Style) and OUT024
  (Tech), both in Colombo, on one trip.*

### Rule checker (B3): every order accounted for
- [ ] **AC-24** When one of the day's orders is on no stop and has no deferral, the system shall report
  `order_not_planned` (block).
- [ ] **AC-25** When an order is on two stops, on a stop and also deferred, or deferred twice, the system
  shall report `order_twice` (block).
- [ ] **AC-26** When a deferral has a code that is not in the list, or an empty reason, the system shall
  report `deferral_incomplete` (block).
- [ ] **AC-27** When an order sits on a stop at a different shop than its own, the system shall report
  `order_wrong_outlet` (block). *An order for OUT004 on the stop at OUT006.*
- [ ] **AC-28** When a trip has no stops, or a stop has no orders, the system shall report `empty_trip`
  (block).
- [ ] **AC-48** When one trip has two stops at the same shop, the system shall report `stop_repeated` (block).
  A shop's orders for a trip go on one stop, so the drive between stops is never counted for a shop the
  vehicle is already at.

### Rule checker (B3): time, fuel and the day
- [ ] **AC-29** When a trip's stops are in more than one district, the system shall report `cross_district`
  (block, D-23) and give that trip no times. *OUT026 (Gampaha) and OUT006 (Colombo) on one
  trip.*
- [ ] **AC-30** When a vehicle has more than two trips, or two trips with the same number, the system shall
  report `too_many_trips` (block).
- [ ] **AC-31** When a vehicle's second trip leaves before its first is ready again, the system shall report
  `trips_overlap` (block) and give the earliest time it can leave. *On the chained day, set trip 2 to leave at
  05:30. VEH012 is not ready until 06:18.*
- [ ] **AC-32** When a vehicle arrives at a shop after its window has closed, the system shall report
  `window_missed` (block) with the minutes it is late. Arriving exactly at closing time is allowed. *OUT010
  closes at 07:30 and is reached at 07:54, 24 minutes late. Four Fresh stops in Badulla (OUT110, OUT112,
  OUT111, OUT113) that leave at 03:00 reach the last one at 08:00 exactly, which is on time. Leaving at 03:30
  they reach it at 08:30, 30 minutes late.*
- [ ] **AC-33** When a vehicle arrives at a mall shop after its slot has closed, the system shall report
  `mall_slot_missed` (block) in place of `window_missed`, and the message names the mall's hours. *OUT015's
  slot closes at 11:00 and it is reached at 11:37.*
- [ ] **AC-34** When a vehicle's litres used this week plus this plan's litres pass its weekly quota, the
  system shall report `fuel_over_quota` (block) with the litres it is over. Ending exactly on the quota is
  allowed. *VEH006 with 330 litres used and the 63.6 litre Galle trip: 13.6 over its 380.*
- [ ] **AC-35** When the plan date is not an operating day, the system shall report `not_operating_day`
  (block). *Sun 28 Jun 2026 and Fri 1 May 2026, closed for Vesak, are refused. Sat 30 May 2026 is a holiday in
  the calendar and still an operating day, so it is allowed.*
- [ ] **AC-36** When a trip is on a vehicle that is not available that day, the system shall report
  `vehicle_off` (block).
- [ ] **AC-37** When the booklet's trip minutes of a vehicle's Fresh trips add up to more than 270, or those
  of its Style and Tech trips to more than 480, the system shall report `over_time_budget` (warning). A trip
  with a Fresh stop counts as a Fresh trip. *Three Fresh stops in Badulla (OUT110, OUT112, OUT111):
  186 + 23 × 2 + 15 × 3 = 277. They are reached at 06:36, 07:14 and 07:52, all inside their windows, so the
  plan is allowed with a warning.*
- [ ] **AC-38** When a trip is set to leave before 03:30 with a Fresh stop, or before 07:30 without one, the
  system shall report `leaves_early` (warning). *The four-stop Badulla trip that leaves at 03:00.*
- [ ] **AC-39** When a vehicle waits more than 30 minutes at a shop, the system shall report `long_wait`
  (warning). When the wait is at the first stop, it also gives the leaving time that removes it. *A Colombo
  trip set to leave at 03:30 whose first stop OUT008 opens at 05:00: it arrives at 03:54 and waits 66 minutes.
  Leaving at 04:36 removes the wait.*
- [ ] **AC-47** When a stop is reached after closing time and an earlier leaving time would reach every stop
  of that trip in time, the `window_missed` or `mall_slot_missed` problem shall carry a fix that names the
  latest such time (D-19). The time is never before the vehicle is ready from its earlier trip. When no
  earlier time helps, there is no fix. *The four-stop Badulla trip left to its default leaves at 03:30 and is
  30 minutes late at OUT113. The fix says to leave at 03:00. A Colombo trip OUT008, OUT012, OUT004, OUT007,
  OUT014, OUT011, OUT013, OUT010 leaves at 04:36 and reaches OUT010 at 07:51, 21 minutes late. Leaving earlier
  only means waiting at OUT008 until it opens at 05:00, so there is no fix.*

### Rule checker (B3): the result
- [ ] **AC-40** When no problem is a block, the system shall return `ok` as true. Warnings never stop a plan.
- [ ] **AC-41** When it reports a problem, the system shall give its code, its level, one plain sentence with
  the numbers in it, and the vehicle, trip, stop, shop or order it is about.
- [ ] **AC-42** When it returns, the system shall include every trip's load, times, kilometres and litres and
  every vehicle's budget minutes and litres, so screens show these numbers and never work them out again. A
  trip that cannot be timed has empty times, and the rules that need times skip it.
- [ ] **AC-43** When it lists problems, the system shall put blocks before warnings, and inside each group
  order them by vehicle, trip and stop, with problems about the whole plan last.
- [ ] **AC-44** When given the chained day above with one order of 48 dry cartons at each of its seven stops,
  the system shall return `ok` with no problems, the times in that table, loads of 993.6 kg and 1,324.8 kg,
  and 15.6 litres for VEH012.
- [ ] **AC-45** When the plan names a vehicle, shop or order that is not in the input, the system shall throw
  an error that names it.
- [ ] **AC-46** When called twice with the same input, the system shall return the same result and leave the
  input unchanged. No engine file imports anything from outside `apps/api/src/planning` except
  `@wayfinder/contracts`, so it cannot reach the database, the config or the clock.

## Out of scope
- Building a plan. That is the suggested plan, B4.
- Dividing an order into two parts (D-17). That belongs to B4 and A2. To the checker each part is an order.
- Reading orders, vehicles and plans from the database, saving a plan and the endpoints. That is A2.
- Traffic, monsoon and unloading that grows with the size of the order. The engine uses the supplied clear-road
  figures only. The idea of using the Datathon's predictions is parked in `docs/ideas.md`.
- A screen to change the settings, such as the reload minutes. The engine takes them as input and ships with
  the defaults.
- The 4 PM cut-off. That belongs to placing an order, A1.

## What comes next
B4, the suggested plan, builds a plan and hands it to this checker, so it can never suggest something the
dispatcher could not send. Its own criteria are written before it is built. It must follow:

- **D-08** one real timeline per vehicle, with a 30 minute reload.
- **D-09** one brand per trip and the time budgets are defaults, not hard rules.
- **D-23** a trip stays inside one district.
- **D-10** a shop that waited last time is protected.
- **D-11** a late stop is never skipped automatically.
- **D-17** an order that does not fit is split, and the rest waits with a reason.
- **D-19** trucks leave from 03:30 and 07:30, and leaving earlier is only suggested.

## What we assumed
- The drive back is as long and as far as the drive out. The data stops at the last shop.
- A window is judged by when the vehicle arrives, not by when unloading ends.
- The booklet's trip minutes are counted per stop, not per order.

## Decided while writing this spec
- **D-23** A trip stays inside one district. The data has no travel figures between districts.
- **D-24** Trucks have a tail lift and vans do not. A tail-lift item on a van is a warning, not a block.
