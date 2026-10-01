# 012 · Loading

**Status:** Done, with two open questions at the bottom  ·  **Owner:**  ·  **Design:** Loader · Today's trucks (tablet and phone), · next truck and · loading; Loader · Load a truck (tablet and phone) and · all on; Loader · Flag a problem (tablet and phone); Loader · Truck ready; and the right-hand column of Dispatcher · Live day · issue open, · issue open · decision sent and · Live day · loading.

Piece A3 of [the map](../000-map.md). It starts where spec 010 ends, with a sent plan whose trips are `planned`. The
clock, live updates and the seeded day are spec 008's, and every load comes from spec 007's calculator.

## Why
The booklet puts the loader on the depot's dock with a shared tablet, where a printed loading list goes out of date as
soon as the plan changes (page 6). The loader needs the stop order, so the last shop's goods go in first, and has to
report anything missing or broken while the truck is still at the dock (pages 6 and 7). Today there is no way to raise
that before the truck is gone (page 4), and what the dispatcher decides has to get back to the loader (page 9). Judges
try the loader on a phone (page 11).

## What it does
Once the plan is sent, the loader sees the day's trucks in leaving order, on a phone or the dock's tablet. A truck is
loaded last stop first, a whole stop at a time (D-12). Anything short, damaged or wrong is flagged with the count at the
dock. The flag goes to the dispatcher, who answers it from Live day: go short, or load it all. A truck with every stop
loaded and every flag answered is marked ready, and what went on is written line by line. On the walkthrough Kasun
loads VEH035 at Thu 25 Jun 02:30, Fresh Wellawatte first and then Fresh Nugegoda, finds 3 of Nugegoda's 4 dry
cartons, and Ruwan lets it go short.

## Decisions
These are in `docs/decisions.md`.
- **D-34 · The loader's day is today until 16:00, then the next operating day.** By then the day's trucks have left and
  the next day is being planned, while D-28's 03:30 would hide trucks that leave later that morning.
- **D-35 · The loader loads last stop first, and a truck's counts are written when it is marked ready.** The stop order
  is what the loader needs, so the server holds it, and the counts that left the dock are the ones the driver and the
  shop check against.
- **D-36 · A problem is an `issues` row whoever raises it, with the lines it counts, and a loader's flag is its first
  kind.** The dispatcher decides every problem in one place, and the driver (A4) and the shop (A5) add their kinds
  without a new table.
- **D-37 · The dispatcher answers a loader's flag once, with "Go short" or "Load it all".** The design draws only the
  loader's side of the answer, these are the two things a dock can do, and taking an order off a truck changes the
  plan, which is Live day's (A7).
- **D-38 · The loader works online.** The dock has the depot's connection, the booklet's coverage gaps are on the road,
  and the loader frames draw no offline state. A write that fails is sent again with the same id, so it never counts
  twice.
- **D-39 · Loading builds only the "Needs you" column of Live day and the dispatcher's bell count.** A flagged truck
  needs the dispatcher to see the flag and answer it, and the rest of Live day is A7's.
- **D-40 · The loader's screens show what the data holds: one list in leaving order, with no waves, dock numbers or
  call buttons.** Every trip has its own leaving time (D-19), and the data has no docks and no phone numbers.

## Screen states
"No frame" means the smallest state that fits the style guide. The loader's screens are built at 390 wide first (the
phone frames) and take the tablet frames' two columns from 1024 wide. Loading shows on the first load only.

| Screen | State | Frame | What shows |
| --- | --- | --- | --- |
| Today's trucks `/loader` | Loading | Loader · Today's trucks · loading | The top bar, then grey blocks for the day line, the card and three rows. |
|  | Trucks to load | Loader · Today's trucks, and · phone | "Thu 25 Jun" and "1 truck". The card "Next out": "VEH035 · leaves 04:36", "in 2 h 6 min · van reefer" and the design's van, "Fresh · Colombo · 2 stops" and "0 of 118 cartons on" with its bar, then "Goes in first" with up to four stops in load order: "stop 2", "Fresh Wellawatte", "94 cartons", then "stop 1", "Fresh Nugegoda", "24 cartons". A loaded stop is faded with "✓ on", a short one reads "23 of 24". The orange button is "Start loading VEH035", or "Continue loading" once it is loading. "Next": the other trucks in leaving order, numbered from 2, each with its icon, "VEH035 · Fresh · Colombo" and "leaves 04:36 · 118 cartons", "leaves 04:36 · 94 of 118 on" with "loading", or "ready 02:36 · 117 of 118 on" with "ready". A row opens its truck. |
|  | A truck is ready | Loader · Today's trucks · next truck | With VEH004 ready, VEH035 is Next out with "Start loading VEH035", and VEH004 is in Next with "ready 02:50 · 210 of 210 on" and "ready". |
|  | Every truck loaded | No frame | "Every truck is loaded." in the card, and the list below it. |
|  | No plan out | No frame | "No plan is out for Thu 25 Jun yet. Trucks show here once the dispatcher sends it." Also while the plan is back in edit (rule 3). |
|  | Nothing to load | No frame | "No trucks to load for Wed 24 Jun." |
|  | No day left | No frame | "No delivery day is left." |
|  | Could not load | No frame | "Could not load the trucks." and "Try again". |
| Truck `/loader/trucks/:tripId` | Not started | No frame | The Load a truck layout with no stop loaded, and "Start loading VEH035" as its orange button. |
|  | Loading | Loader · Load a truck, and · phone | "← Trucks". The card: the van, "Loading VEH035", "van reefer · Fresh · Colombo · 2 stops", "0 /118" with its bar, "leaves 04:36 · in 2 h 6 min" and "0 / 1,040 kg · 0.0 / 7.0 m³", what is on so far over the vehicle's limits. "Load in this order": a row per stop, last stop first, with "stop 2", the shop and "94 cartons", "23 of 24" when short, "✓ 94 on" once loaded, or "23 on · 1 short" in red. The current stop is outlined. While the truck loads, a loaded stop's row opens a ⋮ menu: "Flag a problem" on that stop, and "Undo stop 2 loaded" on the stop loaded last. "Now loading · stop 2", "Fresh Wellawatte", and a row per line with a tick box: "48 cartons chilled", "46 cartons dry"; then stop 1's "12 cartons chilled", "8 cartons chilled", "4 cartons dry", with "1 short" in red on a flagged line. "Stop 2 loaded" in orange, "Flag a problem", and "Mark ready", greyed, and "Mark ready · 1 flag" while a flag is open. On a phone the three buttons sit at the bottom. |
|  | Waiting for an answer | No frame | Under the flagged stop's lines while it is being loaded, and in its row of "Load in this order" once it is on: "Waiting for the dispatcher · flagged 02:33". |
|  | All on | Loader · Load a truck · all on | "All stops loaded", "117 of 118 on, 1 short", each answer with the dispatcher's picture, "Ruwan, dispatcher · 02:35" and "Go with 1 dry carton short for Fresh Nugegoda.", and "Mark ready" in orange once no flag is open. |
|  | Ready | Loader · Truck ready | A green tick and "VEH035 is ready", "117 of 118 on · 1 short, dispatcher told 02:35 · leaves 04:36", and, when something is short, "Dilshan sees the short carton on stop 1 before driving." Then "Back to trucks", and the Next list beside it, below it on a phone. |
|  | Not on the list | No frame | "This truck is not on the list any more. The plan may have changed." and "Back to trucks", for a truck the plan took away. |
|  | Left the dock | No frame | Once its driver starts the trip: "VEH011 left with Asanka at 04:11." and "Back to trucks". The loading day lists the trucks that left, so the page tells the two apart. |
|  | Saving and after | No frame | The pressed button says "Saving…" and every button waits. "Not saved. Check the connection and try again." with "Try again", which sends the same write. A refusal shows the server's sentence in red on top, and the truck is fetched again. |
| Flag `/loader/trucks/:tripId/flag?stop=` | The form | Loader · Flag a problem, and · phone | "← VEH035". "Stop 1 · Fresh Nugegoda" and "VEH035 · leaves 04:36", then each line with its tick box and its count at the dock over its quantity: "4 / 4" in green, "3 / 4" in red. A tap picks a line, and a line already flagged is greyed. "What's wrong?" with "Short", "Damaged", "Wrong item" and "Won't fit". The picked line's counter: "Dry" with the design's dry goods picture ("Chilled" with the chilled one, the item's name for Style and Tech), "at the dock" ("fit on the truck" for Won't fit), "−", "3", "/4", "+". The count can be typed: anything but a whole number from 0 to the line's quantity stays as typed, in red, with "Whole numbers from 0 to 4." under it, and Send waits. A note, "What happened? (optional)". "Send to dispatcher" in orange once a count is lower. |
|  | Sending and after | No frame | As on the truck. The form keeps what was entered. Leaving the form while the flag is not sent asks first: "This flag is not sent. If you leave now, the dispatcher may never see it." with "Try again" and "Leave without sending". Sign out asks the same, with "If you sign out now" and "Sign out anyway". |
| Live day `/dispatcher/live` | Loading | Dispatcher · Live day · loading, its right column | Grey blocks in the right column. |
|  | A problem open | Dispatcher · Live day · issue open, its right column | "Needs you · 1", then a card per open problem, oldest first: the time it was raised, "02:33", the title "1 dry carton short", "Fresh Nugegoda · stop 1 · VEH035 · leaves 04:36", the rows "Loader · Kasun · 02:33", "At the dock · 3 of 4 dry cartons" and "Note · Only 3 dry cartons in the store", "What should the loader do?", the two answers as the design's option cards, "Go short" chosen ("The truck leaves with what is at the dock.") and "Load it all" ("The rest comes from stock and goes on."), and "Send to loader" in orange. |
|  | Answer sent | Dispatcher · Live day · issue open · decision sent, its green card | "✓ Sent 02:35" and "VEH035 goes 1 dry carton short, Kasun told", kept until the next answer or a reload. |
|  | Nothing open | No frame | "Nothing needs you right now." |
|  | The rest of the page | No frame | "Live day · Thu 25 Jun" and "1 needs you" in red, spec 010's depot switch in the top bar, and on the left the placeholder "Trucks: each truck's stops on a timeline, and the day's drops and events. Figma: Dispatcher · Live day." (A7). Below 1024 wide the column comes first. |
|  | Could not load, not sent, refused | No frame | "Could not load what needs you." with "Try again". "Could not send. Try again." A refusal shows its sentence and the column is fetched again. |
| Every dispatcher page | The bell | The bell in every dispatcher frame | A red count of open problems over the bell's corner, and a tap opens Live day. No count when none is open, or when the count cannot be read (Live day then shows the error). |

## Rules
Examples use the seeded day, with the walkthrough's plan sent (VEH035 with OUT001's three orders on stop 1 and OUT002's
two on stop 2, leaving 04:36) and,
where two stops are needed, VEH004 with OUT026 and OUT028 as in spec 010's AC-11. Times are depot time.

1. **The loader's day (D-34).** Today when today is an operating day and it is before 16:00, and otherwise the first
   operating day after today. The list holds that day's sent plan. With no operating day left there is no day.

   | The clock says | The loader's day |
   | --- | --- |
   | Wed 24 Jun, 15:59 | Wed 24 Jun, whose seeded plan has no trucks |
   | Wed 24 Jun, 16:00 | Thu 25 Jun, before its plan is sent |
   | Thu 25 Jun, 02:30 | Thu 25 Jun |
   | Thu 25 Jun, 15:59 | Thu 25 Jun |
   | Thu 25 Jun, 16:00 | Fri 26 Jun |
   | Sat 20 Jun, 16:00 | Mon 22 Jun, as Sunday is closed |
   | Sun 21 Jun, 10:00 | Mon 22 Jun |
   | Thu 30 Apr, 17:00 | Sat 2 May, because Fri 1 May is a holiday |
   | Sat 27 Jun, 16:00 | none, the calendar ends on Sun 28 Jun |

2. **The trucks.** A truck on the list is a trip of that plan that is `planned`, `loading` or `ready`: one that is
   `out` or `done` has left (A4). They come in leaving order, then by vehicle and trip number. A trip's leaving time is
   the one in its plan's kept check (spec 010). "Next out" is the first that is not ready, and the others are numbered
   from 2. A trip 2 can be loaded while its truck is still out on trip 1, as loaders put goods ready on the dock. Its
   row then reads "out on trip 1 · back by 06:38" where it says when it leaves, and its page starts with "VEH057 is out
   on trip 1 · back by 06:38. Put the cartons ready on the dock; they go on when it is back.", until trip 1 is checked
   in. The API words the trip and the time against the app clock: once 06:38 has passed and trip 1 is still out, the
   row reads "out on trip 1 · was due back 06:38", since a planned time is the plan's, not a promise. *With VEH004's trip as well, VEH004 leaves at 03:30 and comes first, then
   VEH035 at 04:36.*
3. **Starting (D-33).** "Start loading" makes a `planned` trip `loading`. It takes the planning locks of spec 010 and
   checks that the plan is still sent at the revision the loader's screen showed. From then on the plan cannot go back
   to edit, and View plan says so where "Back to edit" was: "Loading has started, so this plan cannot go back to edit."
   The board carries that sentence in `lockedReason`, and View plan shows it whatever day the board is on by then (Q-19).
   A plan taken back to edit before that leaves the list, which then says no plan is
   out. The drawn "Plan changed" screens come with A7. *Ruwan takes Thursday's plan back at Wed 16:30: Kasun's list
   says no plan is out for Thu 25 Jun. Once Kasun has started VEH035, View plan has no "Back to edit" and an unsend is
   refused with `loading_started`.*
4. **Last stop first (D-35).** Stops are listed from the last to the first, and the current stop is the last one not
   loaded. A stop is marked loaded whole, and only once every stop after it is loaded. *VEH004's stop 2, Fresh Kandana
   with 99 cartons, goes in before stop 1, Fresh Gampaha with 111. Marking stop 1 first is refused: "Load stop 2
   first."* The tick boxes beside a stop's lines are the loader's own checklist: they are not saved and a reload clears
   them. "Stop 1 loaded" works once each line is ticked or flagged. Until the truck is ready, the stop loaded last can
   be taken off again, keeping its counts and flags, and a loaded stop can still be flagged. *With both of VEH004's
   stops on, taking stop 2 off is refused: "Undo stop 1 first. The last stop loaded comes off first."*
5. **What goes out (D-35).** A line goes out at its quantity, at the count the loader gave while its flag is open or
   after "Go short", and at its quantity again after "Load it all". A loaded stop's lines are on the truck. The screen
   shows the units on over the truck's units, and the kilos and cubic metres on so far over the vehicle's limits. The
   weight never rounds up to look full: a vehicle under 2 t shows kilos, and a truck tonnes rounded down.
   *VEH035 carries 118 cartons. With stop 2 loaded, then Nugegoda's dry line flagged at 3 of 4 and stop 1 loaded, 117
   of 118 are on: 807.3 kg and 4.329 m³, shown "807 / 1,040 kg · 4.3 / 7.0 m³".*
6. **Flags (D-36).** A loader flags lines of one stop while its truck is `loading`: a reason (short, damaged, wrong
   item, or won't fit when the truck cannot take it all), the good units at the dock for each line it names (for won't
   fit, the units that fit), from 0 to one less than the line's quantity and at least
   one line, and a note of up to 200 characters, which may be empty. A line is flagged once while its truck loads, so
   the answer about it is never in doubt. The flag stays open until the dispatcher answers it. *Kasun flags OUT001's
   dry line: short, 3 of 4, "Only 3 dry cartons in the store".*
7. **The answer (D-37).** The dispatcher answers an open flag once: "Go short", and the truck leaves with what is at
   the dock, or "Load it all", and the rest comes from stock and goes on. The plan, the stops and the other lines stay
   as they are. The loader sees who answered, when, and one sentence per answer. A won't fit flag gets the same two
   answers, said about room: "The truck leaves with what fits." and "Make room on the truck for the rest." *With "Go
   short" the dry line goes out at 3, and with "Load it all" at 4, as the loader adds the carton before marking the
   truck ready.*
8. **Ready.** A truck is marked ready once every stop is loaded and no flag is open. It becomes `ready` at the app
   clock's time, each of its lines gets its loaded count, and each of its orders becomes `loaded`. An order whose lines
   all go out at 0 is still `loaded`, so the driver and the shop see it missing. *VEH035 ready: 48 and 46 cartons for
   Wellawatte and 12, 8 and 3 for Nugegoda loaded, and OUT001's three orders read "Loaded" on Nadeesha's Orders.*
9. **What the dispatcher sees (D-39).** Live day gets only its "Needs you" column here: the depot's open problems,
   oldest first, each in full with the two answers and "Send to loader". A sent answer becomes one green line until the
   next answer or a reload. The bell on every dispatcher page counts the open problems and opens Live day.
10. **Writes.** Every loader write names the trip's revision and carries an id made on the phone. A write with the id
    of the last write applied to its trip is a retry, answered with the truck as it is, so nothing counts twice. A
    write naming another revision is refused as `stale`. An answer names the problem's revision.
11. **The numbers.** The API works out every count, kilo and cubic metre shown. The screen formats them, counts the
    minutes to leaving from the app clock on screen, draws the bars, and adds nothing up. The one count it makes is of
    the rows it lists ("1 truck", "1 stop", "Needs you · 1" and the bell), as spec 010's screen does.

## Permissions and failure paths
Only a loader with a depot reads and writes the loading day, and only a dispatcher with a depot reads and answers
problems, each on their own depot (D-32). Another role gets 403 `forbidden`, an admin 403 `no_depot`, no session 401
`signed_out`, and a trip, stop, line or problem of another depot 400 `unknown_record`.
A refusal comes with one sentence (`plan.md`, Contracts), which the screen shows in red on top before it fetches again.
- **Two screens on one truck.** The later write names an old revision and is refused with `stale`: "VEH035 changed on
  another screen." The flag form keeps what was entered, so Send works again.
- **The plan changed.** A start from a screen that saw an older plan gets `plan_changed`: "The plan for Thu 25 Jun
  changed after this screen loaded it." When the plan was edited and its trips made again, the trip is gone and the
  answer is `unknown_record`, and an open truck page says the truck is not on the list any more.
- **The day moved on.** A start after 16:00 on the truck's day gets `day_moved`: "Loading has moved on to Fri 26 Jun."
  The list shows the next day. After the calendar's last day there is no day to move on to, and a start gets spec
  010's `no_plan_day`: "No delivery day is left."
- **The dock's signal drops (D-38).** A write with no answer shows "Not saved. Check the connection and try again.",
  and "Try again" sends the same write with the same id, so one that had landed is answered as done.
- **The dispatcher answered in another tab.** `stale`: "This problem was already answered." The column is fetched
  again.
- **A reset.** Spec 008 fetches everything again, and a write caught behind the reset gets `unknown_record`.
- **Out of order or too early.** The screens never offer these, and the server refuses them anyway with `load_order`,
  `stops_left`, `flag_open`, `not_loading` and `already_flagged`.

## Data in and out
Eight endpoints under `/api/v1`, with shapes and steps in `plan.md`. For a loader: `GET /loading`, and `POST
/loading/trips/:tripId/start`, `/stop-loaded`, `/undo-stop`, `/flags` and `/ready`, each answering the loading day.
For a dispatcher: `GET /issues` and `POST /issues/:issueId/decide`. They read the plan tables, orders and their lines,
products, outlets, vehicles, users, the calendar and the problems, and write `trips`, `stops`, `order_lines`, `orders`,
`issues`, `issue_lines` and `audit_log`. After each change commits, `loading` is announced to the depot (D-21). A start
also announces `plans`, a flag and an answer also `issues`, and a ready `orders` to each shop on the truck and to the
depot. Spec 010's send and unsend also announce `loading`.

## Acceptance criteria
API criteria are integration tests on the seeded day of a fresh database, clock set, each file ending with spec 008's
reset. A helper places Nadeesha's draft and sends the walkthrough's plan through specs 009 and 010, with VEH004's trip
to OUT026 and OUT028 added where a criterion says so. *Unit* ones use made-up data. Screens get a click-through in
Nabil's Chrome at 390 wide and 1180 × 820 as `kasun`, and at 1440 × 900 as `ruwan`, from Thu 25 Jun 02:30.

### The loader's day and the list
- [ ] **AC-1** *Unit.* When the loader's day is worked out, the system shall give the day of each row of rule 1's table.
- [ ] **AC-2** When `kasun` reads the loading day at Wed 24 Jun 16:00 before any send, the system shall answer Thu 25
  Jun with no plan and no trucks. At Wed 24 Jun 15:59 it shall answer Wed 24 Jun, its seeded plan and no trucks, and at
  Sat 27 Jun 16:00 no day. It shall write nothing.
- [ ] **AC-3** When the walkthrough's plan is sent, the loading day shall hold one truck: VEH035 trip 1, van, reefer,
  Fresh, Colombo, `planned`, leaving Thu 25 Jun 04:36, Dilshan, 1,040 kg and 7.0 m³, and two stops, last first: Fresh
  Wellawatte with 48 chilled and 46 dry cartons, then Fresh Nugegoda with 12 chilled, 8 chilled and 4 dry: 118 units,
  0 on and 0 short.
- [ ] **AC-4** When VEH004's trip is sent as well, the trucks shall come VEH004, leaving 03:30, then VEH035, and
  VEH004's stops shall come stop 2, Fresh Kandana with 99 cartons, then stop 1, Fresh Gampaha with 111.
- [ ] **AC-5** When the plan is taken back to edit, the loading day shall have no plan and no trucks, and a trip `out`
  or `done` shall not be listed. Spec 010's send and unsend shall announce `loading` to the depot. *A test sets
  VEH004's trip to `out`.*

### Who may call
- [ ] **AC-6** When a request has no session, the system shall answer 401 `signed_out` on all seven endpoints. A store
  manager, a driver, a dispatcher on the loader's endpoints and a loader on the dispatcher's shall get 403 `forbidden`,
  and an admin 403 `no_depot`.
- [ ] **AC-7** When a loader write names a trip, stop or line that is not of the caller's depot, the system shall answer
  400 `unknown_record` with that id and change nothing. *A Kandy plan with one trip, written by the test.*

### What goes out
- [ ] **AC-8** *Unit.* When the counts that go out are worked out, the system shall give a line its quantity with no
  flag, the flag's count while it is open or after "Go short", and its quantity after "Load it all".

### Starting
- [ ] **AC-9** When `kasun` starts VEH035 naming the plan's id and revision, the system shall make the trip `loading`,
  raise its revision, write the audit row `trip.loading_started`, answer the loading day, and after the commit announce
  `loading` and `plans` to the depot. Ruwan's board shall then have `canUnsend` false, and an unsend shall answer 409
  `loading_started` and change nothing.
- [ ] **AC-10** When a start and an unsend of the plan arrive at once, both shall finish and exactly one shall change
  anything: the trip is `loading` and the unsend got `loading_started`, or the plan is a draft and the start got
  `plan_changed`.
- [ ] **AC-11** When a start names a plan that is not sent, or a revision that is not the plan's, the system shall
  answer 409 `plan_changed`, when the trip's day is no longer the loader's day, 409 `day_moved`, and when there is no
  loader's day at all, 409 `no_plan_day`, and change nothing. *The plan taken back to edit, a test raising the plan's
  revision in the database, the clock at Thu 25 Jun 16:00, and the clock set by the test to Sat 27 Jun 16:00.*

### Every loader write
- [ ] **AC-12** When a loader write names a revision that is not the trip's, the system shall answer 409 `stale` and
  change nothing. *Two tablets start VEH035, and the second is stale.*
- [ ] **AC-13** When a loader write arrives again with the id of the last write applied to its trip, the system shall
  answer the loading day as it is and change nothing. *Each of the four writes sent twice in a row writes one audit
  row.*

### Stops
- [ ] **AC-14** When a stop is marked loaded, the system shall write its time from the app clock, raise the trip's
  revision, count its lines as on and announce `loading`. *VEH004's stop 2: 99 of 210 on, 683.1 kg and 3.663 m³.*
- [ ] **AC-15** When a stop is marked loaded before a stop after it, the system shall answer 409 `load_order` naming the
  stop to load first, and on a trip that is not loading 409 `not_loading`, and change nothing. *VEH004's stop 1 first.*

### Flags
- [ ] **AC-16** When `kasun` flags VEH035's dry line short at 3 of 4 with a note, the system shall write an open problem
  with that line and count, the reason, the note, Kasun and the time, raise the trip's revision, and announce `loading`
  and `issues`. The loading day shall show the line going out at 3, 1 short, the stop 23 of 24, and the problem.
- [ ] **AC-17** When a flag lowers no count, gives a count below 0 or not below its line's quantity, names a line that
  is not on its stop or names a line twice, has a reason not in the list or a note over 200 characters, the system
  shall answer 400 and write nothing. A line already flagged shall get 409 `already_flagged`, and a trip that is not loading 409 `not_loading`.

### The answer
- [ ] **AC-18** When `ruwan` reads what needs him, the system shall list the depot's open problems, oldest first, each
  with its truck and leaving time, stop, shop, lines, note, raiser and time. *VEH035, stop 1, Fresh Nugegoda, leaves
  04:36, Kasun, dry cartons 3 of 4.*
- [ ] **AC-19** When `ruwan` answers "Go short", the system shall mark the problem decided with the answer, Ruwan and the
  app clock's time, raise its revision, answer the open list without it and the decided problem, and after the commit
  announce `issues` and `loading` to the depot. The loader's truck shall show the answer, and the dry line shall still
  go out at 3.
- [ ] **AC-20** When `ruwan` answers "Load it all", the line shall go out at 4 and the truck shall have nothing short.
- [ ] **AC-21** When an answer names a revision that is not the problem's, or the problem is already decided, the system
  shall answer 409 `stale`. Another depot's problem shall get 400 `unknown_record`, and an answer not in the list 400
  `invalid_input`. Nothing changes.

### Ready
- [ ] **AC-22** When a truck is marked ready with a stop not loaded, the system shall answer 409 `stops_left` naming the
  stops, with an open flag 409 `flag_open`, and change nothing.
- [ ] **AC-23** When VEH035 is marked ready after the answer, the system shall make the trip `ready` at the app clock's
  time, write the loaded counts 48 and 46 and 12, 8 and 3, make its five orders `loaded` with their revisions up, write
  the audit row `trip.ready`, and after the commit announce `loading` to the depot and `orders` to OUT001, OUT002 and
  the depot.
  Nadeesha's open list shall show the three orders `loaded`. *A second run flags the dry line at 0 of 4 and goes
  short: the dry order is `loaded` with 0 on, and the truck carries 114 cartons, 786.6 kg and 4.218 m³.*

### A reset
- [ ] **AC-24** When a loader write and a demo reset arrive at once, both shall finish, and the write shall be refused
  with `unknown_record` if the reset committed first.

### The screens
- [ ] **AC-25** Today's trucks. Its "Trucks to load" row with the walkthrough's numbers at 390 wide, and the same in the
  tablet frame's two columns at 1180 wide.
- [ ] **AC-26** Load a truck. "Start loading VEH035" opens the truck with the card's numbers, "Now loading · stop 2"
  and its two lines. "Stop 2 loaded" is greyed until each line is ticked or flagged, a reload clears the ticks, and
  marking stop 1 first is not offered.
- [ ] **AC-27** Flag a problem. The dry line picked and lowered to 3, "Short", a note and "Send to dispatcher" bring back
  the truck with "1 short", "23 of 24" and "Mark ready · 1 flag" greyed. The dry line cannot be picked again.
- [ ] **AC-28** Live day. Within a second of the flag the bell shows 1, and Live day shows the card of the screen states
  with "Go short" chosen. "Send to loader" gives the green line and the bell clears.
- [ ] **AC-29** Two browsers. The answer shows on Kasun's phone within a second. "Stop 1 loaded" gives "All stops
  loaded · 117 of 118 on, 1 short", "Mark ready" the ready screen with its two lines, and "Back to trucks" "Every truck is
  loaded" with VEH035 "ready". Nadeesha's Orders shows her three orders "Loaded", and View plan has no "Back to edit".
- [ ] **AC-30** The plan changed before loading. With the list open on the phone, Ruwan takes the plan back to edit and
  within a second the list says no plan is out. A start from a tab opened before shows the sentence of the failure
  paths, and the list loads again.
- [ ] **AC-31** The other states: loading, could not load with the API stopped and "Try again", not saved and "Try
  again" sending the same write, nothing to load, a truck not on the list, and on Live day nothing open and could not
  load. No day left cannot be reached with the demo clock, which stops on Thursday: AC-2 covers the API, and a reader
  checks the state's sentence.
- [ ] **AC-32** No sums in the screen. A reviewer reads `features/loader` and `features/live` and finds no count, kilo,
  cubic metre or short worked out there: only formats, the minutes to leaving, the bars and counts of listed rows.
- [ ] **AC-33** No answer from the past. A reviewer reads `features/loader/loading.ts` and `features/live/issues.ts`:
  after a write the screen fetches the loading day or the problems again and never puts the write's answer in the
  query, so an answer that arrives late cannot bring back an older truck or problem.

## Walkthrough
It follows spec 010's: Nadeesha has placed her draft, and Ruwan has sent Thursday's plan with OUT001's three orders and
OUT002's two on VEH035, Wasantha driving, leaving at 04:36. After the clock moves the times depend on the judge's pace, so the ones below
are examples.

1. Move the clock on to "Loading, Thu 02:30".
2. On a phone, sign in as `kasun`. Today's trucks: "Thu 25 Jun" and "1 truck". Next out: "VEH035 · leaves 04:36", "in 2
   h 6 min · van reefer", "Fresh · Colombo · 2 stops" and "0 of 118 cartons on", and under "Goes in first" "stop 2 ·
   Fresh Wellawatte · 94 cartons" above "stop 1 · Fresh Nugegoda · 24 cartons". Tap "Start loading VEH035".
3. Loading VEH035: "0 /118", "leaves 04:36 · in 2 h 6 min" and "0 / 1,040 kg · 0.0 / 7.0 m³". Now loading · stop 2 ·
   Fresh Wellawatte: tick "48 cartons chilled" and "46 cartons dry" and tap "Stop 2 loaded": "94 /118" and
   "648 / 1,040 kg · 3.5 / 7.0 m³". Now loading · stop 1 · Fresh Nugegoda: "12 cartons chilled", "8 cartons chilled"
   and "4 cartons dry".
4. Tap "Flag a problem", tap the "4 cartons dry" row, keep "Short", tap − once to "3 /4", write "Only 3 dry cartons in
   the store" and tap "Send to dispatcher". Back on the truck: "1 short" on the dry line, "23 of 24" on stop 1, and
   "Mark ready · 1 flag" greyed.
5. Tick the two chilled lines and tap "Stop 1 loaded": "All stops loaded", "117 of 118 on, 1 short", and stop 1's row
   says "Waiting for the dispatcher · flagged 02:33". The card reads "117 /118" and "807 / 1,040 kg · 4.3 / 7.0 m³".
6. In a desktop browser, sign in as `ruwan`. The bell shows 1. Open Live day: "Live day · Thu 25 Jun", "1 needs you",
   and the card "1 dry carton short", "Fresh Nugegoda · stop 1 · VEH035 · leaves 04:36", "Kasun · 02:33", "3 of 4 dry
   cartons" and the note. Keep "Go short" and tap "Send to loader": "✓ Sent 02:35" and "VEH035 goes 1 dry carton short,
   Kasun told". The bell clears.
7. Back on the phone, without a reload: "Ruwan, dispatcher · 02:35" and "Go with 1 dry carton short for Fresh
   Nugegoda.", and "Mark ready" is orange. Tap it: "VEH035 is ready", "117 of 118 on · 1 short, dispatcher told 02:35 ·
   leaves 04:36" and "Wasantha sees the short carton on stop 1 before driving." "Back to trucks" shows "Every truck is
   loaded" and VEH035 "ready 02:36 · 117 of 118 on".
8. As `nadeesha`, Orders shows her three Thursday orders "Loaded". As `ruwan`, View plan for Thu 25 Jun no longer offers
   "Back to edit".

## Out of scope
- **A7:** the loader's "Plan changed" screens (Loader · Plan changed and Today's trucks · plan changed, the banner "Plan
  changed 03:02 · Ruwan, dispatcher", the "changed" chips, "Got it" and the loader's bell count), the rest of Live day
  (its counts, "All trucks", "Problems only" and "Wave 2", the truck rows and timelines with "Decide" and "Decided",
  "Drops and events", "Undo" after an answer, and "Next · … · Open next"), and changing a plan once a truck is loading,
  such as taking an order off it or swapping the truck. Spec 016 built these, without "Wave 2" and "Undo"; changing a plan
  once loading has begun stays out (D-70).
- **A4:** the driver's side of a ready truck (the loaded counts on the phone, leaving and coming back as `out` and
  `done`), the driver's problems as new kinds with their answers ("Bring them back to Kandy", "Send 2 replacements",
  "Write off on the road", "Send to driver and shop"), and the photo store (D-22) the flag's photo waits for.
- **A5:** the shop's receipt, its short or damaged report as a kind of problem, and the loaded counts on the shop's
  screens.
- **A6:** the no-signal screens. The loader frames draw none, and the loader works online (D-38).
- **B4:** the planner.
- **Not planned:** waves, dock numbers and the call buttons (D-40), scanning (D-12), a printed loading list, the shift's
  name, and a Kandy loader on screen, since Kandy has no loader account. The API serves any depot's loader.

## Departures from the design
1. One list in leaving order, with no "Wave 1 · 03:30" and "Wave 2 · 08:30" tabs, no dock numbers, no "Call the
   dispatcher" and no "Call Prasanna" (D-40).
2. The day line has no shift name ("night shift"), and the place reads "Peliyagoda dock" on every device.
3. Every stop has its own row, where the design joins the last two ("stops 2, 1").
4. A stop lists its lines. For Fresh these are the drawn chilled and dry rows, and Style and Tech lines also name the
   item ("10 boxes · Folded clothing").
5. The flag has no photo until open question 1 is settled.
6. The load figure is what is on the truck so far.
7. The dispatcher answers a loader's flag with "Go short" or "Load it all" and "Send to loader" (D-37), and there is no
   "Undo" (A7). The design draws answers only for the driver's problems.
8. The loader's answer sentence says what was chosen. The design's "The shop has been told and it goes on Monday's run"
   would need a new order for the missing cartons, which nothing here makes; the shop sees them short at receipt (A5).
9. The ready screen names the trip's driver ("Dilshan sees the short carton on stop 1 before driving."), where the
   design names Kasun, who is our loader.
10. Live day's "Needs you" column shows every open problem in full (D-39), and spec 016 keeps it so beside its trucks.
11. States the design lacks: no plan out, nothing to load, every truck loaded, no day left, a truck not on the list,
    waiting for the answer, saving, not saved, refused, and nothing needs you.

## Open questions
1. **A photo on the flag now, or with the driver's proof photos?** The flag frame has a Photo button, and storing
   photos (D-22) is A4's work anyway. Our pick: with A4. The flag gets its photo in a small task once A4's photo store
   is in, and until then the README lists it as a departure.
2. **Show "last stop first" in the walkthrough with a second stop?** Decided: yes, at spec 010's join. VEH035 has one stop, so a judge never sees the load
   order. Our pick: yes. In spec 010's walkthrough Ruwan adds OUT002's two orders (Fresh Wellawatte, van only, Colombo:
   48 chilled and 46 dry cartons) after OUT001's, so VEH035 still leaves at 04:36, reaches Fresh Nugegoda at 05:00 and
   Fresh Wellawatte at 05:24, and carries 118 cartons, 814.2 kg and 4.366 m³ of its 1,040 kg and 7.0 m³. Kasun then
   loads Fresh Wellawatte first, and the steps above change their counts to match. The lead settles this at spec
   010's join, where the board gives the real numbers, before A3's builders start.
3. **May a loader start a truck the evening before?** Thursday's trucks show from Wed 16:00 (D-34), and starting one
   ends "Back to edit" for Thursday's plan (D-33). Our pick: yes. The walkthrough moves the clock to Loading first, and
   a real night shift starts when the goods are picked, which the app cannot know.
