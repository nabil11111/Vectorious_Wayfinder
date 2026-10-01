# 016 · Watching the day

**Status:** Done, with open questions and our picks below · **Owner:** · **Design:** Dispatcher · Dashboard, Live day,
Live day · loading, Live day · issue open, both Live day · decision sent states, Loader · Plan changed and Today's trucks · plan changed.

Piece A7 of [the map](../000-map.md). [008](../008-demo-day/spec.md) supplies the clock and live updates,
[010](../010-plan-board/spec.md) the sent plan, and [012](../012-loading/spec.md) loading and Needs you. Spec 013
supplies the driver's recorded journey; its server half is PR #17. Spec 014's suggested plan becomes an ordinary
published plan here. Build after 013 is joined; this document does not assume its unmerged code is on main.

## Why
The dispatcher needs to see which trucks left, which shops took their goods and which problem needs a decision,
without phoning each driver. The loader needs the current loading list when a plan is taken back and sent again.
The booklet's Hackathon section, pages 11–13, asks for the four roles to work together, responsive screens, a usable
allocation and recovery when connectivity fails. The driver records that recovery in 013; these screens show only
what has reached the server. The design provides the layout, not the example quantities.

## What it does
The dashboard shows six counts, the existing open problems, the next run and the trucks out now. Live day shows
every trip of the sent day, its planned timeline beside recorded progress, the same problem cards and Drops and
events. Open and Decide lead to the trip or problem already on that page. The loader sees what changed between two
publications their tablet has read, then returns to the new list. There is no new dispatch command in this piece.

## Decisions
Recorded from **D-66 to D-72** in [decisions](../../decisions.md); D-43 to D-65 belong to specs 013–015.

- **D-66:** the watched day is the loader's day; older trips still out are shown separately.
- **D-67:** counts name their grain and source; a finished stop is not necessarily a full delivery.
- **D-68:** show the sent schedule and recorded times, with the driver's last report; do not infer a signal or an ETA.
- **D-69:** events use existing business records and their app-clock times, scoped to the shown trips.
- **D-70:** the loader's change notice covers taking back and resending before loading starts. Later route changes wait.
- **D-71:** the change comparison and Got it belong to this account in this tablet tab, with no server acknowledgment.
- **D-72:** decisions remain the existing issue cards and endpoints. Open next is navigation; Undo is outside this piece.

## Screen states
The exports are under `tech-triathlon-ops/design/export/`. The table names the frame and its Figma id. The PNG and JSON
with that id were both read. The loader frames are in `03-high-fidelity-all-role-flows-04-loader-high-fidelity/`,
rather than the dispatcher directory. "No frame" means a small state using the existing components and style guide.
Manrope headings, Inter body, mono ids/times and the existing orange, teal, amber and red tokens remain as built.
Icons come from the existing design assets, with counts rendered beside them, never drawn into a picture.

| Screen | State | Frame | What shows |
| --- | --- | --- | --- |
| Dashboard `/dispatcher` | Day underway | Dispatcher · Dashboard `53:11540` | Date and app time; six tiles from rule 3. Needs you on the left, the next-run card below it, then Trucks out now with problems first. The map area is removed and the cards use the space. Open live day leads to `/dispatcher/live`. |
| | Nothing needs you / no truck out | No frame | The tiles keep their real zeroes. "Nothing needs you right now." and "No truck is out right now." A ready truck remains visible on Live day. |
| | No sent plan | No frame | "No plan is out for Thu 25 Jun." and View plan for that date. No delivery denominator is invented; the tile reads "0 / 0 stops delivered · no plan out". Next-run orders, fuel and depot-wide problems still show. |
| | Next run | Dispatcher · Dashboard `53:11540`, Next run card | The next operating date after the watched day, its order count, its real cutoff and View plan for that date. "Orders close Thu 16:00"; the next run is always still open under the 16:00 rollover. No separate closed state, promised draft at 16:05 or automatic build. |
| Live day `/dispatcher/live` | All trips | Dispatcher · Live day `78:68047` | Date, updated time, counts, All trucks and Problems only. Brand then district groups, one labelled row per trip with stop dots, planned and recorded times. Needs you and Drops and events in a persistent right column. No Wave 2 filter. |
| | Problem open | Dispatcher · Live day · issue open `78:68510` | Decide focuses the existing issue card, with 012's loading answers or 013's refused/closed answers. The timeline stays visible. This is a column, not a modal. |
| | Answer sent | Dispatcher · Live day · decision sent `102:75299`; · issue open · decision sent `102:75808` | Existing green Sent line and changed dispatcher bell count. The answered row says **Decided**, the supported equivalent of the frames' Warned / Decided; no Warned claim without a warning command. The stop keeps its recorded outcome. Open next focuses the oldest remaining full issue card; no Undo. |
| | Open trip / stop details | No frame | An inline section below the chosen trip: shop, window, planned arrival/departure, recorded arrival/completion, ordered/loaded/delivered/refused/closed/short counts and issue links. Close returns focus to Open. No proof viewer. |
| | Link no longer current | No frame | "That trip is no longer in this view." or "That problem was already answered." with the current list/card still usable. No lookup of another day's trip. |
| | Earlier trip still out | No frame | A separate "Still out from Thu 25 Jun" group, with its own progress and date. It contributes to trucks out now, not Friday's stop counts. |
| | No trips / no matching problems / no events | No frame | "No trips on this plan.", "No truck needs attention in this view." or "No events recorded for these trips yet." Filters never replace header totals with zero. |
| Live day | First load | Dispatcher · Live day · loading `85:72127` | The timeline/groups and right-column skeleton of this frame, with navigation usable. No sample counts. |
| Dashboard | First load | Loading · skeleton `85:72065` | Same-layout grey blocks; navigation usable. No sample counts or spinner standing in for them. |
| | First read fails | No frame | "Could not load the day." and Try again. Needs you has its own existing failure state. |
| | Refresh fails / connection lost | No frame | Keep the last data with "Could not update. Showing the last read at 03:38." and Try again. Do not keep a green Live label. This describes this browser, not the driver's connection. |
| | Older plan has no recorded detail | No frame | "Movement details were not recorded for this plan." Legacy trip/stop membership may show, but its missing execution quantities/times read "Not recorded", never an invented journey. The actual seeded publications have no trips, so their stop total is correctly 0 / 0. |
| | No delivery day left / fuel unavailable | No frame | "No delivery day is left." Older trips still out and Needs you remain. Next run says "No next delivery day." Beyond the supplied calendar, the fuel tile says "Fuel week unavailable"; with a known week but zero quota it says "No quota recorded". |
| | Below 1024 wide | No frame | Dashboard tiles in two columns, then Needs you, next run and truck cards. Live day: counts, Needs you, trip cards and events in that order. Cards list stops and labelled times instead of a squeezed horizontal timeline. All Open, Decide and Open next actions remain; no page-wide horizontal scroll. |
| Loader `/loader/changes` | A newer publication | Loader · Plan changed `85:71921` | "Plan changed 02:31 · Ruwan, dispatcher"; one before/after **Moved** row when a removed trip's exact orders appear together on an added trip. The frame's VEH002 → VEH001 move of 41 cartons is one change and bell 1. A leave-time-only change, such as VEH035 04:36 → 04:40 with 118 cartons, is also one row. No dock, invented reason or instruction to unload goods. |
| Loader `/loader` | After Got it | Loader · Today's trucks · plan changed `150:81067` | New loading list with changed chips. The bell opens the comparison again, and its count is comparison rows, with a whole-trip move counted once, not unread messages. Got it closes the notice; chips and count remain until another publication or day. This piece only changes plans before any loading begins (D-70). |
| Loader | Plan taken back / republished without changed details | No frame | While withdrawn: "The dispatcher took this plan back to edit. Wait for the new loading list." On an identical resend: "The plan was sent again. Truck details are unchanged." Got it; no changed chip. |
| Loader | First visit / new day / reset / cannot keep comparison | No frame | A first successful read is the baseline, with no claim to an unseen previous plan. A changed account, depot, day or demo generation clears the comparison. A storage failure says "Could not keep the plan comparison on this tablet." The current list and server checks still work. |
| | Change page opened with no comparison | No frame | "No plan change is kept on this tablet." and Back to trucks. Do not invent an old list from the new one. |
| | Below 1024 wide | No frame | Banner, one changed-trip card at a time with Before above Now, the new Next out list, then Got it as a full-width button. The bell remains in the shell; no side-by-side cards or horizontal scroll at 390. |

The foundations inspected are style guide `18:3`, icons `28:2128`, skeleton `85:72065` and logo `53:4491`. The
dispatcher exports are 1440 × 900; the two loader exports are 1180 × 820. The phone arrangement above is our pick,
not a claim that the exports specify one.

## Rules
Examples continue the README's hand-built Thursday plan: VEH035, Dilshan, OUT001 Nugegoda then OUT002 Wellawatte,
five orders, 118 cartons ordered, 117 loaded and one dry carton short. Times are depot time on the app clock.

1. **Which day (D-66).** Use `loaderDay`: today before 16:00, then the next operating day. At Thu 25 Jun 03:30 this
   stays Thursday although the plan board has moved to Friday. Include the day's published trips, all statuses,
   and any earlier published trip still `out`. Label the latter by its own date. With no current day or no plan,
   still return the depot's out trips and problems. There is no date picker or history browser here.
2. **Only this depot.** The dashboard and Live day read is for a dispatcher with a depot. The existing depot
   switch keeps the other choices disabled (D-32). Needs you and the bell still count all the depot's open problems,
   including one from an earlier day. An old problem can be answered even after its truck leaves the shown list.
3. **Every number has a source (D-67).** The API supplies the following. Screen code formats values, draws bars and
   counts displayed rows, but does not recompute business totals. A count of orders is not a count of cartons.

   | Number or time on screen | Database source and exact meaning |
   | --- | --- |
   | Day, app time, read/updated time | `demo_day` through `readMoment` and `lib/clock.ts`, with `calendar_days` for operating dates. `readAt` is the snapshot's app instant; the header clock uses the existing web clock. Never audit/row creation time. |
   | Need you / bell | Existing `GET /issues`: `issues.status = open`, joined through stop → trip → plan to this depot. Count issues, across dates and kinds; no count for a merely overdue report. |
   | Stops delivered, X / Y | This day's published plan's `stops`: X with outcome delivered/refused **and positive delivered units**, Y all stops. From the same attempt's line counts show "N partial" for refused stops with some accepted, "N with none delivered" for delivered/refused outcomes with zero accepted, and "N closed" for closed outcomes. A complete refusal or a zero-load completion is finished but not delivered. No plan or no stops gives 0 / 0; a legacy trip lacking execution records makes the numerator null, "Not recorded". |
   | Trip/group stops done, X / Y | Same stops, but X has any non-null outcome, including closed. Reopening a closed stop removes it from X. Each stop counts once, however many attempts or orders. |
   | Trucks out now, X / Y | X distinct `trips.vehicle_id` with `status = out` in the depot, including older out trips; Y all `vehicles` of that depot, including workshop vehicles. Peliyagoda Y = 38, not the board's 35 working vehicles. The table itself lists only those out trips. |
   | Trips / trucks per group | Count trip rows / distinct vehicle ids in that brand-and-district group. Mixed-brand trips have a Mixed group and count once. Group truck counts need not sum to a distinct fleet count when a vehicle has two trips. |
   | Brand header, e.g. Fresh · 7 trucks · 40 of 56 stops done | Server `brandTotals`: distinct vehicle ids, distinct stops and finished stops across every trip in that brand, before district grouping or filtering. Count a truck once even when it appears in two districts. Mixed has its own totals; the screen never adds district totals to make a brand header. |
   | Orders for the next run | First `calendar_days` operating date after this watched day. Before the watched day's plan is published, take only leaf orders with `watchedDate < delivery_date <= nextDate`. Once it is published, eligible placed/deferred carry-over with `delivery_date <= nextDate` may also enter. In either phase count placed/deferred orders plus orders assigned to nextDate's published plan, deduplicated by id; the same date eligibility applies to both sets. Exclude drafts, split parents and cancelled orders. Never include this unpublished watched day's workload as next-run demand, or an older underway order merely because it is due. Historical membership does not suppress an order returned to placed. This is demand, not a promised allocation. |
   | Next run cutoff | 16:00 on the operating date before nextDate, from `calendar_days` and the existing cutoff constant. No nextDate gives no count or cutoff. View plan links to that explicit date. |
   | Deferred on this plan | Count `deferrals` on the watched day's published plan, joined to its leaf orders. These are the decisions that plan made, even if an order is allocated later. Label "Deferred on this plan", not "deferred to Friday"; a deferral promises no new date. |
   | Fuel recorded and committed this week, % | Sum `fuel_log.litres` for depot vehicles in the watched date's ISO week/year from `calendar_days`, divided by the sum of those `vehicles.weekly_fuel_quota_l`. Include the whole week's committed rows once, not `sent_check` litres again. Existing `percent` rounding. Show litres/quota in the detail; zero quota gives "No quota recorded". This is not measured fuel consumption. With no watched date use the app clock's calendar date; with no calendar row say "Fuel week unavailable", not 0%. |
   | Trip, driver, shop, brand, district, stops | `trips`, `users.display_name`, `stops`, `outlets`; grouped by brand then district, sorted by planned leave, vehicle id, trip number. Orders/lines through `stop_orders`; no mock drivers or address. |
   | Planned leave, arrival, stop departure, return | `plans.sent_check` for that vehicle and trip; `stops.planned_arrival/planned_depart` for its stops, converted on `plans.date`. They stay the sent schedule even after a retry. No fresh checker run moves them. |
   | Ready, actual left/back, arrived/done, last driver report | `trips.ready_at/left_at/back_at/last_event_at` and `stops.arrived_at/done_at`. Last report is null until a driver has reported, not ready time or a dispatcher answer. |
   | Shop window | `outlets.window_open/window_close`, narrowed by `mall_window`, as 013 already reads it. It is a receiving window, not a forecast. |
   | Ordered, loaded, delivered, refused, not delivered, depot short | `order_lines.quantity/loaded_qty/delivered_qty`, through this trip's stops, and `issue_lines.counted` for refused or closed attempts. Reuse `driverTripsOf` and `tripFigures`; on a closed stop use that attempt's issue counts even after its orders are placed/loaded/delivered again. Before ready, loaded is "Not recorded yet", not a shortfall of 118. |
   | Loading progress before ready | Existing `trucksOf` / `goingOf`: quantities of loaded stops (`stops.loaded_at`), adjusted only by loading issues on this trip. Label "On so far", not final loaded quantity. |
   | Photo marker / event counts | `photos` existence and rule 7's records. Show only the words "· photo" on an event, without an action. No "signed" or "received" total inferred from a driver's delivered count. |
   | Loader changed badge / before and after | Rule 9's two observed publications, whose fields came from `LoadingDay`. Count comparison rows, pairing a removed and added trip with exactly the same orders as one Moved row; otherwise each affected logical trip appears at most once. Do not add their goods together. |

   **Publication changes next-run demand.** On the manual seeded Thursday plan, Friday's count is **0 before Send,
   99 after Send, and 0 after Back to edit**, before loading starts. Thursday's deferred orders join the eligible
   carry-over only while Thursday's plan is published; withdrawing it removes that eligibility. This is a change
   in the recorded plan, not a count bug. The next run's cutoff is always in the future because the watched day
   advances at 16:00; show when its orders close, without a closed flag or state.

   Every bar uses the numerator and denominator of its own tile/row: Stops delivered uses delivered/total, Trucks
   out uses out/fleet, trip Progress uses finished/total, and fuel uses its returned percentage. Zero denominators
   draw an empty bar; unknown numerators draw no determinate fill. Never borrow another tile's progress.
   After the refusal, the delivery tile and its bar are **2 / 2 · 1 partial**, trip progress **2 / 2**, delivered
   **115**, refused **2**, depot short **1**. For the closed-shop alternative the delivery tile is **1 / 2 · 1 closed**
   with a **half bar**, while trip Progress is **2 / 2** with a full bar; delivered **23**, not delivered **94**, short **1**.
4. **Timelines and attention (D-68).** Draw one row per trip, including trip 2 as its own row. A thin planned track
   has the sent leave/stop/return times; recorded departure, arrivals, outcomes and return are separate solid marks.
   Delivered dots are teal, refused/closed red, the next stop ringed. Label the legend Planned / Recorded / Problem.
   Use a shared 02:00–22:00 axis, expanding to the previous/next whole two-hour tick for any schedule, recorded mark
   or the current time outside it. A label includes the date across midnight. The now line is the app time only when
   it is on the row's date. Never animate a truck between stops or fill a line up to now as evidence of travel.

   A trip not yet out after its planned leave says what the dock recorded, in the server's words, a sentence and a
   short word (Q-24): a trip never loaded "Not loaded · planned 03:30" and "still at the dock", a trip being loaded
   "Still loading · 120 of 437 on · planned 03:30" (on so far of its units) and "still at the dock", and only a ready
   trip "Departure not reported · planned 04:36" and "watching", since it alone may have left without reporting it. The
   dashboard's Watching row carries the same sentence: "Watching · VEH006 · Galle · Not loaded · planned 03:30". For an out trip, use
   013's `nextStop`, including its retry order: an unfinished next stop past planned arrival with no arrival says
   "Arrival not reported · planned 05:00". These are amber Watching rows, not new issues or inferred lateness. Once a
   stop is sent back, say "Retry requested [time]"; the old planned arrival is not a new overdue target. An arrived
   stop says "At [shop] · arrived 03:34". With all stops finished and trip out, say "Returning · planned back 06:38",
   and "Returning · was due back 06:38" once that time has passed, as the server words it; with trip done,
   "Back at depot 03:55". A recorded arrival after the narrowed window closes says "Arrived after window". There is
   no "on time" claim about a future arrival, driver-offline state, GPS, congestion cause or revised ETA.

   **Trucks out now** has one row per currently out trip. Progress is that trip's finished stops / total stops,
   including a closed stop as finished. Next stop is 013's `nextStop` shop, or Returning when none remains. The
   frame's ETA column is headed **Planned arrival**, the kept arrival of that next stop (— when returning or
   unrecorded); a retry keeps that old time explicitly labelled Original planned arrival. Back is headed
   **Planned return**, the kept trip return, not a prediction. Status is the oldest open problem's kind/summary
   when one exists, otherwise the recorded/attention sentence above. Problems first means trips with an open
   problem, sorted by their oldest open issue's `raisedAt` then id; then Watching trips by their unreported planned
   time; then other out trips by planned leave. Break remaining ties by plan date, vehicle id and trip number.
5. **Open, filters and decisions (D-72).** The dashboard's problem summaries link to
   `/dispatcher/live?issue=<id>`, and its truck Open to `?trip=<id>`. A summary, like a truck's row on Live day, names
   its problem as Live day's card does, the shop first: "Fresh Nugegoda · 1 dry carton short", "Fresh Kotahena · 3
   chilled cartons refused", a shop's report by its reason, "Fresh Peradeniya · 1 chilled carton damaged" or "Fresh
   Ampitiya · Chilled goods not cold" (spec 015, rule 12), and only a closed shop "Nobody at Fresh Mulgampola" (Q-39). Live day opens the named trip's inline details
   and focuses the issue card if named. All trucks shows the complete list. Problems only shows trips with an open
   issue or rule 4's unreported-departure/arrival attention; totals stay unfiltered. Needs you remains all open issues.
   Needs you keeps 012's departure 10: **every open problem in full**, oldest first; it is not one focused card
   followed by shortened Next rows. Decide focuses a full card. When its answer is kept, the corresponding trip
   row shows **Decided**; another open problem on that trip takes precedence with Decide. This uses recorded
   decisions, so it survives a refresh. Warned is not claimed: this piece has no warning command.
   A decided outcome remains on the trip but does not itself make an open problem. Open next focuses the oldest
   remaining open issue. If another dispatcher already answered it, refetch and say "That problem was already
   answered." A trip no longer in this view says "That trip is no longer in this view." No historical lookup follows.
6. **Refreshing.** Reuse the one SSE stream. A relevant committed change causes a fresh read, normally visible within
   a second locally. A `driver` message also reads the problems again, so a card's "Still on VEH057 · 39 cartons · 1
   stop left" follows the trip on Live day and the dashboard, to "no stops left" once the last stop is done. No server
   report exists for a write still on the driver's phone. On reconnect or a demo/clock
   change refetch as 008 does; retain the one-minute fallback. A stale browser view says so. No SSE payload or write
   response is installed as the day, and an older GET must not overwrite a newer one. The clock/attention query is
   refreshed when its day changes, as well as once a minute for a newly overdue report.
7. **Drops and events (D-69).** Latest first by business time, then a stable event key. At most 50 records, with
   "Latest 50 events" when truncated. Scope to the shown trips and the current publication. Event sources:

   | Event | Time and detail |
   | --- | --- |
   | Plan sent | Current `plans.published_at`, plan id/revision, only while published. No unsent/saved event with an invented time. |
   | Stop loaded; truck ready | `stops.loaded_at`; `trips.ready_at`. Stop/vehicle identity; no claim of a driver delivery. |
   | Left; arrived; back | `trips.left_at`; current `stops.arrived_at`; `trips.back_at`. |
   | Delivery with proof | `stops.done_at` for outcome delivered, current attempt's delivered counts and proof `photos` row. |
   | Problem raised, for every joined issue kind | `issues.raised_at` and `issues.kind`: loading flag, refusal, closed attempt, and 015's receipt report when joined, with that issue's typed counts. A refusal/closed attempt has one event, not another from `stops.done_at`. Old closed attempts remain even after Try again clears the stop. A receipt report is an event, not a new receipt-total metric. |
   | Answer sent | `issues.decided_at`, decision and `users.display_name`, one per decided issue. |

   Keys combine kind and source id (publication also includes revision). Refetch replaces this list rather than
   appending, so a retry or lost SSE never duplicates an event. Arrival history cleared by Try again is not rebuilt;
   the closed-attempt issue remains. This is the current day's record feed, not A8's complete audit history.
   Use no `audit_log.at`, `created_at`, `updated_at` or `driver_writes.answered_at` as visible times. A reset cannot
   reintroduce yesterday's audit rows. Late-synced events sort at the app time the server kept, not their receipt time.
8. **Photo words only.** An event with a photo says "· photo", without a link, thumbnail, binary read or viewer.
   No marker is shown when none exists. The problem card's own photo remains spec 013's existing behavior; A7 adds
   no proof route, uploading, signing, downloading archive or separate gallery.
9. **The loader sees a new publication (D-70, D-71).** Before any truck starts loading, the dispatcher may take the
   plan back, edit it with 010 or 014 and send it again under 010's existing time limits. Keep the last observed
   published loading list **in storage only** through a temporary no-plan response. While withdrawn, hide the old
   truck cards and Start controls and show only the wait sentence from the screen table. On a different
   publication reference for the same account/depot/demo generation/day, compare the old and new published details.
   Match trips by `vehicleId + tripNo`, stops by their shop within that trip, and orders/lines by id, not the trip or
   stop UUIDs which a save replaces. Compare driver, leaving time, ordered stop sequence and order/line quantities.
   First match same vehicle/trip keys. Among the remaining removed and added trips, pair an exact, nonempty order-id
   set once, irrespective of regenerated trip/stop ids; show one Moved row with both vehicles and any changed
   details. Sort ids only for this set match; do not discard the displayed stop sequence. Count that pair once for
   the bell and chip the new trip. A partial move, split or unmatched addition/removal remains separate affected
   rows; never guess a whole-trip move from equal quantities or shop names. Added/removed trips, other moved orders,
   stop-order changes and changed driver/leave time are changes. Loading progress,
   driver departure, issue answers, revision changes on a trip and UUID replacement alone are not.

   Keep the comparison in `sessionStorage`, scoped to account/depot/demo generation/day. It survives this tab's
   reload; a tab/device with no kept comparison establishes its own first-read baseline. The newest observed publication replaces the
   current comparison, against the previous publication this tab observed, even if Got it was not pressed. Show only
   facts from those two reads, never a reason the dispatcher did not enter. A first read does not claim a change.
   Got it changes only this tab's notice state. Bell and chips remain for that comparison, as the frame draws. A new
   day, reset or sign-out clears it; a no-plan response alone does not. A stale Start still uses 012's server checks
   and reloads, then opens the comparison when one exists. No acknowledgment unlocks or changes a trip.
10. **No edit after loading starts.** `loading_started` remains the answer to an unsend. The design's moved 41 cartons
    while another truck is loading cannot be enacted by this piece. This explicitly narrows the A7 promise in D-33,
    D-37 and 012's exclusions: take-off/swap after loading is deferred, not silently enabled. Loading flags and driver
    closed-shop retries remain their existing commands. The loader notice is additional context, never a lock.

## Permissions and failure paths
The new dispatcher GET requires a session (401 `signed_out`), dispatcher role (403 `forbidden`) and depot (admin:
403 `no_depot`). No request accepts an arbitrary depot. The read writes nothing, including no audit or acknowledgment row.
The loader metadata is on its existing protected endpoint. Existing issue writes keep their revision checks, locks,
errors and retry rules. Browser storage failure affects the comparison alone and is visible. A failed GET never
becomes an empty successful day. A seeded plan with no kept execution detail has the explicit Not recorded state;
a malformed kept check on a newly sent plan is an error, not a silent estimated schedule.

## Data in and out
New `GET /api/v1/operations` for both dispatcher pages; no proof endpoint.
The existing `GET /loading` adds the demo generation and publication time/actor. `GET /issues` and its writes/photos
remain the single problem path. Shapes, sources, query keys and read steps are in [plan.md](plan.md). No schema,
migration, seed or business write changes are proposed.

## Acceptance criteria
Every item has one named automated test or one written click-through check in [plan.md](plan.md). API tests use a
freshly seeded private database, sign in once per account per file and restore the seed at the end. Unit fixtures
stay in tests. Screen checks run in **Nabil's visible Chrome on the built app**, beside the frames on the joined
branch, not on fabricated API data. AC-19 was removed after review; the other criterion ids stay stable.

- [ ] **AC-1** When the operations GET is called without a session, with another role or with an admin, the system shall return rule 2's role/depot errors and write nothing.
- [ ] **AC-2** When the day is read at Wed 24 Jun 16:00 before a send, including README step 3 after placement, the system shall give Thu 25 Jun, no plan, no current trips, 0 / 0 delivered, 0 / 38 out, **0 orders for Friday** and no deferrals on a sent Thursday plan; test-only Friday demand shall count only its own eligible orders.
- [ ] **AC-3** When the README's five-order plan is sent, the system shall read its one trip and two stops, 99 deferred orders, 99 next-run orders and 6,947.7 of 18,600 litres recorded/committed (37%), without adding its 2.7 litres twice.
- [ ] **AC-4** When Kasun finishes 012's short-load walkthrough, the system shall show ready, 117 / 118 loaded, one depot short, 0 / 2 delivered and 0 / 38 out, with leave 04:36, arrivals 05:00 and 05:24 and return 06:10 still planned.
- [ ] **AC-5** When Dilshan starts at 03:31 then arrives and delivers Nugegoda at 03:34/03:38, the system shall show 1 / 38 out, 1 / 2 delivered, 1 / 2 done, 23 delivered and last driver report 03:38, with unchanged planned times.
- [ ] **AC-6** When the server receives Wellawatte's two-carton refusal, the system shall give 2 / 2 delivered, one partial, 2 / 2 done, 115 delivered, two refused and one depot short, and one open driver issue.
- [ ] **AC-7** When Wellawatte is closed instead, the system shall give 1 / 2 delivered, one closed, 2 / 2 done, 23 delivered, 94 not delivered and one depot short.
- [ ] **AC-8** When that closed stop is brought back then loaded and delivered on Friday, the system shall first raise next-run demand from 99 to 101 orders and still read Thursday's attempt at 23 delivered and 94 not delivered when the test reads Thursday again.
- [ ] **AC-9** When a closed stop is sent back with Try again, the system shall remove its finished/closed count, use 013's retry order and retain the closed-attempt and decision events once each.
- [ ] **AC-10** When the clock passes Thursday 16:00 while VEH035 is out, the system shall show Friday with that Thursday trip in Still out, count it once in trucks out and exclude its two stops from Friday's totals.
- [ ] **AC-11** When there is no operating day left, including Mon 29 Jun beyond the supplied calendar, the system shall return no day/next run while retaining any depot trip still out and existing depot-wide open problems, and fuel unavailable if its calendar row is absent.
- [ ] **AC-12** When the freshly seeded Wednesday publication is read, the system shall return its zero trips without failing, and when the test adds a legacy trip/stop without a kept check under it, return the explicit Not recorded state without inventing quantities or times.
- [ ] **AC-13** When another depot has a trip and issue, the system shall exclude them from every operations count, row and event.
- [ ] **AC-14** When a read races a demo reset, the system shall finish both without deadlock and return one whole generation, with no old event or mixed trip/line membership.
- [ ] **AC-15** When a fixture has one vehicle on two trips in different districts of the same brand, a mixed-brand trip and a stop completed with zero goods loaded, the system shall return distinct brand as well as district totals, count that vehicle once in its brand, list each trip once, exclude the empty delivery from delivered stops and exclude split parents from demand.
- [ ] **AC-16** When the next report is missing past its sent time, the system shall produce rule 4's attention, "Not loaded", "Still loading" with what is on so far, or "Departure not reported" by what the dock recorded, or an unreported arrival, stop doing so on arrival, and show Retry requested instead for a reopened stop, without an ETA or offline claim.
- [ ] **AC-17** When the walkthrough's records are read twice, including a repeated driver write, a late-synced refusal and a joined 015 receipt problem, the system shall return rule 7's ordered, unique events by problem kind at their business times, with only a photo marker and the same result on both reads.
- [ ] **AC-18** When more than 50 scoped events exist and a reset follows, the system shall return the newest 50 with the truncated flag before reset and none of those old records after reset, despite the surviving audit log.
- [ ] **AC-20** When a loader reads a sent or resent publication, the system shall give its demo generation, publication time and publisher from that exact plan.sent revision, never its original creator or audit wall time.
- [ ] **AC-21** When two observed publications rebuild only trip/stop ids or move exactly one trip's orders to another vehicle, the system shall respectively show no change or one Moved row with bell 1, and shall separately identify departure, driver, sequence, quantity and partial-move changes without pairing unrelated trips.
- [ ] **AC-22** When a loader's list goes published → withdrawn → republished, the system shall keep the old baseline only in storage while showing the wait sentence without old truck cards or Start, then show the comparison on resend and retain it through a tab reload and Got it, clearing it on account/day/depot/demo-generation change or sign-out.
- [ ] **AC-23** When a loader first visits or ordinary loading/driver/issue progress changes the list at the same publication, the system shall establish or keep the baseline without a Plan changed notice, and a failed storage write shall show the storage sentence while leaving current loading usable.
- [ ] **AC-24** When plans, loading, driver, orders or issues are announced, the system shall invalidate the operations query as well as the topic's existing query, and on driver the problems query too; clock/demo/reconnect shall refetch it through 008's existing path.
- [ ] **AC-25** When a truck finishes its route and returns, the system shall remove it from Trucks out now, retain it on the day's Live timeline with its return time and preserve its two-stop totals.
- [ ] **AC-26** When Ruwan opens Dashboard at 1440 × 900 after the refusal and in the closed-shop alternative, the system shall show each tile's own bar (including 1 / 2 delivered as half), the sourced truck columns in problems-first order, the existing issue summary and next run, without a district map or unsupported actions.
- [ ] **AC-27** When Ruwan opens Live day at 1440 × 900, the system shall draw the planned and recorded marks, server brand totals, grouped trips, legend and event rail, and Open shall expose labelled stop facts without a proof viewer.
- [ ] **AC-28** When Problems only, Decide and Open next are used, the system shall filter only rows, keep totals, retain every open problem in full, focus the existing and next card, and show 013's sent confirmation and the row's Decided state without Undo or a second decision API.
- [ ] **AC-29** When those dispatcher pages are used at 390 and 820 wide, the system shall use the table's below-1024 layout with usable cards and decisions and no page-wide horizontal scroll.
- [ ] **AC-30** When Kasun observes a pre-start resend at 1180 × 820 with a whole-trip vehicle move and, separately, a departure-only change, the system shall show the frame's single Moved row/bell 1 and the correct 04:36 → 04:40 row, then Got it shall show the new list and keep its changed chip/bell; both flows shall fit 390 wide.
- [ ] **AC-31** When an old loader Start from either the truck list or the truck page races withdrawal and resend, the system shall retain 012's refusal/refetch behavior, open the available comparison and never start a different trip silently; after any loading starts, Back to edit shall remain refused.
- [ ] **AC-32** When the driver saves Wellawatte offline while the dispatcher watches, the system shall keep the dispatcher's last server facts, show no claimed driver-offline status, then update counts, event and issue once after sync without a reload.
- [ ] **AC-33** When first load, no plan, no matching row, no events, no next day, missing detail or failed refresh occurs, the system shall show the corresponding table state and Try again where applicable, keeping Needs you usable independently.
- [ ] **AC-34** When an operations GET is held behind a newer refetch or an app-clock day change, the system shall prevent the older response replacing the newer view and request the newly watched day without waiting for a page reload.
- [ ] **AC-35** When a reviewer reads the joined code, the system shall have only the declared aggregate GET and local comparison, one clock/stream, server-supplied brand headers and tile ratios, no business sums in screens, and no new schema, command, photo viewer, sample data, GPS/presence inference or decision undo.
- [ ] **AC-36** When Wellawatte refuses all 94 loaded cartons, the system shall show 1 / 2 stops delivered, zero partial, one with none delivered, 2 / 2 finished, 23 cartons delivered, 94 refused and one depot short.
- [ ] **AC-37** When the manual Thursday plan is read before Send, after Send and after Back to edit before loading starts, the system shall show Friday's next-run count as 0, 99 and 0 respectively, with its future order cutoff and no closed state.

## Walkthrough
Keep the README's manual plan, not the separate suggested-plan walkthrough. Times below are examples of the app
clock, dependent on the judge's pace. For exact assertions the test freezes those instants.

Before the steps below, at README step 3 the watched day is Thursday but its plan has not been sent. The next-run
count for Friday is **0**, whether Nadeesha's two drafts remain unplaced (102 Thursday planning orders) or have been
placed (104). Those are Thursday's workload, not Friday's. After the Thursday publication, its 99 deferred orders
become eligible carry-over under rule 3; Back to edit removes them from this count again, giving **0 → 99 → 0**.

1. Continue after the README's Ready step (step 11 on this branch): Kasun has VEH035 ready at about 02:36, 117 of 118 cartons on and one dry short.
   As Ruwan open Dashboard. It reads Thu 25 Jun, 0 need you, 0 / 2 stops delivered, 0 / 38 trucks out, 99 orders for
   Fri 26 Jun, 37% fuel recorded and committed (6,947.7 / 18,600 litres) and 99 deferred on this plan. Next run's
   orders close Thu 16:00. Live day has Fresh → Colombo → VEH035 trip 1, Wasantha, ready; planned leave 04:36,
   Nugegoda 05:00, Wellawatte 05:24 and back 06:10. The loading flag and Go short decision are already in events.
2. Move to Trucks leave, Thu 03:30. As Wasantha start at 03:31, arrive Nugegoda at 03:34 and save its photo delivery
   at 03:38 as 013 says. Without refreshing, Ruwan sees 1 / 38 out, 1 / 2 delivered and 23 cartons delivered.
   Open the truck: actual arrival 03:34 sits beside planned 05:00; its event says "· photo" without a link. There is no revised ETA.
3. In the driver's tab only, turn the network off, arrive Wellawatte and refuse two of its 48 chilled cartons,
   keeping all 46 dry. Until sync, the dispatcher still has one delivered stop and last driver report 03:38.
   Restore the network. The 03:45 arrival and 03:48 refusal reach the server: 2 / 2 delivered · 1 partial,
   115 cartons delivered, two refused, one depot short, and one needs you. The event appears once at 03:48.
4. From the dashboard's issue summary press Decide. Live day focuses the existing refusal card. Bring them back
   and Send to driver at 03:52 gives its green line, the trip row's Decided state, no open issue and no Undo. The trip still records a refusal.
   Wasantha returns at 03:55. Dashboard is 0 / 38 out; Live day keeps the done trip and its 2 / 2 stops.
5. For the alternative on a fresh walkthrough, close Wellawatte instead: 1 / 2 delivered · 1 closed with a half-filled
   delivery bar (the trip's 2 / 2 finished progress is full), 23 delivered,
   94 not delivered and one short. Bring them back changes next-run demand from 99 to 101 orders. Its old stop
   stays closed even after those two orders are planned again. Try again instead reopens it, and its old closed
   attempt remains in events while its next attempt is unfinished.
6. For the loader change frames, reset and repeat through the send, stopping **before Start loading** at Thu 02:30.
   Leave Kasun's list open. Ruwan takes the plan back, changes VEH035's leave from 04:36 to 04:40 and sends again
   before the board changes day at 03:30. The tablet first says to wait, then shows the two departure times with
   the same two stops and 118 cartons. Got it returns to the list, keeping the changed chip. After Start loading,
   the dispatcher cannot take that plan back. This side demonstration does not alter the main driver's numbers.
   The separate comparison test follows frame `85:71921`: the removed VEH002 trip and added VEH001 trip have exactly
   the same order ids, so their before/after vehicle move is one row and bell 1, never Removed + Added with bell 2.

## Not in this piece
- **District map and replay:** omitted here. The map's cut line removes A8 first, then the district-map extra in A7,
  then A9; this omission does not reverse that order. No criterion, placeholder map or GPS simulation.
- **A8:** Orders, History, Fleet, Fleet next six weeks, historical date browsing and an audit/proof gallery.
- The **driver's phone bell count**, handed to A7 by 013's exclusion/departure 9, remains deferred. This piece's
  issue bell is the dispatcher's; its comparison bell is the loader's.
- A new proof read or photo viewer. Events keep only "· photo"; the existing problem-card photo belongs to 013.
- Editing any plan after loading starts: moving goods/trucks, skipping a stop, deferring a live stop or inserting a
  new one. The existing Try again of a closed stop is still 013's, not a new route editor.
- **Revised times and recovery for late trips.** A first trip back late does not move its second trip's leaving or
  arrival times, and a stale planned time is only worded as the plan's ("was due back 06:38" on Live day, the loader's
  and the driver's screens); no updated estimate, re-plan or recovery of the trips still to go is offered, and a sent
  plan cannot be taken back once a trip has moved on from planned.
- Predicted ETAs, GPS, driver presence, a queue count from another phone, traffic reports, "Warn the shop", calls,
  waves and docks. No new notification delivery or promised awareness by another person.
- Reversing an issue answer, credits, write-offs or replacements. Spec 015 owns the receipt and its business writes;
  its eventual issue cards can appear unchanged through Needs you, but 016 defines no received/signed metric.
- Automatic suggestion building, comparing to the original suggestion, a second plan checker or a forecast of
  tomorrow's allocations. Hand and suggested publications are read alike.
- A server acknowledgment ledger, cross-device unread count or historical comparison for a loader who never saw the
  old publication. A stale write is still checked by the server.

## Departures from the design
The join records these in the README: no map; source-backed totals and brand headers in place of inconsistent mock
totals; Stops delivered with its own bar and partial/closed distinctions; recorded and committed fuel; next-run
demand without a promised date for deferred goods or build time; **Planned arrival** and **Planned return** in the
truck table instead of an ETA/return estimate; planned/recorded times without presence; separate trip rows; no waves
or Wave 2 filter; existing issue answers with **Decided** rather than a fictitious Warned action, and no Undo/call/warn;
every open Needs you problem in full (012 departure 10), not one focused card and shortened Next rows; no driver's
phone bell count (013 departure 9 remains deferred); event photo words without a proof viewer; and No frame states.
D-70 also departs from `150:81067`, which draws a truck change while another truck is already loading: this build
only compares publications changed before **any** loading begins, without dock/reason/partial-unload claims.
The whole-trip move is one row/bell 1 as in `85:71921`; the loader badge stays after Got it as the prototype shows.

## Open questions
1. **May A7 change trucks after loading has begun?** Our pick: no for this build (D-70). It needs new commands that
   preserve goods already counted and changes to the existing locks. We explicitly defer the earlier A7 promise.
2. **Does Live day change to tomorrow at 16:00?** Our pick: yes, with the loader/driver day, retaining older out trips
   separately (D-66). Done trips then belong to A8, while old open issues still need the dispatcher.
3. **Live estimates or recorded facts?** Our pick: planned and recorded times plus missing-report attention (D-68).
   The server has neither GPS nor driver presence, and elapsed time alone cannot prove where a truck is.
4. **What does the delivery tile count?** Our pick: stops where some goods were delivered, including partials, with
   partial, none-delivered and closed counts stated beside it (D-67). A complete refusal or a zero-load completion
   does not count as delivered. Its tile bar uses delivered/total; the separate trip Progress uses finished/total.
5. **Must the loader acknowledgment follow the account across devices?** Our pick: no (D-71). Keep the two observed
   publications and Got it in this tab's session storage; describe the badge as changed trips, not unread work.
6. **Should 016 show shop receipt totals?** Our pick: no new metric or receipt behavior here. Keep 015's eventual
   issues and answers in the existing cards; driver delivery never stands in for shop acceptance.
