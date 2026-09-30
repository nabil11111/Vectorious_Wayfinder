# 011 · Planner: the suggested plan

**Status:** Spec, reviewed by the lead  ·  **Owner:**  ·  **Design:** no screens in this piece. Its result feeds Dispatcher · Edit plan and View plan.

Piece B4 of [the map](../000-map.md), after the checker (007). This specifies the pure engine and its hand-off
to the board (010). The two policy choices at the bottom are the lead's picks (D-41, D-42) until Nabil answers.

## Why
Planning and allocation earns 20% of the marks. A judge must be able to ask why one order went before another
and get an answer. A fixed, small search gives a repeatable suggestion that the existing checker can judge.

## What it does
`buildSuggestedPlan(input)` in `apps/api/src/planning/planner/` builds a complete day from scratch. It keeps no
manual trips. The caller supplies the day's snapshot; the engine reads no database, clock or network. It returns
a checked suggestion, proposed splits and explanations. Applying it and sending it remain dispatcher actions.

## Data in and out
`PlannerInput` is `PlanInput` without `plan`, with the order metadata in the plan file. Dates and prior deferrals
are supplied because the checker cannot tell which shop waited. The returned `input: PlanInput` contains the
effective orders and their trips, stops, leaving times and deferrals. `checkPlan(result.input)` works unchanged.
Proposed split parts replace their parent in that input. The board converts their temporary references to real
orders before saving a `DraftPlan` through D-29. This keeps one checker and one persistence path.

## Priority order
Compare these keys in order, stopping at the first difference. Each order gets its resulting rank and a sentence
explaining its allocation or deferral. Lower-priority work never removes higher-priority work already accepted.

1. **Orders that waited first, oldest wanted date first.** An earlier wanted date or `timesDeferred > 0` marks an
   order as waiting; protecting its outstanding goods prevents a new order taking its place (D-10).
2. **Chilled before dry within that age tier.** Fridge capacity cannot be replaced by an ordinary truck.
3. **Earliest effective closing minute first.** Use the earlier of shop and mall closing, capped at 07:59 for
   Fresh; the order with less time left gets first use of a trip.
4. **Fresh before Style or Tech when closing times tie.** Fresh has the booklet's strict before-08:00 deadline.
5. **Mall slots before ordinary windows when still tied.** Their fixed receiving slot gives fewer alternatives.
6. **Van-only shops before other shops when still tied.** They cannot use the ordinary truck fleet.
7. **District, then outlet ID, then order ID, ascending.** These final ties group equal claims by district without
   letting one district jump ahead of an older order elsewhere; compare strings by code point, not locale.

For orders that have not waited, step 1 is one equal tier. For waiting orders it is one tier per wanted date.
No extra priority comes from quantity, input row order or how many times an order on that same date waited.

## Acceptance criteria
Each criterion is a unit test. Tests use the real rows through `planning/testing/shared.ts` unless a boundary
requires a stated override. The numbered priority above and the rules below are the complete selection policy.

### Input, priority and decisions
- [ ] **AC-1** When given a day's valid input, the system shall return the engine types in `plan.md`, with one
  explanation per original order naming its rank and resulting order IDs. Its dispatcher-facing sentence shall
  explain the priority (for example, waited since Tuesday, chilled, window closes 07:30) and the rule that decided
  the trip: joining an existing run, using a first run, or the winning capacity or efficiency preference. It shall
  describe the actual AC-6 comparison, never claim "largest" when another earlier preference decided. A deferral
  uses the checker's own sentence for the best-ranked refused candidate when available, naming the affected shop
  and relevant time. Reasons use plain words, weekdays and brand goods words, with no outlet IDs, ISO dates or
  "units"; for example, "joined VEH004's run to Gampaha" or "new run on VEH002, the largest free fridge truck".
- [ ] **AC-2** When orders compete, the system shall apply priority steps 1 to 7. Pairwise tests isolate every key,
  including an old dry order before a new chilled one and an older district before a newer one.
- [ ] **AC-3** When any of a waiting order's goods are deferred, the system shall include a `waited_again`
  decision for that effective order, including a deferred split remainder. No such decision is needed when both
  split parts go. When an order is deferred for a window, it shall include a `late_order`
  decision. These produce `needs_decision`, not silent acceptance of another missed delivery (D-10, D-11).

### Trips, vehicles and times
- [ ] **AC-4** When trying an order, the system shall try all candidates for the whole order before trying a split.
  Candidates are each existing trip in its district and each available depot vehicle's next free trip, numbered
  1 then 2, capped at two (D-13). Each trip stays in one district because there are no cross-district times (D-23).
- [ ] **AC-5** When selecting candidates, the system shall require a reefer for chilled and a van for van-only
  access, and exclude unavailable or other-depot vehicles. *OUT001's chilled cartons can use VEH035, not VEH008;
  marking VEH035 unavailable leaves no slot if it is the only supplied fridge van.*
- [ ] **AC-6** When more than one whole candidate passes, the system shall choose by this tuple: no departure
  change before an earlier departure, no needless reefer, no needless van, existing trip before new trip, a first
  trip before a second trip, greater volume capacity, greater weight capacity, greater km per litre, vehicle ID,
  trip number. A reefer is needed for chilled and a van for van-only access. Existing trips still take precedence
  over new first trips; between otherwise equal new runs, use an idle vehicle's first before a second run. This
  preserves special vehicles and avoids tying up a vehicle's whole day while other suitable trucks stand idle.
- [ ] **AC-7** When adding orders at one outlet, the system shall use one stop there per trip, with order IDs in
  priority order. It shall sort stops by effective closing minute, effective opening minute, then outlet ID, so
  deadlines decide the route. Mall hours intersect shop hours; effective closing uses priority step 3.
- [ ] **AC-8** When checking a candidate, the system shall check both trips of its vehicle, including all earlier
  accepted orders, against 007. A new stop must not break its second trip. It shall use the checker's load,
  timeline and fuel functions, so both kg and m³, waiting, unloading, return and reload count correctly.
- [ ] **AC-9** When default timing misses a window, the system shall try the checker's numeric `leaveAt` fix, in
  trip-number order, then recheck both trips. Without a fix it rejects that candidate; it never parses the text.
  Prefer any passing candidate whose trips keep their usual departure times to one requiring an earlier departure;
  suggest earlier leaving only when no candidate without it passes. Defaults remain unset in the output; only a
  changed departure is explicit. An earlier-than-default setting adds an `early_leave` decision with the time and
  affected trip, and its reason names the order whose insertion forced the change, for dispatcher acceptance (D-19).
  *The departure helper, given VEH044's ordered OUT110, OUT112, OUT111, OUT113 trip, uses 02:59: the fourth arrival
  is 07:59, where 03:00 reaches it at 08:00 and blocks. `leaves_early` and the 315-minute budget warning remain. If
  an identical idle VEH045 can carry the next order at its usual time, it is preferred to making VEH044 leave early.*
- [ ] **AC-10** When choosing trips, the system shall keep one brand per trip with `mixBrands: false`, and allow
  mixed brands with it true. Tail-lift, time-budget and long-wait warnings do not discard an otherwise usable
  candidate. This respects the switch without treating D-09 or D-24 warnings as hard delivery constraints.
  *OUT093 with two washer crates on VEH059 can pass with `no_tail_lift`.*
- [ ] **AC-11** When testing fuel, the system shall include both trips and the caller's litres used in the plan's
  Monday-to-Saturday week (D-20). It shall use the checker's unrounded quota test, not displayed trip litres.
  *VEH001 with 300 of 340 litres used cannot make even one Kurunegala stop: 190 km / 4.7 exceeds 40 litres.*
- [ ] **AC-12** When building the real-row mall example, with one small dry order each at OUT015, OUT017 and
  OUT019 and only VEH023, the system shall put them in that order. The first trip leaves at 08:36, OUT017 is
  reached at 10:07 and waits until 10:30. The 59-minute mall allowance makes OUT019's arrival 11:37.

### Splits and coverage
- [ ] **AC-13** When no whole candidate fits, the system shall try a nonempty proper part on each candidate using
  AC-14, then pick the candidate by AC-6. It shall split only an original (`splitFrom: null`), once, into exactly
  two children. The first goes on the chosen trip; then try the remainder whole on the updated plan before
  considering the next original order. Defer it only if no whole candidate passes, using AC-17's exhausted stage.
  It is never split again: D-17 sends what fits and 010 forbids splitting a child again. A part already in the input
  must fit whole or wait whole. Both parts retain their parent's priority, so new goods cannot displace waiting goods.
  Automatic splits require at most 10 product lines, each with 1 to 999 units, to fit the split-write contract;
  otherwise plan or defer the original whole. Name a split limit only when a trip had room for an allowed part;
  with no slot at all, use the ordinary stage's reason.
- [ ] **AC-14** When choosing the first part, the system shall visit products by product ID: first keep each whole
  line that fits both remaining limits, then revisit leftover lines in that order and take the greatest integer
  quantity that fits. Reuse `computeLoad` and the checker to test limits, with binary search on units, so no
  fraction or rounding error can overload a truck. The remainder is the original minus kept units per product.
  *180 chilled cartons for OUT001 on VEH035 yield 150 kept (1,035 kg, 5.55 m³) and 30 remaining (207 kg, 1.11 m³).
  With VEH036 also free the remaining cartons go there before a new OUT002 order; otherwise they wait whole.*
- [ ] **AC-15** When proposing a split, the system shall return its original ID, `keep` in `SplitOrderRequest`
  terms and two distinct stable temporary IDs. Both children have positive units, each product appears at most
  once per child, and their quantities add up exactly. The parent appears on no stop, deferral or effective order
  list. If no unit fits, it shall defer the original without an empty split, because the board cannot store one.
- [ ] **AC-16** When the result is checked, every effective order shall appear exactly once at its own outlet or
  in deferrals. The result shall respect `DraftPlan` limits of 76 trips, 40 stops per trip, 300 IDs per stop and
  300 deferrals. Cap effective orders at 300, including children, so a later save can represent the suggestion;
  when a split would exceed that cap, leave its original whole and explain the limit with `over_capacity` only if
  a trip otherwise had room for part of it. Without a slot, use the ordinary capacity reason.

### Reasons, failures and repeatability
- [ ] **AC-17** When deferring, the system shall use the first exhausted stage below and a trimmed sentence of
  1 to 200 characters written for the shop (010 rule 7). Use its name or district, the weekday, and the time that
  mattered when relevant. Never use an outlet ID, ISO date, "units", "tested stop order", "after earlier choices"
  or other search jargon; never promise a new date. Say cartons for Fresh, boxes for Style and items for Tech when
  naming quantities. The sentence must be true to the actual failure and distinguish arriving late at this shop
  from reaching it on time but making other shops late.

  | Stage, in order | Code if none remain | What the sentence explains |
  | --- | --- | --- |
  | Available depot reefers, for chilled | `no_reefer` | "No fridge truck was free for Gampaha on Thursday." |
  | Vans among compatible vehicles, for van-only | `no_van` | "No van was free for Fresh Wellawatte on Thursday, which takes vans only." |
  | Trip slots in this district/brand, board and split-write limits, and room for the whole order or allowed part | `over_capacity` | "The trucks going to Kalutara on Thursday were full." Name a split limit only when some trip had room for a part. |
  | On-time candidates, including AC-9 fixes | `window` | "No truck could reach Fresh Kiribathgoda before its window closed at 07:30 on Thursday." If that shop can be reached on time: "The truck that could reach Fresh Kiribathgoda in time would then have been late for its other shops on Thursday." |
  | Candidates within the remaining weekly fuel | `fuel` | "The trucks that could reach Fresh Matara on Thursday had used up this week's fuel." |

  For a deferred split remainder, name quantities sent and left in the same sentence, for example "75 of the 135
  boxes for Colombo go on Thursday; the other 60 wait for the next plan because the truck was full." An existing
  child too large names that it cannot be split again only when a trip could carry part of it. The planner never
  invents a `dispatcher_choice`; that code stays with the dispatcher.
- [ ] **AC-18** When a valid operating day has no usable vehicle, the system shall return all orders deferred
  with reasons and no blocks, with decisions as AC-3 requires. On a nonoperating day, or if the final checker
  still finds any block, it shall return `unavailable` with that check and no applicable plan. It shall never
  delete accepted orders to hide a final failure, because a broken suggestion must not reach the board.
- [ ] **AC-19** When input is malformed or incomplete, the system shall throw `PlanInputError` naming the fault.
  Validate unique IDs and lookup keys, order metadata and lines, depot ownership of orders, required travel and
  allowances, and finite valid settings, windows, product and vehicle figures before searching. Reject more
  than 300 input orders or reserved temporary IDs. Missing history never silently means a new order.
- [ ] **AC-20** When run repeatedly, with frozen inputs or shuffled rows and order lines, the system shall return
  identical results and leave input unchanged. Canonical output order is vehicle ID/trip number for trips and
  source priority for orders, splits, deferrals, explanations and decisions; keep precedes remainder. Production
  imports stay within `planning/` and `@wayfinder/contracts`, so no time, random seed or external state affects it.
- [ ] **AC-21** When the seeded day is reconstructed without a database, the system shall plan Thu 25 Jun 2026
  from Peliyagoda: 98 placed orders plus 4 carried over, excluding the two shop drafts. OUT060, wanted 23 Jun
  and deferred twice, ranks before OUT001, OUT030 and OUT054, wanted 24 Jun and deferred once. VEH003, VEH005
  and VEH036 are unavailable; 35 vehicles work, including 5 reefer trucks and 1 reefer van, with 140.7 m³ total
  fridge space. Use the seed's fuel history. The result must pass the checker and conserve all goods. Once built,
  pin its exact trips, splits, served and deferred totals and reasons; no unmeasured deferral count is promised.
- [ ] **AC-22** When benchmarked on a documented developer machine with Node 22 or later, the system shall have
  a median below 1 second for AC-21 and below 2 seconds for a fixed 300-order case with the shared fleet, over
  10 measured runs after one warm-up, excluding fixture loading. Search bounds are input counts and quantities,
  never elapsed time; failure of this target requires work, not a different partial answer on a slower machine.

## Out of scope
Database reads or writes, endpoints, screens, `PlanBoard.suggestion`, future-day slot searches, changing a manual
draft in place, global route optimisation, brand-mixing comparisons and a new deferral code. These need a later
board integration. The apply protocol in `plan.md` is its contract, not a claim that it exists in 010 today.

## Open questions for Nabil
1. **Chilled before an earlier-closing new dry order?** Proposed and picked (D-41): yes, after waiting age, as priority step 2 says.
   Fridge trips are the seeded shortage; the window remains a hard check, and any missed-window deferral is shown.
2. **Does a shop's new order inherit its old order's priority?** Proposed and picked (D-42): no. Protect all outstanding waiting
   goods first, retry a split remainder whole before new goods and flag any deferred remainder for a decision; new goods keep their own rank. This uses the history the
   board actually supplies and does not let a new bulk order push another waiting shop back.
