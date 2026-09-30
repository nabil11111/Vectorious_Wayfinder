# Decisions

The choices that shape Wayfinder, oldest first. Each entry says what we chose and why. When a decision
changes we add a new entry and point the old one at it, so the history stays readable.

Decisions still open are listed at the bottom of [the map](specs/000-map.md).

## D-01 · 28 Sep · One app and one database

One Node process serves the web app and the API, with one Postgres database.

**Why.** One address, one deploy and nothing to keep in sync between services. Last competition we lost time
to overengineering and did not finish, so finishing in the time we have is a design rule here.

## D-02 · 28 Sep · Drizzle with committed SQL migrations

The schema is written in TypeScript with Drizzle, and every change to it is a SQL file in the repo.

**Why.** The schema and the queries share one set of types, and a migration is plain SQL that a reviewer can
read. CI fails when the schema and the migrations disagree.

## D-03 · 28 Sep · The booklet's ids stay as primary keys

Outlets and vehicles keep their supplied ids (OUT001, VEH001). Records we create get UUIDs.

**Why.** The design, this app and the Datathon all talk about the same outlets and vehicles.

## D-04 · 28 Sep · A fixed product list with weight and volume per unit

Shops order from a fixed list per brand (`docs/product-list.md`). An order line stores only a quantity.

**Why.** The load of an order is always quantity times the item's figures, so nobody types kilos or cubic
metres and the capacity check can be trusted.

## D-05 · 28 Sep · One order per temperature

A Fresh shop fills one form and it is saved as two orders, one chilled and one dry.

**Why.** Chilled goods need a fridge vehicle and dry goods do not, so they travel separately. If the chilled
order has to wait, the dry one still arrives.

## D-06 · 29 Sep · Sign-in with a session cookie and a role check on every route

Passwords are hashed with Argon2. The cookie holds a random token and the database stores only its hash.
Every route checks the role.

**Why.** A leaked sessions table cannot be used to sign in, and no screen can reach another role's data by
guessing an address.

## D-07 · 29 Sep · Spec first, and tests first for the business rules only

Every feature starts as a spec with acceptance criteria. Planning rules, validation and load maths get their
tests before their code. Screens are checked with click-throughs against the design.

**Why.** The planning rules have clear right answers and are the easiest part to get subtly wrong. Writing
tests first for every screen would cost time without catching much.

## D-08 · 29 Sep · One real timeline per vehicle

The planner works out each vehicle's day as it would really run: leave, drive, wait for the window, unload,
drive back, reload, second trip. Reloading takes 30 minutes unless changed.

**Why.** The booklet's trip time stops at the last shop and never joins a vehicle's two trips, so it cannot
say when the second trip can leave or when its shops are reached.

## D-09 · 29 Sep · Datathon-only rules are defaults, not hard rules

One brand and one district per trip, the 270 and 480 minute budgets and whole orders come from Datathon Task
2B. The app applies them by default and the dispatcher can see them.

**Why.** The Datathon is judged separately. The rules that bind the Hackathon build are capacity, temperature,
outlet access, delivery windows and fuel quotas, and those can never be switched off.

Whole orders stopped being a default on 30 Sep, see D-17. One district per trip became a hard rule, see D-23.

## D-10 · 29 Sep · A shop that waited last time is protected

When something has to wait, the planner defers another shop's order that frees the same space and did not
wait recently. If nothing else can give way, it asks the dispatcher.

**Why.** The booklet names the same outlet going unserved twice as a problem to fix.

## D-11 · 29 Sep · A late stop is never skipped automatically

When a truck falls behind, the app recalculates the trip and shows which later windows will be missed. The
dispatcher chooses: deliver anyway, skip and come back, or move it to tomorrow. The shop is told.

**Why.** Skipping a shop is a business decision with a customer on the other end, so a person makes it.

## D-12 · 29 Sep · The loader marks a stop as loaded, with no scanning

One tap per stop, and a count only when something is short.

**Why.** The booklet never mentions barcodes or scanners, and a stop's cartons go on the truck together.

## D-13 · 30 Sep · The two-trip limit lives in the database

The trips table refuses a third trip for a vehicle in a day.

**Why.** A rule that must never break is safest in the table itself, not only in the code in front of it.

## D-14 · 30 Sep · Admin has its own password, and forwarded addresses are trusted only behind our proxy

**Why.** The demo password is printed in the README, so it must not open the account that can change
everything. And the sign-in limit counts by address, so a forwarded address is believed only when our own
proxy set it.

## D-15 · 30 Sep · One complete order journey first, then the suggested plan

We build order, plan by hand with checks, load, deliver and confirm before the automatic planner.

**Why.** The booklet accepts manual decisions with validation, and all four roles working is a fifth of the
marks. The suggested plan then plugs into the same rule checker.

## D-16 · 30 Sep · A map first, then one piece at a time, reviewed before every merge

See [how a piece gets built](specs/README.md).

**Why.** Writing every spec up front would cost a day and the later specs would be wrong once the first
piece exists. Building without a map means the pieces do not fit. A reviewer who did not write the code
catches what its writer cannot see.

## D-17 · 30 Sep · An order can be split

When an order does not fit, the part that fits goes out and the rest waits with a reason, instead of the
whole order waiting. A split is saved as two parts of the order, and each part is planned or deferred whole.
The dispatcher sees every split before the plan is sent.

**Why.** Delivering half is better for the shop than delivering nothing. Whole orders only is a rule of
Datathon Task 2B, which is judged separately, and the Hackathon section has no such rule. The design already
offers a split as a fix in View plan. This replaces the whole-orders default in D-09.

## D-18 · 30 Sep · The app runs on one clock, and the demo day sets it

Every date and time on a screen comes from one clock inside the app, never from the device. In this build
the clock starts on Wed 24 Jun 2026 at 15:00, an hour before orders close, for delivery on Thu 25 Jun 2026.
A demo control moves it to the next part of the day and resets the day. Tests set the same clock.

**Why.** A judge walks a whole delivery day in a few minutes, at any hour. On the real clock a 6 AM delivery
would look hours late and ordering would already be closed. The day sits inside the booklet's calendar,
which ends on 28 Jun 2026, and it is a payday in the monsoon, so demand is high.

## D-19 · 30 Sep · Trucks leave from 03:30 for Fresh and from 07:30 for Style and Tech

The planner times a trip so the truck reaches its first shop as the window opens, and by itself never
leaves before these times. When leaving earlier would save a delivery window, it suggests that and the
dispatcher decides. A trip where a truck would wait more than 30 minutes at a shop gets a warning.

**Why.** 03:30 to 08:00 is the Fresh morning in the booklet, and 07:30 lets a truck reach a far district as
Style and Tech shops open at 09:00. A fixed default keeps plans predictable, and the dispatcher keeps the
last word.

## D-20 · 30 Sep · The fuel quota week is the calendar week

Monday to Saturday, the same weeks as the booklet's calendar. A plan shows each vehicle's litres used so far
this week plus this plan's trips, against its quota.

**Why.** It is how the supplied data counts weeks, and it makes "fuel left" mean the same thing on every
screen.

## D-21 · 30 Sep · Screens update live

When something changes, the server tells the open screens that care and they fetch the new data straight
away. The channel is a one-way stream from the server (server-sent events) on the same address as the API.
A slow timer stays as a backup for when the stream drops.

**Why.** The dispatcher should see a loader's flag or a driver's delivery as it happens. A one-way stream is
built into every browser and needs no extra service, because the app is one process.

## D-22 · 30 Sep · Proof photos are stored in the database

The phone shrinks the photo before sending it.

**Why.** One place to back up, and it behaves the same in Docker and on the hosted app, with no disk or
storage service to set up.

## D-23 · 30 Sep · A trip stays inside one district

The rule checker refuses a trip with stops in two districts.

**Why.** The booklet's travel data has the drive from a depot to a district and the drive between two stops
inside it. It has no figure for the drive between two districts, so such a trip cannot be given honest times
or a fuel figure. This takes one district per trip out of the defaults in D-09. Mixing brands on a trip is
still a choice the dispatcher can turn on.

## D-24 · 30 Sep · Trucks have a tail lift and vans do not

A tail-lift item on a van is a warning, not a block.

**Why.** The vehicle data has no tail-lift column, so this is our assumption. A block would cut off the one
Tech shop that only a van can reach from ever getting a washing machine or a fridge. The dispatcher sees the
warning and decides.
