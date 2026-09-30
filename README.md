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

Loading, driving and the shop's receipt come with the next pieces.

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
- **The suggested plan is not built yet.** "Build the suggested plan", "Changes", the "suggested" hints and the
  why chips come with the planner (spec 011).
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
- **States the design lacks:** orders still open, no day left, deferring, splitting, saving, not saved and refused.

## Docs

- `docs/architecture.md` - main components and how they connect
- `docs/data-model.md` - how the system stores and connects its data
- `docs/ai-disclosure.md` - what was AI-assisted, what was not, and how we used the tools
- `docs/specs/` - how we build, the map of the whole build, and one spec per feature
- `docs/decisions.md` - the choices that shape the app, and why we made them
