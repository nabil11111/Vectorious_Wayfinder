# Detailed demo walkthrough

The full rehearsal with expected counts, problem cases and suggested planning.
For the short route through all four roles, start with the [README](../README.md#judge-walkthrough).

## Judge walkthrough

One order's journey through the seeded day. Start clean with `docker compose up` and http://localhost:3000, or
press **Reset the demo day** in the demo clock. The shared hosted reset affects every user, so use a local
instance or coordinate the reset with the team. Two browsers (or one normal and one private window) let you watch
one role's change reach another's screen within a second. The expected counts below assume this exact sequence with no extra orders or edits. Times depend on your
pace, so the clock times below are what the demo clock shows.

1. **The shop orders.** Sign in as Nadeesha (`S-001`) at Wed 24 Jun 15:00. Today shows her draft for Thu 25 Jun: 8
   chilled and 4 dry cartons. Continue it, change a number if you like, and place both orders. The confirmation
   says orders for Thursday close at 16:00.
2. **Orders close.** Open the demo clock in the top bar and move it to "Orders closed, 16:00".
3. **The dispatcher plans.** Sign in as Ruwan (`P-001`) and open the Plan board: "Plan for Thu 25 Jun", 104 unplanned
   orders, 4 of them carried over from earlier plans (Fresh Dickwella, deferred twice, first), and 35 working
   trucks with 3 in the workshop. The seeded day is short of fridge trucks on purpose.
4. **A trip.** Drag Fresh Nugegoda's row from the Fresh · Colombo group into the empty middle. The crew picker opens
   there: a truck and its driver on each row, "Wasantha · reefer van · 1.0 t · 7 m³" first with "fits · fuel 53% left",
   the only crew that fits (Nugegoda and Wellawatte take vans only, and the chilled cartons need a fridge). The
   trucks after it say why they may not fit, such as "cannot reach Fresh Nugegoda: van only", and the three in the
   workshop come last, greyed. Pick Wasantha: the trip opens as "Planning · Wasantha · reefer van" with Nugegoda's two
   new orders, and "Fresh Nugegoda added to Wasantha's reefer van" with **Undo**. (The group's **Start a trip** opens
   the same picker for all of Colombo's orders.) Add Nugegoda's 12 carried-over chilled cartons from Carried over,
   and Wellawatte. The trip leaves 04:36, reaches Fresh Nugegoda at 05:00 and Fresh Wellawatte at 05:24, and is back
   at 06:10. Every change is saved and checked at once. Undo in the header (or Ctrl+Z) takes the last change back, its
   tooltip naming it, such as "Undo: Fresh Wellawatte added to Wasantha's reefer van", and Redo (Ctrl+Shift+Z) makes it
   again.
5. **Everything else waits, with a reason.** Defer each other group from its ⋮ menu with a reason the shop will
   read, such as "No fridge truck was left for Colombo.", until nothing is unplanned.
6. **Send.** Mark the trip done and open **View plan**: 5 of 104 orders on 1 trip, 99 deferred, checks all
   clear. Send the plan to loaders and drivers.
7. **The shop sees it.** As Nadeesha (`S-001`), the bell in the top bar has a red count. Press it: a small pop-up (a sheet
   from the bottom on a phone) lists her updates, newest first, and its top row reads "Thursday's delivery is planned:
   Wasantha's reefer van, window 05:00 to 07:30" with the time Ruwan sent it. Pressing the row opens Today, and **Mark all
   read** clears the count. Orders shows her three orders "Planned · Thu 25 Jun". **Withdraw plan and edit**
   on the sent View plan turns it into a draft again until loading starts, and her cards follow within a second.

8. **Loading, last stop first.** Move the demo clock on to "Loading, Thu 02:30" and sign in as Kasun (`L-001`) on a phone (or
   a narrow window). His bell's top row reads "Thursday's plan is out: 1 truck to load". Today's trucks: VEH035 leaves
   04:36, in 2 h 6 min, and "Goes in first" lists stop 2, Fresh Wellawatte (94 cartons), above stop 1, Fresh Nugegoda
   (24). Start loading, tick Wellawatte's two lines and press
   **Stop 2 loaded**: "94 /118" and "648 / 1,040 kg · 3.5 / 7.0 m³".
9. **A problem at the dock.** On Fresh Nugegoda press **Flag a problem**, pick the 4 dry cartons, keep Short, count 3,
   add a note and send it to the dispatcher. The dry line reads "1 short", and Mark ready waits for the answer.
10. **The dispatcher answers.** As Ruwan (`P-001`), the bell shows 1: "Kasun flagged 1 dry carton short for Fresh Nugegoda
    on Wasantha's reefer van". Press the row, or **Open Live day** at the pop-up's foot: Live day's "Needs you" holds the
    card "1 dry carton short · Fresh Nugegoda · stop 1 · VEH035". Keep **Go short** and press **Send to loader**.
11. **Ready.** On Kasun's phone the answer shows without a reload, and a toast says "Ruwan answered on VEH035: Go with 1
    dry carton short for Fresh Nugegoda." with **Open**. Tick the chilled lines, press Stop 1 loaded and then
    **Mark ready**: "VEH035 is ready · 117 of 118 on · 1 short". Nadeesha's three orders now read "Loaded", and View plan
    says "Loading has started, so this plan cannot go back to edit." where Withdraw plan and edit was.

12. **The driver's trip.** Move the demo clock on to "Trucks leave, Thu 03:30". On a phone, or Chrome at 390 wide,
    sign in as Wasantha (`D-036`). His bell holds "Your trip for Thursday is sent: VEH035 leaves 04:36 with 2 stops" and
    "VEH035 is loaded and ready: 117 of 118 on, 1 short". Today's trip: "VEH035 · leaves 04:36", "✓ Loaded · 117 of 118 ·
    1 dry short for Nugegoda",
    then "1 · Fresh Nugegoda · 23 of 24 cartons" and "2 · Fresh Wellawatte · 94 cartons". Press **Start trip**.
13. **A delivery.** Next stop: "Stop 1 of 2 · Fresh Nugegoda", "Unload 23 cartons · 20 chilled · 3 dry" and the shop's
    note. Press **I've arrived**, count 12 and 8 chilled and 3 dry ("Loader flagged 1 carton short at the depot" sits
    under the dry line; a typed 15 or -3 stays as typed with a line under it, and Done unloading waits), press **Done
    unloading**, then **Take photo** (on a laptop, pick any picture) and **Save
    delivery**: "✓ Stop 1 Fresh Nugegoda delivered · synced" and "Stop 2 of 2 · Fresh Wellawatte".
14. **No signal.** Turn the network off: DevTools, Network, "Offline". Press **I've arrived**: the chip turns "Offline"
    with 1 waiting. Press **Something's wrong**, keep "Shop refused some", pick "48 cartons chilled", press + on Refused
    twice ("Accepted 46/48", "Refused 2/48"), choose **Damaged**, write a note and press **Save partial delivery**:
    "Saved on this phone". Press **Continue route**: Trip done, worked out on the phone, with "Cartons delivered 115 of
    118", "Refused 2 · Wellawatte" and "Short from the depot 1 dry · Nugegoda". Reload the page with the network still
    off: it opens on the same screen.
15. **Back online.** Turn the network back on: within seconds "Back online · 1 stop sent · Wellawatte reached the depot",
    and the chip turns "Online".
16. **The dispatcher answers.** As Ruwan (`P-001`), the bell's top row reads "Fresh Wellawatte refused 2 chilled cartons
    from Wasantha's reefer van: damaged"; press it. Live day's card: "2 chilled cartons refused", "Fresh
    Wellawatte · stop 2 · VEH035 · Wasantha · damaged, the shop took 46 of 48 chilled", with **Bring them back to
    Peliyagoda** chosen. Press **Send to driver**: "✓ Sent · VEH035 · 2 cartons back to Peliyagoda, Wasantha told".
17. **Back at the depot.** On Wasantha's phone, without a reload, a large card pops up over the screen: the answer's picture,
    "Bring back · 2 chilled", and under it, small, "Ruwan" with the time and "Bring the 2 chilled cartons back to
    Peliyagoda." A tap or a swipe closes it, and it goes by itself after 8 seconds. The trip's top line then keeps only
    "Bring back · 2 chilled", and the full sentence stays in the bell's pop-up. Press **I'm back at the depot**: "✓ Trip closed · 2 of 2 stops · all records sent". Nadeesha's three
    Thursday orders now read "Delivered".

18. **Watching the day.** Ruwan's **Dashboard** and **Live day** follow every step from 12 on without a reload. Before
    the trucks leave the Dashboard reads 0 need you, "0 / 2 stops delivered", "0 / 38 trucks out", 99 orders for Friday,
    37% of the week's fuel and 99 deferred, and Live day lists VEH035 ready with its planned times (leave 04:36,
    Nugegoda 05:00, Wellawatte 05:24, back 06:10) and the loading events. Once Wasantha delivers, Live day shows "23
    delivered · photo" in its events, and after the refusal the Dashboard's **Decide** opens the problem's card on Live
    day, where "Send to driver" turns the truck's row to "Decided".

19. **The shop confirms.** Move the demo clock on through "First windows, Thu 05:00", "Some shops open, Thu 06:30" and "Most shops open, Thu 07:30" to "Morning deliveries done, Thu 08:30". As Nadeesha (`S-001`) on a phone, Today shows her three
    Thursday orders "Delivered", the dry one "3 of 4 delivered · 1 short from the depot". Open **Deliveries**: "Confirm
    delivery", each line against what the driver handed over (12 and 8 chilled, 3 dry with "1 short from the depot"), and
    "Still cold on arrival?" with Yes. On the first card press − once: "1 carton missing", and beside it "What's wrong?"
    with Missing; each short line has its own. "Note for the depot (optional)" takes a note of up to 200 characters.
20. **A receipt with no signal.** Turn the network off and press **Confirm delivery**: "Receipt saved on this phone",
    "Received 11 cartons · Missing 1 carton", "Saved at 08:30 · waiting to sync". Reload with the network still off: the
    same screen opens. Turn it back on: "Receipt sent to the depot" and "Sent at 08:31 · shortage unresolved".
21. **The depot replaces it.** As Ruwan (`P-001`), the bell's top row reads "Nadeesha reported 1 chilled carton missing at
    Fresh Nugegoda"; press it. Live day: "1 chilled carton missing", "Shop · Nadeesha",
    "Received · 11 of 12 chilled cartons, 1 missing", "Cold on arrival · yes", with **Send 1 replacement on Fri 26 Jun** chosen.
    Press **Send to shop**: "✓ Sent · Fresh Nugegoda · 1 replacement on Fri 26 Jun, Nadeesha told".
22. **The shop sees it.** On Nadeesha's phone, without a reload, a toast says "The depot answered your report, 1 chilled
    carton missing: a replacement comes on Fri 26 Jun", and the receipt says "replacement on Fri 26 Jun". Orders,
    Past: "12 chilled cartons · 11 received · 1 short" with "1 missing chilled carton: a replacement comes on Fri 26 Jun", "8 chilled cartons ·
    All 8 received" and "4 dry cartons · 3 received · 1 short". Open: "1 chilled carton · Waiting for the delivery plan ·
    Replacement for Thu 25 Jun".

At step 16 Ruwan can also answer Wellawatte's refusal with **Send 2 replacements on Fri 26 Jun**: Wasantha still brings the
2 cartons back, and Wellawatte gets a placed order of 2 chilled cartons for Friday's plan.

**A closed shop.** At step 14 choose "Shop closed" instead and press **Save attempt and move on**: Ruwan's card reads
"Nobody at Fresh Wellawatte". **Try again on this trip** makes Wellawatte Wasantha's next stop again, and delivering it ends
at 117 of 118. **Bring them back** ends with "Hand them in; they go on the next run.", and Wellawatte's two orders are
placed again for Friday's plan: they leave "Coming today", and the shop's Today says what happened to each under "Not
coming today", "48 chilled cartons brought back to the depot · waiting for the next plan", with "planned for Fri 26 Jun"
once Friday's plan takes it. Orders reads "48 chilled cartons: brought back to the depot, waiting for the next plan"
with no day until then.

**More shops ordering.** For a presenter at step 1: signed in as Ruwan (`P-001`) with orders still open, open the demo
clock, press **Add sample shop orders**, choose "25 shops" and press **Place the orders**. "Placed 25 orders at
Peliyagoda: 10 from shops that hadn't ordered, 15 top-ups.": the seeded day leaves only four Style and six Tech shops
without an order, so 15 shops that already ordered add a few cartons, boxes or one crate. Nadeesha's draft is left
alone. The same press after a reset places the same orders. Step 3 then counts 129 unplanned orders, and **Reset the
demo day** takes them away again.

**A second trip.** A truck the plan sends out twice, such as VEH057 at Kandy, gives its driver both trips. **I'm back at the
depot** on trip 1 opens trip 2's Today's trip under "✓ Trip 1 closed · 4 of 4 stops · all records sent · checked in
03:56", with trip 1's hand-back card ("Still on the truck", what to hand in) until trip 2 starts. After trip 2, Day done
shows a line per trip, "Trip 1 · 4 of 4 stops · 105 of 144 cartons delivered · 39 handed back", the day's totals, and
"Trip 3 · none today".

**The bell.** Every role's bell counts the person's unread updates and opens them, newest first, up to 30, each with its
picture, line and time, and a press goes where the person acts on it. They are read from what the walkthrough recorded,
so a reset brings back the seeded day's. Nadeesha hears of her orders placed, her delivery planned or moved to another
day with its reason, the truck leaving, the driver arriving, delivering, being refused or finding the shop closed, and the
depot's answer to her report. Ruwan hears of every new problem and of each truck ready, leaving and back, for the depot
on show (both under Both). After he sends one depot, the bell warns him when the other still has orders and no sent plan,
and that row switches him to its plan board. Kasun hears that the plan is out, changed or taken back to edit, and Ruwan's answers to the
dock's flags. Wasantha hears of his trip sent or changed, his truck ready and Ruwan's answers. A new update also shows as
a toast with **Open**, once in each tab, and plays a short sound while Wayfinder is open. The pop-up's **Turn sounds off**
keeps it quiet. **Turn on alerts when Wayfinder is in the background** asks the
browser, and the app never asks on its own; permission allows the open page to show system notifications while hidden.
Delivery after the page is suspended also needs configured VAPID keys, a successful push subscription and
a supporting browser/OS. Notification permission alone does not confirm that server push is connected. What has been read is kept in the browser, per account and demo day, so a new device starts with
the day's updates unread.

### The look-up pages

After step 22, Ruwan can look the day up. The three pages only read what the walkthrough recorded (D-80).

23. **Orders.** As Ruwan, open **Orders**: "Orders for Thu 25 Jun", "104 orders · 5 planned · 99 deferred · 4 carried over
    from earlier days". Nugegoda's three orders read "VEH035 · 1" and "Received"; press the one wanted Wed 24 for its
    lines and its history ("deferred · The fridge van was full." on Wed 24, then planned on VEH035). Search and the
    filters run on the page, and Skipped lately lists the shops deferred most in four weeks.
24. **History.** Open **History**: "History · Thu 25 Jun", "1 trip", "118 ordered · 117 loaded · 115 handed over", "1 short
    from the depot" and "2 refused", with "Not delivered · 1" (Fresh Wellawatte, "Return instructed") and "Shop
    confirmations · 1" on the right. Press **Open** on VEH035: the planned and recorded times, every line at each stop,
    Nugegoda's proof photo and the shop's confirmation ("3 orders · 22 cartons received"), Kasun's flag answered Go
    short, and Wellawatte's refusal answered Bring them back.
25. **Fleet.** Open **Fleet**: "38 vehicles", "3 in the workshop today" with their reasons, and each vehicle's fuel left
    this week, lowest first. Press a vehicle for its limits, its fuel week and its latest sent trips.

### The suggested plan

The planner builds the same day in one press. It has its own short walkthrough, because the one above plans by hand.
Press **Reset the demo day** first if you walked the one above.

1. **Orders close.** Move the demo clock to "Orders closed, 16:00". Nadeesha's draft stays a draft, so 102 orders are
   due.
2. **The empty board.** As Ruwan (`P-001`), the Plan board shows "Unplanned · 102" with "Carried over · 4" (Fresh Dickwella,
   deferred twice, first), "0 / 35 trucks", "0 / 102 orders", "37% fuel this week" and "0 / 140.7 m³ fridge space".
   In the middle, "Build the suggested plan" in orange.
3. **Build it.** Press it: "Building the plan · 102 orders · 35 trucks", then View plan opens for the day with
   "Suggested plan · 16:00", "96 / 102 orders placed", "6 deferred", "26 / 35 trucks · 27 trips", "96 / 96 windows
   met", the trucks by brand and district, "Decisions · 6" and a greyed "Send plan · 6 decisions open". Press **← Back
   to edit**: "Unplanned · 0", "Done · 27 trips", each card naming its truck by its usual driver ("Priyantha · reefer
   truck · Fresh · Matara"), "26 / 35 trucks", "96 / 102 orders", "41% fuel this week" and
   "57.02 / 140.7 m³ fridge space". "Deferred · 6" holds
   the chilled orders of four Kurunegala shops (Pannala, Polgahawela, Wariyapola, Mawathagama) and two Puttalam shops
   (Wennappuwa, Puttalam), each with the sentence the shop will read, such as "The order for Fresh Pannala didn't
   fit this suggested plan's fridge trucks on Thursday; try it by hand on the board." Each could go alone on an empty
   fridge truck, so none says it cannot be delivered. The middle says "Suggested plan · 16:00 · 6 decisions to
   make".
4. **Ask why.** Under Done, open Priyantha's reefer truck, the Fresh · Matara trip. Its timeline runs from "Peliyagoda 03:30" to "back
   09:34", and pointing at Fresh Dickwella's dot shows "Stop 3 · Fresh Dickwella", "arrives 06:37 · leaves 06:52",
   "window 03:00 to 08:00" and "39 cartons chilled". Press **Plan reason** on Fresh Dickwella: "Rank 1: waited since Tuesday;
   chilled; …". Press **Plan reason** on a deferred order: its rank, the closest run the planner tried and when that run would
   have arrived, and "to decide".
5. **An ordinary edit.** Open Wasantha's reefer van, the trip with Fresh Nugegoda's carried-over cartons. His name in
   the header is the driver menu: Dilshan's row says "drives VEH001 now; it will have no driver". Choose him: the
   header reads "Planning · Dilshan · reefer van", VEH001's card "reefer truck VEH001 · no driver", and "Dilshan moved
   from VEH001, which has no driver now" shows with **Undo**. It is one change, saved and checked like any other.
   Press **Undo**: Wasantha drives the van again and Dilshan VEH001.
6. **Decide and send.** Open **View plan**: "Suggested plan · 16:00", "Decisions · 6" and a greyed "Send plan · 6
   decisions open". Press **Accept all 6**: "Decisions · all made", and "Checks · 2" keeps the long wait and the Fresh
   workload listed with "Ready, with warnings". Press **Send plan to loaders and drivers**: "✓ Sent 16:06 ·
   loaders and 26 drivers".

## What the plan assumes

Every plan, suggested or hand-made, is timed, fuelled and checked from the booklet's data, which is coarse in places.
The checker and the planner assume the following; none of it is calibrated against real trips, so a planned time is
the plan's estimate, not a promise.

- **Legs are district averages.** A trip's drive out is the depot-to-district figure, and each hop between shops is
  the district's average leg. Two routes through the same shops in another order come out the same in distance and
  fuel.
- **Clear roads.** Drive times are the free-flow figures, with no traffic, monsoon or disruption, so a checked
  arrival can be optimistic.
- **A fixed unloading allowance per stop.** Each stop takes the booklet's minutes for its brand and dock type,
  whatever the quantity.
- **The drive back takes as long as the drive out.** The data has no return leg.
- **A 30-minute reload** between a vehicle's two trips (a setting).
- **Every truck has a tail lift and no van does.** The fleet data has no such field (D-24). A tail-lift item on a van
  is a warning that says "vans are taken to have no tail lift", because a van-only shop may have its own way to
  unload.

