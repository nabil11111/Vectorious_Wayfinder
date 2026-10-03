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
