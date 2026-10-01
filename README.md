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

The app runs on its own clock, the same for every screen, starting on Wednesday 24 June at 15:00 with orders
open. The demo control in the top bar moves the whole app to the next part of the day (orders close at 16:00,
loading at 02:30, trucks leave at 03:30, delivered by 08:30) and can reset the day to the seed. Every open
screen follows at once. `DEMO_MODE=false` runs on the real clock with no seeded day.

### Working on the code

```bash
cp .env.example .env
docker compose up -d db      # Postgres on localhost:5433
npm install
npm run db:migrate && npm run db:seed
npm run dev                  # API on :3000, web app on :5173
npm test                     # needs the db running
```

Changed the schema in `apps/api/src/db/schema`? Run `npm run db:generate` and commit the new file in
`apps/api/drizzle` with it. CI fails if they disagree.

## Configuration

Every setting is in `.env.example`, and `docker compose up` works without a `.env` file.

| Variable | What it does |
| --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Database login used by compose |
| `SEED_PASSWORD` | Password for the seeded demo accounts |
| `SEED_ADMIN_PASSWORD` | Password for the seeded admin account |
| `TRUST_PROXY` | Proxies in front of the app: `0` when reached directly, `1` on Railway |
| `DEMO_MODE` | `true` runs the app on its own clock with the seeded delivery day. `false` uses the real clock and seeds no day |
| `LIVE_HEARTBEAT_MS`, `LIVE_MAX_STREAMS` | The live stream to open screens: how often it sends a heartbeat, and how many streams may be open at once |
| `DATABASE_URL` | Only for running the API outside Docker |

## Seeded accounts

Password for the demo accounts: `wayfinder-demo` (`SEED_PASSWORD`). Admin has its own: `wayfinder-admin`
(`SEED_ADMIN_PASSWORD`).

| Role | Username | Where |
| --- | --- | --- |
| Store manager | `nadeesha` | Fresh Nugegoda (OUT001) |
| Store manager | `ishara` | Style Liberty Plaza (OUT017) |
| Store manager | `tharindu` | Tech Matara (OUT064) |
| Dispatcher | `ruwan` | Peliyagoda depot |
| Loader | `kasun` | Peliyagoda depot |
| Driver | `dilshan` | Peliyagoda depot. 34 more drivers there, one per working vehicle (`chaminda`, `lasantha` and so on), for the plan board |
| Driver | `prasanna` | Kandy depot |
| Admin | `admin` | Everything |

## Judge walkthrough

One order's journey through the seeded day. Start clean with `docker compose up` and http://localhost:3000, or
press **Reset the demo day** in the demo clock. Two browsers (or one normal and one private window) let you watch
one role's change reach another's screen within a second. Times depend on your pace, so the clock times below
are what the demo clock shows.

1. **The shop orders.** Sign in as `nadeesha` at Wed 24 Jun 15:00. Today shows her draft for Thu 25 Jun: 8
   chilled and 4 dry cartons. Continue it, change a number if you like, and place both orders. The confirmation
   says orders for Thursday close at 16:00.
2. **Orders close.** Open the demo clock in the top bar and move it to "Orders closed, 16:00".
3. **The dispatcher plans.** Sign in as `ruwan` and open the Plan board: "Plan for Thu 25 Jun", 104 unplanned
   orders, 4 of them carried over from earlier plans (Fresh Dickwella, deferred twice, first), and 35 working
   trucks with 3 in the workshop. The seeded day is short of fridge trucks on purpose.
4. **A trip.** On the Fresh · Colombo group press **Start a trip** and choose VEH035, the fridge van (Nugegoda
   and Wellawatte take vans only). Add Nugegoda's two new orders from the group, its 12 carried-over chilled
   cartons from Carried over, and Wellawatte. The trip leaves 04:36, reaches Fresh Nugegoda at 05:00 and Fresh
   Wellawatte at 05:24, and is back at 06:10. Every change is saved and checked at once. Pick Dilshan as the
   driver.
5. **Everything else waits, with a reason.** Defer each other group from its ⋮ menu with a reason the shop will
   read, such as "No fridge truck was left for Colombo.", until nothing is unplanned.
6. **Send.** Mark the trip done and open **View plan**: 5 of 104 orders on 1 trip, 99 deferred, checks all
   clear. Send the plan to loaders and drivers.
7. **The shop sees it.** As `nadeesha`, Orders shows her three orders "Planned · Thu 25 Jun". **Back to edit**
   on View plan turns the plan into a draft again until loading starts, and her cards follow within a second.

8. **Loading, last stop first.** Move the demo clock on to "Loading, Thu 02:30" and sign in as `kasun` on a phone (or
   a narrow window). Today's trucks: VEH035 leaves 04:36, in 2 h 6 min, and "Goes in first" lists stop 2, Fresh
   Wellawatte (94 cartons), above stop 1, Fresh Nugegoda (24). Start loading, tick Wellawatte's two lines and press
   **Stop 2 loaded**: "94 /118" and "0.6 / 1.0 t · 3.5 / 7.0 m³".
9. **A problem at the dock.** On Fresh Nugegoda press **Flag a problem**, pick the 4 dry cartons, keep Short, count 3,
   add a note and send it to the dispatcher. The dry line reads "1 short", and Mark ready waits for the answer.
10. **The dispatcher answers.** As `ruwan`, the bell shows 1. Live day's "Needs you" holds the card "1 dry carton
    short · Fresh Nugegoda · stop 1 · VEH035". Keep **Go short** and press **Send to loader**.
11. **Ready.** On Kasun's phone the answer shows without a reload. Tick the chilled lines, press Stop 1 loaded and then
    **Mark ready**: "VEH035 is ready · 117 of 118 on · 1 short". Nadeesha's three orders now read "Loaded", and View plan
    no longer offers Back to edit.

12. **The driver's trip.** Move the demo clock on to "Trucks leave, Thu 03:30". On a phone, or Chrome at 390 wide,
    sign in as `dilshan`. Today's trip: "VEH035 · leaves 04:36", "✓ Loaded · 117 of 118 · 1 dry short for Nugegoda",
    then "1 · Fresh Nugegoda · 23 of 24 cartons" and "2 · Fresh Wellawatte · 94 cartons". Press **Start trip**.
13. **A delivery.** Next stop: "Stop 1 of 2 · Fresh Nugegoda", "Unload 23 cartons · 20 chilled · 3 dry" and the shop's
    note. Press **I've arrived**, count 12 and 8 chilled and 3 dry ("Loader flagged 1 carton short at the depot" sits
    under the dry line), press **Done unloading**, then **Take photo** (on a laptop, pick any picture) and **Save
    delivery**: "✓ Stop 1 Fresh Nugegoda delivered · synced" and "Stop 2 of 2 · Fresh Wellawatte".
14. **No signal.** Turn the network off: DevTools, Network, "Offline". Press **I've arrived**: the chip turns "Offline"
    with 1 waiting. Press **Something's wrong**, keep "Shop refused some", pick "48 cartons chilled", press + on Refused
    twice ("Accepted 46/48", "Refused 2/48"), choose **Damaged**, write a note and press **Save partial delivery**:
    "Saved on this phone". Press **Continue route**: Trip done, worked out on the phone, with "Cartons delivered 115 of
    118", "Refused 2 · Wellawatte" and "Short from the depot 1 dry · Nugegoda". Reload the page with the network still
    off: it opens on the same screen.
15. **Back online.** Turn the network back on: within seconds "Back online · 1 stop sent · Wellawatte reached the depot",
    and the chip turns "Online".
16. **The dispatcher answers.** As `ruwan`, the bell shows 1. Live day's card: "2 chilled cartons refused", "Fresh
    Wellawatte · stop 2 · VEH035 · Dilshan · damaged, the shop took 46 of 48 chilled", with **Bring them back to
    Peliyagoda** chosen. Press **Send to driver**: "✓ Sent · VEH035 · 2 cartons back to Peliyagoda, Dilshan told".
17. **Back at the depot.** On Dilshan's phone, without a reload: "Ruwan, dispatcher · Bring the 2 chilled cartons back to
    Peliyagoda." Press **I'm back at the depot**: "✓ Trip closed · 2 of 2 stops · all records sent". Nadeesha's three
    Thursday orders now read "Delivered".

The shop's receipt comes with the next piece.

**A closed shop.** At step 14 choose "Shop closed" instead and press **Save attempt and move on**: Ruwan's card reads
"Nobody at Fresh Wellawatte". **Try again on this trip** makes Wellawatte Dilshan's next stop again, and delivering it ends
at 117 of 118. **Bring them back** ends with "Hand them in; they go on the next run.", and Wellawatte's two orders are
placed again for Friday's plan.

### The suggested plan

The planner builds the same day in one press. It has its own short walkthrough, because the one above plans by hand.
Press **Reset the demo day** first if you walked the one above.

1. **Orders close.** Move the demo clock to "Orders closed, 16:00". Nadeesha's draft stays a draft, so 102 orders are
   due.
2. **The empty board.** As `ruwan`, the Plan board shows "Unplanned · 102" with "Carried over · 4" (Fresh Dickwella,
   deferred twice, first), "0 / 35 trucks", "0 / 102 orders", "37% fuel this week" and "0 / 140.7 m³ fridge space".
   In the middle, "Build the suggested plan" in orange.
3. **Build it.** Press it: "Building the plan · 102 orders · 35 trucks", then "Unplanned · 0", "Done · 27 trips",
   "26 / 35 trucks", "96 / 102 orders", "41% fuel this week" and "57.02 / 140.7 m³ fridge space". "Deferred · 6" holds
   the chilled orders of four Kurunegala shops (Pannala, Polgahawela, Wariyapola, Mawathagama) and two Puttalam shops
   (Wennappuwa, Puttalam), each with the sentence the shop will read, such as "No fridge truck could reach Fresh
   Pannala before its window closed at 07:45 on Thursday." The middle says "Suggested plan · 16:00 · 6 decisions to
   make".
4. **Ask why.** Under Done, open VEH004's Fresh · Matara trip and press **why?** on Fresh Dickwella: "Rank 1: waited
   since Tuesday; chilled; …". Press **why?** on a deferred order: its rank, why no truck could take it, and "to
   decide".
5. **An ordinary edit.** Open VEH035's trip, the fridge van with Fresh Nugegoda's carried-over cartons, and choose
   Dilshan as its driver. It is saved and checked like any other change.
6. **Decide and send.** Open **View plan**: "Suggested plan · 16:00", "Decisions · 6" and a greyed "Send plan · 6
   decisions open". Press **Accept all 6**: "Decisions · all made", and "Checks · 3" keeps the two long waits and the
   Fresh workload listed with "Ready, with warnings". Press **Send plan to loaders and drivers**: "✓ Sent 16:06 ·
   loaders and 1 driver".

## Departures from the design

Anything we built differently from our Designathon submission, and why.

- **Sign in** uses a username and password where the design shows a staff ID and PIN. The seeded accounts are
  easier to hand to a judge.
- **No language choice yet.** Every screen is in English.
- **The demo clock and its control are ours.** The design shows the time of day. The app keeps its own clock so
  a judge can walk a whole delivery day in minutes, and the control that moves it (and resets the day) exists
  only in demo mode.
- **A placed order cannot be edited.** The confirmation says "Orders for Thursday close at 16:00 today" where
  the frame says "Edits close at 16:00 today". A shop that needs more places another order for the same day.
- **Shop cards show only what exists so far.** Arrival times, the vehicle and driver, "Running late",
  "Delivery help", "Tuesday works for me", "All 6 received" and "plan updated" come with the dispatcher's,
  driver's and receipt pieces.
- **The shop's order form.** The number between − and + can also be typed. The tail-lift line names every item
  that needs one, where the frame names only the fridge crate. Tech's form has the note for the driver, which the
  Tech frame leaves out. The note uses 16 px text on phones, so iOS does not zoom in.
- **Shop states the design does not draw:** nothing started, empty lists, could not load, not saved, day
  closed, no open day, and "Could not update. This may be out of date." when a background refresh fails. The
  desktop Style and Tech forms, confirmation and Help have no frames, so they follow the desktop Fresh form.
- **Today after placing** keeps the date and the shop's name as its header, where the frame has the title "Today".
- **OUT001** has a street entrance and van-only parking in the booklet's data, where the design shows a rear dock.
- **Below 1024 wide the nav is bottom tabs** for every role, and the name beside the avatar waits until 1280, so
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
- **Orders are named by shop, amount and wanted day.** The design's order numbers (WF-2402) do not exist here.
- **The depot switch** shows the dispatcher's own depot and greys the others (D-32), from 1280 wide.
- **Drivers** are picked from the depot's driver accounts, and a vehicle may have none (D-31).
- **Moving stops** shows no "12 km shorter" or "35 min earlier", and a late stop says "late": the checker's
  kilometres depend only on the number of stops, and its sentence under the timeline gives the minutes.
- **More actions than the frames draw:** a stop's ⋮ menu has Take off, Split and Defer for each order, group and
  shop rows have ⋮ menus, a trip has Remove trip in its footer, Pick a truck has Close, and split orders carry a
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
- **The flag has no photo yet;** proof photos come with the driver's piece.
- **The load figure is what is on the truck so far.**
- **The dispatcher answers a loader's flag** with "Go short" or "Load it all" and "Send to loader" (D-37); the design
  draws answers only for the driver's problems. There is no Undo yet, and the loader's answer line says what was chosen.
- **The ready screen names the trip's driver,** where the design names Kasun, who is our loader.
- **Live day shows only its "Needs you" column** for now; the trucks' timelines come with the dashboard piece.
- **A truck cannot change after any loading begins.** Frame `150:81067` shows a changed truck while another is
  already loading. The existing loading lock remains: spec 016's Plan changed flow will compare taking back and
  resending before any truck starts loading, not moving already-counted goods (D-70).
- **Small differences:** the flag form asks to tap the line first, the "loading" chip is yellow, and an answer also
  shows under its stop's lines while that stop is still loading.
- **States the design lacks:** no plan out, nothing to load, every truck loaded, no day left, a truck no longer on the
  list, waiting for the answer, saving, not saved, refused, and nothing needs you.

**The driver**
- **No calls and no signature.** No "Call the shop", "Called the shop" or "Call Prasanna": the data has no phone numbers
  (D-40). No "Get a signature instead": the photo is the proof (D-47).
- **"What's wrong?" has "Shop refused some" and "Shop closed".** A damaged or wrong carton is one the shop refuses, with
  "Damaged" or "Not ordered" as its reason, and "Cannot reach" has no frame.
- **No dock and no address.** Today's trip names no dock (D-40), and a stop's line under its name is the district and
  entrance, "Colombo · street".
- **A stop lists its lines,** so Nugegoda's two chilled orders are two counters, as the loader's screens do. Style and Tech
  lines name the item.
- **A refusal has one answer, "Bring them back",** with "Send to driver". No "Write off on the road", no "Send 2
  replacements" (D-48) and no "shop credited, claim opened": a write-off or a replacement is a record the depot adds later.
- **A closed shop is answered with "Try again on this trip" or "Bring them back";** no frame draws them.
- **"Nothing to hand back"** says the short carton never left the depot, without "It goes on Monday's run".
- **"Done unloading" stays grey until every line is counted,** where the frame draws it orange at 2 of 6: a stop that
  cannot be counted in full goes through "Something's wrong".
- **The driver's bell has no count.**
- **The top bar carries the demo chip,** as "Demo" alone beside the status chip on a phone, and the status chip hides its
  words below 380 px wide so both fit.
- **"Back online" takes the top line's place,** with the dispatcher's answer under it, so the driver never closes the bar
  to read it, and it shows on Trip done when the stop that waited was the last one.
- **States the design lacks:** not loaded yet, no trip, could not load, the waiting sheet, not accepted, sign in again,
  could not save on this phone, the unusable photo, the answer on the phone, a stop to try again, and Day done with
  records waiting.

## Docs

- `docs/architecture.md` - main components and how they connect
- `docs/data-model.md` - how the system stores and connects its data
- `docs/ai-disclosure.md` - what was AI-assisted, what was not, and how we used the tools
- `docs/specs/` - how we build, the map of the whole build, and one spec per feature
- `docs/decisions.md` - the choices that shape the app, and why we made them
