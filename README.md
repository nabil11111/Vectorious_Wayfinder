# Vectorious_Wayfinder

Wayfinder plans and runs a delivery day for Waypoint Group, from the store's order through planning,
loading and delivery to receipt at the outlet. Built by team Vectorious for the Tech-Triathlon 2026
Hackathon.

> Work in progress. The sections below are the ones the booklet requires, and they get filled in as the
> build lands.

## Setup

You need Docker. Nothing else.

```bash
docker compose up
```

Open http://localhost:3000. The first start builds the image, creates the database, applies the migrations and
loads the seed data (the booklet's 120 outlets, 60 vehicles, calendar, travel times and service allowances, plus
our product list and demo accounts). Later starts keep whatever you changed.

The outlet names are ours, because the booklet's data has only ids: each outlet is named after a real town or
mall in its district (`data/fixtures/outlet-names.csv`).

To start again from an empty database: `docker compose down -v && docker compose up`.

### The demo day

The seed writes one realistic delivery day: Thursday 25 June 2026 from the Peliyagoda depot, with 98 placed
orders, four chilled orders that earlier plans left out (one of them twice), three vehicles in the workshop and
the week's fuel used so far.
It is short of fridge trucks on purpose, so the plan has to defer and explain.
The same Thursday has Kandy's orders too, 64 from its 45 shops by the same rules, for a dispatcher who switches to Kandy.

The app runs on its own clock, the same for every screen, starting on Wednesday 24 June at 15:00 with orders
open. The demo control in the top bar moves the whole app to the next part of the day (orders close at 16:00,
loading at 02:30, trucks leave at 03:30, delivered by 08:30) and can reset the day to the seed. Every open
screen follows at once. `DEMO_MODE=false` runs on the real clock with no seeded day.
An install seeded before the shop's receipt keeps its old shop history until **Reset the demo day** is pressed once.

### Working on the code

```bash
cp .env.example .env
docker compose up -d db      # Postgres on localhost:5433
npm install
npm run db:migrate && npm run db:seed
npm run dev                  # API on :3000, web app on :5173
npm test                     # needs the db running
```

An install seeded before staff IDs and PINs gets them from the seed: after pulling, run
`npm run db:migrate && npm run db:seed` once. `docker compose up` does both on every start.
An install seeded before every shop had an account gets the new accounts and Kandy's orders the same way, with
`npm run db:migrate && npm run db:seed`, and nothing it already has changes.

Changed the schema in `apps/api/src/db/schema`? Run `npm run db:generate` and commit the new file in
`apps/api/drizzle` with it. CI fails if they disagree.

## Configuration

Every setting is in `.env.example`, and `docker compose up` works without a `.env` file.

| Variable | What it does |
| --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Database login used by compose |
| `SEED_PIN` | Four-digit PIN of the seeded demo accounts |
| `SEED_ADMIN_PIN` | Four-digit PIN of the seeded admin account |
| `TRUST_PROXY` | Proxies in front of the app: `0` when reached directly, `1` on Railway |
| `DEMO_MODE` | `true` runs the app on its own clock with the seeded delivery day. `false` uses the real clock and seeds no day |
| `LIVE_HEARTBEAT_MS`, `LIVE_MAX_STREAMS` | The live stream to open screens: how often it sends a heartbeat, and how many streams may be open at once |
| `DATABASE_URL` | Only for running the API outside Docker |

## Seeded accounts

PIN for the demo accounts: `1234` (`SEED_PIN`). Admin has its own: `9024` (`SEED_ADMIN_PIN`).

| Role | Staff ID | Name | Where |
| --- | --- | --- | --- |
| Store manager | `S-001` | Nadeesha | Fresh Nugegoda (OUT001) |
| Store manager | `S-002` | Ishara | Style Liberty Plaza (OUT017) |
| Store manager | `S-003` | Tharindu | Tech Matara (OUT064) |
| Dispatcher | `P-001` | Ruwan | Peliyagoda depot |
| Loader | `L-001` | Kasun | Peliyagoda depot |
| Driver | `D-036` | Wasantha | Peliyagoda depot, the usual driver of VEH035, the fridge van. 34 more drivers there, one per working vehicle (`D-001` Dilshan, `D-003` Chaminda and so on to `D-035`), for the plan board |
| Driver | `D-002` | Prasanna | Kandy depot |
| Admin | `A-001` | Admin | Everything |

Every shop has an account, so a test run can sign in as any of the 120: `S-004` to `S-120` are the other shops in
outlet order (OUT002 is `S-004`). Kandy has a driver for each of its 22 vehicles, Prasanna and `D-037` to `D-057`,
and a loader, `L-002` Sarath. [`docs/accounts.md`](docs/accounts.md) lists every account with its shop or depot.

## Judge walkthrough

One order's journey through the seeded day. Start clean with `docker compose up` and http://localhost:3000, or
press **Reset the demo day** in the demo clock. Two browsers (or one normal and one private window) let you watch
one role's change reach another's screen within a second. Times depend on your pace, so the clock times below
are what the demo clock shows.

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
   read** clears the count. Orders shows her three orders "Planned · Thu 25 Jun". **Back to edit**
   on View plan turns the plan into a draft again until loading starts, and her cards follow within a second.

8. **Loading, last stop first.** Move the demo clock on to "Loading, Thu 02:30" and sign in as Kasun (`L-001`) on a phone (or
   a narrow window). His bell's top row reads "Thursday's plan is out: 1 truck to load". Today's trucks: VEH035 leaves 04:36, in 2 h 6 min, and "Goes in first" lists stop 2, Fresh
   Wellawatte (94 cartons), above stop 1, Fresh Nugegoda (24). Start loading, tick Wellawatte's two lines and press
   **Stop 2 loaded**: "94 /118" and "648 / 1,040 kg · 3.5 / 7.0 m³".
9. **A problem at the dock.** On Fresh Nugegoda press **Flag a problem**, pick the 4 dry cartons, keep Short, count 3,
   add a note and send it to the dispatcher. The dry line reads "1 short", and Mark ready waits for the answer.
10. **The dispatcher answers.** As Ruwan (`P-001`), the bell shows 1: "Kasun flagged 1 dry carton short for Fresh Nugegoda
    on Wasantha's reefer van". Press the row, or **Open Live day** at the pop-up's foot: Live day's "Needs you" holds the
    card "1 dry carton short · Fresh Nugegoda · stop 1 · VEH035". Keep **Go short** and press **Send to loader**.
11. **Ready.** On Kasun's phone the answer shows without a reload, and a toast says "Ruwan answered on VEH035: Go with 1
    dry carton short for Fresh Nugegoda." with **Open**. Tick the chilled lines, press Stop 1 loaded and then
    **Mark ready**: "VEH035 is ready · 117 of 118 on · 1 short". Nadeesha's three orders now read "Loaded", and View plan
    says "Loading has started, so this plan cannot go back to edit." where Back to edit was.

12. **The driver's trip.** Move the demo clock on to "Trucks leave, Thu 03:30". On a phone, or Chrome at 390 wide,
    sign in as Wasantha (`D-036`). His bell holds "Your trip for Thursday is sent: VEH035 leaves 04:36 with 2 stops" and
    "VEH035 is loaded and ready: 117 of 118 on, 1 short". Today's trip: "VEH035 · leaves 04:36", "✓ Loaded · 117 of 118 · 1 dry short for Nugegoda",
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

19. **The shop confirms.** Move the demo clock on to "Delivered by 08:30". As Nadeesha (`S-001`) on a phone, Today shows her three
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
on show (both under Both). Kasun hears that the plan is out, changed or taken back to edit, and Ruwan's answers to the
dock's flags. Wasantha hears of his trip sent or changed, his truck ready and Ruwan's answers. A new update also shows as
a toast with **Open**, once in each tab. The pop-up's **Turn on alerts when Wayfinder is in the background** asks the
browser, and the app never asks on its own; once allowed, an update that comes while the tab is hidden shows as a
system notification. What has been read is kept in the browser, per account and demo day, so a new device starts with
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
   "window 03:00 to 08:00" and "39 cartons chilled". Press **why?** on Fresh Dickwella: "Rank 1: waited since Tuesday;
   chilled; …". Press **why?** on a deferred order: its rank, the closest run the planner tried and when that run would
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

## Departures from the design

Anything we built differently from our Designathon submission, and why.

- **Sinhala and Tamil come later.** The language buttons on the sign-in page show as designed and say so (D-91).
- **The demo clock and its control are ours.** The design shows the time of day. The app keeps its own clock so
  a judge can walk a whole delivery day in minutes, and the control that moves it (and resets the day) exists
  only in demo mode.
- **A placed order cannot be edited.** The confirmation says "Orders for Thursday close at 16:00 today" where
  the frame says "Edits close at 16:00 today". A shop that needs more places another order for the same day: the
  confirmation names the order just placed and lists the day's earlier orders apart, each with its own time, and a
  second screen whose draft was placed elsewhere says so and links to it.
- **Shop cards show only what exists so far.** Arrival times, the vehicle and driver, "Running late",
  "Delivery help", "Tuesday works for me", "All 6 received" and "plan updated" come with the dispatcher's,
  driver's and receipt pieces.
- **The shop's order form.** The number between − and + can also be typed. The tail-lift line names every item
  that needs one, where the frame names only the fridge crate. Tech's form has the note for the driver, which the
  Tech frame leaves out. The note uses 16 px text on phones, so iOS does not zoom in. A typed number takes whole
  numbers from 0 to 999 and says so under the box rather than changing what was typed, and the note counts down to
  its 200 characters. Place pressed while a change is saving waits for the save, and Sign out waits for it too.
- **Shop states the design does not draw:** nothing started, empty lists, could not load, not saved, day
  closed, no open day, and "Could not update. This may be out of date." when a background refresh fails. The
  desktop Style and Tech forms, confirmation and Help have no frames, so they follow the desktop Fresh form.
- **Today after placing** keeps the date and the shop's name as its header, where the frame has the title "Today".
- **OUT001** has a street entrance and van-only parking in the booklet's data, where the design shows a rear dock.
- **The bell's pop-up is ours.** The frames draw the bell and its red count, and no frame draws what it opens. It is
  one pop-up for all four roles, built from the style guide's card and the design's 3D icons: a popover under the bell
  from 1024 wide and a sheet from the bottom below, with "Mark all read", the role's own link at its foot ("Open Live
  day" for the dispatcher, "See what changed" for the loader) and the button that turns on background alerts. The
  count is the person's unread updates, where the dispatcher's bell counted open problems and the loader's the plan's
  changes, and every role's bell now opens (D-99). A new update also shows as a toast, which no frame draws.
- **Below 1024 wide the nav is bottom tabs** for every role, and the name beside the avatar waits until 1320, so
  the dispatcher's six tabs fit the top bar.

**The plan board and View plan**
- **"why?" gives the planner's reason for an order.** The design's why chips, which ask why the dispatcher changed
  the suggestion, are not built (D-55).
- **Building shows a moving bar,** since one request has no progress to report, and its line has no "16 windows to
  check".
- **The planner's decisions are a card on View plan** in the Suggestions card's place, with Accept, "Accept all" and
  "Open in edit" (D-54). The design draws none.
- **No "Changes · N" and no "Back to the suggestion"** in the board's header. View plan says when the plan was
  suggested, with no switch between the suggested and the edited plan.
- **A build opens View plan,** where the suggested plan's trips, decisions and checks are laid out. The design stays
  on the board.
- **The empty middle takes a drop** in place of "Start a blank trip": "or drag an order here to start a trip" opens
  the crew picker there and starts the trip with the order. Orders, shops and whole groups also drag onto the open
  trip's stops or a trip's card in Done, and stops drag along their list, back to Unplanned orders or onto another
  trip's card, by pointer or keyboard (D-98). Every button and menu stays, so the walkthrough runs on them alone.
- **Orders are named by shop, amount and wanted day.** The design's order numbers (WF-2402) do not exist here.
- **The depot switch** works for Peliyagoda, Kandy and Both (D-93, D-96) and shows from 1280 wide. Both shows the two
  depots together: the dashboard adds them up and marks each row with its depot, and Live day, Orders, History and
  Fleet show Peliyagoda's part and then Kandy's. No frame draws a Both screen, so each page keeps its own layout. A plan
  belongs to one depot, so on Both the plan board and View plan ask which depot to plan and switch to it.
- **No "Unassigned trucks" panel.** A dispatcher remembers drivers, not truck numbers, so a truck and its driver are
  picked as one crew from a dropdown at "Start a trip", "Swap truck" or a drop, which says for the trip's orders
  whether each truck fits, the district it ran last time and its fuel (D-100). Unplanned orders takes the panel's
  place, so more of them show.
- **Trucks are named by their drivers** on the plan board's and View plan's cards and headers, "Chaminda · dry truck",
  where the frames show the vehicle number. The number stays where someone must find the truck: the loader's and
  driver's screens, and Fleet.
- **Drivers** are picked from the depot's driver accounts, and a vehicle may have none (D-31). Each truck has a usual
  driver, from the latest sent plan, and the suggested plan gives it them. The driver menu in a trip's header changes
  the driver alone, and a driver taken from another truck leaves it with none.
- **Undo, Redo and Start over** sit in the board's header, where the design draws none: every change of the draft is a
  step this tab can undo and redo (Ctrl+Z, Ctrl+Shift+Z), and Start over takes every trip and deferral off after asking,
  as one step Undo brings back (D-101). A stop has a × that takes it off its trip, and a card in Done a ⋮ with Remove
  trip.
- **Moving stops** shows no "12 km shorter" or "35 min earlier", and a late stop says "late": the checker's
  kilometres depend only on the number of stops, and its sentence under the timeline gives the minutes.
- **More actions than the frames draw:** a stop's ⋮ menu has Take off, Split and Defer for each order, group and
  shop rows have ⋮ menus, a trip has Remove trip in its footer, and split orders carry a
  "split" chip.
- **A deferred order gets no new date,** so the shop's "Tuesday works for me" is not built.
- **Below 1024 wide** the board's three columns become three tabs, and between 1024 and 1280 the side columns are
  narrower and View plan's rows stack.
- **Problems** show as lines under the trip's timeline, and failures as short notices.
- **View plan** says "h on the road" where the design says "h driving", because the figure includes unloading.
- **States the design lacks:** orders still open, no day left, deferring, splitting, saving, not saved and refused,
  and for the suggested plan: replacing a draft, the line after a build, a refused build, and a plan ready with
  warnings.

**Loading and Live day**
- **One list of trucks in leaving order,** with no "Wave 1 · 03:30" and "Wave 2 · 08:30" tabs, no dock numbers and no
  call buttons: every trip has its own leaving time (D-19), and the data has no docks or phone numbers (D-40).
- **The day line** has no shift name, and the place reads "Peliyagoda dock".
- **Every stop has its own row** where the design joins the last two, and a stop lists its lines (Style and Tech lines
  also name the item).
- **A loaded stop's row opens a ⋮ menu** while the truck loads, with "Flag a problem" and "Undo stop 3 loaded" (the
  stop loaded last). A stop loaded onto the wrong truck, or found wrong once on, needs a way back before it leaves.
- **The flag has no photo yet;** proof photos come with the driver's piece.
- **"Won't fit" is a fourth flag reason,** counting what fits on the truck, with the same two answers said about room.
  A full truck is a real dock problem, and flagging it as "Short" made the dispatcher read it as missing stock.
- **Leaving the flag form or signing out while its flag is not sent asks first,** with "Try again" and "Leave without
  sending" or "Sign out anyway". The loader works online with no outbox, so a flag that did not go would otherwise be
  lost without a word.
- **The load figure is what is on the truck so far.**
- **A van's load reads in kilos,** "648 / 1,040 kg", and a truck's weight in tonnes rounds down. In tonnes a 1,040 kg
  van read "1.0 / 1.0 t" with 81 kg still free.
- **The dispatcher answers a loader's flag** with "Go short" or "Load it all" and "Send to loader" (D-37); the design
  draws answers only for the driver's problems. There is no Undo yet, and the loader's answer line says what was chosen.
- **The ready screen names the trip's driver,** where the design names Kasun, who is our loader.
- **A truck cannot change after any loading begins.** Frame `150:81067` shows a changed truck while another is
  already loading. The existing loading lock remains: spec 016's Plan changed flow will compare taking back and
  resending before any truck starts loading, not moving already-counted goods (D-70).
- **Small differences:** the flag form asks to tap the line first, the "loading" chip is yellow, and an answer also
  shows under its stop's lines while that stop is still loading.
- **States the design lacks:** no plan out, nothing to load, every truck loaded, no day left, a truck no longer on the
  list, waiting for the answer, saving, not saved, refused, nothing needs you, a second trip whose truck is still out
  on its first ("out on trip 1 · back by 06:38"), and a truck its driver has driven away ("VEH011 left with Asanka at
  04:11.").

**The shop's receipt**
- **Confirm delivery lists every line of the drop,** so Nugegoda's three orders are three cards, as the driver's Unload
  does; the frame shows one order. A line expects what the driver handed over, and says when the depot sent it short or
  the shop refused some at the door, with the design's damaged picture.
- **A typed count stays as typed.** A minus or a fraction says "Whole numbers from 0 to 50." and a count above what was
  handed over "More than the 50 handed over.", in red, and Confirm waits; the frame draws no wrong count, and changing
  what was typed sent a report the shop never meant.
- **"What's wrong?" shows on each line once its count is lower,** with "Missing" and "Damaged", and "Add a photo
  (optional)" and "Note for the depot (optional)" only on a receipt that reports something. One answer for the whole
  receipt could not say a crate came damaged while a pallet never came, and the frame draws no note.
- **The saved screen** says "There is no signal right now." when the phone knew it had none, and "The connection dropped
  while sending." after a send that got no answer.
- **No "and signed":** there is no signature; the shop's receipt is the confirmation.
- **The sent receipt follows the depot's answer,** and one with nothing wrong says "All received"; a record the depot did
  not accept says so at its foot. No frame draws these.
- **A shop's report on Live day** uses the issue-open card with "Send N replacements on <day>", "No replacement" and
  "Send to shop"; the design draws only the "Next" line for it.
- **A receipt refused because another device confirmed first keeps its report on screen,** under "Confirmed on another
  device at 08:42" and what that confirmation said, with a line that the report did not reach the depot and to contact
  the depot for anything more: two staff checking one delivery is a normal morning, and the report used to go without a
  word. No frame draws it.
- **Today lists the deliveries still to confirm** when a shop had more than one, "2 deliveries to confirm" with a row
  and Confirm for each, until the last is confirmed: a shop that confirmed its chilled drop never heard its dry one
  waited. No frame draws it.
- **A brought-back order leaves "Coming today"** and names no day until the next plan takes it: Thursday's window
  beside "Coming today" told the shop to wait for cartons already back at the depot. Today says instead, under "Not
  coming today", that it was brought back and waits for the next plan, or the day the plan gave it, so a manager who
  opens only Today still sees it did not come. No frame draws it.
- **A card's answer lines name their cartons,** "3 expired chilled cartons: replacements come on Fri 26 Jun" beside "2
  missing chilled cartons: no replacement": no frame draws two answers on one order, and plain "No replacement is
  coming" under a refusal's replacements read as taking them back.
- **States the design lacks:** something wrong, a photo, sending, sent and all received, sent and answered, nothing to
  confirm, not accepted, sign in again, could not save, could not load, another tab, not on your list, and the shop's
  cards for a delivery not yet confirmed, nobody at the shop, the depot's answers and a replacement.

**The dashboard and Live day**
- **No waves:** Live day has no "Wave 2", and the next run's button is "View plan" with no draft line.
- **The district map** says "Live · 07:30" where the frame says "Replay · 07:30": it shows the day as it is, where the
  design drew a replay, so every number on it comes from the live read (D-92). Its Map view switch works for
  Peliyagoda, Kandy and Both as the top bar's does (D-93, D-96), and Both draws both depots' districts and trucks from
  the two depots' reads added up; districts and trucks have no hover details,
  the active chip carries the design's lorry picture, and the card credits OpenStreetMap for the district outlines.
  Below 1280 wide it sits under Needs you, and below 640 its Stores delivered list goes under the map.
- **One answer per problem:** "Decide" opens its card, where the design also draws Warn, Skip, Credit and Resend, and an
  answered row reads "Decided", never "Warned". There is no Undo.
- **Recorded times only (D-68):** the trucks table shows the planned arrival and the planned return, never an estimate,
  and the tiles say "stops delivered · partial or closed", "fuel · litres this week" and "deferred on this plan". A
  truck past its leaving time says what the dock recorded, "Not loaded · planned 03:30 · still at the dock" or "Still
  loading · 120 of 437 on", and only a ready one "Departure not reported", so the dispatcher sees which trucks are
  still on the dock.
- **Every open problem shows in full** in Needs you, as spec 012 built it, not one focused card with short "Next" rows.
- **Events say "· photo"** without opening it, and the Trip column shows the trip's number only.
- **Between 1024 and 1279 wide** the tiles take three columns and the trucks table folds the driver and trip under the
  truck.
- **The loader's "Plan changed"** names no docks and has no "Why" line. The plan can change only before loading starts
  (D-70), where the design also draws a truck changed after loading began.

**The look-up pages**
- **They only read (D-80):** Orders has no "Plan first" and no "Call the shop" (the data has no phone numbers, D-40),
  and Fleet has no "Next 6 weeks", forecast or booking.
- **Orders** shows the order's own id (8 characters in the table, all of it in the detail) where the frame shows WF
  numbers, picks other days with a date field in place of a second day chip, and has no "Late by", shop contact or
  "orders closed" line. An order brought back from a closed shop reads "Brought back · waiting for the next plan", and
  its history names the closed visit and the return.
- **History** draws a still timeline with a legend, without Replay or speed controls (D-82), has one row per trip, not
  per vehicle, and says "Shop confirmations" where the frame says "Receipts" and "Signed": there is no signature (D-47).
  Deferrals have their own card and filter, apart from "Not delivered", and there is no receipt-count column.
- **Fleet** says "Not recorded out" where the frame says "At the depot": the app knows whether a truck has a trip out,
  not where it stands (D-85). It lists the vehicles on today's plan past their leave time with no departure recorded,
  never one that went out and came back. Fuel is "recorded and committed" this week (D-86), and there are no no-signal, minutes-late
  or "about N km more" chips.
- **States the design lacks:** loading, could not load, could not update, no connection, sign in again, a date or trip
  link that does not exist, no photo recorded and a photo that will not open.

**The driver**
- **No calls and no signature.** No "Call the shop", "Called the shop" or "Call Prasanna": the data has no phone numbers
  (D-40). No "Get a signature instead": the photo is the proof (D-47).
- **"What's wrong?" has "Shop refused some" and "Shop closed".** A damaged or wrong carton is one the shop refuses, with
  "Damaged" or "Not ordered" as its reason, and "Cannot reach" has no frame.
- **No dock and no address.** Today's trip names no dock (D-40), and a stop's line under its name is the district and
  entrance, "Colombo · street".
- **A stop lists its lines,** so Nugegoda's two chilled orders are two counters, as the loader's screens do. Style and Tech
  lines name the unit and the item in full, "crates of 3 · Washing machines", as the loader's list does, wrapping to a
  second line with the counter under them on a phone, since the item is how a driver tells the crates apart.
- **A refusal has two answers,** "Bring them back to Peliyagoda" and "Send 2 replacements on Fri 26 Jun", with "Send to
  driver and shop". No "Write off on the road" and no "shop credited, claim opened": a write-off is a record the depot adds
  later.
- **A closed shop is answered with "Try again on this trip" or "Bring them back";** no frame draws them.
- **"Nothing to hand back"** says the short carton never left the depot, without "It goes on Monday's run".
- **"Done unloading" stays grey until every line is counted,** where the frame draws it orange at 2 of 6: a stop that
  cannot be counted in full goes through "Something's wrong". A typed count stays as it was typed and says under the box
  when it is not a whole number or is more than was loaded, rather than being changed.
- **The dispatcher's answer pops up as a large card** with its picture and three words, "Bring back · 2 chilled", that
  closes at a tap or a swipe and by itself after 8 seconds, so a driver at the wheel can read it at a glance. The trip's
  top line then keeps only those three words, where the frame writes the dispatcher's whole sentence; the sentence is in
  the bell's pop-up. No frame draws the card.
- **The top bar carries the demo chip,** as "Demo" alone beside the status chip on a phone, and the status chip hides its
  words below 380 px wide so both fit.
- **"Back online" takes the top line's place,** with the dispatcher's answer under it, so the driver never closes the bar
  to read it, and it shows on Trip done when the stop that waited was the last one. Its lines wrap where the frame cuts
  them, and beyond three stops it names three and how many more, so the driver can always read which stops went. It
  belongs to its trip and goes when that trip is checked in, so it never shows on a second trip.
- **Between trips,** the second trip's Today's trip opens with "✓ Trip 1 closed · 4 of 4 stops · all records sent ·
  checked in 03:56" and trip 1's hand-back card until it starts. The frames draw no state between two trips, and the
  driver must know trip 1 went and what to hand in before the truck is loaded again.
- **Day done after two trips** shows a line per trip, "Trip 1 · 4 of 4 stops · 105 of 144 cartons delivered · 39 handed
  back", and the day's totals, then "Trip 3 · none today". The frame draws a one-trip day, and the driver's last screen
  should show the whole day rather than only the last trip.
- **States the design lacks:** not loaded yet, no trip, could not load, the waiting sheet, not accepted, sign in again,
  could not save on this phone, the unusable photo, the answer on the phone, a stop to try again, and Day done with
  records waiting.

## Docs

- `docs/architecture.md` - main components and how they connect
- `docs/data-model.md` - how the system stores and connects its data
- `docs/ai-disclosure.md` - what was AI-assisted, what was not, and how we used the tools
- `docs/specs/` - how we build, the map of the whole build, and one spec per feature
- `docs/decisions.md` - the choices that shape the app, and why we made them
