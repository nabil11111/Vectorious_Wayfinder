# 016 · Plan

## Data changes
**None.** No new table, column, migration, seed, event log or acknowledgment record. Both new endpoints are GETs.
The loader's comparison lives in tab-scoped `sessionStorage`; the server remains the authority for starting loading.
The read depends on spec 013's schema and joined server code, not merely its specification branch.

Read against main at `1326aa3`, 013's specification at `origin/nabil/driver` (`4ec0a6e`), its server PR #17
(`33fee4e`), and 014's specification at `origin/nabil/suggest` (`00191fb`). These are evidence for this draft, not
pins to impose on implementation. T0 follows the joined code and rechecks any changed interfaces. D-56 to D-65 are
reserved for 015; this piece does not invent its receipt fields.

## Contracts
T0 adds `packages/contracts/src/operations.ts` and exports it. Days are `YYYY-MM-DD`, instants ISO strings; all
counts, percentages and attention flags are server values. No unvalidated record-shaped JSON crosses the boundary.

| Shape | Fields and meaning |
| --- | --- |
| `OperationsDay` | `depot` (id/name), `demoDay` (reset generation), `day` or null, `dayChangesAt` (16:00 on the watched operating day, null with no day), `readAt`, `plan` (`id`, `revision`, `publishedAt`, `detailRecorded`) or null, `counts`, `nextRun` or null, `fuel` or null when its calendar date is absent, `groups`, `earlierOut`, `events`, `eventsTruncated`. |
| `OperationsCounts` | `stopsTotal`, `stopsDelivered`, `stopsDone`, `partialStops`, `noGoodsStops`, `closedStops`, `tripsTotal`, `vehiclesOut`, `vehiclesTotal`, `deferredOrders`. The execution numerators are nullable when any current trip lacks recorded detail; with no stops they are zero. `noGoodsStops` counts delivered/refused outcomes with zero delivered units, distinct from closed. They describe the current day except `vehiclesOut/Total`, which are depot-wide. Needs you comes from `IssueList`, not a second count here. |
| `NextRun` | `date`, `cutoffAt`, `orders`, `ordersClosed`. Demand by rule 3's union, not the default planning board's day. |
| `OperationsFuel` | `isoYear`, `isoWeek`, `litres`, `quotaLitres`, `percent` or null with zero quota. Entire week's recorded/committed rows. No duplicate `sent_check` contribution. |
| `OperationsGroup` | `brand` (existing `Brand`: `Fresh`, `Style`, `Tech`, or null for Mixed), `district`, `tripsTotal`, `vehiclesTotal`, `stopsTotal`, `stopsDone`, `trips`. Groups in Fresh, Style, Tech, Mixed order, districts in the existing planner's district order; within them scheduled leave, vehicle id, trip number. No missing brand substituted with Fresh. |
| `OperationsTrip` | A discriminated union by `detailRecorded`. Both variants hold `tripId`, `planId`, `date`, `vehicleId/type/temp`, `tripNo`, `driver` (id/name or null), `brand`, `district`, `status`, `openIssueIds`, `stopsTotal`. A recorded variant holds `trip` (013's `DriverTrip`), `figures` (the result of `tripFigures` with nullable final-load fields before ready), `onSoFar` for dock trips, `lastReportAt`, `attention`, `schedule`, `stopDetails`. An unrecorded variant has basic stop membership (`id`, `seq`, shop id/name), no execution figures or schedule, and reason `legacy_plan`. |
| `TripSchedule` / `StopDetail` | Planned leave/return; stop id, planned arrival/departure, effective shop window, recorded loaded/arrived/done times, quantities, outcome, proof presence and issue ids. Instants use the plan's date, including a next-day offset if the kept schedule has one. Detail counts reuse 013, not client sums. Timeline extent/ticks for each dated section cover 02:00–22:00 and expand to whole two-hour bounds for outlying marks/current time. |
| `TripAttention` | `none`, `departure_unreported` with planned time, `arrival_unreported` with stop id/planned time, or `retry_requested` with stop id/time. Only the first two make a Watching item. Recorded arrival after window is a separate stop fact. Neither has a predicted time or driver connectivity. |
| `OperationsEvent` | `key`, `kind` (the finite list in spec rule 7), `at`, `tripId`/`stopId`/`issueId` as appropriate, vehicle/shop identity, optional actor name, optional typed quantities or decision, and `photo` (null, `{ kind: 'proof', stopId }` or `{ kind: 'issue', issueId }`). No arbitrary URL or photo bytes. Keys and quantities come from the record, never the rendered sentence. |
| `LoadingDay` change | Add `demoDay`. Extend its `plan` with `publishedAt` and `publishedBy` (display name or null for a legacy publication without a matching audit). Keep existing id/revision and truck fields. All GET and write responses use the widened shape. |

`DriverTrip` is a shared data shape, not permission to call the driver's endpoint as a dispatcher. Do not return a
driver's applied write ids, queue information, photo bytes or private browser state. A `null` value has the explicit
screen meaning from the spec; it is not an instruction to invent an estimate.

New routes have no new error codes. Reuse `signed_out`, `forbidden`, `no_depot`, `unknown_record` with the offending
id, and `not_found` ("This stop has no delivery photo."). The read has no date or depot selector. Invalid stop-id
syntax is `invalid_input`; a foreign or absent well-formed id is `unknown_record`.

## How it works

| File | Responsibility |
| --- | --- |
| `apps/api/src/operations/read.ts` | `getOperations(caller)` and the single-snapshot `operationsOf(tx, caller, moment)` assembly. Current/earlier trip selection, publication, fleet, demand and fuel reads. |
| `operations/figures.ts` | Pure aggregation/grouping from typed read inputs, including distinct vehicles, delivered versus finished stops, nullable legacy facts and next-run order deduplication. Uses existing `tripFigures` and `percent`. |
| `operations/attention.ts` | Rule 4's missing-report/retry status on plain values; no forecast. |
| `operations/events.ts` | Rule 7's typed events, deterministic keys/order and newest-50 limit. |
| `operations/photo.ts` | Depot-scoped proof read, following the existing issue-photo implementation. |
| `apps/api/src/routes/operations.ts` | The two GETs behind `requireRole('dispatcher')` and `requireDepot`, mounted by the lead in `app.ts`. |
| `apps/api/src/loading/day.ts` | Publication metadata, and carry `demoDay` with the same read/locked moment. |
| `apps/api/src/loading/writes.ts` | Pass the existing transaction's moment to the widened loading-day assembler; no new lock or mutation. |
| `apps/web/src/features/live/operations.ts` | The query shared by both dispatcher pages, scoped to account/depot. |
| `features/dispatcher/DashboardPage.tsx` | Six tiles, issue summaries linking to existing cards, next-run card, out-truck table/cards. |
| `features/live/LiveDayPage.tsx`, new `parts/` | Grouped rows, timelines/cards, inline trip detail, filters, events and existing Needs you. |
| `features/loader/changes.ts`, `PlanChangedPage.tsx`, new `parts/PlanChangeBell.tsx` | Pure publication comparison, scoped session store, full change page and badge. Existing list owns notice detection. |

### One consistent read
`GET /operations` calls `snapshot` from `orders/store-orders.ts`. It first takes `orders ACCESS SHARE` before its
first snapshot read and runs read-only/repeatable-read. This is the existing reset-safe path; do not open one
snapshot per card, or call an exported service that opens a nested transaction.

1. Read one `moment` through `plans/board.ts::readMoment` and `operatingDays`. Derive `loaderDay`, the next operating
   date and cutoff from those inputs. The watched day is not `boardDay` and never default `getBoard()`.
2. Select this depot's published current plan and all its trips, plus older published trips still out. There is no
   current-date restriction on open issues: `GET /issues` remains the independent source for Needs you and its bell.
3. For plans with a kept check, call 013's exported `driverTripsOf(tx, tripPlanRows)` on the already authorized rows.
   It holds the historical closed-attempt read and effective windows in one place. Add names, `last_event_at`, saved
   stop times and photo existence in batched reads. Call `trucksOf` only for planned/loading/ready trips for On so far;
   it rejects out/done. Call `tripFigures` / `nextStop` on the resulting trip data. Preserve null loaded counts before
   ready; never render ordered-minus-null as depot short. Do not interpret `tripFigures.onTruck` as all remaining
   cargo: it counts refused/closed return goods only.
4. Handle `sent_check IS NULL` legacy seeded plans explicitly before calling either helper (both require times).
   Read their basic trip/stop membership directly and mark detail unrecorded. Their current-day execution totals
   remain null when they have trips, zero when they have none. The actual seed's Tuesday/Wednesday plans have
   deferrals and no trips; a test-only legacy trip exercises the detail path. Do not recalculate an old schedule
   from current master data. A malformed check, missing current trip timing, or a null check with a matching
   `plan.sent` audit for this publication is an invariant error and fails the read visibly.
5. Read this depot's vehicles; read `fuel_log` joined to those vehicles and `calendar_days` for the watched date's
   ISO week/year (app date if no day). If that date is beyond the supplied calendar, return `fuel: null` with the
   explicit unavailable state. Otherwise sum litres in integer tenths and quota once per vehicle, then use
   `plans/board-day.ts::percent`. Read next-run demand by the rule 3 union, deduplicated by order id. Read deferrals
   from the published current plan, not all older deferrals or order status alone. No call to the optimizer/checker.
6. Read issues for shown trip ids with `issuesOf` and assemble trip attention, counts and groups. The dashboard out
   list is the current/earlier trips whose status is out. Global stop figures exclude earlier trips; a Mixed trip is
   one group member. `openIssueIds` are hints for navigation/filtering, not a second authoritative issue form.
7. Read the rule 7 event records for exactly those trip ids and current publication. Emit one event for each source,
   sort by `at` descending then `key` ascending, take 50 and return `eventsTruncated`. Refusal/closed issue records
   supply their attempt event instead of another generic outcome event. Use issue snapshots for closed quantities.
   Do not query the surviving audit log for a general feed. A duplicate driver write produces no new source row.
8. Validate and return `OperationsDay` with the same `readAt` and `demoDay`. No audit write, cached daily total or
   acknowledgment is made. The whole read is before a reset or after it, not a combination.

The six dashboard tiles use this query except Need you, which uses the existing shared `['issues']` query like the
bell. This keeps the bell/card count consistent. Operations and issues are separate snapshots: on a brief mismatch
after a commit, a missing card triggers an issues refetch and the explicit already-answered state, never a new write.

### Proof and publication metadata
The proof read uses `snapshot` too. Check stop → trip → plan belongs to the caller's depot, then select `photos`
with that stop and `issue_id IS NULL`; return the JPEG using the same response/cache policy as the existing issue
photo route. It does not expose another depot even if its UUID is known. Issue photos stay on `/issues/:id/photo`.

Change `loadingDayOf` to accept the existing moment's `{ at, demoDay }` rather than only `at`, and update its GET and
write callers. The GET passes `readMoment(tx)` once; loader writes pass their existing `open.moment`, obtained through
`lib/day-lock.ts`. Do not read an independent clock or take another lock just to form the response.

The loading plan's time is `plans.published_at`. Find the publisher only from `audit_log` where `entity = plan`,
`entity_id = plan.id`, `action = plan.sent` and `after.revision = plan.revision`, joined to `users.display_name`.
Do not choose `created_by` or the latest audit row by real time. Missing sender on a legacy plan is null and the
screen omits the person's name; no invented Ruwan. For a real new publication a missing matching audit is a failure
of the send's existing invariant and is covered in the regression checks. No intermediate-withdrawal timestamp is
available, so that notice has none.

### Locks and changes made elsewhere
There are **no new write locks**. GETs use `snapshot`, not `lockDay`. The unchanged commands still use
`lib/day-lock.ts`: plan edits and loader start lock demo day then depot; driver/issue commands retain 013's trip/issue
order and post-lock clock read. Existing writes announce only after commit. Got it changes session storage, takes no
database lock and cannot grant permission to load. Start-versus-unsend is still 012's race and its tests remain green.

### Live updates and query ordering
Reuse `apps/web/src/lib/live.ts::useLive`, `features/live/issues.ts`, `Bell`, `NeedsYou` and `IssueCard`. No second
EventSource, server topic, socket, polling service or new write-side announcement.

| Existing incoming topic | Existing query kept | Additional invalidation |
| --- | --- | --- |
| `plans` | `[plans]` | `[operations]`: publication, trip membership, deferrals/fuel |
| `loading` | `[loading]` | `[operations]`: dock counts, loaded/ready timestamps |
| `driver` | `[driver]` | `[operations]`: departure, arrival, delivery/refusal/closed/return |
| `issues` | `[issues]` | `[operations]`: flags, decisions, attention and events |
| `orders` | `[orders]` | `[operations]`: next-run demand and counts returned for another run |
| `clock`, `demo`, reconnect after a break | All as 008 already does | Included through the existing all-query refetch |

T0 adds this small fan-out to the single stream and tests it. Keys for operations include the signed-in account and
depot; no previous account's view is used as placeholder data. Requests use the query's abort signal, and cancelled
or older results cannot land after a newer request. Each successful response replaces the aggregate in one step.
Both dispatcher pages share it instead of issuing independent tile requests. Use the existing one-minute refetch,
plus invalidation on the locally observed loader-day boundary so a tab moves at 16:00 even without an SSE clock jump.
Do not create another clock: compare the existing app clock with the response's `dayChangesAt`. Cancel the old
day's request when switching; refetch before labelling the new day.

Request cancellation/generation orders responses, never `readAt`: demo holds can give equal times and reset moves
the app clock backward. The page's current app time may move the now line, but delivery/attention facts only change on a successful read.
The updated line displays `readAt` from the last successful aggregate, with its failure state if refresh fails.
Dashboard and Live day use the existing issue mutation hook. After an answer refetch issues and operations (also
reached by SSE); keep only the existing decided-card confirmation locally. Never put a write response into either
query as the day's replacement.

### Loader comparison on the tablet
`changes.ts` stores a versioned, validated object under the account/depot/demo-generation/day key: the previous
observed publication, the latest one, its computed change rows and whether Got it closed the notice. Keep only the
publication fields needed for comparison and display, not issues, loading progress or photo data. A publication key
is plan id plus revision. The first read establishes it. A missing plan retains it; an error does not update it.

Compare only on a new publication key in the same scope. Normalize by vehicle/trip number, ordered shops and
order/line identities. Driver/leave/sequence/quantities participate; generated trip/stop UUIDs, trip revisions,
loading counts and issue decisions do not. A trip disappearing at the same publication because it drove out is not
a new publication. Resend can skip intermediate edits the tab never observed; describe the two reads, not a complete
change history. Removed trips stay on the comparison page; only current trips receive list chips. An identical
republish shows the generic sent-again notice with zero changed badge.

`LoaderHome` owns `/loader/changes` inside its existing nested routes. On the trucks list, a new publication opens
the notice once; reopening it is through the loader bell. Do not replace an in-flight flag form or loading write
with navigation. A stale Start first follows its existing refusal/refetch path, then offers the comparison when
available. On reset, day/account/depot change or sign-out discard the old scope, including hidden previous account
entries owned by this feature. Storage parse/quota errors are visible and fall back to current in-memory comparison
for that tab; the current API list and loading commands stay usable. This is explicit degraded behavior, not a
successful persisted acknowledgment. A reload without a readable baseline starts from the first-visit state.

### Screens and layout
`DispatcherHome` mounts `DashboardPage` at its existing index and gives dashboard the same wide shell as Live day.
It leaves Orders/History/Fleet placeholders alone. Dashboard's map area disappears; Needs you and next run take that
space. Summaries link to Live day; they have no new decision form. Timeline drawing is ordinary SVG/CSS from returned
times, no mapping library or new package. Pixel positioning and time formatting are presentation, not business maths.

At 1024 and wider keep the timeline with its rail; at smaller widths use the card order in the screen table. Test
1024 itself as well as 1440, 820 and 390. Inline details, focus targets, filter controls and proof links work with a
keyboard; do not hide a required action behind hover. Keep the existing green confirmation and problem card wording.

## Changes to other specs
- **008:** reuse its clock, snapshot/reset behavior, single stream and reconnect/fallback. The only shared live change
  is the additional query invalidation; no service-worker/API caching change.
- **010 / 014:** no command or suggestion change. Operations reads published membership and kept times alike. The
  dashboard links View plan by explicit date; it does not use a suggestion as publication history or build at 16:05.
- **012:** extend `LoadingDay` and its assembler callers; the loader's change screens leave its A7 exclusion. At join,
  amend its AC-30 click-through to include the comparison, and its exclusion to say post-loading edits remain deferred
  by D-70. Keep its race, role and stale-write tests. No flag-photo work added.
- **013:** reuse `driverTripsOf`, `nextStop`, `tripFigures`, problem cards and issue photos. Its A7 exclusion gains a
  pointer to this spec for timelines/events, with presence/ETA/Undo still excluded. No change to phone queue rules.
- **015:** retain its eventual issue kinds/cards without defining receipt counts or competing writes. T0 joins against
  its actual contracts if it landed, keeping the exhaustive kinds and existing tests. Its reserved decisions stay its own.
- **README / map:** join adds the walkthrough and departures, makes A7 Done only after tests/click-through/review. This
  documents-only PR adds the spec/table link and A7 Spec; it does not claim implementation.

## Risks
- The mock delivery totals conflict and its loader move conflicts with current loading locks. D-67 and D-70 are
  explicit picks for Nabil to review, not claims that those interactions already exist.
- The 013 server helper expects a kept check. AC-12 covers the actual empty legacy seed publications, then adds
  a test-only legacy trip to verify the unrecorded path without claiming that trip was seeded.
- An order can appear on an old closed stop and a new plan. Current order status/counts alone rewrite history or
  double-count next-run demand. AC-8 checks the whole reallocation, using the old issue snapshot.
- Shared contracts/live code may move while 013–015 join. T0 lands first; builders branch from it, and only the lead
  edits shared files. Receipt decisions remain 015's, even if its cards broaden Needs you.
- Session storage is deliberately local. It cannot tell a new tablet what changed yesterday. The badge is not an
  acknowledgment ledger, and server revision checks remain essential.
- Offline driver data is unknowable here until sync. The visible Last report label avoids an untrue connectivity or
  arrival claim. The event feed omits cleared historical arrivals and is not the audit trail promised to A8.

## Test plan
Write each automated test, run it failing, then implement. Pure rules' tests are committed before their code (D-07).
The one-to-one map below names the test/check; do not replace it with one broad screenshot or a mocked happy path.

| Criterion | One test/check name | File / evidence |
| --- | --- | --- |
| AC-1 | `operations requires a dispatcher with a depot` | `apps/api/tests/operations-read.test.ts` |
| AC-2 | `unpublished Thursday has real empty totals` | Same file |
| AC-3 | `sent walkthrough counts orders and fuel once` | Same file |
| AC-4 | `ready truck separates dock load from delivery` | Same file |
| AC-5 | `recorded departure and delivery leave schedule unchanged` | Same file |
| AC-6 | `refusal is one partial delivered stop` | Same file |
| AC-7 | `closed stop is finished but not delivered` | Same file |
| AC-8 | `returned orders reenter demand without rewriting the old attempt` | `apps/api/tests/operations-attempts.test.ts` |
| AC-9 | `retry reopens progress and keeps the closed event` | Same file |
| AC-10 | `sixteen hundred keeps earlier out trips separately` | `apps/api/tests/operations-read.test.ts` |
| AC-11 | `no remaining day keeps out trips and open issues` | Same file |
| AC-12 | `legacy seeded plan explicitly lacks movement detail` | Same file |
| AC-13 | `another depots records and proof stay private` | Same file |
| AC-14 | `snapshot and reset return one generation without deadlock` | Same file |
| AC-15 | `counts distinguish orders stops trips and vehicles` | `apps/api/src/operations/figures.test.ts` (unit) |
| AC-16 | `attention names missing reports and retries without predictions` | `apps/api/src/operations/attention.test.ts` (unit) |
| AC-17 | `replayed and late writes yield unique business time events` | `apps/api/tests/operations-events.test.ts` |
| AC-18 | `latest fifty events never survive their reset` | Same file |
| AC-19 | `owned delivery proof reads as jpeg or not found` | Same file |
| AC-20 | `loading publication names its actual sender and generation` | `apps/api/tests/loading-publication.test.ts` |
| AC-21 | `publication comparison uses semantic identities` | `apps/web/src/features/loader/changes.test.ts` (unit) |
| AC-22 | `withdrawal reload got it and scope changes preserve or clear comparison` | Same file (storage lifecycle) |
| AC-23 | `first visit progress and storage failure cannot invent a change` | Same file |
| AC-24 | `existing topics invalidate operations and keep normal invalidations` | `apps/web/src/lib/live.test.ts` |
| AC-25 | `return removes out row but retains days finished trip` | `apps/api/tests/operations-read.test.ts` |
| AC-26 | `dashboard desktop` | Lead's written click-through record at join |
| AC-27 | `live desktop and details` | Same record |
| AC-28 | `filters and existing decisions` | Same record, with a second open issue |
| AC-29 | `dispatcher narrow layouts` | Same record, 390 and 820, plus 1024 boundary |
| AC-30 | `loader changed publication` | Same record, 1180 × 820 and 390 |
| AC-31 | `stale loader start and loading lock` | Same record, retaining 012's automated race tests |
| AC-32 | `offline driver reaches watching dispatcher once` | Same record, two browsers, driver tab offline |
| AC-33 | `all non-happy screen states` | Same record; unreachable calendar-end state also checked with AC-11's real API fixture |
| AC-34 | `older operations response cannot replace a newer day` | `apps/web/src/features/live/operations.test.ts` (controlled request ordering and clock boundary) |
| AC-35 | `source and scope review` | Independent review recorded at join |
| AC-36 | `a complete refusal finishes a stop without delivering it` | `apps/api/tests/operations-read.test.ts` |

Integration files use the builder's private seeded database, once-per-file sign-ins and the existing
`loading-plan.ts` / 013 `driver-plan.ts` walkthrough helpers. `operations-plan.ts` may compose them and call real
loader/driver/issue endpoints; it does not change their seed or substitute mocked production records. Restore with
`clearDemoDay` and `seedDemoDay` in one transaction at each file's end, then let the clock run. The closed reallocation
test follows 013's Friday retry scenario; the read/reset race uses its existing transaction barrier pattern.
Permission fixtures add a Kandy trip/proof in the test only. The 50-event case makes typed issue records in the test,
with deliberately different real audit and business times; no production sample feed is permitted.

On the joined branch run typecheck, fresh migrate and seed, the full tests and build, then the browser checks on the
built app (013's service worker is off in development). Record actual API/web test totals and each click-through
result. Do not start on ports 3000/5173 or touch another builder's database. No tests or database run is needed merely
to review this documents-only draft; its checks are links, source facts, criterion coverage and ownership boundaries.
