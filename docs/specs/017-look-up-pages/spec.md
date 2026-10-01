# 017 · The dispatcher's look-up pages

**Status:** Done, with the questions and our picks below · **Owner:** lead joins API and screens · **Design:**
Dispatcher · Orders; Dispatcher · History; Dispatcher · Fleet. The two next-six-weeks frames are excluded below.

Piece A8 of [the map](../000-map.md), **the first piece cut if time runs short**. This is a documents-only draft.
It adds reads of the delivery day already kept by 004 and 008–015. It neither blocks that journey nor changes its
commands. The picks below include the lead's review decisions; the rules and tests use that reduced scope.

## Why
Ruwan needs to find a shop's order, inspect a delivery and its proof after the day has moved on, and see the depot's
vehicles and recorded workshop days. The submitted design gives each a page. The Hackathon asks for the designed
flows and a complete, demonstrable delivery journey; it does not justify making up historical trips or future demand.
The smallest useful A8 makes the stored facts easy to find and says when a fact was never recorded.

## What it does
**Orders** lists a delivery day's orders, their lines, carried-over marks, that day's plan and deferrals, and the
frame's **Skipped lately · 4 weeks** panel. **History** opens a sent plan's date, its trips, loading, driver attempts,
photos and shop confirmations. **Fleet** reads today's vehicle limits, recorded trip state, workshop rows and fuel
ledger. Hide the Next 6 weeks toggle: there is no forecast, hiring or substitute availability view. There are no
new business writes or record kinds. T0 starts after 016 is merged. Orders and Fleet require joined 013; History's
shop confirmations and replacement answers additionally wait for joined 015, without blocking Orders or Fleet.

A row opens a detail panel. History links and photo viewers read the same authorized records; the pages never call
a store, driver or global admin endpoint under a dispatcher's identity. Decisions still happen in Live day, planning
still happens on the Plan board, and vehicle administration stays with the admin.

## Decisions
The entries in `docs/decisions.md` start at D-80. D-43 to D-79 belong to the earlier pieces, including their reviews.

| Decision | Pick this spec uses |
| --- | --- |
| D-80 | A8 is read-only and remains first to cut. No forecasting, hiring or workshop-booking command. |
| D-81 | Orders lists delivery days, starts on the board day, includes carried-over orders and embeds detail in each row. |
| D-82 | History is retained sent-plan records and recorded attempts, not an animated reconstruction of every edit. |
| D-83 | Counts keep their grain and their stage: orders, stops, attempts and shop confirmations are different. |
| D-84 | A8 owns its proof read if 016 has none; keep 013's issue-photo read and depot scope. |
| D-85 | Fleet Today uses the app's calendar date and recorded trip states, without claiming physical location. |
| D-86 | Fleet fuel means recorded and committed litres, never measured consumption or inferred kilometres. |
| D-87 | Hide Next 6 weeks; no forecast, hiring or availability substitute. |
| D-88 | Below 1024, tables scroll inside their own boxes and details stack below; lookup stays online. |
| D-89 | Skipped lately counts distinct sent-plan dates per shop in the last 28 dates. |

## Screen states
All five dispatcher PNGs and their JSON text/links were inspected in the external export folder
`tech-triathlon-ops/design/export/03-high-fidelity-all-role-flows-03-dispatcher-high-fidelity/`.
The style guide, icons, logo and loading skeleton in `01-foundations-style-guide-icons-and-logo-1-style-guide-and-icons/`
were also inspected. These exports stay outside the repo. Frame names below give their ids as well as names.
“No frame” means a necessary state using the existing style guide, not another feature to design.

| Screen | State | Frame | What shows |
| --- | --- | --- | --- |
| Orders `/dispatcher/orders` | Rows and selected order | Dispatcher · Orders, `102:76375` | Heading **Orders for Thu 25 Jun**, opening on the board's day. Date picker, Day / Last 4 weeks, search **Shop or outlet id**, All / Carried over / Deferred / Split. Brand/district groups, table and detail rail. Wanted date, ordered load, window, selected day's truck/stop and **Planned arrival**, current status and deferral count. Summary names orders, planned, deferred, carried over and split parts; planned/deferred come from the selected day's own sent plan. |
| | Selected order | Same frame | Detail is already in the list row: placed time if recorded, wanted date, ordered lines, note, selected-day plan links, published deferral reasons and split original/parts. History links name their plan date. No receipt/replacement ancestry, Plan first or Call button. |
| | Skipped lately · 4 weeks | Same frame, lower detail rail | Shops with published deferrals in the 28 dates ending on the selected day; one skip per shop per plan, latest date/reasons and count, under rule 11. Independent of table search/filter. |
| | Empty day / no search match / no skipped shops | No frame | “No orders for this delivery day.” / “No orders match these filters.” / “No shops skipped in these four weeks.” Clear filters keeps the day. No valid default board day says “Choose a delivery day”; no fallback to a guessed date. |
| History `/dispatcher/history` | Sent plan, trips and selected stop | Dispatcher · History, `112:78211` | Date picker, up to three latest published dates, All / Late / Short / Returned / Deferred and brand filter. Brand/district cards, one row per trip, static planned timeline with labelled recorded marks. Detail rail: loading, ordered/loaded/handed-over/received lines, earlier closed attempts, problem answers and proof links. No Play, speed buttons or moving replay cursor. |
| | Receipts / problems | Same frame, detail rail | **Shop confirmations** counts stops confirmed once; a receipt card names shop and confirmed time, not “Signed”. Problems include decided ones. A **Not delivered / return instructed** section keeps closed goods and refusals distinct from deferred orders. |
| | Earlier plan with no trips | No frame | “No trips recorded on this sent plan.” Its recorded deferrals still show. No fake completed trips, receipts or photos. |
| | No publication / no date selected | No frame | “No sent plan for this date.” / “No sent plans yet.” A draft is never shown as sent history. |
| Fleet `/dispatcher/fleet` | Today, selected vehicle | Dispatcher · Fleet, `112:79095` | Today only; hide Next 6 weeks. All / Out now / Not recorded out / Workshop today; All types / Reefer / Dry / Van. Reefer trucks, dry trucks and vans in separate cards. Limits, recorded driver/trip state, weekly fuel remaining, recorded sent trips and planned km. Fuel remaining ascending by default; Vehicle id is the other sort. Detail rail holds limits, Mon–Sat fuel bars, workshop reason and latest five sent trips with History links. |
| | Archived / no trip or fuel record | No frame | Archived rows last, labelled Archived; retained trips still open in History. “No trip recorded today” is not “At the depot”. No sent trips means zero recorded trips, not fabricated trips from fuel rows. Fuel outside the calendar is “Week not available”. |
| Fleet | Next 6 weeks / booked | Dispatcher · Fleet · next 6 weeks, `112:80499`; Dispatcher · Fleet · next 6 weeks · booked, `195:83482` | **Not built.** These frames forecast demand and book hired reefers. No toggle, route, substitute availability chart, Book, Booked or Tell shops control. |
| Every page | First load | Loading · skeleton, `85:72065` | Existing top bar stays usable; grey blocks match rows and detail. A later fetch keeps the last successful view in place. |
| | First read failed / refresh failed | No frame | “Could not load orders/history/fleet.” and Try again; or “Could not update. These are the last records loaded.” with the last successful app-clock read time. An error never becomes an empty or zero result. |
| | Connection lost / signed out | No frame | The loaded view stays with “Connection lost · these records may be out of date.” First visit has the error/retry state. A refused session clears this account's visible detail/photos and follows existing sign-in. No offline lookup store or queue. |
| | Photo loading / open / missing / failed | No frame | A labelled, keyboard-closeable viewer with loading blocks, image and Close; “No photo recorded” for absent proof and “Could not load the photo” with Try again for a failed read. |
| | Below 1024 wide | No frame | Keep all filters and counts, wrapping controls. Each table/timeline scrolls horizontally inside its own bounded box; the selected detail stacks below that table with Close. No custom card layout or page-wide horizontal scroll. Existing bottom navigation remains; keyboard users can reach all columns and controls. |

At 1024 and wider keep the frame's table/timeline and detail rail, narrowing the rail between 1024 and 1280.
Use existing CSS tokens, Manrope headings, Inter body, JetBrains Mono ids/times, 12 px cards and the supplied PNG
icons. No stock emoji substitute, chart package, map or new design system. Keyboard focus and text labels carry
meaning alongside colour. Only the loader and driver require phone-first layouts; A8 keeps its desktop tables.

## Rules
Times use the app clock and depot time. Examples use the README's **manual** VEH035 walkthrough, not 014's suggested
plan. Missing evidence remains missing even if a plausible figure could be worked out from today's master data.

1. **Scope and dates.** Every read is for the signed-in dispatcher's depot. Orders defaults to `boardDay`, with
   its existing 03:30 rollover and operating calendar; a chosen date stays chosen. Day means delivery day D; Last
   4 weeks is the union of the 28 delivery-day lists D−27 through D, deduplicated by order id. It is not a wanted-date
   filter. History defaults to the latest published plan date no later than calendar today, or no date; its picker
   may open any recorded published date, including a sent tomorrow. Fleet Today uses calendar today, independently
   of the board's rollover. No parameter switches depot; no default board day means choose a date, not an invented one.
2. **Orders belongs to a delivery day (D-81).** Include submitted leaf orders wanted on D, plus D's published stop
   memberships and deferrals. Before D is sent, also include the board's eligible earlier orders: current placed or
   deferred orders wanted before D. Exclude private drafts and split parents from leaf totals; retain original
   details through each part. Mark an order **Carried over** for a listed day when its wanted date is earlier than
   that day. This is a read of current records, not a reconstruction of unsent past boards. Before Nadeesha places,
   Thursday has 102 orders; afterwards it has **104**, including four carried over. Last 4 weeks ending Thursday
   has 127 before place, 129 afterwards. Count planned and deferred from that day's own published stop membership
   and deferral ids, never from current order status or a later plan: the manual send gives **5 planned, 99 deferred**.
   Before Send and after Back to edit those publication counts are zero, with “No sent plan” beside them. A range
   counts distinct order ids across its days and distinct ids in its own publications for each plan count; an order
   may be deferred on one day and planned on another, so those two range counts overlap and are never added.
3. **One list supplies the table and detail.** Every row carries its ordered lines, note, split original/parts,
   selected-day plan links and published deferral history. No second order-detail GET. For a split part include the
   original's deferrals, deduplicated by plan id; these historical reasons do not add another leaf order or assign
   the part to its original's old trip. A current status is labelled separately from each dated sent-plan record.
   A later receipt or reallocation cannot replace Thursday's truck/stop or promise a new date before publication.
   Search is a case-insensitive substring of shop name or outlet id in the browser. Carried over matches any listed
   day with that mark; Deferred matches a selected-range publication's deferral; Split means a leaf with `split_from`.
   Filter and search the complete returned rows in the browser, with no server filter or matched-count field.
   Summary stays unfiltered; “Showing N of M” is just the displayed array length and returned order total.
   Groups are Fresh, Style, Tech, district, shop, wanted date, chilled before dry, then UUID. Range detail lists
   dated plan links rather than picking a latest unrelated assignment. Show real ids, never fabricated WF numbers.
4. **History is a publication, not a simulation (D-82).** Select the depot's published plan for the explicit date.
   Its stops and deferrals define that day; current order status alone cannot move them out. Sent trips made by hand
   or by 014 read identically. Keep one trip row, sorted by saved leave time, vehicle id and trip number within its
   brand/district group; a mixed-brand trip has its own Mixed group and is never counted twice. Use `sent_check` for
   planned times, effective windows, load and km. Do not run today's checker to rebuild an old schedule. Current
   names/item descriptions are labelled as current reference data, not an immutable copy of a past screen.
5. **Recorded stages and attempts.** Current trip/stop columns give departure, ready, load, arrival, completion and
   return times. All loading, refused, closed and receipt problems and their answers are visible, not only open ones.
   Every closed issue is its own attempt, with its own `raised_at`, `decided_at`, counted lines and optional photo.
   Do not recover an earlier arrival from the audit log or borrow the stop's later arrival for that attempt.
   Earlier attempts show their own closed time and answer time; only the current visit shows its recorded arrival.
   A Try again can clear the current stop and later create a successful visit; the old attempt remains separate.
   Unsend/resend retains only the current
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
   never gains an order's later receipt. Seeded received orders with no stop do not create History trips.
   Receipt details and replacement/report links
   belong here after 015 is merged, not in Orders; Orders and Fleet require no receipt fields or helper.
8. **Photos (D-84).** A stop proof has `issue_id IS NULL`; a loading/driver/receipt problem photo names its issue.
   Show metadata and explicit links, loading bytes only when opened. Use A8's `/lookup/stops/:stopId/photo`
   when joined 016 has no proof route, and 013's issue-photo endpoint, including decided issues. Never add files
   or handlers to 016 to supply A8. No second photo table, synthetic receipt image, signature, public URL or
   base64 in a list. Keep the existing JPEG/cache policy and Helmet headers; no separate photo-header criterion
   or middleware change.
   Close/sign-out/reset releases the fetched image; a late response cannot put another selection's photo on screen.
9. **Fleet is records, not location (D-85).** List this depot's vehicles, including archived rows last with their
   badge; historic trips never vanish when a vehicle is archived. Every header vehicle count excludes archived
   vehicles, including reefers, vans and Out now. Group
   reefer trucks, dry trucks, then all vans, with archived rows last within each group. Fuel sorting puts unknown
   remaining values after known ones within the active/archived sets; ties use vehicle id. Reefer filter includes
   reefer vans; Van includes both temperatures, so
   those totals overlap and must not be added. Out now means a distinct vehicle with an `out` trip on any published
   date, including an earlier day. That trip supplies the status/driver first; if several are out, use oldest plan
   date then trip number/id and show all in detail. Otherwise use today's first unfinished trip by saved leave time
   then trip number/id, else today's latest returned trip by back time then trip number/id descending, else No trip
   recorded today. Say Planned, Loading, Ready or Returned with its recorded time
   as applicable. “Not recorded out” means no such out trip, not physically at the depot. Never guess a permanent
   driver. Today's workshop reason is independent of trip state; an out trip remains visible even if someone
   archived its vehicle. No no-signal minutes or ETA.
10. **Fuel (D-86).** The selected calendar day's ISO year/week picks Mon–Sat `fuel_log` rows for those vehicle ids.
    Sum each row once in integer tenths of litres; publication already writes its estimated litres here, so do not
    add `sent_check` fuel again. Remaining = quota − recorded/committed; retain a negative value as Over quota.
    Recorded/committed percent = `percent(recordedCommitted, quota)` and remaining percent =
    `percent(quota - recordedCommitted, quota)`, using the existing rounded helper; both are null for zero quota.
    Preserve negative remaining values; clamp only the drawn bar width. Header totals use active vehicles only,
    consistently with its vehicle counts. Archived rows keep their own ledger and history readable in detail;
    they do not enter the active header numerator or quota denominator. Mon–Sat bars use those dated rows;
    a date with no row is zero **recorded/committed**, not evidence
    that no trip happened. Sent-trip count and planned km come only from published trips/checks in that week;
    use the kept schedule for each actual trip, without inventing trips or km from unlinked fuel rows.
    Fleet's latest-five trip list uses published plan date descending, then vehicle
    trip number descending then id, never inferred trips from fuel history. No calendar row means the fuel week is unavailable.
11. **Skipped lately · 4 weeks (D-89).** The Orders panel reads this depot's published plan deferrals on D−27
    through D, independently of the table's Day / Last 4 weeks or filters. Group by shop, count distinct plan ids:
    two orders or split parts left out of one plan are one skip for that shop. A later delivery does not erase a
    skip; Back to edit removes that plan's contribution until it is sent again. Show all matching shops, their
    count, latest skipped plan date and its distinct recorded reasons. Sort count descending, latest date
    descending, then shop name/id. Fresh seed: four shops, five shop-plan skips; Fresh Dickwella has two, Fresh
    Nugegoda, Fresh Ragama and Fresh Unawatuna one each. No forecast, priority write or guessed next delivery.
12. **Reads stay coherent.** Each page aggregate is one reset-safe, repeatable-read snapshot, including its clock
    and all totals. It writes nothing and announces nothing. Existing changes refetch the pages, including admin
    archives. Requests are cancelled/scoped by account, depot, parameters and demo generation; a stale result
    cannot replace a newer date or reset. The last loaded view may stay during a failed refresh, explicitly marked
    stale. Sign-out clears visible account data. No last-update comparison by timestamp: the demo clock can wait
    or move backward. These pages use the existing minute fallback and reconnect behavior, not another stream.

## Permissions and failure paths
Every new endpoint requires a session (`signed_out` 401), dispatcher role (`forbidden` 403 for shop/loader/driver),
and depot (the seeded admin gets `no_depot` 403). A missing/foreign photo stop or issue id is
`unknown_record` 400 after scoping; malformed dates, ids or query values are `invalid_input` 400. A valid empty
date is an empty result. A plan never sent cannot be obtained as sent history through an id or a photo shortcut.
There are no new writes, revision conflicts, confirmations or retries of mutations on these pages.

Seeded publications with no trips simply show their recorded deferrals. Actual trips use their kept schedule;
a malformed check or trip missing required timing is an invariant failure and shows Could not load. There is no
legacy-trip state or `plan.sent` audit check: no application path creates that proposed legacy case.
Errors cannot silently choose a
different date, depot or order. A reset can remove a selection; clear it and its image before presenting new data.

## Data in and out
Three aggregate GETs under `/api/v1/lookup`: `/orders`, `/history`, `/fleet`, with details already included.
Contracts and query parameters are in [plan.md](plan.md). With no joined 016 proof route, A8 adds its own
`/lookup/stops/:stopId/photo`; problem photos use `/issues/:issueId/photo`.
Read the existing order, plan, trip, stop, issue, photo, receipt,
vehicle, days-off, fuel, calendar and reference records. No schema, seed or business-command change.

## Acceptance criteria
Each numbered criterion has one named automated test or written browser check in plan.md. Integration tests use
the private seeded database and restore it; business-rule tests run failing before implementation. IDs stay stable:
AC-9, AC-19, AC-25 and AC-26 are removed with their excluded work; 33 criteria remain.

- [x] **AC-1** When any lookup GET is called without the required session/role/depot, the system shall return the existing permission errors and write nothing.
- [x] **AC-2** When lookup lists or a proof request could name another depot, the system shall reveal no records from that depot, including inline details and photo links.
- [x] **AC-3** When a date, range or photo id is malformed, the system shall return `invalid_input` without changing records.
- [x] **AC-4** When Orders opens on the seeded board day, the system shall show Thursday's 102 orders before placement and 104 at README step 3, including four carried over; Send shall show five planned and 99 deferred from Thursday's plan, and Back to edit shall remove those publication counts.
- [x] **AC-5** When Last 4 weeks ends on Thu 25 Jun, the system shall union 29 May–25 Jun delivery-day lists, counting each order once, for 127 before placement and 129 afterwards.
- [x] **AC-6** When Orders search or Carried over / Deferred / Split is selected, the system shall filter its already-returned rows in the browser with stable order, unchanged summary and no additional API search or detail request.
- [x] **AC-7** When an order is split and later joined back, the system shall count only live leaf orders, expose the original through detail, and deduplicate inherited deferrals by plan without inventing orders.
- [x] **AC-8** When a returned order is published again on Friday, the system shall retain Thursday's own membership and deferral counts and show each day's dated plan link without substituting the later plan.
- [x] **AC-10** When Thursday's manual plan is sent, the system shall show one History trip, two stops, five orders, 99 deferred orders and the kept 04:36 / 05:00 / 05:24 / 06:10 schedule.
- [x] **AC-11** When Kasun marks the walkthrough truck ready after Go short, the system shall show 118 ordered, 117 loaded, one depot short, the loading flag and answer, and no delivered or received counts yet.
- [x] **AC-12** When Nugegoda is delivered and Wellawatte refuses two chilled cartons, the system shall show two delivered stops, one partial, 115 handed over, two refused and one depot short without counting the refusal twice.
- [x] **AC-13** When a stop hands over zero goods, the system shall count it finished but not delivered, distinguishing a complete refusal from a closed attempt.
- [x] **AC-14** When a closed stop is brought back, reloaded and received on another day, the system shall keep the old attempt's 94 not-delivered cartons and no receipt on that attempt.
- [x] **AC-15** When a closed stop is retried, the system shall retain each closed issue's own time, counts, photo and answer separately from the new visit, without retrieving an earlier arrival from audit.
- [x] **AC-16** When Nugegoda confirms 11, 8 and 3 cartons against 12, 8 and 3 handed over, the system shall show one shop confirmation, three received orders, 22 received and one receipt shortage distinct from the one depot shortage.
- [x] **AC-17** When History opens the seeded Tuesday/Wednesday publications, the system shall show their one/four deferrals, zero trips and no invented receipts or delivery detail.
- [x] **AC-18** When History's Late / Short / Returned / Deferred or brand filter is used, the system shall apply rule 6's predicates, including a refusal answered Send replacements as Return instructed, without mixing orders, stops and attempts or double-counting a mixed trip.
- [x] **AC-20** When Fleet Today is read on Thu 25 Jun before a send, the system shall show Peliyagoda's 38 active vehicles, nine reefers, four vans, three workshop vehicles and 35 without a recorded day off.
- [x] **AC-21** When a recorded trip starts and returns while its vehicle has a second ready trip, the system shall change Out now from zero to one to zero and select the second trip under rule 9, retaining any earlier-day out trip ahead of today's unfinished trip without inferring physical depot presence or connectivity.
- [x] **AC-22** When VEH003 is archived, the system shall show 37 active vehicles, eight reefers, four vans, two active workshop vehicles and 35 without a day off, while retaining its own historical trips, fuel and any recorded out trip in its row/detail.
- [x] **AC-23** When the seeded fuel week is read and a plan is sent/unsent, the system shall show 6,945 of 18,600 litres before send, 6,947.7 after VEH035's send and 6,945 after unsend, without duplicate fuel or invented historic trips.
- [x] **AC-24** When fuel has zero quota, exceeds quota or has no calendar week, the system shall show the explicit null/over-quota/unavailable states defined by rule 10.
- [x] **AC-27** When any lookup aggregate races a write or demo reset, the system shall return one coherent committed snapshot without mixing old stops or attempts with new problems or receipts.
- [x] **AC-28** When a relevant existing live topic arrives or the stream reconnects, the system shall refetch lookup data while preserving the existing pages' invalidations and minute fallback.
- [x] **AC-29** When an older request/photo completes after a newer selection, reset or sign-out, the system shall prevent it replacing the current view, clear invalid selections and release old image data.
- [x] **AC-30** When Orders is used at 1440 wide on the walkthrough, the system shall show the frame's grouped table, inline detail, browser filters, Skipped lately panel and the real delivery-day totals.
- [x] **AC-31** When History is used at 1440 wide, the system shall expose the selected trip, earlier attempts, shop confirmation, deferrals and real proof links without replay or signature controls.
- [x] **AC-32** When Fleet is used at 1440 wide, the system shall keep the frame's Today groups/detail rail and source-backed labels, with no Next 6 weeks toggle, forecast, hire or workshop-booking path.
- [x] **AC-33** When the pages are used at 390, 820 and 1024 wide, the system shall stack detail below a table in its own scrolling box below 1024, retain the desktop rail at 1024, and allow keyboard access without page-wide sideways scrolling or custom card layouts.
- [x] **AC-34** When a first read, refresh or photo fails, the system shall show the corresponding screen-table state, keeping empty data, absent photos, unavailable fuel week, lost connection and expired sign-in distinct.
- [x] **AC-35** When the four-role walkthrough advances or offline records sync, the system shall end showing the accepted facts, without exposing another phone's queue or showing a shop confirmation before its receipt syncs.
- [x] **AC-36** When the implementation is reviewed, the system shall have no A8 business write, forecast/sample result, new table, second clock, duplicated calculator, unsafe photo cache or control for an excluded action.
- [x] **AC-37** When Skipped lately is read on the fresh Thursday seed, the system shall show four shops with Dickwella skipped twice and the other three once, count multiple deferred orders at one shop on one plan once, and remove only a withdrawn plan's contribution.

## Walkthrough
Follow the README's manual plan and spec 013/015's joined driver/receipt flow. API tests freeze example instants;
the judge sees the times actually recorded at their pace. Do not manufacture completion data in the seed for A8.

1. Reset. Orders opens on the board's Thu 25 Jun: 102 rows including four Carried over. Last 4 weeks has 127.
   Nadeesha places her 8 chilled and 4 dry draft: **104** and **129** respectively (README step 3), without reload.
   Skipped lately initially shows Dickwella twice; Nugegoda, Ragama and Unawatuna once each. Its counts are shop-plan
   skips, not deferred order quantities. The panel updates from actual deferrals when the new plan is sent.
2. Send the README's VEH035 plan, Dilshan driving, OUT001's 12 carried chilled + 8 new chilled + 4 dry and OUT002's
   48 chilled + 46 dry. Thursday Orders shows 104 rows, **five planned and 99 deferred**, four Carried over. History
   shows one trip, two stops, five orders, 118 cartons and the saved 04:36 / 05:00 / 05:24 / 06:10 schedule.
3. Kasun loads Wellawatte first, flags Nugegoda's dry count at 3 of 4; Ruwan answers Go short; Kasun marks ready.
   History shows 117 loaded and one depot short, with the recorded flag, answer and ready times.
4. Dilshan starts, arrives and photographs Nugegoda's delivery (12, 8 and 3 handed over), then refuses two of
   Wellawatte's 48 chilled cartons and hands over 46 chilled + 46 dry. History reads 115 handed over, two refused,
   one depot short, two delivered stops and one partial. Open the actual proof; an absent optional refusal photo
   stays absent. Bring them back is answered in Live day, not here.
5. After 015 joins, Nadeesha confirms 11, 8 and 3 at Nugegoda, reporting one chilled missing. History shows one
   confirmation, three received orders, 22 received and one receipt shortage, distinct from the dry carton left
   at the depot. A replacement answer belongs to 015; History links its report/replacement without changing the
   old quantities. Orders carries no replacement ancestry or receipt-detail promise.
6. Fleet Thu 25 Jun: 38 active, nine reefers, four vans, VEH003/005/036 off and 35 without an off row. Fuel is
   6,945 / 18,600 L before Send and 6,947.7 after it, rounded 37%; VEH035's 2.7 L is already committed. Out now
   follows recorded start/finish. Its History link names Thursday. Archive VEH003 in a separate fresh run: header
   37 active, eight reefers, four vans; its old trip and ledger remain readable in the archived detail.
7. Next 6 weeks is hidden. Repeat at 390 wide: each table scrolls in its own box and its detail stacks below.
   Lose the connection and observe labelled stale data, then reconnect. Reset clears selected trips/photos and
   prevents late bytes restoring them. Run these click-throughs in Nabil's visible Chrome on the built app.
8. In a separate retry run, close Wellawatte, Try again, then close it again or deliver. Inspect separate issues'
   times, quantities, photos and answers. **AC-14 is an API test with `setClockForTests`**, not a browser run: bring
   Thursday's closed goods back, send and receive them Friday, then assert Thursday still has 94 not delivered
   and no Friday receipt. Browser time controls do not support that cross-day proof.

## Not in this piece
- **Orders:** placing/editing/cancelling, priority overrides, Plan first, Find a slot, a next date for deferrals,
  calls, invented order numbers, operating-day lateness analytics, receipt/replacement ancestry, a detail GET,
  server-side search/filters/matched counts or wildcard escaping.
- **History:** replay/speed/scrubbing, a raw audit explorer, all past publication revisions, deleted draft trips,
  reconstructed GPS/ETAs, signatures, guessed missing times, or claims that current reference names were names then.
  Earlier closed-attempt arrivals are not recovered from audit; each attempt keeps its own closed time, counts,
  photo and answer. No legacy-trip state or audit-based `plan.sent` classification.
- **Fleet:** master-data edits/archives, booking or cancelling workshop days, hiring/returning vehicles, recording
  actual fuel/odometer use, driver rosters, availability promises, maintenance recurrence or dispatch commands.
- **Six weeks:** the entire view/toggle, including recorded availability, two-year demand predictions, seasonal
  multipliers, suggested hires/waves, future fuel depletion,
  capacity sufficiency, messages to shops, bookings, new calendar data or Datathon inputs/models.
- **Other pieces:** changes to planning/issue/receipt commands or the phone queues, loader change acknowledgments,
  maps, exports, printing, persistent offline lookup storage, or new packages/infrastructure.

## Departures from the design
At implementation join, add these to the README: delivery-day Orders with current status labelled separately;
real identities and no phone/priority/replacement-ancestry controls; static retained History with stage-specific
counts and shop confirmations rather than signatures/replay; no earlier attempt arrival recovered from audit;
separate trip rows; recorded trip state instead of physical depot/connection claims; recorded-and-committed fuel
rather than consumption; **no Next 6 weeks view, no forecast and no hiring** (`112:80499`, `195:83482`); and the
No frame states plus contained table scrolling below 1024. The calendar ends 28 Jun: a substitute 42-date view
would leave 38 dates unknown, so it is cut too. This spec PR does not claim those screens are already built.

## Open questions
These picks incorporate the lead's review decisions; builders use them unless Nabil changes the scope.

1. **Is A8 worth building before the deadline? Our pick:** only after the joined four-role/offline journey and A7
   checks pass; cut all of A8 first if they need time (D-80). T0 waits for 016 to merge.
2. **Which date should Orders mean? Our pick:** a delivery day, opening on the board day, with wanted-earlier rows
   marked Carried over and planned/deferred counts from that day's own publication (D-81).
3. **How much history is required? Our pick:** static retained sent-plan detail, closed issues' own evidence,
   proofs and shop confirmations; no old arrival recovery, legacy-trip state or full replay (D-82). This explicitly
   narrows 013's A8 promise. Orders/Fleet require 013; History confirmations and replacements also require 015.
4. **Should six weeks predict demand or show availability? Our pick:** neither; hide the view and toggle (D-87).
   Keep the actual frame's small Skipped lately read from published deferrals instead (D-89).
5. **May the dispatcher book a vehicle off or hire the trucks drawn? Our pick:** neither in A8 (D-80). No forecast,
   hiring, workshop-booking write or pretend Booked state. Today still reads existing workshop days.
6. **Should Fleet say At the depot and fuel used? Our pick:** Not recorded out and Recorded + committed (D-85/86).
   Every vehicle count in the header uses active vehicles; an archived vehicle's own records remain readable.
7. **What should a narrow screen get? Our pick:** the same tables in bounded scrolling boxes, detail stacked below
   1024 (D-88), with no custom cards or second mobile reporting app.
