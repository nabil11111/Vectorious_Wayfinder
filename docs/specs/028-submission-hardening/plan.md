# Implementation handoff

## Receiving readiness foundation

Lead commits 7e704a2 (red contract tests) and its following foundation commit add contracts in receiving.ts,
outletReceiving table and migration 0013, plus explicit demo reset clearing. The three contract tests pass.

Store GET /store/receiving returns StoreReceiving. PUT /store/receiving accepts SaveReceivingRequest and
returns the updated StoreReceiving. Outlet/actor come only from the session, not the body. Use calendar date
at the outlet from the app clock, not the planning cutoff day: receiving readiness for today must not switch
to tomorrow at 16:00 while a driver may still arrive. On a nonoperating day, return date/state null and no edit.
UI names the date, so a declaration cannot be mistaken for permanent opening hours.

Use existing snapshot/clock/reset locks. Write checks demoDay, exact date and row revision; lock outlet row
to serialize first inserts as well as updates. Missing row is unconfirmed revision 0; explicit unconfirmed saves
retain an incremented row. Note empty string becomes null. Changed state audited with before/after under
receiving.updated, updatedAt from app clock. Do not queue readiness writes offline: show a clear offline/error
state and leave the previous confirmed declaration unchanged. Manager can retry with a fresh read.

DriverStop may gain receiving: ReceivingState nullable/optional for backward-compatible old caches. Populate it
for each stop's actual plan date. Show state/note/time on NextStopPage with last-known wording while offline.
Only assigned trips reach a driver. Dispatcher GET /operations/receiving?depot=... reads current-day declarations
for the chosen authorized depot and returns ReceivingList. Integrate an unobtrusive current-day list on Live day,
with unknown/error explicitly distinguished from unconfirmed. Do not merge states from unrelated dates.

Notify assigned drivers and depot dispatcher through existing notifications, e.g. receiving.updated audit records
filtered by outlet, date and assignment. Use stable revision-based notification IDs; duplicate read/live refresh
must not duplicate alerts. Do not send to every driver. No new read/seen acknowledgement system. Existing live
topics can invalidate readiness/driver/notifications without embedding private record data in events.

All readiness changes are advisory; they must not change delivery state, permit forbidden plans or block driver
writes. Tests must include wrong roles/outlets/depot scope, stale revision/date/reset generation, two writers,
reset clearing and post-16:00 current-day behavior. Tests for notifications must exclude unassigned drivers.

## Boundaries between builders

After A–D commits are joined, receiving builder owns API route/helper, live notifications addition, store readiness
card and driver/dispatcher presentation with narrow existing integration edits. It may extend driver and notification
contracts for this feature. No other schema changes without lead. This ownership is granted after integration to
avoid overlapping the initial evidence/interface/operations branches.

## What-if comparison foundation and feasibility

Contracts are in packages/contracts/src/scenario.ts. POST /plans/:date/scenario accepts PlanScenarioRequest;
it is a read-only calculation despite using POST for its structured input. Never call openPlan, replaceDraft,
makeParts, joinParts or suggestPlan: those write. Use snapshot/readBoard/plannerInputOf with explicit current
day/cutoff/plan ref/locked-state validation and a maximum of 300 input orders, matching existing planner limits.

Run the same structured input twice, once unchanged and once with exactly the selected available vehicle
marked unavailable. Return PlanScenario with generated baseline clearly labelled (not the manual saved draft).
Each outcome uses real checker results, per-original-order outstanding demand and real planner reasons.
Map generated split IDs through result.splits/result.choices; aggregate persisted parts by splitFrom so totals
do not double-count an original. A partially served order has some outstanding goods planned and some deferred.
Fuel is the sum of planned trip fuel (not the entire weekly already-used quota). Count repeated deferrals only
where an outstanding original had already waited and still has goods deferred. If either run is unavailable,
return an actionable calculation failure and keep the saved plan unchanged.

snapshotKey hashes relevant input content, not merely plan revision. Client discards results on depot/day/reset,
board revision/content changes or new input selection, and ignores late responses from old identities. Excluded
vehicle must exist in the chosen depot and be available in the baseline. No Apply button and no external dependency.

Local feasibility on 2026-10-04 (Node 22.22.2, macOS arm64): pure planner benchmark median 133 ms for 102 seeded
orders and 382 ms for 300 synthetic orders, 10 measured runs after warmup. This is local engine timing, not
production API latency. A real fixture probe excluding VEH035 produced checked plans: baseline 27 trips / 6
deferrals versus 26 trips / 9 deferrals. Original input remained unchanged. Feasibility passes; integration,
source-part reconciliation, stale state and read-only database behavior still need tests.
