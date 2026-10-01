# 014 · The suggested plan

**Status:** Done, with two open questions at the bottom  ·  **Owner:**  ·  **Design:** Dispatcher · Edit plan · empty, Edit plan and View plan, and the in-screen states Edit plan · building, View plan · ready to send and View plan · sent.

Piece B4 of [the map](../000-map.md), after the planner itself ([011](../011-planner/spec.md)). This spec puts the planner on
spec 010's board: one button builds the day's plan, every order says why it went where it went, the dispatcher makes the
choices the planner leaves open, and the plan is edited and sent like a hand-made one. The frames are exported in
`tech-triathlon-ops/design/export`.

## Why
The booklet, page 11: "You may use automatic allocation, assisted planning, or manual decisions with validation. Whatever
approach you choose, the system must produce an allocation that respects the operating constraints and identifies
deferred orders." Page 3: "When demand exceeds capacity, they must decide which orders to defer and explain the
consequences." Planning and allocation is a fifth of the marks, and a judge tries it with one button. Spec 011's
`buildSuggestedPlan` plans a whole day and explains it, but nothing on the board calls it yet.

## What it does
Once the next day's orders close at 16:00, the dispatcher presses "Build the suggested plan". The server plans every
order of the day with spec 011's planner and saves the result as the board's draft in one step, splits included. Every
order on a trip or deferred has a "why?" with the planner's reason. The choices the planner leaves to the dispatcher (a
trip leaving earlier than usual, an order that waited waiting again, an order deferred because its window cannot be met)
are listed on View plan and must be accepted before the plan is sent. From there the plan is an ordinary draft: the
dispatcher edits it like a hand-made one (D-29) and sends it with spec 010's send. On a fresh reset Ruwan builds Thu 25
Jun at Peliyagoda from Wed 24 Jun 16:00: 102 orders (98 placed for Thursday and 4 carried over), 35 working vehicles and
3 in the workshop.

## Decisions
These are in `docs/decisions.md`.
- **D-51 · One write builds the suggestion and saves it in one transaction.** The draft and the orders the planner
  splits land together or not at all, so a refused build leaves the board as it was. It saves with the same
  `replaceDraft` and checks as a hand save (D-29).
- **D-52 · A build replaces the whole draft, and the screen asks first.** The planner plans the day from the shops'
  orders (spec 011), so splits made on this draft are joined back before it plans, and a mix of hand trips and
  suggested ones would be neither plan. Each vehicle keeps its driver, since a driver is not part of the allocation
  (D-31).
- **D-53 · The plan keeps its suggestion.** When it was built, the draft it saved, the planner's reason for every order
  and its decisions stay with the plan, so the reasons and the decisions survive a reload, and a decision is judged
  against the planner's own choice. Hand edits leave it as built, and the next build replaces it.
- **D-54 · The planner's decisions are accepted before the plan is sent.** Leaving early, an order that waited waiting
  again and a late order waiting are the dispatcher's calls (D-10, D-11, D-19), and a checker warning is not consent
  (spec 011). An edit that changes the planner's choice ends its decision.
- **D-55 · "why?" shows the planner's reason for an order** (our pick, until Nabil answers, open question 1). A judge
  and a dispatcher must be able to ask why an order went where it did. The design's chips that ask why the dispatcher
  changed the suggestion are not built, because a deferral already carries its reason (spec 010, rule 7).

## Screen states
"No frame" means the smallest state that fits the style guide. Loading, saving and the first read are spec 010's. The
numbers a build produces are the planner's, so N stands for them here and the walkthrough gives the seeded day's.

| Screen | State | Frame | What shows |
| --- | --- | --- | --- |
| Plan board `/dispatcher/plan` | No plan yet | Edit plan · empty | Spec 010's empty board. In the middle, "No trip open", then "Build the suggested plan" in orange beside "Start a blank trip". |
|  | A draft, no trip open | Edit plan · empty, its middle | The same two buttons under "No trip open", with the draft's trips under Done. |
|  | Replacing a draft | No frame | A dialog, here over the judge walkthrough's hand-built draft: "Replace the draft with a suggested plan?", "The planner plans all 104 orders again. Your 1 trip and 99 deferred orders are replaced, and orders split on this draft are joined back first. Vehicles keep their drivers.", then "Build the suggested plan" in orange and "Keep the draft". Only when the draft has a trip or a deferral. |
|  | Building | Edit plan · building | The middle column: the design's route picture, "Building the plan", a moving bar and "102 orders · 35 trucks", the board's counts. The rest of the board holds still until the answer. |
|  | Built | Edit plan, its header and Done column | Every trip under "Done · N trips", "Unplanned · 0" and "Every order is on a trip or deferred.", "Deferred · N" with each reason, the header's counts and "Draft saved 16:00 · not sent". The middle: "No trip open", the line "Suggested plan · 16:00 · N decisions to make", and the two buttons. |
|  | why? | No frame | A "why?" chip on each stop of the open trip and on each deferred order. It opens a popover with the planner's reason for each of the stop's orders, or for the deferred order with its decisions: "to decide" in the warning colour, or "✓ accepted 16:08". A deferred order with an open decision also carries "to decide". |
|  | Refused | No frame | The server's sentence in red under the middle's buttons, with "Try again". A refusal that reloads the board (`stale`, `plan_sent`, `day_moved`) does so with spec 010's line. |
|  | Below 1024 wide | No frame | Spec 010's three tabs. "Build the suggested plan" moves the page to the Planning tab, which shows Building, and the dialog fits a phone. |
| View plan `/dispatcher/plan/:date` | Decisions open | View plan, the Suggestions card's place and look | Above Checks, "Decisions · N" with the design's second-trip picture and "N open" in the warning colour. Each decision: a title ("VEH002 trip 1 leaves early, at 03:07", "Fresh Dickwella waits again", "Fresh Pannala would be late, so it waits"), the planner's sentence, "Accept" and "Open in edit". "Accept all N" in orange at the bottom. A decision an edit has ended is not listed, and a sent plan, or another day's, offers no Accept. In the header, "Suggested plan · 16:00" beside the title. The send is greyed: spec 010's "Send plan · N checks open" while a block remains, else "Send plan · N decisions open". Checks lists its checks and holds back "Ready". |
|  | Ready, with warnings | View plan · ready to send | "Decisions · all made" with "Accepted" in green, each with "✓ Accepted 16:08". "Checks · N" still lists the checker's warnings with their fixes, with "Ready, with warnings" in green, because accepting a decision changes nothing the checker says. The orange send. With no warning, "Checks · all clear" and "Ready", as spec 010's. |
|  | Sent | View plan · sent | Spec 010's sent state, with "Suggested plan · 16:00", the accepted decisions and the warnings kept. |

## Rules
Examples use the seeded day on a fresh reset, with the clock at Wed 24 Jun 16:00 and Nadeesha's draft not placed. Times
are depot time.

1. **The button.** "Build the suggested plan" is under "No trip open" whenever the board can change: the board's day,
   its orders closed and its plan a draft (spec 010, rule 1). With a trip or a deferral in the draft, the screen asks
   first (D-52). Before 16:00 the board shows only when orders close, and a sent plan is on View plan, so neither
   offers it.
2. **What the planner plans.** The day's orders as spec 010's rule 2 gives them, once this draft's splits are joined
   back (rule 4), with each order's wanted day, how many sent plans deferred it and its original if it is a part. The
   day's vehicles with their workshop days and the fuel they used this week, the depot's shops, travel and unloading
   times, and "Mix brands" as the draft has it. Spec 011 decides every trip, stop, leaving time, split and deferral in
   its priority order, and the board adds nothing to it. *102 orders: 98 placed for Thursday and the 4 carried over.
   VEH003, VEH005 and VEH036 are in the workshop, and VEH001 has 40 of its 340 litres left this week.*
3. **What a build replaces (D-51, D-52).** Every trip and deferral of the draft, in one transaction with the build: a
   refused build changes nothing. A vehicle the suggestion uses keeps the driver the draft gave it, and a driver on a
   vehicle the suggestion leaves out is dropped. *A draft with VEH035's trip to Fresh Nugegoda, Dilshan driving, and
   VEH004's trip to OUT026 and OUT028: after the build Dilshan still drives VEH035, which the suggestion needs for
   Nugegoda's chilled cartons (the only working fridge van, and Nugegoda takes vans only), and VEH004 has whatever the
   planner gave it.*
4. **Splits.** Before planning, each split order whose two parts are both among the day's orders, `placed`, and on no
   stop or deferral of another plan is joined back, as spec 010's Join does. A part that a sent plan deferred stays a
   part and is planned whole, because a part cannot be split again (spec 011, AC-13). Each split the planner proposes
   is made as spec 010's split makes one (rule 8): the original becomes `split`, and two parts start `placed` with its
   shop, temperature, wanted day, note, placed time and placer. Each part goes exactly where the planner's plan puts
   it: the first on the trip it chose, and the second on another trip when the planner found one for it whole (spec
   011, AC-13), or deferred with the planner's reason. The shop sees both parts at once, as for a hand split (spec
   010, open point 2). *A test raises OUT001's carried-over order from 12 to 180 chilled cartons. Only VEH035 can take
   it, and 1,242 kg is over its 1,040, so the planner splits it: 150 cartons (1,035 kg, 5.55 m³) go on VEH035 trip 1
   and the other 30 on VEH035 trip 2, which reaches Fresh Nugegoda at 06:34. All its goods go, so there is no
   `waited_again`. Building again joins the two parts back first and splits the order the same way, into two new
   parts in the same places.*
5. **The suggestion kept (D-53).** The plan holds its suggestion: when it was built, the draft the build saved, one
   choice per order the planner got (its rank, the orders it became and the planner's reason) and the planner's
   decisions. Saves, splits, joins, sends and back to edit leave it as built. The next build replaces it, and a reset
   removes it with the plan.
6. **Decisions (D-54).** The planner hands the dispatcher three kinds (spec 011, AC-3 and AC-9): `early_leave`, a trip
   set to leave before its usual time to meet a window (D-19); `waited_again`, an order that waited before and some of
   whose goods wait again (D-10); and `late_order`, an order deferred because no truck can reach the shop in its window
   or mall slot (D-11). A decision is open while it is not accepted and the saved draft still holds the planner's own
   choice: the trip leaves at that time, or the order is deferred with the planner's code and reason. An edit that
   changes that choice (another time, the order put on a trip or left unplanned, the reason rewritten) ends the
   decision, because the dispatcher has decided by editing. On View plan the dispatcher accepts one decision or all of
   them, and an accepted one stays accepted. *The seeded suggestion has six: four chilled orders for Kurunegala and two
   for Puttalam wait for their windows, each a `late_order`, and no trip leaves early. With VEH035 in the workshop,
   Fresh Nugegoda's carried-over chilled cartons have no fridge van (`no_van`) and add a `waited_again`.*
7. **why?** An order's reason is the planner's: it names the order's rank, its priority (waited since when, chilled or
   dry, when its window closes) and what decided its trip, or why it waits (spec 011, AC-1 and AC-17). Both parts of a
   split show their original's. A part split by hand after the build has no "why?", since the planner never saw it.
   *Fresh Dickwella's chilled order, wanted Tue 23 Jun and deferred twice, is rank 1, and the three other carried-over
   orders are 2 to 4.*
8. **Editing and sending.** After a build the draft is an ordinary draft: every change of spec 010 works on it and is
   saved and checked the same way (D-29), and the suggestion stays as built. The send goes as spec 010's rule 11 once
   the checker finds no block and no decision is open. Accepting a decision clears none of the checker's warnings, and
   warnings never stop a send, so the plan is ready, with warnings, and they stay on View plan. *The seeded suggestion
   keeps two long waits, of 59 and 73 minutes, and a Fresh workload of 278 of 270 minutes.*
9. **The numbers.** As spec 010's rule 12: the API works out every number shown, and the planner writes every rank
   and reason. The screen counts the rows it lists ("Decisions · N", "N decisions to make") and nothing else.

## Permissions and failure paths
Only a dispatcher with a depot may call, on the routes of spec 010's router. Another role is refused, and so is an
admin, who has no depot.
- **Another tab, a send elsewhere, the day moving on, a reset.** As spec 010's writes: the build or the accept is
  refused (`stale`, `plan_sent`, `day_moved`) and the screen loads the board with that spec's line.
- **The planner cannot build.** `planner_unavailable` with its sentence. Nothing is written, and the board stays as it
  was, draft and splits included.
- **The signal drops during a build.** The build committed whole or not at all. "Try again" sends it again naming the
  plan on screen, and if the first one landed it is refused as `stale` and the board loads with the suggestion, as a
  lost split's answer does in spec 010.
- **Unsaved changes.** A build and an accept wait for the save on its way, as spec 010's split, join and send do.
- **View plan opened on its own.** After a reload of View plan, or with no board open for that day, an accept goes
  the way View plan's send does: straight to the server naming the plan on screen, and a stale reference reloads it.

## Data in and out
Two endpoints under `/api/v1`, for dispatchers only, with shapes and steps in `plan.md`: `POST /plans/:date/suggest`
and `POST /plans/:date/decisions`. They read what spec 010's board reads and write the plan tables with
`plans.suggestion`, `orders` and `order_lines` (the parts made and joined back) and `audit_log`. Every board
(`GET /plans`, `GET /plans/:date` and each write's answer) gains `suggestion`, and spec 010's send gains the refusal
`decisions_open`. After a build commits, `plans` is announced to the depot, and `orders` to the depot and each shop whose
order it split or joined back. An accept announces `plans`.

## Acceptance criteria
API criteria are integration tests on the seeded day of a fresh database, clock set, each file ending with spec 008's
reset. *Unit* ones use made-up data. Screens get a click-through in Nabil's Chrome at 1440 × 900 and 390 wide as
`ruwan`, from Wed 24 Jun 16:00 on a fresh reset.

### Building the suggestion
- [ ] **AC-1** When `ruwan` builds the suggestion at Wed 24 Jun 16:00 with no plan yet, the system shall make the plan
  and save the planner's plan as its draft in one transaction, and answer the board: each of the 102 orders on exactly
  one stop or deferred with the planner's code and reason, a check with no block, revision 1, and the app clock's time
  as both `savedAt` and the suggestion's `builtAt`.
- [ ] **AC-2** When the suggestion is built on that day, the saved trips, stops, leaving times, deferral codes, choices'
  ranks and orders, and decisions shall be exactly what `buildSuggestedPlan` gives for spec 011's seeded-day fixture
  (`planner/testing/demo.ts`), which is the same day. *The reasons may differ only where they name a shop, which the
  fixture names by its id. So the walkthrough's numbers are spec 011's pinned ones.*
- [ ] **AC-3** When the board is read after a build, it shall hold the suggestion as built: one choice per order in rank
  order, each with the orders it became and its reason, OUT060's order ranked 1 and OUT001's, OUT054's and OUT030's
  carried-over orders 2 to 4, and every decision not accepted. A save, a split and a join after it shall leave the
  suggestion as it was.
- [ ] **AC-4** When the planner splits an order, the system shall make its two parts as spec 010's split does (rule 8)
  in the same transaction, put each part exactly where the planner's plan puts it, on a stop or deferred with its
  reason, name both in the original's choice, and write `order.split`. *Rule 4's 180 cartons: the original `split`, 150
  cartons on VEH035 trip 1 and 30 on VEH035 trip 2, reaching Fresh Nugegoda at 06:34, and no `waited_again`.*
- [ ] **AC-5** When the suggestion is built again, the system shall first join back each split order rule 4 names, as
  spec 010's Join does, with `order.joined`, then plan the shops' orders. *AC-4's day built twice: two new parts of 150
  and 30 cartons on VEH035 trips 1 and 2, and the first build's parts deleted.* A part a sent plan deferred shall stay a
  part. *A test sets the second part `deferred` in a sent plan of Wed 24 Jun.*
- [ ] **AC-6** When a draft with trips, deferrals and drivers exists, the build shall replace every trip and deferral,
  and a vehicle the suggestion uses shall keep its driver. *Rule 3's draft: Dilshan still on VEH035.*

### Refusals and what a build tells
- [ ] **AC-7** When a build or an accept has no session, the system shall answer 401 `signed_out`, to a store manager,
  loader or driver 403 `forbidden`, and to an admin 403 `no_depot`. When a build names a plan id or revision that is not
  the plan's, or a first build's demo day is not the clock's, it shall answer 409 `stale`; for a sent plan 409
  `plan_sent`; before the orders close 409 `orders_open`; after the day moved 409 `day_moved`; and with no day left 409
  `no_plan_day`. Each changes nothing. *One test per case.*
- [ ] **AC-8** When the planner finds no plan that passes every check, or the day has more than 300 orders, the system
  shall answer 409 `planner_unavailable` with its sentence and change nothing: no plan made, no order split or joined
  back, the draft as it was. *A test makes the planner answer `unavailable`, and another places orders until Thursday
  has 301.*
- [ ] **AC-9** When a build commits, the system shall write the audit row `plan.suggested` with what it did, announce
  `plans` to the depot, and announce `orders` to the depot and each shop whose order it split or joined back. A refused
  build shall announce nothing.
- [ ] **AC-10** When a build and a save of the same plan arrive at once, both shall finish and one shall be refused as
  `stale`, never a database error. When a build and a demo reset arrive at once, both shall finish, and the build shall
  be refused as `stale` if the reset committed first.

### Decisions
- [ ] **AC-11** *Unit.* When the board works out a decision, it shall be open while it is not accepted and the saved
  draft holds the planner's choice: an early departure while its trip leaves at that time, and a waiting or late order
  while the draft defers it with the planner's code and reason. *Spec 011's VEH044 trip leaving at 02:59 is open, and
  closed at 03:30 or once removed; a deferral is open, and closed on a trip, unplanned or reworded.*
- [ ] **AC-12** When `ruwan` accepts decisions naming the plan's revision, the system shall record each as accepted at
  the app clock's time, raise the revision, write the audit row `plan.decided` with their keys, announce `plans` to the
  depot and answer the board with them closed. A key that is not an open decision of the plan shall get 400
  `invalid_input`, and AC-7's refusals apply. Each refusal changes nothing.
- [ ] **AC-13** When a plan with an open decision is sent, the system shall answer 409 `decisions_open` with their keys
  and change nothing. Once each is accepted or ended by an edit, the send shall go as spec 010's does, warnings and all.
  *A test puts VEH035 in the workshop on Thu 25 Jun and builds: Fresh Nugegoda's carried-over chilled cartons wait with
  `no_van` and a `waited_again`. The send is refused, every decision is accepted with one request, and the send goes.*

### The screens
- [ ] **AC-14** The build. On the empty board "Build the suggested plan" is orange beside "Start a blank trip". Pressing
  it shows Edit plan · building with "102 orders · 35 trucks", then the built state of the screen states table with
  the walkthrough's numbers.
- [ ] **AC-15** Over a draft. With a hand-made trip on the board the button asks first. "Keep the draft" changes
  nothing, and "Build the suggested plan" replaces it with Dilshan still on VEH035.
- [ ] **AC-16** why?. On an opened trip, "why?" on a stop shows the planner's reason for each of its orders, and on
  Fresh Dickwella's chilled order it names rank 1. On a deferred order with a decision it shows "to decide", then
  "✓ accepted" after View plan's Accept.
- [ ] **AC-17** View plan. With the seeded suggestion's decisions: "Decisions · 6" above Checks, each with Accept and
  Open in edit, "Accept all 6" in orange and the send greyed as "Send plan · 6 decisions open". Accepting one closes
  it. Accepting the rest leaves the warnings listed under "Checks · 3" with "Ready, with warnings" and turns the send
  orange. The send gives the sent state, which keeps "Suggested plan · 16:00", the accepted decisions and the warnings
  after a reload.
- [ ] **AC-18** View plan opened by a reload. After a fresh build, reload View plan before anything else, then press
  "Accept all" and send: both go through, naming the plan on screen, as View plan's send already does.
- [ ] **AC-19** Refusals and a phone. `planner_unavailable` shows its sentence in red in the middle column with "Try
  again", and a stale build reloads the board with spec 010's line. At 390 wide the build runs from the Planning tab,
  the dialog fits, and "why?" opens.
- [ ] **AC-20** No sums in the screen. A reviewer reads `features/plan` and finds every rank, reason, time, load,
  distance, litre and percentage from the API, and nothing counted but listed rows.

## Walkthrough
The judge walkthrough keeps spec 010's hand-built plan (VEH035 with Fresh Nugegoda and Fresh Wellawatte), which specs
012 and 013 are pinned to. The planner has this short walkthrough of its own, on a fresh reset. Its numbers are spec
011's pinned result for the seeded day, which AC-2 holds the board to; T3 reads them again once PR #15 is merged. Times
depend on the judge's pace, so the clock times are examples.

1. Press **Reset the demo day** and move the demo clock to "Orders closed, 16:00". Nadeesha's draft stays a draft.
2. As `ruwan`, open the Plan board: "Plan for Thu 25 Jun", "Unplanned · 102" with "Carried over · 4" (Fresh Dickwella,
   deferred 2×, first), "0 / 35 trucks", "0 / 102 orders", "37% fuel this week" and "0 / 140.7 m³ fridge space". In
   the middle, "No trip open" and "Build the suggested plan" in orange.
3. Press it. "Building the plan · 102 orders · 35 trucks", then "Unplanned · 0", 27 trips under Done on "26 / 35
   trucks", "96 / 102 orders", and "Deferred · 6": the chilled orders of four Kurunegala shops and two Puttalam shops,
   each with its sentence, such as "No truck could reach Fresh Pannala before its window closed at 07:45 on
   Thursday." The middle says "Suggested plan · 16:00 · 6 decisions to make".
4. Under Done, open the Fresh · Matara trip with Fresh Dickwella's chilled cartons and press "why?" on its stop: rank
   1, waiting since Tuesday. Press "why?" on a deferred order: its sentence and "to decide".
5. Open VEH035's trip 1, the fridge van with Fresh Nugegoda's chilled cartons, and choose Dilshan as its driver: an
   ordinary edit, saved and checked as spec 010's are.
6. Open View plan: "Suggested plan · 16:00", "Decisions · 6" and "Send plan · 6 decisions open". Press "Accept all 6":
   "Decisions · all made", and under "Checks · 3" the two long waits and the Fresh workload stay listed with "Ready,
   with warnings". Press "Send plan to loaders and drivers": "✓ Sent 16:06 · loaders and 1 driver".

## Out of scope
- **"Changes · N" and "Back to the suggestion"**: time. The planner's walkthrough shows allocation, reasons,
  decisions, editing and sending without them, and the plan keeps its suggestion, so they can come later
  (departure 4).
- **The "suggested …" hints on each group** ("VEH003 · reefer · fits · back 08:10", "none yet"): after a build almost
  nothing is unplanned, and a hint per group needs a search per group that the planner does not make.
- **"came in after the suggestion"**: orders close before the board opens (spec 010, rule 1), so none can arrive after a
  build.
- **"cannot be met from wave 1"**: there are no waves (D-40).
- **The "Planner: … Add it · Skip" row, "2 fit Fresh · Kalutara" and "fits all 12 · back 08:10"**: each needs a search
  of unplanned orders against trucks or trips. Find a slot already does that for one order.
- **The "why?" chips that ask why the dispatcher changed the suggestion** ("window cannot be met", "no truck fits",
  "shop asked", "road or weather", "other", "+ note"): a deferral already records its reason for the shop (D-55, open
  question 1).
- **"on would save 2 trips, 140 km"**: it needs a second build with brands mixed and a comparison of the two.
- **The "Swap stops 5 and 6" advice**: a route change the checker does not propose.
- **Find a slot's day tabs, "Try Tue 29" and "Plan first on VEH019"**: a deferred order gets no new date (spec 010,
  rule 7).
- **On View plan: the switch between "Suggested plan" and "As edited"** (open question 2), **Suggestions with "Send
  ahead" and "Skip", "spare space · send ahead?", "swap to VEH001", "What the 3 fixes change" and "Apply all 3 fixes"**:
  the planner plans one day and proposes no fixes to a draft, and the checker's own fixes are already on the board.
- **Planning only what is unplanned, keeping hand-made trips**: the planner builds a whole day (spec 011).
- **A build that runs by itself at 16:00**: the dispatcher asks for it.

## Departures from the design
The README lists these at T3.
1. "why?" gives the planner's reason for an order. The design's "why?" chips, which ask why the dispatcher changed the
   suggestion, are not built (D-55).
2. Edit plan · building's bar moves while the build runs, since one request has no progress to show, and its line says
   "102 orders · 35 trucks" without "16 windows to check".
3. The planner's decisions are a card on View plan in the Suggestions card's place, with Accept, "Accept all" and "Open
   in edit" (D-54). The design draws none.
4. The board's header has no "Changes · N" and no "Back to the suggestion". There was no time, and the planner's
   walkthrough shows allocation, reasons, decisions, editing and sending without them.
5. View plan says when the plan was suggested, with no switch between the suggested and the edited plan.
6. States the design lacks: replacing a draft, the middle's line after a build, a refused build, and a plan ready with
   warnings.

## Open questions
1. **What does "why?" answer?** Our pick (D-55): the planner's reason for an order. The design's chips record why the
   dispatcher changed the suggestion, which a deferral's own reason already covers for an order left out.
2. **View plan's switch between the suggested and the edited plan?** Our pick: not now. It needs a second checked board
   from the server for a read-only view, and the planner's walkthrough reads the suggestion on the board itself. The
   README lists it as a departure.
