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
caller's depot, so the depot switch in the top bar shows the depot and changes nothing. Replaced by D-93: the
caller's depot is now the one the dispatcher's session switched to, and the switch works.

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

**D-43 · 1 Oct · The driver's no-signal screens come with A4, and A6 keeps only the receipt that waits on the shop's
phone, built with A5.** The design draws the driver's no-signal states beside the driver's own screens and they share one
save-first queue, and the waiting receipt belongs with the shop confirming what arrived.

**D-44 · 1 Oct · The driver's day is the loader's day (D-34), and a trip that is out stays on the phone until the driver
ends it.** The depot has one morning for both, and a late trip must not vanish from its driver at 16:00.

**D-45 · 1 Oct · Every driver action is saved on the phone first, as the request it will send, and sent oldest first, one
at a time, by the one tab that holds the driver's app. The server keeps each applied write's id with its account, trip,
kind and a hash of its body, the driver's day lists the ids the account had applied in the last 48 hours, and a write
leaves the phone once the day lists it. Each write names the revision of the stop or trip it changes, which the phone
works out as it saves.** A delivery happened whether there was a signal or not, so it must never need doing again or
count twice, an id cannot be reused for something else, and a trip that has left the day must not strand its last write.

**D-46 · 1 Oct · A time recorded on the phone is kept when it lies between the trip's last event time and the server's
clock, read once the trip is locked, and otherwise the nearer of the two is kept. Reopening a stop never moves the last
event time back.** The phone counts the app clock on from its last contact and can fall behind after a sleep or a clock
move, but a record must never land in the future or before what it follows.

**D-47 · 1 Oct · A delivery needs a photo of the goods at the door, and a refused or closed stop may add one. The phone
shrinks it to 1280 px and 500 KB, it rides inside the write, and the server takes only a whole JPEG.** The booklet wants
proof so disputes do not rest on memory, and one write means a delivery never exists without its photo.

**D-48 · 1 Oct · The driver raises two problems, a shop that refused some and a shop that is closed. The dispatcher
answers a refusal with "Bring them back", and a closed shop with "Try again on this trip", which sends the stop after the
other stops in the order stops were sent back, or "Bring them back", which puts the stop's orders back as placed with
their counts cleared while the stop stays closed and keeps that attempt's counts.** The cartons are on the truck either
way, a retried stop must not jump the queue, and the old stop keeps what happened there while its orders start again
for the next plan. Writing cartons off, and sending replacements, are the depot's records to add later.

**D-49 · 1 Oct · The phone keeps the app's files, the signed-in account, the clock's last state, the driver's trip and the
waiting writes, and reads them at once on start, so the driver's screens open with no signal. A service worker keeps the
files and never an answer from the API.** A phone reloads tabs, the camera often does it, and a queue behind a page that
cannot load would strand the driver.

**D-50 · 1 Oct · The phone shows the day the server last sent with the still-waiting writes applied, through one function
in the contracts that a test holds the server to, and never shows a write's answer: after each write it fetches the day
again.** With no signal the phone must show what the server will say, one function cannot drift from itself, and an
answer that arrives late must not bring back an older day.

**D-51 · 1 Oct · One write builds the suggested plan and saves it in one transaction.** The draft and the orders the
planner splits land together or not at all, so a refused build leaves the board as it was. It saves with the same
`replaceDraft` and checks as a hand save (D-29).

**D-52 · 1 Oct · A build replaces the whole draft, and the screen asks first.** The planner plans the day from the
shops' orders (spec 011), so splits made on the draft are joined back before it plans, and a mix of hand trips and
suggested ones would be neither plan. Each vehicle keeps its driver, since a driver is not part of the allocation
(D-31).

**D-53 · 1 Oct · The plan keeps its suggestion.** When it was built, the draft it saved, the planner's reason for every
order and its decisions stay with the plan, so the reasons and the decisions survive a reload, and a decision is judged
against the planner's own choice. Hand edits leave it as built, and the next build replaces it.

**D-54 · 1 Oct · The planner's decisions are accepted before the plan is sent.** Leaving early, an order that waited
waiting again and a late order waiting are the dispatcher's calls (D-10, D-11, D-19), and a checker warning is not
consent (spec 011). An edit that changes the planner's choice ends its decision.

**D-55 · 1 Oct · "why?" shows the planner's reason for an order** (our pick, until Nabil answers). A judge and a
dispatcher must be able to ask why an order went where it did. The design's chips that ask why the dispatcher changed
the suggestion are not built, because a deferral already carries its reason (spec 010, rule 7).

**D-56 · 1 Oct · The shop confirms each delivery whole, one stop's orders at once, and counts against what the driver
handed over** (our pick, until Nabil answers). The orders of a stop arrive together, and a carton short from the depot
or refused at the door was reported where it was found, so the receipt shows those and asks only what the shop counts.

**D-57 · 1 Oct · A receipt is saved on the shop's phone first and sent once, through the driver's queue: one table of
applied phone writes, one store, sender and signal on the phone, the same time rule with the handover as its lower bound,
and a view function of its own in the contracts. A receipt waiting or refused on the phone shows from the phone's own copy
of it, and in the shop's area only Deliveries waits for the tab that owns the queue** (our pick for the tabs, until Nabil
answers). One way to keep a write safe without a signal is easier to get right than two, a receipt the depot turned down
must stay where the shop can read and clear it even after its delivery is gone, and the shop's other screens keep working
online in any tab, as spec 009 built them.

**D-58 · 1 Oct · A receipt with anything missing, damaged or not cold is a problem of kind `receipt`, answered once from
Live day's "Needs you" with "Send N replacements" or "No replacement"** (our pick for the second answer, until Nabil
answers). The dispatcher decides every problem in one place (D-36), reporting a carton does not replace it, and the depot
may have none to send.

**D-59 · 1 Oct · "Send N replacements" places a new order for the shop, one per temperature, and another for each 999
units of one product beyond the first, for the day an order placed at that moment is for, pointing at the problem it
answers. It answers a shop's report and, beside "Bring them back", a driver's refusal. Neither it nor a part of it, when
the plan splits it, counts as the shop's own next order.** An order of its own is planned, checked, loaded and confirmed
like any other, so a replacement needs no new path, and the shop never sees the depot's order counted as one it placed.
No line of it holds more than the 999 a receipt counts on a line, though two of the shop's orders can hold more of one
product between them, so the shop can confirm everything it is sent. A part of a split replacement is still a
replacement, through the link every part keeps to its original (D-30). This takes over the replacements half of D-48's
last sentence. Writing cartons off is still not built.

**D-60 · 1 Oct · "Still cold on arrival? No" is a report even when every carton is there** (our pick, until Nabil
answers). Warm chilled goods are the depot's to know about, and an answer that reaches nobody would make the question
decoration.

**D-61 · 1 Oct · A receipt is kept on the orders it covers: each line's received count, and on each order when the shop
confirmed, when the receipt reached the depot and, for a chilled order, whether it arrived cold.** Every shop card reads
its own order, also history that never travelled on a planned trip.

**D-62 · 1 Oct · The seeded shop history arrives received, with its counts and times, and Wednesday's 6 dry cartons were
received at 07:42.** A delivered order that the seed puts on no trip could never be confirmed, and the design's Today and
Past draw the shop's history as received. This changes spec 009's seed, where Wednesday's order waited to be confirmed.
An existing install takes it through a demo reset, since the seed writes nothing on a day already seeded.

D-56 to D-65 are reserved for spec 015. Spec 016 starts at D-66 so those records can join without renumbering.

**D-66 · 1 Oct · Dashboard and Live day watch the loader's day, with older trips still out listed separately**
(our pick, until Nabil answers). The day changes at 16:00 as D-34 and the driver's D-44 do, not at the plan board's
03:30. Earlier out trips count in trucks out now, but not the new day's delivery denominator. Open problems remain
depot-wide, and this piece adds no history date picker.

**D-67 · 1 Oct · The dashboard's counts say what they count** (our pick, until Nabil answers). Stops delivered
requires some goods accepted and labels partial deliveries; its bar uses the same delivered count. Closed stops,
complete refusals and zero-load completions are finished but not delivered; trip Progress counts them as finished.
Brand headers get their own server totals, counting each vehicle once across districts. Trucks out counts distinct
vehicles. Until the watched plan is published, next-run demand counts only eligible leaf orders wanted after that
watched date, so the seeded Friday count is 0 while Thursday is being planned. Afterwards eligible carry-over can
enter: the manual Thursday Send/Back to edit gives Friday demand **0 → 99 → 0**, intentionally. The tile shows when
the next run's orders close; under the 16:00 watched-day rollover that cutoff is always future, so no closed state
or flag is defined. Waiting orders and next-date published membership are deduplicated by id. Deferrals name the plan that deferred them without
promising a new date. Fuel is the week's recorded and committed `fuel_log` litres against the fleet's quota, not
measured consumption. [Spec 016's source table](specs/016-live-day/spec.md#rules) defines every numerator and denominator.

**D-68 · 1 Oct · Live day shows the sent schedule and recorded progress, not a location or connection it cannot
know** (our pick, until Nabil answers). Planned times stay the sent plan's; actual times and Last report come from
the driver's records. The out-truck table heads the frame's ETA as Planned arrival and Back as Planned return;
open problems sort first by their oldest raised time, then missing-report attention, then other out trips.
An overdue missing report says that, without claiming the truck is late or offline. GPS,
revised ETAs, traffic causes and the driver's waiting queue are outside this piece.

**D-69 · 1 Oct · Drops and events reads existing business records at their app-clock times.** Current publication,
loading, driver and issue records make the feed, scoped to the shown trips, with stable keys and at most 50 latest
events. Every joined problem kind gets its raised event, including 015's receipt report. A photo is only the words
"· photo" on an event: no A7 proof route or viewer; the existing problem-card photo stays 013's. A closed attempt
keeps its issue counts even when its orders are sent again. Real audit timestamps are never
shown and the audit log surviving a reset cannot repopulate this day. Complete history belongs to A8.

**D-70 · 1 Oct · The loader's Plan changed flow covers taking back and resending before loading starts** (our pick,
until Nabil answers). D-33's existing loading lock stays. Taking goods off or swapping a truck after loading begins,
previously assigned to A7 by D-33, D-37 and spec 012, is explicitly deferred: those actions need commands that protect
goods already counted. Loading flags and the driver's existing closed-shop retry still work as specified.

**D-71 · 1 Oct · The loader compares two publications this tablet tab has seen, and Got it is local** (our pick,
until Nabil answers). Keep the comparison per account, depot, demo generation and day in session storage. First visit
establishes a baseline; withdrawal keeps it only in storage, with no old list on screen. Resend compares logical
vehicle/trip, stop/order and quantity details, not regenerated UUIDs. A removed and added trip with the exact same
orders become one Moved row and bell 1, as in frame 85:71921. Got it closes the notice, while changed chips and the
comparison-row count remain as drawn.
It is not a cross-device unread count or permission to start loading, and adds no acknowledgment write.

**D-72 · 1 Oct · Dashboard and Live day use the existing problem cards and decisions.** Decide and Open next only
open or focus an existing issue; its existing API still checks the role, depot and revision. Every open problem
remains shown in full, preserving 012's departure 10; an answered trip row says Decided, not an unsupported Warned.
The driver's phone bell count remains deferred despite 013's earlier A7 promise. There is no second
answer path, Undo, credit, write-off, warning message or replacement command in spec 016. Receipt behavior remains
spec 015's; a driver-delivered quantity never stands in for a shop's confirmed receipt.

## Spec 017 picks
D-43–79 belong to specs 013–016 and their reviews, including the entries already joined above. The entries below
record [017](specs/017-look-up-pages/spec.md)'s picks, including the lead's review decisions; they do not fill those gaps.

**D-80 · 1 Oct · The dispatcher's look-up pages only read what the earlier pieces record.** A8 remains the first
piece cut if time runs short. Orders, History and Fleet add no business write or new kind of record. No forecast,
hiring or workshop-booking command; planning, Live day, shop and admin retain their commands. T0 starts after 016
is merged. Orders/Fleet require merged 013; History's confirmations and replacement answers additionally wait
for merged 015, without blocking Orders or Fleet.

**D-81 · 1 Oct · Orders lists a delivery day and starts on the board's day.** Include orders wanted that day,
that day's published stops/deferrals, and before Send the board's eligible earlier orders. Mark wanted-earlier as
Carried over. Count planned and deferred from that day's own plan, not current order status or a later plan.
Count submitted leaves once, excluding private drafts and split parents. Last 4 weeks unions 28 delivery days,
deduplicated by order id. One list includes detail; search/filters run in the browser. No detail endpoint,
server-side search/filter/matched count or replacement ancestry. Thursday at README step 3 is 104, including
four carried over; the manual send accounts for five planned and 99 deferred.

**D-82 · 1 Oct · History shows retained sent-plan detail and recorded attempts without replay.** Use the kept
schedule and read loading, driver outcomes, problems and (after 015) shop confirmations/replacement answers.
Each closed issue retains its own time, counts, photo and answer. Do not recover old arrivals from audit or borrow
current stop times/receipts for earlier attempts. No legacy-trip state or check against plan.sent audit rows:
no application path makes that case. Seeded publications with no trips still show their genuine deferrals.
This explicitly narrows 013's A8 promise; deleted publication revisions and animated/full audit replay stay out.

**D-83 · 1 Oct · History keeps orders, stops, attempts and shop confirmations separate.** Quantities say ordered,
loaded, handed over or received, with null for missing evidence. Three orders confirmed at one stop are one shop
confirmation, not three deliveries. Closed attempts never inherit later receipts. Returned means Return
instructed, including refused goods answered Send replacements; it does not claim a depot return scan exists.

**D-84 · 1 Oct · A8 owns its missing proof read and reuses 013's problem-photo read.** T0 waits for 016 to merge;
if it has no proof endpoint (the reviewed spec omits it), add the scoped GET in lookup/photo.ts through
routes/lookup.ts, never in 016's files. Reuse an equivalent merged route unchanged if one exists. Keep 013's
issue-photo GET, depot checks, existing JPEG/cache policy and Helmet headers; no separate header criterion.
Lists carry metadata only. Open photos on demand and release on close/reset/sign-out, with no public link,
synthetic receipt signature or persistent browser photo cache.

**D-85 · 1 Oct · Fleet Today uses reported trip state and an active-only header.** Out now includes a vehicle's
published out trip even from an earlier date. Its driver/status takes precedence, then today's first unfinished
trip, then its last returned trip. Not recorded out replaces physical At the depot. All header vehicle counts,
including reefers, vans, Out now and workshop counts, use active vehicles only; archiving VEH003 yields 37 active,
eight reefers and four vans. Its old trips, own fuel and any out trip remain readable in the archived row/detail.

**D-86 · 1 Oct · Fleet fuel is recorded and committed litres.** Use the app calendar date's ISO-week ledger
once, including estimates already committed on Send. Show quota minus that sum, with negative/unknown values and
distinct recorded/remaining percentages. The header sums active vehicles and their quota; archived rows keep
their own ledger. Count trips/planned km only from sent plans, never from unlinked fuel rows. No measured
consumption or future fuel forecast is claimed.

**D-87 · 1 Oct · Cut the entire Next 6 weeks view.** Hide its toggle. The two frames forecast demand and book
hired reefers; these are not recorded facts. An availability substitute would show 38 of 42 dates outside the
calendar ending 28 June. No forecast, hiring, availability route/view, calendar extension or Booked success.
Fleet Today still reads its existing workshop rows. Record the two excluded frames as design departures.

**D-88 · 1 Oct · Narrow lookups keep their tables in bounded scrolling boxes.** At 1024 and wider retain the
frames' table/timeline and detail rail. Below 1024 the detail stacks below the table, which scrolls in its own
box without page-wide sideways scroll. No custom card layout; phone-first is required for driver and loader.
Keep filters/photos keyboard-accessible. Use the existing stream/fallback, labelled stale records on refresh
failure and no persistent offline lookup store. Join checks use the built app in Nabil's visible Chrome.

**D-89 · 1 Oct · Skipped lately counts shops left out of published plans.** Keep the small panel drawn in the
Orders frame. Read published deferrals in the 28 dates ending on the selected delivery day; count one skip per
shop per plan even with several orders/parts. Show count, latest date and that plan's distinct recorded reasons,
sorted by count descending, latest date descending, shop name/id. Later delivery does not erase a skip; a
withdrawn plan contributes nothing until sent again. Fresh seed gives four shops/five skips: Dickwella twice,
Nugegoda, Ragama and Unawatuna once each. Table filters do not change the panel. No priority write or forecast.

**D-90 · 1 Oct · Sign in with a staff ID and a four-digit PIN, as designed.** Every account has a staff ID, a role
letter and three digits (S shop, P dispatcher, L loader, D driver, A admin), and a PIN. The demo accounts share one
PIN the README prints; admin has its own setting, so a hosted admin PIN can differ from the printed one. Five wrong
PINs in a row lock a staff ID for 15 minutes on real time, because four digits are easy to try in turn; the address
limit stays. This replaces the username and password we had listed as a departure (Nabil, 1 Oct, spec 018).

**D-91 · 1 Oct · English only; the Sinhala and Tamil buttons show and say they come later.** Translating every
screen is a big piece on the cut line. Showing the buttons keeps the sign-in page as designed without pretending the
app speaks those languages (Nabil, 1 Oct).

**D-92 · 1 Oct · The dashboard's map draws the live day, not the design's replay.** The frame drew February's
training records at 07:30; that data never enters the repo, and a dispatcher needs today. The card keeps the
frame's shapes, lines, arrows, labels and list, and takes its numbers from the operations read. Its view switch
follows D-32: the dispatcher's own depot only. The district shapes are derived from geoBoundaries (OpenStreetMap,
ODbL), so the card credits OpenStreetMap and `docs/map-data.md` names the source (Nabil, 1 Oct, spec 019).

**D-93 · 1 Oct · A dispatcher switches between the two depots.** The top bar's switch works as the design draws it:
the dispatcher picks Peliyagoda or Kandy, and every page plans, answers and looks up that depot until they switch
back or sign out. The choice lives on the session, so the routes that read the caller's depot follow it unchanged.
"Both" waits. This replaces D-32's own depot only, and the map card's switch follows it (Nabil, 1 Oct, spec 020).

**D-94 · 1 Oct · Every shop has an account and Kandy has its day.** For a QA run "with as much data as possible",
the seed gives each of the 120 shops a store manager (S-001 to S-120), Kandy a driver per working vehicle and a loader,
and the seeded day Kandy's Thursday orders by Peliyagoda's rules. Peliyagoda's numbers stay as the walkthrough has
them (Nabil, 1 Oct, spec 020).

**D-95 · 1 Oct · Every dispatcher request names the depot its tab shows.** The web app sends `x-wayfinder-depot`
with each request while a dispatcher is signed in, and the server answers 409 `depot_changed` when it differs from
the session's depot, before the route reads or writes anything. A tab that fell behind a switch made elsewhere, by
another tab or through an answer that never arrived, then never shows or changes the other depot's records: it reads
the session and takes the depot the session is on. Requests without the header pass, so scripts and the other roles
work as before. The account, sign-in and sign-out routes, the switch itself, the demo clock and its reset, health
and the live stream ignore it, and photos go through the same check as every other read (spec 020's follow-up).

**D-97 · 1 Oct · The suggested plan names a driver for every vehicle.** The suggestion keeps a vehicle's earlier
driver and gives the others the depot's free drivers in staff ID order, as the frames show a driver on every trip.
Choosing a driver who is on another vehicle swaps the two. A dispatcher can still leave a vehicle with no driver
(D-31) (Nabil, 1 Oct, spec 022).

**D-98 · 1 Oct · The plan board plans by drag and drop too.** Orders, trucks and stops can be dragged where the board's
buttons and menus would put them, with the pointer or the keyboard, and each drop is the same draft change the button
makes, checked by the same checker. The empty middle offers "Build the suggested plan" and a drop area in place of
"Start a blank trip". Drag and drop uses `@dnd-kit`, which handles the pointer, the keyboard and announcements (Nabil,
1 Oct, spec 023).

**D-100 · 1 Oct · Trucks are picked as crews and named by their drivers.** A dispatcher remembers drivers, not truck
numbers, and the same driver mostly drives the same truck on the same roads. So the plan board picks a truck and its
driver together from one list sorted by fit, district last run and fuel. The "Unassigned trucks" panel goes, giving
Unplanned orders the column. Sentences call a truck "Chaminda's dry truck". The plan board's and View plan's cards
read "Chaminda · dry truck" with no vehicle number, which stays only where someone must find the actual truck (the
loader, the driver, Fleet) (Nabil, 1 Oct, spec 026).
