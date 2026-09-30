# 007 · Plan checker: load, timeline and rules

**Status:** Ready  ·  **Owner:**  ·  **Design:** no screens of its own. Its numbers show on Dispatcher · Edit plan and View plan, Shop · New orders and Loader · Load a truck.

Pieces B1 to B3 of [the map](../000-map.md). It replaces specs 001 and 002. It checks a plan and does not
build one: that is the planner (B4), which gets its own spec.

## Why
The booklet says plans "must account for capacity, temperature requirements, outlet access, delivery windows,
and fuel quotas", and that the system must name the orders it defers. The plan board, the suggested plan and
the final send all call this one checker, so a rule is written once and no screen works a number out itself.

## What it does
Plain logic in `apps/api/src/planning`: plain data in, plain data out, no database, clock or network. The
**load calculator** gives the kilos, cubic metres and handling needs of an order or a trip. The **trip
timeline and fuel** say when a vehicle leaves, reaches each shop, waits, unloads, is back and can leave again,
and what that costs in kilometres and litres. The **rule checker** takes the day's orders and a plan and
returns whether the plan may be sent, every problem in plain words, and the numbers it worked out. A problem
is a **block** or a **warning**. A plan with a block cannot be sent. A warning is one of our own defaults
(D-09, D-19), and the dispatcher can still send.

## Rules, with worked examples
Each rule is stated once, in its criterion below, with numbers from `data/shared` and the product list. Times
are minutes after midnight on the plan date, in depot time, so 03:30 is 210. Two examples serve several rules.

**The chained day (D-08).** Dry truck VEH012 (6.8 km per litre) runs two Fresh trips. Trip 1 leaves for
Gampaha at 03:30: OUT026 and OUT030 (rear docks) from 04:07 to 04:22 and 04:31 to 04:46, then OUT028 (street)
from 04:55 to 05:11. It is back at 05:48 and reloaded at 06:18. Trip 2 leaves for Colombo at 06:18: OUT006,
OUT004, OUT007 and OUT014 (all street) are reached at 06:42, 07:06, 07:30 and 07:54. The last is done at 08:10
and the truck is back at 08:34. The booklet's trip minutes are 101 and 112, which is 213 of the 270 Fresh
minutes. It drives 70 km for 10.3 litres and 36 km for 5.3.

**The Style trip.** Colombo, OUT015 (mall, 09:00 to 11:00), OUT017 (mall, 10:30 to 12:30), then OUT019. It
leaves at 08:36, is at OUT015 from 09:00 to 09:59, reaches OUT017 at 10:07, waits 23 minutes, unloads until
11:29 and reaches OUT019 at 11:37.

## Data in and out
No endpoints and no tables. Everything is passed in as plain data: the depot, whether the date is an operating
day, the settings, the products, the day's orders (placed for that date plus carried over), the shops, the
vehicles, the travel and unloading figures, and the plan (trips with their stops and orders, deferrals with a
code and a reason). A vehicle's `available` comes from `vehicle_days_off` and its `litresUsedThisWeek` from
`fuel_log` (spec 008). Reading them, calling the checker and checking the role is A2's job. Out comes
`PlanCheck` (`packages/contracts/src/planning.ts`): `ok`, the problems, and the numbers of every trip and
vehicle. Bad input is not a plan problem: the engine throws an error that names it (AC-5, AC-45).

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
- [ ] **AC-6** When a trip has no leaving time, the system shall time it to reach the first stop as its window
  opens, but never before 03:30 with a Fresh stop or 07:30 without one (D-19). *OUT005 (Fresh, Colombo, opens
  04:00) leaves at 03:36, OUT006 (opens 03:00) at 03:30, OUT057 (Style, Galle, opens 09:00) at 07:30.*
- [ ] **AC-7** When a trip has a leaving time, the system shall use it unchanged.
- [ ] **AC-8** When timing a stop, the system shall set its arrival to the leaving time before it plus the
  drive: the district's depot-to-district minutes for the first stop, its between-stops minutes after that.
- [ ] **AC-9** When a vehicle arrives before the window opens, the system shall record the minutes it waits
  and start unloading when the window opens. Otherwise it starts on arrival. *OUT017 on the Style trip.*
- [ ] **AC-10** When unloading, the system shall take the allowance for the shop's brand and dock type, and
  the vehicle leaves that stop when it ends. *Style at a mall bay is 59 minutes, so 10:30 to 11:29.*
- [ ] **AC-11** When a shop has a mall slot, the system shall use the later of its two opening times and the
  earlier of its two closing times as its window. When they do not overlap, a stop there is always late.
  *09:00 to 17:00 with a slot of 10:30 to 12:30 gives the slot. 09:00 to 10:00 never overlaps it.*
- [ ] **AC-12** When a trip is timed, the system shall give when the last stop is done, when the vehicle is
  back at the depot (that plus the depot-to-district minutes, as the data has no drive back) and when it is
  ready again (back plus the reload minutes). *Trip 1 of the chained day: 05:11, 05:48, 06:18.*
- [ ] **AC-13** When a trip is timed, the system shall give the booklet's trip minutes: depot-to-district
  minutes + between-stops minutes × (stops - 1) + every stop's allowance, with no waiting and no drive back.
  We count per stop, the booklet per order. *Its Gampaha trip: 37 + 9 × 2 + 15 + 15 + 16 = 101.*
- [ ] **AC-14** When a vehicle has two trips, the system shall time them in trip-number order, and a second
  trip with no leaving time shall not leave before the first is ready again. *06:18 on the chained day.*
- [ ] **AC-15** When a trip is timed, the system shall give its kilometres as depot-to-district km × 2 +
  between-stops km × (stops - 1), and its litres as kilometres ÷ the vehicle's km per litre, shown to 1
  decimal. *Five Fresh stops in Galle on VEH006 (4.4 km per litre): 120 + 10 × 4 + 120 = 280 km, 63.6 litres.*
- [ ] **AC-16** When a vehicle's day is summed, the system shall give its litres used before this plan, the
  litres in this plan and the litres left, which is the quota minus both. *300 + 63.6 leaves 16.4 of 380.*

### Rule checker (B3): what a vehicle carries, and every order accounted for
- [ ] **AC-17** When a trip's load is over the vehicle's weight limit, the system shall report `over_weight`
  (block) and say how many kilos to take off. Exactly at the limit is allowed. *Three chilled orders of 60
  cartons on van VEH035: 1,242.0 kg against 1,040 kg, 202 kg over, though their 6.66 m³ fits in its 7.0 m³.*
- [ ] **AC-18** When a trip's load is over the vehicle's volume limit, the system shall report `over_volume`
  (block) and say how many cubic metres to take off. *80 rail boxes of hanging garments on VEH008: 24.0 m³
  against 22.0 m³, while the 1,120.0 kg is well inside its 3,800 kg.*
- [ ] **AC-19** When an order with chilled goods is on a vehicle that is not a fridge vehicle, the system
  shall report `needs_reefer` (block). A fridge vehicle carrying dry goods is fine. *A chilled order on dry
  truck VEH012 is refused. The same order next to a dry one on fridge truck VEH003 is allowed.*
- [ ] **AC-20** When a stop at a `van_only` shop is on a truck, the system shall report `van_only` (block).
  *OUT001 on truck VEH008 is refused. On van VEH035 it is allowed.*
- [ ] **AC-21** When a trip's vehicle is from another depot than the plan, or a stop's shop from another depot
  than the vehicle, the system shall report `wrong_depot` (block). *Kandy's OUT084 on Peliyagoda's VEH008.*
- [ ] **AC-22** When an order with a tail-lift item is on a van, the system shall report `no_tail_lift`
  (warning, D-24). *Two crates of washing machines, 420.0 kg, for OUT093 on van VEH059.*
- [ ] **AC-23** When a trip has shops of more than one brand and "mix brands" is off, the system shall report
  `mixed_brands` (warning). With it on, nothing. *OUT019 (Style) and OUT024 (Tech), both in Colombo.*
- [ ] **AC-24** When one of the day's orders is on no stop and has no deferral, the system shall report
  `order_not_planned` (block).
- [ ] **AC-25** When an order is on two stops, on a stop and also deferred, or deferred twice, the system
  shall report `order_twice` (block).
- [ ] **AC-26** When a deferral has a code that is not in the list, or an empty reason, the system shall
  report `deferral_incomplete` (block).
- [ ] **AC-27** When an order sits on a stop at a different shop than its own, the system shall report
  `order_wrong_outlet` (block). *An order for OUT004 on the stop at OUT006.*
- [ ] **AC-28** When a trip has no stops, or a stop no orders, the system shall report `empty_trip` (block).
- [ ] **AC-48** When a trip has two stops at the same shop, the system shall report `stop_repeated` (block).

### Rule checker (B3): time, fuel and the day
- [ ] **AC-29** When a trip's stops are in more than one district, the system shall report `cross_district`
  (block, D-23) and give that trip no times. *OUT026 (Gampaha) and OUT006 (Colombo) on one trip.*
- [ ] **AC-49** When the data has no travel figures from the plan's depot to a trip's district, the system
  shall report `no_travel_data` (block) and give that trip no times. *OUT084 is in Kandy district, and the
  data has no drive from Peliyagoda to Kandy. A Peliyagoda trip there gets this block beside `wrong_depot`.*
- [ ] **AC-30** When a vehicle has more than two trips, two trips with the same number, or a trip number other
  than 1 or 2, the system shall report `too_many_trips` (block).
- [ ] **AC-31** When a vehicle's second trip leaves before its first is ready again, the system shall report
  `trips_overlap` (block) and give the earliest it can leave. *Chained day: trip 2 set to 05:30, ready 06:18.*
- [ ] **AC-32** When a vehicle arrives at a shop after its window has closed, the system shall report
  `window_missed` (block) with how many minutes after closing it arrives. Arrival is what counts, and arriving
  exactly at closing time is on time. The booklet's exception: a Fresh shop must be reached before 08:00
  whatever its window says, so 08:00 is late, and the message says so. *OUT010 (closes 07:30) in place of
  OUT014 on the chained day is reached at 07:54, 24 minutes late. Badulla's OUT110, OUT112, OUT111, OUT113
  leaving at 03:00 reach OUT113 at 08:00, which is late. Leaving at 02:59 they reach it at 07:59, on time.*
- [ ] **AC-33** When a vehicle reaches a mall shop after its slot has closed, or its slot and window do not
  overlap, the system shall report `mall_slot_missed` (block) instead of `window_missed` and name the mall's
  hours. *The Style trip with OUT017 first reaches OUT015 at 11:37. Its slot closed at 11:00.*
- [ ] **AC-34** When a vehicle's litres used this week plus this plan's litres pass its weekly quota, the
  system shall report `fuel_over_quota` (block) with the litres it is over. The check uses unrounded litres,
  and ending exactly on the quota is allowed. *VEH006 (380 a week) with 330 used and the 280 km Galle trip is
  13.6 over. With 316.4 used it makes 380.036 litres: blocked, although the shown figures add up to 380.0.
  VEH010 (5.6 km per litre, 540 a week) with 490 used and the same 280 km ends on exactly 540 and passes.*
- [ ] **AC-35** When the plan date is not an operating day, the system shall report `not_operating_day`
  (block). *Sun 28 Jun 2026 is refused. Sat 30 May 2026 is a holiday that still operates, so it is allowed.*
- [ ] **AC-36** When a trip's vehicle is unavailable that day, the system shall report `vehicle_off` (block).
- [ ] **AC-37** When a vehicle's Fresh trips pass 270 of the booklet's trip minutes, or its Style and Tech
  trips 480, the system shall report `over_time_budget` (warning). A trip with a Fresh stop counts as a Fresh
  trip. *Badulla's OUT110, OUT112 and OUT111 take 186 + 23 × 2 + 15 × 3 = 277 and are all reached in time.*
- [ ] **AC-38** When a trip is set to leave before 03:30 with a Fresh stop, or before 07:30 without one, the
  system shall report `leaves_early` (warning). *The four-stop Badulla trip that leaves at 02:59.*
- [ ] **AC-39** When a vehicle waits more than 30 minutes at a shop, the system shall report `long_wait`
  (warning). At the first stop it also gives the leaving time that removes the wait. *Leaving at 03:30 with
  OUT008 (Colombo, opens 05:00) first, a truck arrives at 03:54 and waits 66 minutes. 04:36 removes it.*
- [ ] **AC-47** When a stop is late and an earlier leaving time would reach every stop of that trip in time,
  the `window_missed` or `mall_slot_missed` problem shall carry a fix that names the latest such time (D-19),
  never before the vehicle is ready from its earlier trip. When no earlier time helps, there is no fix. *The
  four-stop Badulla trip at its default 03:30 reaches OUT113 at 08:30. The fix says 02:59. A Colombo trip
  OUT008, OUT012, OUT004, OUT007, OUT014, OUT011, OUT013, OUT010 leaves at 04:36 and reaches OUT010 at 07:51,
  21 minutes late. Leaving earlier only means waiting at OUT008, which opens at 05:00, so there is no fix.*

### Rule checker (B3): the result
- [ ] **AC-40** When no problem is a block, the system shall return `ok` as true. Warnings never stop a plan.
- [ ] **AC-41** When it reports a problem, the system shall give its code, its level, one plain sentence with
  the numbers in it, and the vehicle, trip, stop, shop or order it is about.
- [ ] **AC-42** When it returns, the system shall include each trip's load, times, kilometres and litres and
  each vehicle's budget minutes and litres. An untimed trip has no times, is skipped by rules that need them
  and always carries a block (`empty_trip`, `cross_district` or `no_travel_data`), so its plan is never `ok`.
- [ ] **AC-43** When it lists problems, the system shall put blocks before warnings, and inside each group
  order them by vehicle, trip and stop, with problems about the whole plan last.
- [ ] **AC-44** When given the chained day with 48 dry cartons ordered at each of its seven stops, the system
  shall return `ok`, no problems, its times, loads of 993.6 kg and 1,324.8 kg, and 15.6 litres.
- [ ] **AC-45** When the plan names a vehicle, shop or order that is not in the input, the system shall throw
  an error that names it.
- [ ] **AC-46** When called twice with the same input, the system shall return the same result and leave the
  input unchanged. No engine file imports anything from outside `apps/api/src/planning` except
  `@wayfinder/contracts`, so it cannot reach the database, the config or the clock.

## Out of scope
- Building a plan, dividing an order into two parts (D-17), reading from the database, saving a plan and the
  endpoints. They belong to B4 and A2. To the checker each part of a split order is simply an order.
- Traffic, monsoon and unloading that grows with the size of the order. The engine uses the supplied
  clear-road figures only. Using the Datathon's predictions is parked in `docs/ideas.md`.
- A screen to change the settings, and the 4 PM cut-off, which belongs to placing an order (spec 009).

## What comes next
B4, the planner, builds a plan and hands it to this checker, so it can never suggest something the dispatcher
could not send. Its criteria are written before it is built. It must follow D-08 (one real timeline, 30 minute
reload), D-09 (one brand per trip and the budgets are defaults), D-10 (a shop that waited is protected), D-11
(a late stop is never skipped automatically), D-17 (split what does not fit), D-19 (leaving earlier is only
suggested) and D-23 (a trip stays inside one district). Splitting an order needs a link from each part to the
original and a check that the parts add up to it. That is specified with A2.
