# 017 · Plan

## Data changes
**None.** No new table, column, migration, seed data, retained daily aggregate, receipt id, forecast, vehicle hire
or booking record. All five new endpoints are GETs. This PR changes only this spec's documents and the three spec
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
| 015 | Spec/plan/tasks and decisions on `origin/nabil/receipt` at `a9897d7` | At inspection this has the receipt spec, not its implementation. T0 must join its actual receipt fields/readers first; no receipt stub or driver-count substitution. |
| 016 | Spec/plan/tasks and decisions on `codex/live-spec` at `bbb5df2`, draft PR #18 | Its proof GET and shared live/helper seams are proposed, subject to lead review. T0 reconciles them once, before builders branch. |

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
| `GET /lookup/orders` | `date?`, `range=day\|four_weeks` (default day), `q?` (trimmed, at most 80 characters), `filter=all\|has_deferrals\|deferred\|split` (default all) | `LookupOrders`: scope, resolved inclusive dates, range totals, matched count and rows. With no date, use calendar today. |
| `GET /lookup/orders/:orderId` | UUID; no arbitrary outlet/depot | `LookupOrderDetail`: submitted own-depot order, including a split parent reached from a part. A draft is always `unknown_record`, even in this depot. |
| `GET /lookup/history` | `date?` only | `LookupHistory`: resolved date or null, latest three published dates, publication or null, day totals/coverage, groups/trips/stops and deferrals. Missing date resolves by spec rule 1. Browser filters use returned flags/brands; no other API aggregation. |
| `GET /lookup/fleet` | No date/depot parameter | `LookupFleet`: calendar today, depot vehicles and current statuses, whole-week fuel, recent trip links and summary counts. Browser filters/sort use returned fields. |
| `GET /lookup/fleet/availability` | No arbitrary range/depot | `LookupAvailability`: today through today+41, current inventory totals, 42 date entries and recorded off rows by vehicle/reason. Browser category selection uses returned category values. |

Unknown query keys and repeated scalar parameters are rejected, so `depot=...` cannot silently imply a switch.
Shared scope is `depot {id,name}`, `readAt` and `demoDay` (the existing reset generation; nullable outside demo as in
the joined clock contract). Browser query keys include user/depot even though they are not user-supplied API filters.
No new error codes: reuse `signed_out`, `forbidden`, `no_depot`, `invalid_input`, `unknown_record`, and `not_found`
for an authorized stop/issue without a photo. Invalid JSON/shape follows the existing error middleware.

| Shape | Fields and source |
| --- | --- |
| `LookupOrderRow` | `id`, `wantedDate`, `placedAt` or null, `outlet` id/name/brand/district/effective window, `temp`, current `status`, `load` from `computeLoad`, `splitFrom` or null, `hasDeferrals`, `deferralCount`, `replacementFor` or null, `latestSent` or null. `latestSent` names plan/date, vehicle/trip/stop, outcome and planned arrival (null for a genuine legacy missing schedule); it never calls a returned order currently assigned. |
| `LookupOrderDetail` | Row plus typed lines (ordered/loaded/handedOver/received with nulls), driver note, split original and current parts' ids, published deferral rows (date/code/note), retained assignment links, current delivery/receipt facts and replacement source. No private draft, shop phone or synthetic WF number. |
| `LookupOrders.summary` | `orders` = selected-range leaf rows; `planned` = current status planned; `deferred` = current status deferred; `splitParts` = splitFrom nonnull; `withDeferrals` = hasDeferrals. These predicates overlap except the status ones and are not summed. Summary precedes search/filter. |
| `LookupHistory` | `date`, `publishedDates`, plan id/revision/publishedAt/detailRecorded, `counts`, typed groups, deferrals. A null plan is the no-publication state; a sent empty plan is different. Groups carry actual brands, including Mixed. |
| `HistoryTrip` | plan/trip identity, vehicle identity/current archived flag, driver or null, brand/district, status, saved planned schedule/load/km or null, recorded left/ready/back times, current stops and problem records. `detailRecorded` separates genuine legacy missing schedules from corrupt current publications. Reuse joined 016/013 types where meanings match, without their current-day filtering or latest-50 event limit. |
| `HistoryStop` | id/seq/shop, saved effective window, loaded/arrived/done times, outcome, typed lines and stage totals, `late`, `short`, `returnInstructed`, current receipt or null, `proof` metadata or null, problem records and `closedAttempts`. Unknown flags are nullable, not false certainty. |
| `HistoryClosedAttempt` | Issue id, raisedAt, reason/note, actor, counted lines, own photo metadata, decision/decider/decidedAt, arrivalAt or null with `arrivalRecorded`. Arrival comes only from the exactly matched closed audit. No current stop times, current receipt or replacement delivery count substituted for this attempt. |
| `HistoryReceipt` | `stopId`, confirmedAt, sentAt (nullable only where joined 015 permits), cold answer, order count, lines and received/receipt-short totals, optional report id and its photo/decision/replacement link. A confirmation without a report still has its stop identity. |
| `HistoryCounts` | trips, stops, onPlanOrders, stopsDelivered, stopsFinished, partialStops, lateStops, shortStops, returnInstructedStops, deferredOrders, confirmedStops, receivedOrders, plus stage totals and recorded/total coverage for nullable measures. Spec rule 6 defines each predicate. No publication has no counts object; an empty sent plan has zero known counts. |
| `LookupPhoto` | `{kind:'proof', stopId}` or `{kind:'issue', issueId}` with takenAt if recorded. No URL supplied by a database row, no binary and no implied receipt. Viewer resolves the two fixed authorized paths. |
| `LookupVehicle` | id/type/temp/fuel type, weight/volume limits, km/L, weekly quota, archived boolean, today off reason or null, all currently out trip references and today's sent trip references, selected recorded driver/status, weekly ledger totals and Mon–Sat bars, sent trip count, planned km or null, latest five sent trip references. Out status includes earlier published dates. |
| `LookupFleet.summary` | registered, active, archived, reefers, vans, recordedOut, notRecordedOut, activeOffToday, activeWithoutOffToday; fuel litres/quota/remaining/recordedCommittedPct/remainingPct or a null fuel object. The two percentages are also on per-vehicle fuel. Reefer/van figures describe all registered rows and overlap; working figures describe only active rows. |
| `LookupAvailability` | start/end, active category totals, archived count, `days[]` with date, `operating: boolean\|null`, category active/off/withoutOff counts and off vehicles/reasons. Categories are reefers, dry trucks, dry vans. Null operating means Outside delivery calendar. |

Order lists return all matches within at most 28 wanted dates; there is no unbounded “all time” endpoint or silently
truncated set. History reads one publication; fleet reads the depot's inventory and a fixed 42 dates. Details/photo
bytes are fetched on selection. If real usage later needs pagination, specify its stable cursor/totals as a separate
change instead of hiding rows to meet a render budget. There are no forecast, booked-hire or offline-presence fields.

## How it works

| File | Responsibility |
| --- | --- |
| `apps/api/src/lookup/orders.ts` | Wanted-date selection, order/detail reads, deferral/split/replacement links. |
| `lookup/history.ts` | Explicit published-date read and static trip/stop/receipt assembly. |
| `lookup/attempts.ts` | Typed retained closed-attempt evidence, including the narrow audit match. |
| `lookup/fleet.ts` | Inventory, recorded trip state, weekly ledger, recent sent trips. |
| `lookup/availability.ts` | 42-date read, current inventory and recorded days off. |
| `lookup/figures.ts`, `dates.ts` | Small pure functions for the new predicates/range/grouping; call existing load/driver/receipt/percent helpers, never fork those rules. |
| `apps/api/src/routes/lookup.ts` | Five GETs under `requireRole('dispatcher')` and `requireDepot`, mounted by the lead in `app.ts`. |
| `apps/web/src/features/lookup/api.ts`, `queries.ts` | Validated reads, scoped keys, abort signals, minute refresh and date/reset selection handling. |
| `features/lookup/OrdersPage.tsx`, `OrderDetail.tsx` | Orders table/cards and selected record. |
| `features/lookup/HistoryPage.tsx`, `HistoryDetail.tsx` | Static timeline/cards, attempts and receipts, existing photo viewer. |
| `features/lookup/FleetPage.tsx`, `AvailabilityPage.tsx`, `VehicleDetail.tsx` | Today/read-only six-week views and vehicle detail. |
| `features/lookup/parts/`, `words.ts` | Local presentational rows, filters, date control and labels; no duplicated business sums. |

### One snapshot per answer
Every aggregate/detail GET uses `orders/store-orders.ts::snapshot`. Its first `orders ACCESS SHARE` lock precedes
the first repeatable-read snapshot query, so a reset cannot deadlock or produce mixed generations. Read `readMoment(tx)`
once, then dates and business records in that same transaction. Use `...Of(tx, authorizedRows)` helpers, not nested
`getBoard`, `getDriverDay` or store-service transactions. No GET takes a new write lock, touches an audit row, runs
the optimizer, changes `answered_at`, or emits an announcement. All existing writes keep their current lock order.

### Orders and every number on the page
1. Resolve the wanted date/range. Use date arithmetic on explicit calendar-date values: day D, or D−27 through D
   inclusive. No device timezone, inferred holiday or open-order cutoff affects this lookup. Return resolved dates.
2. Join orders to outlets for `outlets.depot_id = caller.depotId`; exclude drafts and split parents. Keep archived
   outlets/products in historical reads. Batch lines/products and call `computeLoad` for ordered units/kg/m³.
   These per-line product descriptions/properties are current reference data, unlike the sent plan's kept total.
3. Read published memberships via stop_orders → stops → trips → plans, scoped to the same depot. Keep all assignment
   links in detail and select latest by plan date descending, trip number then id for deterministic ties. The UI
   says Latest sent-plan record, not Assigned now, so a closed return cannot imply a promised future date.
4. Read published deferrals on the order and its one split original. For each plan count one, preferring the leaf's
   own row if both exist; preserve reason/note. Draft deferrals do not count. Has deferrals is the resulting count
   above zero. A part has the original's wanted date and historical links, but only its own units enter totals.
5. Add joined 015 facts through a transaction-local authorized helper where suitable, or batch the same typed
   sources. Do not call the store endpoint or treat `readOrders`' outlet argument as a depot. Do not use a bare
   `max(plan.date)` as proof an order is currently assigned. Replacements follow `replaces_issue_id` on the order
   or its original, not a receipt-derived guess. Seed receipts without stop links remain order facts only.
6. Compute the five range summary values before filter/search, then filter and sort by spec rule 3. Search `%` and
   `_` literally if using SQL ILIKE: escape wildcard characters, use bound values, and validate length. Return
   matched count and rows. Detail repeats depot/submitted checks, including for a split parent; a foreign, missing
   or draft UUID all gets `unknown_record`. None of these reads includes arbitrary user/session fields.

### History, stage counts and attempts
1. Select the one depot's published plan for the resolved date; select its current publication metadata, trips,
   stop membership and deferrals. Also return the newest three published dates for navigation. No publication is
   an ordinary empty state, even if a draft exists. Seeded Tue/Wed publications have deferrals and no trips.
2. Validate `sent_check` with `PlanCheck`. A genuine legacy null check is handled before `driverTripsOf`, which
   requires a kept trip schedule. No check plus a matching current `plan.sent` audit, an invalid check, or a kept
   check missing a current trip is an invariant error. Do not re-run the checker against changed reference data.
3. For recorded trips, reuse `driverTripsOf(tx, tripPlanRows)` selected by depot/date, plus batched loading times,
   all `issuesOf` records for those trips, photo existence and 015's receipt columns. Reuse `tripFigures`/receipt
   helpers for stage arithmetic where their meanings match; before ready preserve null final loads rather than
   converting ordered quantities into loads. JSON must not accidentally include `Issue.stop`'s current times as an
   earlier attempt's times. A closed current result uses its issue snapshot, including after reallocation.
4. Build each closed attempt from its issue id and immutable `issue_lines.counted`. To recover a cleared arrival,
   look only for `audit_log.action = stop.closed`, `entity = stop`, `entity_id = this existing stop.id`, with typed
   `after.tripId = this authorized trip.id` and `after.writeId = this existing closed issue.id`. Validate
   `after.keptAt` against that issue's recorded time and read ISO `before.arrivedAt`. No match/null arrival is explicit
   unavailable evidence; malformed or contradictory matched evidence fails visibly. Never use `audit_log.at` or
   attach audit by order id, actor/depot membership or “latest row”. Reset deletes the issue/stop/trip identities;
   an orphan audit cannot populate this read, even when seeded order UUIDs are reused. A retained issue can have
   no old arrival record; that does not erase its known counts, closed time or photo.
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
7. Group trips by actual brand/district (Mixed once), with deterministic kept-schedule order and legacy unknown
   times last. Return flags for client filters; retain global totals and show a separate matched row count. Deferred
   filter lists the published deferrals with their order/shop/reason, including those later fulfilled elsewhere.
   No general event feed, period analytics, latest-50 cap, replay slider or new photo gallery service is necessary.

### Photo reads shared with 013/016
Use `/operations/stops/:stopId/photo` for proof and `/issues/:issueId/photo` for problem images. T0 first resolves
the outcome of 016's review; if its proof route is not yet implemented, the lead brings forward exactly that shared
read, in its proposed `operations/photo.ts` / `routes/operations.ts`, rather than give A8 a competing endpoint.
It checks stop → trip → published plan → caller depot before selecting an issue-null proof. Problem reads preserve
013's depot check and work after a decision. A byte read uses the same snapshot approach as its metadata.

Both routes return `image/jpeg`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` and
`Cross-Origin-Resource-Policy: same-origin`. No proof gives `not_found`; a foreign/absent stop or issue gives
`unknown_record` without revealing whether bytes exist. Use the shared viewer if joined, otherwise a small local
viewer: abort old fetches, verify current selection/generation before displaying, revoke object URLs on close,
scope change or unmount, and never write photos into query persistence, local storage or service-worker caches.

### Fleet and fuel
Read this depot's vehicle rows, including archived rows last; each row's limits come directly from vehicles.
Batch today's off rows, today's published trips, **all dates' out trips**, this calendar week's fuel rows and the
latest five sent trips per vehicle. Never choose a driver's permanent vehicle from seed conventions.

Out now is a recorded `out` trip and wins the displayed trip status, even for an earlier date. Multiple out records
sort by plan date, trip number and id ascending. Without one, select today's earliest unfinished trip by saved leave
time, then trip number/id; otherwise the latest returned trip by backAt/trip number/id descending; otherwise No trip
recorded today. Unknown legacy times sort last. Include all relevant trip references in detail so the choice
does not hide trip 2 being loaded while trip 1 is out. Archived and workshop badges are independent facts. One
vehicle contributes one Out now count regardless of the number of matching records. Within each type group put
active rows before archived, then the chosen sort (unknown remaining fuel last), then vehicle id.

Read the app date's `calendar_days.iso_year/iso_week` and join fuel rows to this depot's vehicles and calendar dates
in that same ISO year/week with `dow` 0–5 (Mon–Sat). Read the whole week, including future committed rows; do not
copy the planning board's earlier-than-plan-date ledger restriction. Each stored litre
value is converted to tenths before summing. Per row and aggregate, remaining = quota − ledger litres,
recordedCommittedPct = `percent(ledgerLitres, quota)`, remainingPct = `percent(remaining, quota)`; both percentages
are null on a zero denominator. Clamp drawing widths only, never the returned quantity.
All registered rows, archived included, form the labelled ledger denominator. Active/no-off figures separately
exclude archived vehicles. Unknown week is a nullable fuel object. Weekly bars sum by ledger date Mon–Sat; a sent
trip's estimate is already a ledger row and must not be added again. Count sent trips from trip/plan rows; sum
planned km from each matching saved check exactly once. Missing legacy km gives null with known-trip coverage.

The seed has 111 historical fuel rows with no trip ids, 6,945 / 18,600 L for Peliyagoda (37% rounded), **zero recorded
historic trips/km**, and VEH001 at 300 / 340 L (40 left). The manual VEH035 send adds 2.7 L: 6,947.7. Its unsend
removes that commitment. The first number remains a ledger fact, not fuel measured after a completed route.
Recent trips sort by published plan date and trip number descending, then id, to choose exactly five.

### Forty-two dates without a forecast
Calculate start = `depotDate(moment.at)`, end = start+41, with explicit date arithmetic. Read all vehicles belonging
to this depot, the `vehicle_days_off` rows in this range and any existing calendar rows; join off records by vehicle
id/date. Filter to active vehicles for the availability calculations, retaining archived metadata/off rows separately.
The table's composite key means one off row per vehicle/date. Separate active reefers (including reefer vans),
active dry trucks and active dry vans. For each date/category, `withoutOff = active − off`; an off row for an archived
vehicle can be listed as archived but does not reduce active totals. Return the independent operating flag or null.
Do not fabricate holiday, festival, payday or monsoon facts after the supplied calendar ends.

There is no order forecast, trip-capacity divisor, scheduling call, availability reservation or future fuel model.
The Thursday seed's three workshop vehicles leave six reefers with 140.7 m³ of nominal vehicle volume, but the view
does not translate that into six trips that must fit: temperature, access, windows, fuel and actual plans still
constrain them. No `Book` or `Tell shops` HTTP action is defined.

### Live updates, selection and screens
Use the one existing `useLive` stream. T0 adds a small lookup fan-out, preserving each normal topic invalidation
and whatever 016 joins for operations. No new live topic, write-side announce or second EventSource is needed.

| Incoming topic | Additional invalidation |
| --- | --- |
| `orders`, `plans`, `loading`, `driver`, `issues` | All `['lookup']` queries: the read set overlaps, and this is the smallest correct fan-out. |
| `admin` | All `['lookup']`: archives, reference names/limits and depot assignment can affect each view. |
| `clock`, `demo`, reconnect after a break | Existing all-query invalidation already includes lookup. |

Use keys `['lookup', page, userId, depotId, validatedParameters]`. Detail keys include selected id. Keep the existing
one-minute fallback, and invalidate implicit Today/latest defaults on a locally observed calendar-midnight change
using the existing web clock. Explicit historical date choices stay pinned, including across a clock move; a reset
clears selected entities/photos and refetches that date, which may now be empty. A first response resolves default
dates server-side. Do not turn a default into a permanently pinned date just because its first answer named one.

Pass TanStack Query's AbortSignal to fetch and guard photo/selection responses by scope/request generation.
Cancellation/generation, not `readAt`, orders results. On account/depot change discard that account's lookup cache
and visible image; on demo generation change discard selected identities and image bytes before replacing records.
Never retain one date's data under a newly selected date heading as placeholder success. A same-scope failed refresh
may retain its last successful view, with the spec's explicit warning and read time.

`DispatcherHome.tsx` mounts the three pages through the existing routes and wide shell; Fleet uses the query
parameter for its second view. T0 owns this file because 016 also edits it. No root-router rewrite or nav redesign.
Links use browser `?date=YYYY-MM-DD&trip=<uuid>` for History; only `date` is sent to its aggregate API. The browser
validates `trip` as a selection among the returned trips, never as a second fetch or arbitrary query key.
A bad/stale trip selection clears detail while leaving
the authorized day visible. History → issue navigation opens the existing Live day page; it does not create another
decision form. Browser tests must verify account/date/reset transitions as well as the desktop/narrow layouts.

## Changes to other specs
- **004 / 008:** reuse vehicle archive and days off, calendar, clock, reset and stream. No new fleet command or seed
  history. Today's archive remains a current fact, not a reconstructed demo-clock effective date.
- **009 / 010 / 014:** no order or planner command changes. Wanted-date lookup is explicitly different from the
  planning workload. Has deferrals reads published decisions, and a saved suggestion is not a past publication.
- **012 / 013:** read all retained problems and attempts; retain lock/replay/photo guarantees. At join, point 013's
  A8 exclusion at this static history/attempt/photo coverage, documenting that exhaustive replay is still deferred.
- **015:** required for receipt counts, confirmation times and replacement links. Follow actual joined schemas,
  including the driver-writes → phone-writes rename; don't introduce a parallel receipt record or pending-phone read.
- **016:** coordinate proof read, optional typed projections/viewer, live invalidation and DispatcherHome in T0.
  Its live feed remains current-day/latest-50; History is an explicit-date read. At join clarify its broad A8
  audit-gallery promise with this spec's retained-attempt boundary. Review decisions may alter shared seam names.
- **README / map / specs index:** this draft only adds 017 and A8 Spec plus D-80 onward. Implementation join adds
  the actual walkthrough/departures, updates relevant exclusions and marks A8 Done only after its checks/review.

## Risks
- Forecast and booking are prominent in the submitted frames. Availability-only is an explicit scope/design pick,
  not a claim to have implemented forecasting. Nabil may cut A8 rather than approve the departure.
- Receipt/live work is still in flight. T0 must reconcile reviewed interfaces and reserved decisions before builder
  assignments. If 015 isn't joined, defer A8 completion; do not represent missing received quantities as zero.
- Mutable line counts and current `Issue.stop` timestamps can rewrite an old closed visit. AC-14/15 exercise both
  retry and later-date reallocation with different counts; matching audit ids prevent old-run rows leaking on reset.
- Historical master-data versions and every publication edit were never stored. Explicit missing/current-reference
  labels are part of the product. Malformed new records are errors, not silently classified as legacy.
- Fuel ledger rows are not actual consumption, and the seeded calendar ends in four days of the Thursday horizon.
  Zero recorded future off days is not proof of available operating capacity; AC-25/26 enforce that boundary.
- A8 can get large through optional tables, search analytics, replay or booking. The task file separates small reads
  from their screens and keeps them after shared parts. No acceptance criterion authorizes an excluded write.

## Test plan
Write and run each automated criterion test failing before its implementation. Use existing pure helpers where
possible; new date/aggregation predicates get unit cases as part of the corresponding named test. No database or
application test run is needed for this documents-only draft; its checks are source facts, links, coverage and scope.

| Criterion | One named test / check | File or evidence |
| --- | --- | --- |
| AC-1 | `lookup requires the existing dispatcher and depot checks` | `apps/api/tests/lookup-access.test.ts` |
| AC-2 | `lookup cannot cross depot through lists details or photos` | Same file |
| AC-3 | `lookup rejects malformed queries without side effects` | Same file |
| AC-4 | `wanted Thursday is 98 then 100 and never the 104 workload` | `apps/api/tests/lookup-orders.test.ts` |
| AC-5 | `four weeks means 28 inclusive wanted dates and 127 then 129 records` | Same file |
| AC-6 | `order filters and literal search preserve range totals and stable order` | Same file |
| AC-7 | `split and join count leaves and distinct inherited deferral plans` | Same file |
| AC-8 | `returned orders retain historical assignments without a promised new date` | Same file |
| AC-9 | `order receipts and replacement ancestry use the recorded sources` | Same file |
| AC-10 | `history reads the manual sent schedule and its 99 deferrals` | `apps/api/tests/lookup-history.test.ts` |
| AC-11 | `history keeps loading distinct from handover and receipt` | Same file |
| AC-12 | `refusal records 115 handed over 2 refused and 1 depot short` | Same file |
| AC-13 | `zero handover finishes a stop without delivering it` | Same file |
| AC-14 | `Friday loading and receipt cannot rewrite Thursdays closed counts` | `apps/api/tests/lookup-attempts.test.ts` |
| AC-15 | `retry attempts use their own issue and matched audit evidence` | Same file |
| AC-16 | `three received orders make one confirmation and two distinct shortage stages` | `apps/api/tests/lookup-history.test.ts` |
| AC-17 | `legacy seed publications expose recorded deferrals and missing detail honestly` | Same file |
| AC-18 | `history filters keep stop order and attempt grains separate` | Same file |
| AC-19 | `proof and decided problem images have scoped uncached JPEG reads` | `apps/api/tests/lookup-photos.test.ts` |
| AC-20 | `Thursday fleet has 38 active 9 reefers 4 vans and 3 off` | `apps/api/tests/lookup-fleet.test.ts` |
| AC-21 | `recorded out status takes precedence then hands over to trip two` | Same file |
| AC-22 | `archived fleet retains history fuel and any out trip` | Same file |
| AC-23 | `fuel reads history and publication commitments exactly once` | `apps/api/tests/lookup-fleet.test.ts` |
| AC-24 | `fleet fuel distinguishes zero quota over quota and unknown week` | Same file |
| AC-25 | `six weeks gives 42 dates and does not infer the missing calendar` | `apps/api/tests/lookup-availability.test.ts` |
| AC-26 | `future off records and present archive do not promise available trips` | Same file |
| AC-27 | `lookup snapshots race writes and reset without mixed generations` | `apps/api/tests/lookup-snapshot.test.ts` |
| AC-28 | `existing live topics reconnect and fallback refresh lookup too` | `apps/web/src/lib/live.test.ts` |
| AC-29 | `late reads and images cannot cross selection account or reset` | `apps/web/src/features/lookup/queries.test.ts` |
| AC-30 | `orders desktop lookup` | Lead's written click-through record at join |
| AC-31 | `history desktop lookup and proof` | Same record |
| AC-32 | `fleet desktop records and future view` | Same record |
| AC-33 | `lookup narrow layouts and boundary` | Same record at 390, 820, 1024 plus desktop 1440 |
| AC-34 | `lookup failure empty legacy and session states` | Same record; unavailable calendar and legacy data also exercised by API fixtures |
| AC-35 | `joined roles and offline sync update the lookups` | Same record with driver/shop phone tabs and Ruwan open |
| AC-36 | `source and scope review` | Independent reviewer at join |

One scenario may be parameterized (for example each unauthorized role/route), but no criterion is replaced by a broad
green smoke test. Each file signs in once per account, uses the builder's private freshly migrated/seeded database
and resets the day at its end, restoring the clock. Compose `loading-plan.ts`, `driver-plan.ts` and the joined 015
receipt helpers in `tests/lookup-plan.ts`; keep exact assertions on the seed above. Kandy rows, missing legacy detail,
zero/over-quota vehicles, a future off day and concurrency barriers are **test-only** fixtures, never seed changes.

The snapshot race pauses between stops and issue/receipt reads while another transaction commits; it must see a
whole before or whole after result. Reset tests include surviving audit with reused seeded order ids, and date/id
selectors from a now-deleted trip. Validate GET side effects with before/after business rows and no announcement.
Browser request-order tests include equal app instants, reset backward, parameter changes and late photo bytes.

Implementation join: private database, fresh migrate/seed, typecheck, full tests and both builds, then the built-app
click-through against all five exports at the four widths. Do not use ports 3000/5173 or another builder's database.
Record actual API/web totals, failures fixed and every browser result; these are future completion gates, not
claims made by this documents-only PR.
