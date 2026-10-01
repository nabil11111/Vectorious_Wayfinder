# 017 · The dispatcher's look-up pages

**Status:** Spec, with open questions and our picks below · **Owner:** lead joins API and screens · **Design:**
Dispatcher · Orders; Dispatcher · History; Dispatcher · Fleet; Dispatcher · Fleet · next 6 weeks; and its booked state.

Piece A8 of [the map](../000-map.md), **the first piece cut if time runs short**. This is a documents-only draft.
It adds reads of the delivery day already kept by 004 and 008–015. It neither blocks that journey nor changes its
commands. The picks below are provisional until Nabil answers; the rules and tests build on those picks.

## Why
Ruwan needs to find a shop's order, inspect a delivery and its proof after the day has moved on, and see the depot's
vehicles and recorded workshop days. The submitted design gives each a page. The Hackathon asks for the designed
flows and a complete, demonstrable delivery journey; it does not justify making up historical trips or future demand.
The smallest useful A8 makes the stored facts easy to find and says when a fact was never recorded.

## What it does
**Orders** looks up submitted orders by the day the shop wanted them, with their current status, lines, deferrals,
split links and receipts. **History** opens a sent plan's date, its trips, loading, driver attempts, photos and shop
confirmations. **Fleet** reads vehicle limits, recorded trip state and the fuel ledger. **Next 6 weeks** reads 42
calendar dates of recorded availability, not a demand forecast. There are no new business writes or record kinds.

A row opens a detail panel. History links and photo viewers read the same authorized records; the pages never call
a store, driver or global admin endpoint under a dispatcher's identity. Decisions still happen in Live day, planning
still happens on the Plan board, and vehicle administration stays with the admin.

## Decisions
The entries in `docs/decisions.md` start at D-80. D-43 to D-79 belong to the earlier pieces, including their reviews.

| Decision | Pick this spec uses |
| --- | --- |
| D-80 | A8 is read-only and remains first to cut. No forecasting, hiring or workshop-booking command. |
| D-81 | Orders filters wanted dates and shows current facts, counting submitted leaf orders once. |
| D-82 | History is retained sent-plan records and recorded attempts, not an animated reconstruction of every edit. |
| D-83 | Counts keep their grain and their stage: orders, stops, attempts and shop confirmations are different. |
| D-84 | Proof and problem photos use shared depot-scoped reads and are never browser-cached. |
| D-85 | Fleet Today uses the app's calendar date and recorded trip states, without claiming physical location. |
| D-86 | Fleet fuel means recorded and committed litres, never measured consumption or inferred kilometres. |
| D-87 | Next 6 weeks means today through today + 41 calendar days; missing calendar rows stay unknown. |
| D-88 | Desktop tables become cards and an inline detail below 1024 wide; lookup stays online. |

## Screen states
All five dispatcher PNGs and their JSON text/links were inspected in the external export folder
`tech-triathlon-ops/design/export/03-high-fidelity-all-role-flows-03-dispatcher-high-fidelity/`.
The style guide, icons, logo and loading skeleton in `01-foundations-style-guide-icons-and-logo-1-style-guide-and-icons/`
were also inspected. These exports stay outside the repo. Frame names below give their ids as well as names.
“No frame” means a necessary state using the existing style guide, not another feature to design.

| Screen | State | Frame | What shows |
| --- | --- | --- | --- |
| Orders `/dispatcher/orders` | Rows and selected order | Dispatcher · Orders, `102:76375` | The frame's brand/district groups, table and right detail rail. Heading **Wanted for Thu 25 Jun · current status**; date picker, Day / Last 4 weeks, search **Shop or outlet id**, and All / Has deferrals / Deferred / Split. Rows name shop, temperature, units and wanted date instead of invented WF numbers. Load, window, **Latest sent plan · truck / stop**, **Planned arrival**, current status and deferral count. Summary gives submitted orders, currently planned orders, deferred orders and split parts, with those labels. |
| | Selected order | Same frame | Placed time if recorded, wanted date, lines and current stage counts, latest sent-plan record with its date/outcome, published deferrals with their reasons, split original/parts and replacement source when present. “Open in History” names the relevant plan date. No Plan first or Call button. |
| | Empty date / no search match | No frame | “No submitted orders were wanted for this date.” / “No orders match these filters.” Clear filters keeps the date. |
| | Selected order gone | No frame | “This order is no longer in the list. It may have been joined back or the demo reset.” Close the detail and refetch; never show another order under its label. |
| History `/dispatcher/history` | Sent plan, trips and selected stop | Dispatcher · History, `112:78211` | Date picker, up to three latest published dates, All / Late / Short / Returned / Deferred and brand filter. Brand/district cards, one row per trip, static planned timeline with labelled recorded marks. Detail rail: loading, ordered/loaded/handed-over/received lines, earlier closed attempts, problem answers and proof links. No Play, speed buttons or moving replay cursor. |
| | Receipts / problems | Same frame, detail rail | **Shop confirmations** counts stops confirmed once; a receipt card names shop and confirmed time, not “Signed”. Problems include decided ones. A **Not delivered / return instructed** section keeps closed goods and refusals distinct from deferred orders. |
| | Earlier plan with no trips | No frame | “No trips recorded on this sent plan.” Its recorded deferrals still show. No fake completed trips, receipts or photos. |
| | Legacy trip with incomplete detail | No frame | Vehicle, trip and shop membership where recorded, plus “Schedule / delivery detail not recorded.” Missing stage totals are —, not zero. |
| | No publication / no date selected | No frame | “No sent plan for this date.” / “No sent plans yet.” A draft is never shown as sent history. |
| Fleet `/dispatcher/fleet` | Today, selected vehicle | Dispatcher · Fleet, `112:79095` | Today / Next 6 weeks; All / Out now / Not recorded out / Workshop today; All types / Reefer / Dry / Van. Reefer trucks, dry trucks and vans in separate cards. Limits, recorded driver/trip state, weekly fuel remaining, recorded sent trips and planned km. Fuel remaining ascending by default; Vehicle id is the other sort. Detail rail holds limits, Mon–Sat fuel bars, workshop reason and latest five sent trips with History links. |
| | Archived / no trip or fuel record | No frame | Archived rows last, labelled Archived; retained trips still open in History. “No trip recorded today” is not “At the depot”. No sent trips means zero recorded trips, not fabricated trips from fuel rows. Fuel outside the calendar is “Week not available”. |
| Fleet `/dispatcher/fleet?view=six_weeks` | Recorded availability | Dispatcher · Fleet · next 6 weeks, `112:80499`, with the departure in rule 11 | **Recorded availability · next 6 weeks**, exact inclusive dates, Reefers / Dry trucks / Dry vans. Six seven-day groups, counts of active vehicles with and without a recorded day off, and a selected-date rail listing off vehicles/reasons. Operating / Closed / Outside delivery calendar is shown separately. No trips-needed, forecast, seasonal uplift, future fuel exhaustion or shortage claim. |
| | A date has workshop records | No frame | Date and reason for each existing `vehicle_days_off` row. This is a read, not a booking success. |
| | Booking / booked | Dispatcher · Fleet · next 6 weeks · booked, `195:83482` | **Not built.** The frame books hired reefers, not workshop time. No Book, Booked, Tell shops or pretend success state is offered. The availability view says “Demand forecasts and vehicle bookings are not included.” |
| Every page | First load | Loading · skeleton, `85:72065` | Existing top bar stays usable; grey blocks match rows and detail. A later fetch keeps the last successful view in place. |
| | First read failed / refresh failed | No frame | “Could not load orders/history/fleet.” and Try again; or “Could not update. These are the last records loaded.” with the last successful app-clock read time. An error never becomes an empty or zero result. |
| | Connection lost / signed out | No frame | The loaded view stays with “Connection lost · these records may be out of date.” First visit has the error/retry state. A refused session clears this account's visible detail/photos and follows existing sign-in. No offline lookup store or queue. |
| | Photo loading / open / missing / failed | No frame | A labelled, keyboard-closeable viewer with loading blocks, image and Close; “No photo recorded” for absent proof and “Could not load the photo” with Try again for a failed read. |
| | Below 1024 wide | No frame | Keep all filters and counts, wrapping controls. Cards replace dense rows; selecting a card opens its detail immediately below it with Close. History uses a list of labelled planned/recorded times, not a squeezed timeline. Six weeks is a date list grouped by seven days. Existing bottom navigation remains; no page-wide horizontal scroll. |

At 1024 and wider keep the frame's table/timeline and detail rail, narrowing the rail between 1024 and 1280.
Use existing CSS tokens, Manrope headings, Inter body, JetBrains Mono ids/times, 12 px cards and the supplied PNG
icons. No stock emoji substitute, chart package, map or new design system. The six-week chart may be simple CSS/SVG,
with the same values also in a readable date list. Keyboard focus and text labels carry meaning alongside colour.

## Rules
Times use the app clock and depot time. Examples use the README's **manual** VEH035 walkthrough, not 014's suggested
plan. Missing evidence remains missing even if a plausible figure could be worked out from today's master data.

1. **Scope and dates.** Every read is for the signed-in dispatcher's depot. Orders defaults to the app's calendar
   today, explicitly labelled Wanted for; a chosen date stays chosen. Day selects that wanted date; Last 4 weeks is
   the 28 calendar dates ending on it, inclusive. History defaults to the latest published plan date no later than
   today, or no date; its picker may open any recorded published date, including a sent tomorrow. Fleet Today and
   six weeks use calendar today, not the plan board's 03:30 or loader's 16:00 rollover. No parameter switches depot.
2. **Orders are current submitted leaf records (D-81).** Exclude drafts and `split` parents from list totals. Parts
   are real orders; their original and sibling links remain in detail. Filter by `orders.delivery_date`, not a
   guessed scheduled date. Before Nadeesha places, 98 orders are wanted Thu 25 Jun; afterwards 100. Thursday's
   planning workload is 104 because it also includes four wanted earlier; History accounts for it as on-plan orders
   plus the publication's deferrals. It is not this page's wanted-date count. Last 4 weeks ending Thursday holds
   127 submitted orders before place, 129 afterwards.
3. **Order facts do not promise a new delivery.** Show current status beside **Latest sent-plan record**, selected
   by latest published plan date, with its vehicle, trip, stop, outcome and saved planned arrival. A closed record
   stays historical when Bring them back makes the order placed again. Until a new publication exists there is no
   new assigned date. Deferrals come only from published plans; for a split part include its original's deferrals,
   deduplicated by plan id. Has deferrals means at least one such record; Deferred means current status deferred;
   Split means a leaf with `split_from`. A split parent appears only through its parts' detail. Replacement links
   follow 015, including a part's original. Search is a literal, case-insensitive substring of shop name or outlet id.
   Groups are Fresh, Style, Tech, district, shop, wanted date, chilled before dry, then order UUID; details show the
   full UUID when needed, never a fabricated order number. Filter summaries describe the unfiltered wanted-date set;
   a separate “Showing N of M” gives filtered rows. No cap silently hides records.
4. **History is a publication, not a simulation (D-82).** Select the depot's published plan for the explicit date.
   Its stops and deferrals define that day; current order status alone cannot move them out. Sent trips made by hand
   or by 014 read identically. Keep one trip row, sorted by saved leave time, vehicle id and trip number within its
   brand/district group; a mixed-brand trip has its own Mixed group and is never counted twice. Use `sent_check` for
   planned times, effective windows, load and km. Do not run today's checker to rebuild an old schedule. Current
   names/item descriptions are labelled as current reference data, not an immutable copy of a past screen.
5. **Recorded stages and attempts.** Current trip/stop columns give departure, ready, load, arrival, completion and
   return times. All loading, refused, closed and receipt problems and their answers are visible, not only open ones.
   Every closed issue is its own attempt, with its own `raised_at`, `decided_at`, counted lines and optional photo.
   Its old arrival may be read from its matching `stop.closed` audit's `before.arrivedAt`; absent evidence says
   “Arrival not recorded”. Never borrow the stop's later arrival for that attempt. A Try again can clear the current
   stop and later create a successful visit; the old attempt remains separate. Unsend/resend retains only the current
   publication, not a browsable sequence of deleted draft trips. The page offers no animated replay or raw audit log.
6. **Counts say their stage (D-83).** Per line: ordered = quantity; loaded = final loaded count once recorded;
   handed over = delivered count; received = the shop's received count. Zero is a recorded zero, null is unknown.
   Depot short = ordered − loaded; refused = loaded − handed over on a refusal; receipt short = handed over −
   received. Do not add a receipt's total order shortfall to those differences again. For an old closed attempt,
   loaded/not delivered comes from its `issue_lines.counted`; handed over and received are null, even if the orders
   later travel on Friday. Use the existing calculators/helpers on the server; screens format, filter by returned
   flags and draw, without calculating business figures.

   | History figure | Exact meaning |
   | --- | --- |
   | Trips / stops | Trip rows / distinct current stops of this publication. Attempts never add stops. |
   | Stops delivered | Current delivered/refused outcomes with more than zero units handed over. Partial deliveries are marked; a closed or completely refused stop is not delivered. |
   | Finished / partial | Stops with a current outcome / delivered stops with a refusal quantity above zero. |
   | Late | Current recorded arrival strictly after the saved effective window close; no arrival is unknown, never late from elapsed time alone. |
   | Short | Distinct current stops with any known depot short, refused quantity or receipt short above zero. A not-cold report with no count difference is a problem, not a short quantity. |
   | Returned | Distinct stops with a closed problem answered Bring them back, or a refusal answered Bring them back or Send replacements (015 still sends the refused goods back). Label “Return instructed”; this is not a depot return scan. Earlier retry attempts alone do not make it returned. |
   | Deferred | Distinct orders in this publication's deferrals, independent of what they do on a later plan. No promised next date. |
   | Shop confirmations | Distinct current delivered/refused stops whose orders were confirmed through 015. Three orders at Nugegoda make one confirmation. |

   Summary totals describe the whole selected publication; brand/attention filters give a separate visible count.
   Late/Short/Returned select trips with a matching stop; Deferred shows the deferral list instead of inventing trip
   rows. Brand selects actual stop/order brands; matching a mixed trip keeps its whole row, with nonmatching stops
   labelled rather than silently removed. Missing execution detail makes the affected aggregate null, with its
   recorded/total coverage, instead of silently counting missing detail as zero. No publication means a separate
   empty state; a publication with no trips has zero trip/stop counts and its genuine deferrals.
7. **A receipt belongs to its stop.** Use `stopId` as the receipt reference: 015 confirms a stop once and adds no
   receipt id. Show confirmed time, time received by the server, cold answer, line counts and report/decision if any.
   The driver's proof is not a receipt; a waiting receipt on another phone is not visible here. An old closed attempt
   never gains an order's later receipt. Seeded received orders with no stop show their order-level receipt facts in
   Orders only, not fabricated History trips. Under 015 the 25 seeded received orders total 205 cartons, with no
   server receipt-sent time, trip or proof attached to them.
8. **Photos (D-84).** A stop proof has `issue_id IS NULL`; a loading/driver/receipt problem photo names its issue.
   Show metadata and explicit links, loading bytes only when opened. Use the shared proof endpoint from 016 and
   013's issue-photo endpoint, including decided issues. No second photo table, synthetic receipt image, signature,
   public URL or base64 in a list. Each binary response is JPEG with `private, no-store`, nosniff and same-origin.
   Close/sign-out/reset releases the fetched image; a late response cannot put another selection's photo on screen.
9. **Fleet is records, not location (D-85).** List this depot's vehicles, including archived rows last with their
   badge; historic trips never vanish when a vehicle is archived. Active counts exclude archived vehicles. Group
   reefer trucks, dry trucks, then all vans, with archived rows last within each group. Fuel sorting puts unknown
   remaining values after known ones within the active/archived sets; ties use vehicle id. Reefer filter includes
   reefer vans; Van includes both temperatures, so
   those totals overlap and must not be added. Out now means a distinct vehicle with an `out` trip on any published
   date, including an earlier day. That trip supplies the status/driver first; if several are out, use oldest plan
   date then trip number/id and show all in detail. Otherwise use today's first unfinished trip by saved leave time
   then trip number/id, else today's latest returned trip by back time then trip number/id descending, else No trip
   recorded today. Unknown legacy times sort last. Say Planned, Loading, Ready or Returned with its recorded time
   as applicable. “Not recorded out” means no such out trip, not physically at the depot. Never guess a permanent
   driver. Today's workshop reason is independent of trip state; an out trip remains visible even if someone
   archived its vehicle. No no-signal minutes or ETA.
10. **Fuel (D-86).** The selected calendar day's ISO year/week picks Mon–Sat `fuel_log` rows for those vehicle ids.
    Sum each row once in integer tenths of litres; publication already writes its estimated litres here, so do not
    add `sent_check` fuel again. Remaining = quota − recorded/committed; retain a negative value as Over quota.
    Recorded/committed percent = `percent(recordedCommitted, quota)` and remaining percent =
    `percent(quota - recordedCommitted, quota)`, using the existing rounded helper; both are null for zero quota.
    Preserve negative remaining values; clamp only the drawn bar width. Totals include exactly the listed depot
    vehicle set, including archived rows that still have ledger entries, with active/archived counts labelled
    separately. Mon–Sat bars use those dated rows; a date with no row is zero **recorded/committed**, not evidence
    that no trip happened. Sent-trip count and planned km come only from published trips/checks in that week;
    legacy missing km stays unknown. Fleet's latest-five trip list uses published plan date descending, then vehicle
    trip number descending then id, never inferred trips from fuel history. No calendar row means the fuel week is unavailable.
11. **Six weeks (D-87).** Read 42 consecutive dates from the app's calendar today, inclusive, and the current depot
    inventory with its recorded days off. Categories are disjoint: reefers (trucks and vans), dry trucks, dry vans.
    Each date gives active total, recorded off count and active vehicles without a recorded off row, independently
    of the operating flag. A date outside `calendar_days` has unknown operating status; no weekday inference or
    calendar extension. “No recorded day off” is not “free”, “enough capacity” or “available for any route”. The view
    does not subtract out trips, reserve a future trip or forecast return/fuel/demand. An archive affects current
    inventory across this read; its real timestamp cannot reconstruct demo-time historical availability. On Thu
    25 Jun the range ends Wed 5 Aug: 38 active, 3 recorded off, 35 without an off row that Thursday; 6 of 9 reefers
    without an off row. Fri 26 has 38; Sun 28 is closed; Mon 29 is outside the calendar. Hiring and booking a vehicle
    off are both outside this piece, even though days off can already be read.
12. **Reads stay coherent.** Each page aggregate is one reset-safe, repeatable-read snapshot, including its clock
    and all totals. It writes nothing and announces nothing. Existing changes refetch the pages, including admin
    archives. Requests are cancelled/scoped by account, depot, parameters and demo generation; a stale result
    cannot replace a newer date or reset. The last loaded view may stay during a failed refresh, explicitly marked
    stale. Sign-out clears visible account data. No last-update comparison by timestamp: the demo clock can wait
    or move backward. These pages use the existing minute fallback and reconnect behavior, not another stream.

## Permissions and failure paths
Every new endpoint requires a session (`signed_out` 401), dispatcher role (`forbidden` 403 for shop/loader/driver),
and depot (the seeded admin gets `no_depot` 403). Missing/foreign order, stop, issue or vehicle ids are
`unknown_record` 400 after scoping; malformed dates, ids or query values are `invalid_input` 400. A valid empty
date is an empty result. A plan never sent cannot be obtained as sent history through an id or a photo shortcut.
There are no new writes, revision conflicts, confirmations or retries of mutations on these pages.

A genuinely legacy plan with no kept check gets the missing-detail state; a malformed kept check or a newly sent
trip missing required timing is an invariant failure and shows Could not load. Errors cannot silently choose a
different date, depot or order. A reset can remove a selection; clear it and its image before presenting new data.

## Data in and out
Five GETs under `/api/v1/lookup`: `/orders`, `/orders/:orderId`, `/history`, `/fleet`, `/fleet/availability`.
Contracts and query parameters are in [plan.md](plan.md). Proof uses 016's `/operations/stops/:stopId/photo`;
problem photos use `/issues/:issueId/photo`. Read the existing order, plan, trip, stop, issue, photo, receipt,
vehicle, days-off, fuel, calendar and reference records. No schema, seed or business-command change.

## Acceptance criteria
Each numbered criterion has one named automated test or written browser check in plan.md. Integration tests use
the private seeded database and restore it; business-rule tests run failing before implementation.

- [ ] **AC-1** When any lookup GET is called without the required session/role/depot, the system shall return the existing permission errors and write nothing.
- [ ] **AC-2** When another depot's order, trip detail, vehicle or photo is requested, the system shall reveal no record from that depot, including through detail links and filters.
- [ ] **AC-3** When a query has an invalid date, range, filter or id, the system shall reject it with `invalid_input` without changing the selected records.
- [ ] **AC-4** When Orders is read on the fresh seed for Thu 25 Jun, the system shall show 98 wanted orders and exclude the two drafts; after placement it shall show 100, not the planning workload's 104.
- [ ] **AC-5** When Last 4 weeks ends on Thu 25 Jun, the system shall use 29 May–25 Jun inclusive and show 127 submitted leaf orders before place and 129 afterwards.
- [ ] **AC-6** When Orders search or Has deferrals / Deferred / Split is selected, the system shall return exactly rule 3's rows in stable order with unchanged range totals and a separate matched count.
- [ ] **AC-7** When an order is split and later joined back, the system shall count only live leaf orders, expose the original through detail, and deduplicate inherited deferrals by plan without inventing orders.
- [ ] **AC-8** When closed goods are brought back and later sent again, the system shall keep the old sent-plan record as historical and show a new scheduled date only once a new plan is published.
- [ ] **AC-9** When a received or replacement order is looked up, the system shall show 015's recorded counts/times/source, including split replacement ancestry and null sent time for seeded receipts.
- [ ] **AC-10** When Thursday's manual plan is sent, the system shall show one History trip, two stops, five orders, 99 deferred orders and the kept 04:36 / 05:00 / 05:24 / 06:10 schedule.
- [ ] **AC-11** When Kasun marks the walkthrough truck ready after Go short, the system shall show 118 ordered, 117 loaded, one depot short, the loading flag and answer, and no delivered or received counts yet.
- [ ] **AC-12** When Nugegoda is delivered and Wellawatte refuses two chilled cartons, the system shall show two delivered stops, one partial, 115 handed over, two refused and one depot short without counting the refusal twice.
- [ ] **AC-13** When a stop hands over zero goods, the system shall count it finished but not delivered, distinguishing a complete refusal from a closed attempt.
- [ ] **AC-14** When a closed stop is brought back, reloaded and received on another day, the system shall keep the old attempt's 94 not-delivered cartons and no receipt on that attempt.
- [ ] **AC-15** When a closed stop is retried, the system shall keep each closed issue's own quantities/time/photo and matching audit arrival separate from the new visit, with Arrival not recorded where that audit evidence is absent.
- [ ] **AC-16** When Nugegoda confirms 11, 8 and 3 cartons against 12, 8 and 3 handed over, the system shall show one shop confirmation, three received orders, 22 received and one receipt shortage distinct from the one depot shortage.
- [ ] **AC-17** When the app has only the seeded Tuesday/Wednesday publications, the system shall show their one/four deferrals and no invented trips or stop receipts; a test-only legacy trip shall show explicit missing detail.
- [ ] **AC-18** When History's Late / Short / Returned / Deferred or brand filter is used, the system shall apply rule 6's predicates, including a refusal answered Send replacements as Return instructed, without mixing orders, stops and attempts or double-counting a mixed trip.
- [ ] **AC-19** When an owned proof or decided problem photo is opened, the system shall return only its JPEG with private/no-store, nosniff and same-origin headers, or the explicit absent-photo result.
- [ ] **AC-20** When Fleet Today is read on Thu 25 Jun before a send, the system shall show Peliyagoda's 38 active vehicles, nine reefers, four vans, three workshop vehicles and 35 without a recorded day off.
- [ ] **AC-21** When a recorded trip starts and returns while its vehicle has a second ready trip, the system shall change Out now from zero to one to zero and select the second trip under rule 9, retaining any earlier-day out trip ahead of today's unfinished trip without inferring physical depot presence or connectivity.
- [ ] **AC-22** When a vehicle is archived by admin, the system shall keep its historical trips and fuel readable, distinguish active totals and still show any recorded out trip.
- [ ] **AC-23** When the seeded fuel week is read and a plan is sent/unsent, the system shall show 6,945 of 18,600 litres before send, 6,947.7 after VEH035's send and 6,945 after unsend, without duplicate fuel or invented historic trips.
- [ ] **AC-24** When fuel has zero quota, exceeds quota or has no calendar week, the system shall show the explicit null/over-quota/unavailable states defined by rule 10.
- [ ] **AC-25** When Next 6 weeks is opened on Thu 25 Jun, the system shall return exactly 42 dates through Wed 5 Aug with the recorded Thu/Fri workshop counts, closed Sun 28 and unknown Mon 29 operating status.
- [ ] **AC-26** When a future workshop row exists beyond the calendar and VEH003 is archived, the system shall show that row with unknown operating status and Thursday's 37 active, two active off and 35 without an off row, without predicting demand or claiming free route capacity.
- [ ] **AC-27** When any lookup aggregate races a write or demo reset, the system shall return one coherent committed snapshot and never combine old stops with new problems or old-run audit events.
- [ ] **AC-28** When a relevant existing live topic arrives or the stream reconnects, the system shall refetch lookup data while preserving the existing pages' invalidations and minute fallback.
- [ ] **AC-29** When an older request/photo completes after a newer selection, reset or sign-out, the system shall prevent it replacing the current view, clear invalid selections and release old image data.
- [ ] **AC-30** When Orders is used at 1440 wide on the walkthrough, the system shall show the frame's grouped table and working detail/filter links with rule 2's real wanted-date totals.
- [ ] **AC-31** When History is used at 1440 wide, the system shall expose the selected trip, earlier attempts, shop confirmation, deferrals and real proof links without replay or signature controls.
- [ ] **AC-32** When Fleet and Next 6 weeks are used at 1440 wide, the system shall preserve the frame's groups/detail rail, show the source-backed fuel/availability labels, and offer no hire or booking-off success path.
- [ ] **AC-33** When the pages are used at 390, 820 and 1024 wide, the system shall use D-88's cards below 1024 and desktop layout at 1024, with all filters/details/photos accessible by keyboard and no page-wide overflow.
- [ ] **AC-34** When a first read, refresh or photo fails, the system shall show the corresponding screen-table state; empty data, missing detail, lost connection and expired sign-in shall remain distinct.
- [ ] **AC-35** When the four-role walkthrough advances or an offline driver's records sync, the system shall refresh these lookups once from accepted server facts without exposing another phone's queue or claiming a receipt before the shop syncs it.
- [ ] **AC-36** When the implementation is reviewed, the system shall have no A8 business write, forecast/sample result, new table, second clock, duplicated calculator, unsafe photo cache or control for an excluded action.

## Walkthrough
Follow the README's manual plan and spec 013/015's joined driver/receipt flow. API tests freeze example instants;
the judge sees the times actually recorded at their pace. Do not manufacture completion data in the seed for A8.

1. Reset. As Ruwan open Orders, choose Wanted for Thu 25 Jun: 98. Last 4 weeks ending Thu: 127. As Nadeesha place
   her 8 chilled and 4 dry draft; Ruwan sees 100 and 129 respectively without reload. Has deferrals on the four-week
   list finds the four waiting orders, including Fresh Dickwella with two distinct earlier plan deferrals.
2. As in the README send VEH035, Dilshan driving, OUT001's 12 carried chilled + 8 new chilled + 4 dry and OUT002's
   48 chilled + 46 dry. Orders wanted Thursday shows four planned and 96 deferred among its 100 rows. History for
   Thursday shows five on this trip and 99 deferred from the 104-order workload, with two stops and 118 cartons.
3. Kasun loads Wellawatte first, flags Nugegoda's dry count at 3 of 4; Ruwan answers Go short; Kasun marks ready.
   History shows 117 loaded, one depot short, 807.3 kg and 4.329 m³ loaded, with the recorded flag/answer/ready times.
4. Dilshan starts, arrives and photographs the Nugegoda delivery (12, 8 and 3 handed over), then refuses two of
   Wellawatte's 48 chilled cartons and hands over 46 chilled + 46 dry. History reads 115 handed over, two refused,
   one depot short, two delivered stops and one partial. Open Nugegoda's actual proof; a missing optional refusal
   photo shows no invented thumbnail. Bring them back is answered in Live day, not here.
5. Nadeesha confirms 11, 8 and 3 at Nugegoda, reporting one chilled missing through 015. History shows one stop
   confirmation, three received orders, 22 received and one receipt shortage; the total ordered-to-received gap is
   two, including the dry carton left at the depot. A replacement answer belongs to 015 and adds one chilled carton
   wanted Friday, linked to the report; Thursday's old receipt stays unchanged. On a fresh 015 seed Orders also has
   the 25 earlier received orders / 205 cartons; none becomes a fake History trip.
6. Fleet on Thu 25 Jun: 38 active, nine reefers, four vans, VEH003/005/036 off, 35 without an off row. Fuel after
   sending is 6,947.7 / 18,600 L, rounded 37%; VEH035's 2.7 L is already committed, even before it drives. Out now
   follows the recorded start/finish, and its History link opens Thursday's trip rather than the current board day.
7. Next 6 weeks shows Thu 25 Jun–Wed 5 Aug. Reefers on Thursday: nine active, three off, six without an off row.
   Friday has no workshop rows. Sun 28 is closed; Mon 29 says Outside delivery calendar, not “nine available trips”.
   There is no Booked state. Repeat the views at 390 wide; turn off the connection and observe the labelled stale
   data, then reconnect. Reset removes the selected trip/proof, including any late response still in flight.
8. Separate fresh run: close Wellawatte, then Try again; close it again or deliver it. Inspect both attempts and
   their photos/times. In a different run Bring them back and allocate those orders on Friday: Thursday still
   records 94 not delivered and cannot acquire Friday's received quantities or receipt photo.

## Not in this piece
- **Orders:** placing/editing/cancelling, priority overrides, Plan first, Find a slot, a next date for deferrals,
  calls, invented order numbers, operating-day lateness analytics and the four-week Skipped lately ranking.
- **History:** replay/speed/scrubbing, a raw audit explorer, all past publication revisions, deleted draft trips,
  reconstructed GPS/ETAs, signatures, guessed missing times, or claims that current reference names were names then.
  The audit-backed arrival for a retained closed attempt is included; a complete event-sourced day is not.
- **Fleet:** master-data edits/archives, booking or cancelling workshop days, hiring/returning vehicles, recording
  actual fuel/odometer use, driver rosters, availability promises, maintenance recurrence or dispatch commands.
- **Six weeks:** two-year demand predictions, seasonal multipliers, suggested hires/waves, future fuel depletion,
  capacity sufficiency, messages to shops, bookings, new calendar data or Datathon inputs/models.
- **Other pieces:** changes to planning/issue/receipt commands or the phone queues, loader change acknowledgments,
  maps, exports, printing, persistent offline lookup storage, or new packages/infrastructure.

## Departures from the design
At implementation join, add these to the README: wanted-date/current-status Orders with Has deferrals instead of
ambiguous Carried over; real identities and no phone/priority buttons; static retained History with stage-specific
counts and shop confirmations rather than signatures/replay; separate trip rows; recorded trip state instead of
physical depot/connection claims; recorded-and-committed fuel rather than consumption; recorded availability instead
of a demand forecast and hired-booking success; unknown dates beyond the calendar; and the No frame states/narrow
layouts above. This spec PR does not amend the README as though those screens were already built.

## Open questions
1. **Is A8 worth building before the deadline? Our pick:** only after the joined four-role/offline journey and A7
   checks pass; cut all of A8 first if they need time (D-80). This draft creates no obligation to ship it.
2. **Which date should Orders mean? Our pick:** Wanted for, with current status and a separate latest sent-plan
   record (D-81). It avoids silently switching populations when a plan is sent or returned. A worklist of every
   order eligible for a plan already belongs to the Plan board.
3. **How much history is required? Our pick:** static retained sent-plan detail, all retained closed attempts and
   their available audit arrival, proofs and shop confirmations; no animated/full audit replay (D-82). This narrows
   013/016's broad A8 history promise explicitly without discarding the evidence they actually keep.
4. **Should six weeks predict demand or show records? Our pick:** recorded availability, clearly labelled (D-87).
   No forecast record or estimator is necessary for this smaller useful view; the exported forecast cannot be
   supported by these records. Calendar dates after 28 June stay unknown even though workshop entries can be read.
5. **May the dispatcher book a vehicle off, or hire the trucks drawn? Our pick:** neither in A8 (D-80). The inspected
   Book button hires reefers; it is not a workshop booking. Either write needs authorization, clashes with published/
   loading/out trips, durable identity, audit and recovery rules. Reading `vehicle_days_off` does not authorize a
   new write, and an admin archive is not a date-range booking.
6. **Should Fleet say At the depot and fuel used? Our pick:** Not recorded out and Recorded + committed (D-85/86).
   The app has reported trip state and planning fuel estimates, not physical tracking or consumption measurements.
7. **What should a narrow screen get? Our pick:** complete read/detail/filter access as cards below 1024 (D-88),
   without bringing the driver's offline queue or building a second mobile reporting app.
