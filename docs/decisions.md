# Decisions

The choices that shape Wayfinder, oldest first: what we chose and why. When a decision changes, a new entry
says so. Open questions sit at the bottom of [the map](specs/000-map.md).

**D-01 · 28 Sep · One app and one database.** One Node process serves the web app and the API, with one
Postgres. One address, one deploy, nothing to keep in sync. We overbuilt last year and did not finish.

**D-02 · 28 Sep · Drizzle with committed SQL migrations.** The schema and the queries share one set of types,
and every schema change is plain SQL a reviewer can read. CI fails when they disagree.

**D-03 · 28 Sep · The booklet's ids stay as primary keys.** OUT001 and VEH001 mean the same record in the
design, this app and the Datathon. Records we create get UUIDs.

**D-04 · 28 Sep · A fixed product list with weight and volume per unit.** An order line stores only a
quantity, so a load is always quantity times the item's figures and nobody types kilos.

**D-05 · 28 Sep · One order per temperature.** Chilled goods need a fridge vehicle and dry goods do not, so
they travel apart. If the chilled order has to wait, the dry one still arrives.

**D-06 · 29 Sep · A session cookie and a role check on every route.** Passwords are hashed with Argon2 and
only a hash of the session token is stored, so a leaked table cannot be used to sign in.

**D-07 · 29 Sep · Spec first, and tests first for the business rules only.** Planning rules have clear right
answers and are the easiest part to get subtly wrong. Screens are checked by clicking through them.

**D-08 · 29 Sep · One real timeline per vehicle.** Leave, drive, wait, unload, drive back, reload for 30
minutes, second trip. The booklet's trip time stops at the last shop, so it cannot say when a second trip
can leave.

**D-09 · 29 Sep · Datathon-only rules are defaults.** One brand per trip and the 270 and 480 minute budgets
come from Task 2B, which is judged separately. The dispatcher sees them as warnings. Capacity, temperature,
access, windows and fuel can never be switched off. (Whole orders went with D-17, and one district per trip
became a hard rule in D-23.)

**D-10 · 29 Sep · A shop that waited last time is protected.** Another shop's order gives way first, and if
nothing can, the dispatcher is asked. The booklet names the same outlet going unserved twice as a problem.

**D-11 · 29 Sep · A late stop is never skipped automatically.** The app shows which windows will be missed
and the dispatcher chooses. Skipping a shop is a business decision, so a person makes it.

**D-12 · 29 Sep · The loader marks a stop as loaded, with no scanning.** The booklet never mentions
barcodes, and a stop's cartons go on the truck together.

**D-13 · 30 Sep · The two-trip limit lives in the database.** A rule that must never break is safest in the
table itself.

**D-14 · 30 Sep · Admin has its own password, and a forwarded address is trusted only behind our proxy.** The
demo password is printed in the README, and the sign-in limit counts by address.

**D-15 · 30 Sep · One complete order journey first, then the planner.** The booklet accepts manual planning
with validation, and all four roles working is a fifth of the marks.

**D-16 · 30 Sep · A map first, then one piece at a time, reviewed before every merge.** Writing every spec
up front costs a day and the later ones turn out wrong. See [how a piece gets built](specs/README.md).

**D-17 · 30 Sep · An order can be split.** The part that fits goes out and the rest waits with a reason. The
two parts are orders of their own, each planned or deferred whole, and the dispatcher sees every split before
sending. Delivering half is better for the shop than delivering nothing.

**D-18 · 30 Sep · The app runs on one clock, and the demo day sets it.** A judge walks a whole delivery day
in minutes, at any hour. It starts on Wed 24 Jun 2026 at 15:00 for delivery on Thu 25 Jun, a payday inside
the booklet's calendar, which ends on 28 Jun 2026.

**D-19 · 30 Sep · Trucks leave from 03:30 for Fresh and 07:30 for Style and Tech.** Leaving earlier is only
suggested when it saves a delivery window, and the dispatcher decides. Waiting more than 30 minutes at a
shop gets a warning.

**D-20 · 30 Sep · The fuel quota week is the calendar week, Monday to Saturday.** It is how the supplied
data counts weeks, so "fuel left" means the same thing on every screen.

**D-21 · 30 Sep · Screens update live.** The server tells open screens what changed over a one-way stream
and they fetch it again. It is built into every browser and needs no extra service. A slow timer is the
backup.

**D-22 · 30 Sep · Proof photos are stored in the database.** The phone shrinks them first. One place to back
up, and the same in Docker and on the hosted app.

**D-23 · 30 Sep · A trip stays inside one district.** The data has no travel figures between districts, so
such a trip cannot be timed honestly. Mixing brands is still a switch.

**D-24 · 30 Sep · Trucks have a tail lift and vans do not.** The vehicle data does not say, so this is our
assumption. A tail-lift item on a van is a warning, because one Tech shop can only be reached by van.

**D-25 · 30 Sep · The demo clock waits at the end of each part of the day.** Otherwise the hosted demo would
run out of its day while nobody is using it. Anyone signed in can move it on or reset the day, because judges
hold one account per role.

**D-26 · 30 Sep · The seeded day is short of fridge trucks.** Three fridge vehicles are in the workshop and
orders are near normal size, so a few chilled orders have to wait. That reads as a busy day, not a broken
one.

**D-27 · 30 Sep · A store manager for each brand.** One Fresh, one Style and one Tech shop have an account,
so a judge can see all three order forms.

**D-28 · 1 Oct · The plan board shows today until 03:30, then the next operating day.** 03:30 is when the first
trucks leave (D-19), so a plan can be sent, or taken back to edit, until its trucks leave.

**D-29 · 1 Oct · The plan's draft is saved whole after every change.** Each save names the plan by its id and
revision and comes back with the checker's result. A depot's planning writes queue one behind the other. It is the
shop's draft pattern (spec 009), and the planner will use the same path.

**D-30 · 1 Oct · A split keeps the shop's order and makes two new orders from it.** The original becomes `split`,
each part points to it and their lines add up to it. What the shop asked for stays on record, and each part is
planned or deferred whole (D-17).

**D-31 · 1 Oct · A driver is chosen per vehicle for the day, and may be left out.** It is the account that sees
that vehicle's trips on its phone. The booklet gives every vehicle a driver and makes driver availability no
constraint.

**D-32 · 1 Oct · A dispatcher plans their own depot only.** Every plan route checks the record belongs to the
caller's depot, so the depot switch in the top bar shows the depot and changes nothing.

**D-33 · 1 Oct · A sent plan can go back to edit until loading starts** (Nabil). The booklet says printed loading
lists go out of date when plans change and wants the dispatcher's decisions to reach the loader. Once a trip is
loading, changes go through the loader's flag and the dispatcher's answer (A3) and Live day (A7).

**D-34 · 1 Oct · The loader's day is today until 16:00, then the next operating day.** By then the day's trucks have
left and the next day is being planned, while D-28's 03:30 would hide trucks that leave later that morning.

**D-35 · 1 Oct · The loader loads last stop first, and a truck's counts are written when it is marked ready.** The
stop order is what the loader needs, so the server holds it, and the counts that left the dock are the ones the driver
and the shop check against.

**D-36 · 1 Oct · A problem is an `issues` row whoever raises it, with the lines it counts, and a loader's flag is its
first kind.** The dispatcher decides every problem in one place, and the driver (A4) and the shop (A5) add their kinds
without a new table.

**D-37 · 1 Oct · The dispatcher answers a loader's flag once, with "Go short" or "Load it all".** The design draws only
the loader's side of the answer, these are the two things a dock can do, and taking an order off a truck changes the
plan, which is Live day's (A7).

**D-38 · 1 Oct · The loader works online.** The dock has the depot's connection, the booklet's coverage gaps are on
the road, and the loader frames draw no offline state. A write that fails is sent again with the same id, so it never
counts twice.

**D-39 · 1 Oct · Loading builds only the "Needs you" column of Live day and the dispatcher's bell count.** A flagged
truck needs the dispatcher to see the flag and answer it, and the rest of Live day is A7's.

**D-40 · 1 Oct · The loader's screens show what the data holds: one list in leaving order, with no waves, dock numbers
or call buttons.** Every trip has its own leaving time (D-19), and the data has no docks and no phone numbers.

**D-41 · 1 Oct · The planner serves chilled orders before dry ones of the same waiting age, even when a dry one
closes earlier** (the lead's pick, until Nabil answers). Fridge trips are what the seeded day is short of, and a
window stays a hard check, so a dry order that misses its window is still deferred with its reason.

**D-42 · 1 Oct · A shop's new order keeps its own place in the queue and does not take its older order's
priority** (the lead's pick, until Nabil answers). The waiting goods are protected first, and a new bulk order
cannot push another shop's waiting order back.

D-43 to D-50 belong to spec 013, D-51 to D-55 to spec 014, and D-56 to D-65 are reserved for spec 015 on their
branches. Spec 016 starts at D-66 so those records can join without renumbering.

**D-66 · 1 Oct · Dashboard and Live day watch the loader's day, with older trips still out listed separately**
(our pick, until Nabil answers). The day changes at 16:00 as D-34 and the driver's D-44 do, not at the plan board's
03:30. Earlier out trips count in trucks out now, but not the new day's delivery denominator. Open problems remain
depot-wide, and this piece adds no history date picker.

**D-67 · 1 Oct · The dashboard's counts say what they count** (our pick, until Nabil answers). Stops delivered
requires some goods accepted and labels partial deliveries; closed stops, complete refusals and zero-load completions
are finished but not delivered. Trucks out counts distinct
vehicles, next-run orders counts eligible leaf orders, and deferrals name the plan that deferred them without
promising a new date. Fuel is the week's recorded and committed `fuel_log` litres against the fleet's quota, not
measured consumption. [Spec 016's source table](specs/016-live-day/spec.md#rules) defines every numerator and denominator.

**D-68 · 1 Oct · Live day shows the sent schedule and recorded progress, not a location or connection it cannot
know** (our pick, until Nabil answers). Planned times stay the sent plan's; actual times and Last report come from
the driver's records. An overdue missing report says that, without claiming the truck is late or offline. GPS,
revised ETAs, traffic causes and the driver's waiting queue are outside this piece.

**D-69 · 1 Oct · Drops and events reads existing business records at their app-clock times.** Current publication,
loading, driver and issue records make the feed, scoped to the shown trips, with stable keys and at most 50 latest
events. A closed attempt keeps its issue counts even when its orders are sent again. Real audit timestamps are never
shown and the audit log surviving a reset cannot repopulate this day. Complete history belongs to A8.

**D-70 · 1 Oct · The loader's Plan changed flow covers taking back and resending before loading starts** (our pick,
until Nabil answers). D-33's existing loading lock stays. Taking goods off or swapping a truck after loading begins,
previously assigned to A7 by D-33, D-37 and spec 012, is explicitly deferred: those actions need commands that protect
goods already counted. Loading flags and the driver's existing closed-shop retry still work as specified.

**D-71 · 1 Oct · The loader compares two publications this tablet tab has seen, and Got it is local** (our pick,
until Nabil answers). Keep the comparison per account, depot, demo generation and day in session storage. First visit
establishes a baseline; withdrawal keeps it; resend compares logical vehicle/trip, stop/order and quantity details,
not regenerated UUIDs. Got it closes the notice, while changed chips and the changed-trip count remain as drawn.
It is not a cross-device unread count or permission to start loading, and adds no acknowledgment write.

**D-72 · 1 Oct · Dashboard and Live day use the existing problem cards and decisions.** Decide and Open next only
open or focus an existing issue; its existing API still checks the role, depot and revision. There is no second
answer path, Undo, credit, write-off, warning message or replacement command in spec 016. Receipt behavior remains
spec 015's; a driver-delivered quantity never stands in for a shop's confirmed receipt.
