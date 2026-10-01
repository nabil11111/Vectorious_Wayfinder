# 017 · Plan

## Data changes
**None.** No new table, column, migration, seed data, retained daily aggregate, receipt id, forecast, vehicle hire
or booking record. The three aggregate endpoints and A8's proof endpoint are GETs. This PR changes only this spec's documents and the three spec
indexes/decision records. Implementation follows the joined earlier pieces; it does not copy branches into this PR.

### Sources read for this draft
Research began on `origin/main` at `1326aa3`; this draft was then rebased onto `c4ec6af` when 014 merged. The initial
specs README/template/map, decisions D-01–42, data model, judge walkthrough and specs 004, 008, 009, 010 and 012 were
read in full, and the new main's changed documentation was checked. The Hackathon section on pages 11–13 was read outside the repo;
none of its text is copied here. All five named dispatcher PNG/JSON pairs and all four foundation PNG/JSON pairs
were inspected. Design dates, ids and figures are examples, not seed facts.

| Earlier piece | Evidence used | Implementation dependency |
| --- | --- | --- |
| 013 | Spec/plan/tasks and D-43–50 on `origin/nabil/driver` at `4ec0a6e`; server PR #17 on `codex/driver` at `946ac64` | Joined driver fields, helpers, issues and photos, including the reviewed response-snapshot/retry/photo-header fixes. |
| 014 | Spec/plan/tasks, D-51–55 and code on `origin/nabil/suggest` at `629b70a`; joined on main in `c4ec6af` during this draft | Read sent hand/suggested plans identically; never treat a saved suggestion as publication history. |
| 015 | Spec/plan/tasks and decisions on `origin/nabil/receipt` at `a9897d7` | History confirmations and replacement answers wait for its merged implementation. Orders and Fleet use no 015 fields/helpers and can start after 013, subject to T0's 016 gate. No receipt stub or driver-count substitution. |
| 016 | Spec/plan/tasks and decisions on `codex/live-spec` at `eb8a703`, draft PR #18 after review | T0 starts only after 016 is merged. Its reviewed spec has no proof-photo route; A8 supplies its own through `routes/lookup.ts`, without writing into 016's files. |

These commits identify evidence, not versions to force on later builders. Only D-56–62 and D-66–72 were present
in the inspected receipt/live documents; the user's reserved ranges through D-65 and D-79 remain untouched.
017 starts at D-80. Do not insert missing decisions on behalf of another piece or present the still-unjoined
013, 015 or 016 as merged on main.

## Contracts
The lead adds `packages/contracts/src/lookup.ts` and its export in T0. Dates use the existing validated calendar-date
shape, not a regex which accepts 31 February; instants are ISO strings. Counts are nonnegative integers, litres/kg/m³
finite numbers, and nullable evidence has a named screen meaning. `received` fields follow the joined 015 contract.
Do not expose raw Drizzle rows, audit JSON, phone-write identities or image bytes in any list.

| Endpoint | Input | Output |
| --- | --- | --- |
| `GET /lookup/orders` | `date?`, `range=day\|four_weeks` (default day) | `LookupOrders`: scope, resolved dates or null when no default board day, summary, complete rows with inline detail, and Skipped lately. Missing date uses `boardDay`, not calendar today. No search/filter/matched-count parameters or fields. |
| `GET /lookup/history` | `date?` only | `LookupHistory`: resolved date or null, latest three published dates, publication or null, counts, groups/trips/stops/attempts/receipts and deferrals. Browser filters use returned flags/brands. This page waits for 015's receipt implementation. |
| `GET /lookup/fleet` | No date/depot parameter | `LookupFleet`: calendar today, inventory, current recorded states, weekly fuel and recent trips, active-only header counts. Browser filters/sort use returned fields. |
| `GET /lookup/stops/:stopId/photo` | UUID | Owned sent stop's proof JPEG or existing absent-photo error. A8 owns this route and `lookup/photo.ts` because reviewed 016 has no proof route. If merged 016 already provides an equivalent route, reuse it without editing its files or adding a duplicate. |

With no default board day, Orders returns null dates/summary/Skipped lately and an empty row list for the
choose-date state; it does not report a zero workload.

Unknown query keys and repeated scalar parameters are rejected, so `depot=...` cannot silently imply a switch.
Shared scope is `depot {id,name}`, `readAt` and `demoDay` (the existing reset generation; nullable outside demo as in
the joined clock contract). Browser query keys include user/depot even though they are not user-supplied API filters.
No new error codes: reuse `signed_out`, `forbidden`, `no_depot`, `invalid_input`, `unknown_record`, and `not_found`
for an authorized stop/issue without a photo. Invalid JSON/shape follows the existing error middleware.

| Shape | Fields and source |
| --- | --- |
| `LookupOrderRow` | `id`, wanted date, placed time or null, outlet id/name/brand/district/window, temperature, current status, ordered load from `computeLoad`, ordered lines/note, split original/parts, published deferral history/count. `days[]` names each selected delivery day, carried-over flag and its own published assignment/deferral, with plan/date/vehicle/trip/stop/planned arrival where present. No `latestSent` shortcut, receipt quantities or replacement ancestry. Detail is part of this shape, not another endpoint. |
| `LookupOrders.summary` | Distinct leaf order ids in the range; distinct planned ids and distinct deferred ids from its own published plans; distinct carried-over row ids (any selected day) and split leaf ids. Before a day's send there are no publication counts. Range planned/deferred sets may overlap across days; do not add them. Summary is unfiltered. |
| `LookupOrders.skippedLately` | Start/end (D−27 to D), rows with outlet id/name/brand, distinct published-plan count, latest skipped date and distinct reasons from that shop's latest skipped plan. No separate endpoint or relation to the table's browser filters. |
| `LookupHistory` | `date`, `publishedDates`, plan id/revision/publishedAt, counts, groups, trips and deferrals. Null publication is distinct from a publication with zero trips. Mixed-brand trips appear once. No `detailRecorded`/legacy flag. |
| `HistoryTrip` | Plan/trip, vehicle/current archive flag, driver, brand/district, status, kept planned schedule/load/km, recorded left/ready/back times, stops and problems. Reuse 013's trip helpers/types where meanings match; do not impose its current-day filter. |
| `HistoryStop` | id/seq/shop, kept effective window, loaded/arrived/done times, outcome, lines and stage totals/coverage, late/short/return-instructed flags, current receipt or null, proof metadata or null, problems and closed attempts. An unknown execution measure is null, not zero. |
| `HistoryClosedAttempt` | Issue id, own raised time, reason/note, counted lines, photo metadata, decision/decider/decided time. No recovered arrival, current stop time or current receipt copied into an old attempt. |
| `HistoryReceipt` | Joined 015 stop confirmation: stopId, confirmedAt, sentAt, cold answer, order count, received lines/receipt-short totals and optional report/photo/decision/replacement link. No new receipt id. Orders and Fleet contracts do not depend on these fields. |
| `HistoryCounts` | Trips, distinct stops/on-plan orders, stops delivered/finished/partial/late/short/return-instructed, publication deferrals, confirmed stops and received orders; stage totals with known/total coverage. Spec rule 6 defines predicates. No publication has no counts object; a sent plan with no trips has zero trip/stop totals. |
| `LookupPhoto` | `{kind:'proof', stopId}` or `{kind:'issue', issueId}`, with recorded photo time. Metadata only; viewer resolves fixed authorized routes, never a database-provided public URL. |
| `LookupVehicle` | Vehicle limits/type/temp/quota, archive flag, today's workshop reason, currently out and today's trip references, selected status/driver, own weekly ledger/Mon–Sat bars, sent-trip count/planned km and latest five sent trips. An archived row retains its own ledger and links. |
| `LookupFleet.summary` | `active`, `reefers`, `vans`, `recordedOut`, `notRecordedOut` (active vehicles whose own `notRecordedOut` flag is set: a trip of today's past its leave time that never left, Q-42), `activeOffToday`, `activeWithoutOffToday`, plus active-fleet litres/quota/remaining/percentages or null for an unknown week. Every header count uses only active vehicles. Reefer and van counts overlap (reefer vans), so never add them. Archived rows are labelled separately in the list. |

Orders returns every selected row, with no cap, server-side search/filter/matched count, wildcard escaping or
second detail query. Day/range selection bounds the read to at most 28 delivery days (earlier wanted dates can
enter through carriage or retained publication membership). History reads one publication; Fleet reads inventory,
this week and recent trip links. Photo bytes load only on request. No availability, forecast or booked-hire shape.

## How it works

| File | Responsibility |
| --- | --- |
| `apps/api/src/lookup/orders.ts` | Delivery-day sets, inline order details, published deferrals and Skipped lately. |
| `lookup/history.ts`, `attempts.ts` | Explicit published-date read, kept trips, loading, retained closed issues and joined 015 confirmations. No audit-log read. |
| `lookup/fleet.ts` | Inventory, active header, recorded state, weekly ledger and recent sent trips. |
| `lookup/photo.ts` | Scoped proof read owned by A8 when no equivalent route exists after 016 merges. |
| `lookup/figures.ts`, `dates.ts` | Only the small new grouping/date predicates needed; reuse load, driver, receipt and percent helpers. |
| `apps/api/src/routes/lookup.ts` | Dispatcher/depot checks, three aggregate GETs and A8's proof GET. Lead mounts it in `app.ts`. |
| `apps/web/src/features/lookup/api.ts`, `queries.ts` | Validated reads, scoped keys, cancellation, minute fallback, dates/reset. |
| `features/lookup/OrdersPage.tsx`, `OrderDetail.tsx`, `filters.ts` | Table, browser search/filters, detail from selected row and Skipped lately panel. |
| `features/lookup/HistoryPage.tsx`, `HistoryDetail.tsx`, `PhotoViewer.tsx` | Static trip/attempt/receipt detail, on-demand photo viewer local to A8. |
| `features/lookup/FleetPage.tsx`, `VehicleDetail.tsx` | Today and own vehicle records; no future view. |
| `features/lookup/parts/`, `words.ts` | Small presentation/filter/date components, no duplicated business sums. |

### One snapshot per answer
Every aggregate and proof GET uses `orders/store-orders.ts::snapshot`. Its first `orders ACCESS SHARE` lock precedes
the first repeatable-read snapshot query, so a reset cannot deadlock or produce mixed generations. Read `readMoment(tx)`
once, then dates and business records in that same transaction. Use `...Of(tx, authorizedRows)` helpers, not nested
`getBoard`, `getDriverDay` or store-service transactions. No GET takes a new write lock, touches an audit row, runs
the optimizer, changes `answered_at`, or emits an announcement. All existing writes keep their current lock order.

### Orders and every number on the page
1. Read the moment and operating dates in the snapshot; use the existing pure `boardDay` for the implicit default.
   Day is D; a range is D−27 through D inclusive. Return the resolved dates; null board day returns the explicit
   choose-date state. An explicit valid date stays selectable even if no publication exists for it.
2. Scope orders through the caller's depot outlets. For each selected day union wanted-that-day submitted leaves,
   that day's published stop/deferral memberships, or (when not published) the board's current eligible earlier
   placed/deferred orders. The eligibility predicate is the one in `plans/board.ts`, not a second cutoff rule.
   Batch the range query and memberships instead of calling 28 nested board transactions. Deduplicate by order id;
   original split records are detail, not extra leaves. Keep archived shops/products as historical references.
3. Batch ordered lines/products and call `computeLoad` for units/kg/m³. Inline note, original/parts and published
   deferral history: include a part's original's history, deduplicate by plan id, prefer its own deferral reason
   when both exist. These are current reference properties; do not claim immutable historical product names.
4. Each row's `days[]` records the delivery days that admitted it and marks wanted-earlier as Carried over. Only
   that day's own published membership supplies its vehicle/trip/stop and kept planned arrival. A current order
   status cannot select a later plan. Summary planned/deferred counts are the distinct stored order ids in those
   selected publications, not current status counts or inherited history counted again. Detail names every plan
   link's date; a range never silently chooses a latest unrelated assignment. No current receipt/replacement read.
5. Order totals count distinct returned leaves; carried-over/split totals count their returned flags. Browser search
   and All / Carried over / Deferred / Split filter these complete rows and show the resulting array length.
   There are no API search/filter inputs, matched count, SQL substring/wildcard handling or order-detail handler.
6. Independently read published deferrals on D−27 through D joined to their depot's outlets. Group **distinct
   (outletId, planId)**, not number of deferral rows: one shop left out with two temperatures/parts is skipped once
   on that plan. Count per shop, take latest plan date and its distinct code/reason pairs, sort count descending,
   latest date descending, shop name/id. No cap or all-outlet zero rows. The seed's five pairs make four shops:
   OUT060 Fresh Dickwella twice; OUT001 Fresh Nugegoda, OUT030 Fresh Ragama and OUT054 Fresh Unawatuna once each.
   Later order status changes do not remove historical skips; withdrawing a plan removes its contribution.

### History, stage counts and attempts
1. Select the one depot's published plan for the resolved date; select its current publication metadata, trips,
   stop membership and deferrals. Also return the newest three published dates for navigation. No publication is
   an ordinary empty state, even if a draft exists. Seeded Tue/Wed publications have deferrals and no trips.
2. A zero-trip publication (including seeded Tue/Wed) needs no fabricated schedule. For actual trips, validate the
   kept `sent_check` and use `driverTripsOf`'s required schedule. An invalid check or missing trip schedule is an
   invariant error. There is no legacy-trip branch, `detailRecorded` state or `plan.sent` audit-log check; the app
   has no path creating that hypothetical legacy trip. Never run today's checker to reconstruct past schedules.
3. For recorded trips, reuse `driverTripsOf(tx, tripPlanRows)` selected by depot/date, plus batched loading times,
   all `issuesOf` records for those trips, photo existence and 015's receipt columns. Reuse `tripFigures`/receipt
   helpers for stage arithmetic where their meanings match; before ready preserve null final loads rather than
   converting ordered quantities into loads. JSON must not accidentally include `Issue.stop`'s current times as an
   earlier attempt's times. A closed current result uses its issue snapshot, including after reallocation.
4. Build each closed attempt from its retained issue and immutable `issue_lines.counted`, raised/decided times,
   photo and answer. Never read audit to recover an old arrival. Never reuse the mutable stop's current arrival,
   order receipt or newly loaded quantities for an old closed issue. Retry can create a new visit without changing
   those facts; a later day's reallocation cannot add its receipt to this attempt. No event reconstruction needed.
5. Current successful/refused stop receipt comes only from its own 015-confirmed orders and received lines. Check
   the shared confirmation-time/order-state invariant; partial receipt evidence is not a made-up complete receipt.
   `stopId` groups those orders into one confirmation. The report is optional. A previous closed attempt gets no
   current order receipt; replacement orders are separate demand and not part of these old delivered totals.
6. Per current stop compute flags and stage totals once. Saved `StopTime.windowClose` is the lateness threshold,
   converted using that plan date, including minute offsets beyond midnight. Use actual arrival, not completion,
   clock-now or planned lateness. Keep “Return instructed” separate from driver trip finished; no receiving-at-depot
   record exists. Return instructed includes closed/bring_back and refused/bring_back or send_replacements; count
   each stop once even if it has several qualifying issues. Distinct stop confirmation
   count differs from received-order count. Fold line totals only over comparable known stages; report coverage
   and null aggregate for an incompletely recorded measure. Return zero for a genuinely empty set, not a missing one.
7. Group trips by actual brand/district (Mixed once), with deterministic kept-schedule order. Return flags for client filters; retain global totals and show a separate matched row count. Deferred
   filter lists the published deferrals with their order/shop/reason, including those later fulfilled elsewhere.
   No general event feed, period analytics, latest-50 cap, replay slider or new photo gallery service is necessary.

### Proof owned by A8, problem photos reused from 013
T0 starts after 016 merges. Its reviewed spec omits proof photos, so implement `lookup/photo.ts` and
`GET /lookup/stops/:stopId/photo` through A8's `routes/lookup.ts`. If the merged code already has the equivalent
read, reuse it unchanged and record that final path in the shared contract; **never edit 016's files**. Use
`/issues/:issueId/photo` unchanged for problem images, including decided issues. No new table or gallery service.

Scope stop → trip → published plan → caller depot before selecting the issue-null proof, inside a reset-safe
snapshot. Return the JPEG using the existing binary-response/cache policy and app Helmet headers; no new header
middleware or separate header test. Missing/foreign stop is `unknown_record`; an owned stop with no proof is
`not_found`. AC-2 tests access and absent proof alongside depot isolation; the viewer is exercised by AC-29/31/34.
A8's small viewer aborts old requests, guards scope/selection/generation and revokes object URLs on close/reset/
sign-out/unmount. Do not put photos in persisted query data, local storage or service-worker caches.

### Fleet and fuel
Read this depot's vehicle rows, including archived rows last; each row's limits come directly from vehicles.
Batch today's off rows, today's published trips, **all dates' out trips**, this calendar week's fuel rows and the
latest five sent trips per vehicle. Never choose a driver's permanent vehicle from seed conventions.

Out now is a recorded `out` trip and wins the displayed trip status, even for an earlier date. Multiple out records
sort by plan date, trip number and id ascending. Without one, select today's earliest unfinished trip by saved leave
time, then trip number/id; otherwise the latest returned trip by backAt/trip number/id descending; otherwise No trip
recorded today. Include all relevant trip references in detail so the choice
does not hide trip 2 being loaded while trip 1 is out. Archived and workshop badges are independent facts. One
active vehicle contributes one header Out now count regardless of matching records; an archived out vehicle
keeps its own badge/driver/detail but is excluded from every header vehicle count. Within each type group put
active rows before archived, then the chosen sort (unknown remaining fuel last), then vehicle id.

Read the app date's `calendar_days.iso_year/iso_week` and join fuel rows to this depot's vehicles and calendar
dates in that same ISO year/week with `dow` 0–5 (Mon–Sat). Read the whole week, including future committed rows;
do not copy the planning board's earlier-than-plan-date ledger restriction. Each stored litre value is converted
to tenths before summing. Per row and aggregate, remaining = quota − ledger litres, recordedCommittedPct =
`percent(ledgerLitres, quota)`, remainingPct = `percent(remaining, quota)`; both percentages are null on a zero
denominator. Clamp drawing widths only, never the returned quantity. The header sums active vehicles only, for
its ledger numerator, quota denominator and every vehicle count, including reefers (trucks plus reefer vans),
vans, Out now and workshop counts. Archived rows retain their own ledger/details outside that header. Archiving
VEH003 changes 38/9/4 to **37 active / 8 reefers / 4 vans**, not 37/9/4; active workshop count becomes two and
35 remain without an off row. Unknown week is a nullable fuel object. Weekly bars sum by ledger date Mon–Sat; a
sent trip's estimate is already a ledger row and must not be added again. Count sent trips from trip/plan rows;
sum planned km from each matching saved check exactly once. Unlinked fuel rows do not create trips or km.

The seed has 111 historical fuel rows with no trip ids, 6,945 / 18,600 L for Peliyagoda (37% rounded), **zero recorded
historic trips/km**, and VEH001 at 300 / 340 L (40 left). The manual VEH035 send adds 2.7 L: 6,947.7. Its unsend
removes that commitment. The first number remains a ledger fact, not fuel measured after a completed route.
Recent trips sort by published plan date and trip number descending, then id, to choose exactly five.

### No six-week read
No availability route, contract, helper, screen, query parameter or tests. The frames `112:80499` / `195:83482`
show a forecast and hired-vehicle booking; neither has recorded evidence in this app. The calendar ends 28 June,
so 38 of the 42 dates would be unknown even in the proposed availability substitute. Hide the toggle and document
**no forecast and no hiring**. Fleet Today still reads existing workshop rows for its calendar date.

### Live updates, selection and screens
Use the one existing `useLive` stream. T0 adds a small lookup fan-out, preserving each normal topic invalidation
and whatever 016 joins for operations. No new live topic, write-side announce or second EventSource is needed.
One accepted action can announce several topics: the guarantee is that the screen ends showing accepted facts,
not exactly one refetch.

| Incoming topic | Additional invalidation |
| --- | --- |
| `orders`, `plans`, `loading`, `driver`, `issues` | All `['lookup']` queries: the read set overlaps, and this is the smallest correct fan-out. |
| `admin` | All `['lookup']`: archives, reference names/limits and depot assignment can affect each view. |
| `clock`, `demo`, reconnect after a break | Existing all-query invalidation already includes lookup. |

Use keys `['lookup', page, userId, depotId, validatedParameters]`. Order/vehicle detail comes from the selected
row, not another query. Keep the existing one-minute fallback; refresh implicit Orders at the board's 03:30
rollover and Today/latest defaults at calendar midnight using the existing web clock. Explicit historical date
choices stay pinned, including across a clock move; a reset clears selected entities/photos and refetches that
date, which may now be empty. A first response resolves default dates server-side. Do not turn a default into a
permanently pinned date just because its first answer named one.

Pass TanStack Query's AbortSignal to fetch and guard photo/selection responses by scope/request generation.
Cancellation/generation, not `readAt`, orders results. On account/depot change discard that account's lookup cache
and visible image; on demo generation change discard selected identities and image bytes before replacing records.
Never retain one date's data under a newly selected date heading as placeholder success. A same-scope failed refresh
may retain its last successful view, with the spec's explicit warning and read time.

`DispatcherHome.tsx` mounts the three pages through the existing routes and wide shell; Fleet has only Today. T0
owns this file because 016 also edits it. No root-router rewrite or nav redesign. Links use browser
`?date=YYYY-MM-DD&trip=<uuid>` for History; only `date` is sent to its aggregate API. The browser validates
`trip` as a selection among the returned trips, never as a second fetch or arbitrary query key. A bad/stale trip
selection clears detail while leaving the authorized day visible. History → issue navigation opens the existing
Live day page; it does not create another decision form. Browser tests must verify account/date/reset
transitions as well as the desktop/narrow layouts.

## Changes to other specs and merge gates
- **004 / 008:** read archives, today's workshop rows, calendar, clock/reset and live stream. No new fleet write,
  archive semantics or seed. Every Fleet header count is active-only; an archive does not erase history.
- **009 / 010 / 014:** no command changes. Orders adopts delivery-day membership and the board's default/earlier
  eligibility, while keeping current status separate. Skipped lately reads published deferrals, not suggestions.
- **012 / 013:** retain their lock/replay/photo guarantees. Narrow 013's promise to A8 explicitly: retain each closed
  issue's own time, counts, photo and answer, but do not reconstruct earlier arrivals from audit or add full replay.
  The lead records this boundary when joining 013's documentation. Orders and Fleet need merged 013; neither
  reads 015 receipt fields nor waits for receipt implementation once T0 can start.
- **015:** History's shop confirmations, receipt shortages and replacement/report links wait for its merged code.
  Confirm the real columns/helpers before the History task; no substitute driver count or fake empty receipt.
  This gate does not delay Orders/Fleet work. Follow the actual phone-writes naming without changing those files.
- **016:** **T0 starts only after 016 is merged**, then integrates existing `lib/live.ts` and `DispatcherHome.tsx`
  once without overwriting 016's behavior. Reviewed 016 supplies no proof GET; A8 supplies it in its own files.
  No implementation task edits 016's operations/features files or documentation. Its current-day/latest-50 feed
  remains distinct from explicit-date retained History. Record the narrowed A8 promise here for the lead's join.
- **README / map / index:** this draft updates A8's reduced scope, still Spec. Implementation join records actual
  walkthrough/departures and marks Done only after checks/review. It does not claim the two future frames are built.

## Risks
- The prominent forecast and hire frames are cut entirely. This is a documented departure, not a claim that
  availability supplies the forecast. A8 is still first to cut if the four-role journey needs time.
- A delivery-day list and current status answer different questions: use dated memberships for counts/truck links.
  A range can contain both an earlier deferral and later assignment of one order; label and never add those totals.
- Reused current order/stop fields can rewrite earlier closed attempts. AC-14 tests cross-day reallocation with
  `setClockForTests`; AC-15 tests retry issues. Neither needs audit reconstruction or a browser time travel test.
- Seeded zero-trip publications are valid; missing required timing on an actual trip is an error, not a new state.
  Current master-data names are not historical snapshots. A fuel ledger is not actual measured consumption.
- Receipt code must join before History's confirmation/replacement work. T0 waits for merged 016; after that,
  Orders and Fleet can proceed independently of 015. Keep file ownership explicit to avoid other builders' work.

## Test plan
Write and run each automated criterion test failing before its implementation. Use existing pure helpers where
possible; new date/aggregation predicates get unit cases as part of the corresponding named test. No database or
application test run is needed for this documents-only draft; its checks are source facts, links, coverage and scope.

| Criterion | One named test / check | File or evidence |
| --- | --- | --- |
| AC-1 | `lookup requires dispatcher and depot checks` | `apps/api/tests/lookup-access.test.ts` |
| AC-2 | `lists inline details and proof stay inside the depot` | Same file; includes owned proof absent/present and decided issue photo |
| AC-3 | `lookup validates dates ranges and proof ids` | Same file |
| AC-4 | `Thursday has 102 then 104 with its own five planned and 99 deferred` | `apps/api/tests/lookup-orders.test.ts`; includes board default/03:30 and Send/Back to edit |
| AC-5 | `four weeks unions 28 delivery days without duplicate orders` | Same file; 127 → 129 and a cross-date membership fixture |
| AC-6 | `Orders filters its returned rows without a new request` | `apps/web/src/features/lookup/filters.test.ts` |
| AC-7 | `split and join count leaves and deduplicate inherited deferrals` | `apps/api/tests/lookup-orders.test.ts` |
| AC-8 | `Thursday keeps its own membership when Friday is sent` | Same file |
| AC-10 | `history reads the manual schedule and 99 deferrals` | `apps/api/tests/lookup-history.test.ts` |
| AC-11 | `loading keeps 118 ordered 117 loaded and one depot short` | Same file |
| AC-12 | `refusal records 115 handed over two refused and one depot short` | Same file |
| AC-13 | `zero handover finishes without delivering` | Same file |
| AC-14 | `Friday receipt cannot rewrite Thursdays 94 closed cartons` | `apps/api/tests/lookup-attempts.test.ts`, using `setClockForTests`; not a browser check |
| AC-15 | `retry keeps each issues own time counts photo and answer` | Same file; no audit recovery fixture |
| AC-16 | `three received orders make one confirmation with separate shortages` | `apps/api/tests/lookup-history.test.ts`; after 015 |
| AC-17 | `seeded publications show one and four deferrals with zero trips` | Same file; no invented legacy-trip fixture |
| AC-18 | `history filters keep stop order and attempt grains separate` | Same file; includes mixed trip and 015 send_replacements |
| AC-20 | `Thursday fleet has 38 active nine reefers four vans and three off` | `apps/api/tests/lookup-fleet.test.ts` |
| AC-21 | `out status wins then passes to trip two` | Same file; includes earlier-day out trip |
| AC-22 | `archiving VEH003 gives 37 active eight reefers and four vans` | Same file; retained own ledger/history/out state, active header sums |
| AC-23 | `fuel reads commitments once across Send and Back to edit` | Same file; 6,945 → 6,947.7 → 6,945 |
| AC-24 | `fuel distinguishes zero quota over quota and unknown week` | Same file |
| AC-27 | `lookup snapshots race writes and reset without mixed records` | `apps/api/tests/lookup-snapshot.test.ts` |
| AC-28 | `existing topics reconnect and fallback refresh lookup too` | `apps/web/src/lib/live.test.ts` |
| AC-29 | `late reads and photos cannot cross selection account or reset` | `apps/web/src/features/lookup/queries.test.ts` |
| AC-30 | `orders desktop lookup` | Lead's written visible-Chrome click-through at join |
| AC-31 | `history desktop lookup and proof` | Same record, after 015 |
| AC-32 | `fleet desktop Today only` | Same record |
| AC-33 | `lookup narrow tables and boundary` | Same record at 390, 820, 1024, plus desktop 1440 |
| AC-34 | `lookup failure empty and session states` | Same record; unavailable fuel week also tested in API |
| AC-35 | `joined roles and offline sync end showing accepted facts` | Same record; several announcements/refetches are allowed |
| AC-36 | `source and scope review` | Independent reviewer at join |
| AC-37 | `Skipped lately counts shop plan pairs and respects withdrawal` | `apps/api/tests/lookup-orders.test.ts`; seed four shops/five skips, multiple orders/parts counted once |

There are 33 retained criteria. AC-9/19/25/26 are removed (Orders ancestry, duplicate photo-header test and the
six-week view), not skipped tests. AC-6 now belongs to screens; AC-37 covers the frame's small Skipped lately read.
Each automated test is written and run failing before implementation. A parameterized scenario may cover roles
or routes; no criterion is replaced by a green smoke test.

Each integration file signs in once per account, uses the builder's private freshly migrated/seeded database,
restores the day at file end and restores the app clock. Compose `loading-plan.ts`, `driver-plan.ts` and (for History)
015's joined receipt helpers in `tests/lookup-plan.ts`. Kandy isolation, multiple deferrals per shop, zero/over-quota
vehicles and concurrency barriers are test-only fixtures. No seed changes or legacy-trip/audit-arrival fixtures.

Pause the snapshot race between stop and issue/receipt reads while a write commits; it must see one whole before
or after result. Race a reset too and reject deleted selections/photos. GETs cause no business writes or announce.
Use `setClockForTests` to reallocate/receive on Friday in AC-14 and return to Thursday to assert its retained attempt;
restore it afterwards. Browser checks do not claim that unsupported cross-day test. Browser response-order tests
include equal app instants, reset backward, parameter/account changes and late photo bytes.

Implementation join: private database, fresh migrate/seed, typecheck, full tests and builds, then click through the
**built app in Nabil's visible Chrome**, using the three built frames and recording the two future frames as excluded.
Check the four widths, record actual API/web totals and each browser result. Never use ports 3000/5173 or another
builder's database. These are future completion gates; this documents-only PR checks facts, references and coverage.
