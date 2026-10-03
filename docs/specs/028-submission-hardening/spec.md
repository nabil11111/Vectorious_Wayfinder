# 028 · Submission hardening and clearer handoffs

Status: building. Baseline: 1f41125. This spec groups related changes for one independent review per batch,
not per individual fix. Existing specs and design tokens apply except for the explicit changes here.

## Scope and priorities

Fix the observed proof/quantity/dispatch failures, improve the principal screens, then add receiving readiness.
Do not treat draft warnings as publication failures without reproducing Send. Daily route budgets stay advisory,
and the demo may still record fast departures/arrivals. No fake elapsed travel time or timer waiting in real time.
No admin expansion, Datathon integration, new routing service, or new driver problem workflow.

## A · Evidence and quantity consistency

- A1: A dispatcher authorized for a trip can open its driver proof and shop report image in History after reload,
  including Both-depot view. Unauthenticated/wrong-role/wrong-depot requests still fail. Fix the actual retrieval
  path rather than weakening permissions. Photo UI must release obsolete object URLs and not show stale images.
- A2: Shop Today includes all eligible placed replacement orders for the next orderable day, consistent with
  Orders. Do not duplicate split/replacement quantities or show another outlet's records.
- A3: A historical ready notification describes the quantity loaded at ready time. Later refused/closed/delivered
  quantities do not become a depot shortage. Prefer existing immutable loading facts over a new schema.
- A4: Add focused regression tests for reproduced bugs first. Do not claim physical-camera testing from uploads.

## B · Dispatch and trip lifecycle

- B1: A draft may have no driver; Send must reject each trip whose vehicle has no assigned driver, with an
  actionable message. This supersedes D-31/D-97 only at publication. Server must enforce it even for direct calls.
- B2: For a vehicle's second trip, loader start/count/ready operations are refused until the earlier trip is done.
  Staging is not called physically loaded. Preserve idempotent retry and atomicity under concurrent requests.
- B3: Second-trip departure requires first return plus the configured reload interval on the application clock,
  and its own ready state. Reject old premature readiness too; UI explains the next permitted action/time.
  Loading can occur after return during that interval. First-trip early departure remains supported in the demo.
- B4: Validate publication checks for weight, volume, fridge, access, windows and fuel; only fix a demonstrated
  failure. Keep valid boundary plans legal. Tail lift and 270/480-minute budgets retain their documented policy.
- B5: Use tests-first for lifecycle changes, including direct requests, retry, out-of-order actions and vehicle
  reassignment where relevant. Update affected fixtures honestly; do not loosen meaningful expectations.

## C · Visible workflow and readability

- C1: History Open shows a clear, accessible trip detail dialog/panel, full width on narrow screens, with summary
  quantities, existing proof entry points and a legible timeline. Restore trigger focus on close; Escape works.
  Show planned departure and distinguish actual times, keep timeline labels aligned. Never invent event data.
- C2: History summary cards and rows have clear hierarchy, hover and keyboard focus; existing filters remain.
- C3: Dashboard separates actionable items from watching items and bounds the displayed list with explicit
  Show more/View all. Counts match their labels; every actionable item remains reachable.
- C4: Before plan cutoff, show current received demand and time until closing plus View orders using existing
  authorized data. Planning remains locked. Day/depot changes and errors must not show stale totals.
- C5: Wayfinder logo navigates to the current role's home. Use existing routing and accessible links.
- C6: Driver unloading has an explicit per-line All unloaded control setting the actually loaded quantity.
  Nothing is pre-confirmed on entry, partial entry/refusal remains usable, and offline action semantics stay intact.
- C7: Receipt quantity entry retains product units (cartons, boxes, pallets/crates and pack size when known).
- C8: Reuse design tokens and existing components. Update README departures when changing submitted design.

## D · Preserve input and honest connection feedback

- D1: Dirty loader problem and shop receipt forms warn before discarding via in-app navigation/Back, or preserve
  their complete draft including quantity/reasons/cold answer/note/photo. Do not silently reset to full/cold Yes.
  Sign-out must not leak saved input to another account. A discard confirmation is preferable to broad persistence.
- D2: Offline/queued/server-confirmed labels reflect the actual queue and known connectivity. Do not say sent
  until acknowledged. Preserve already-working retry/reload/identity separation and test regressions.
- D3: Reproduce reported sign-out hang and old-trip flash before changing code; record non-reproductions honestly.

## E · Shop ready to receive (shared schema/contracts supplied by lead)

- E1: Store manager may set Not confirmed / Ready to receive / Temporarily unavailable for their own delivery
  day, with a short optional receiving note. Use app clock and explicit day; no automatic yesterday carryover.
- E2: Assigned driver and authorized dispatcher see that day-scoped status, note and updated time. An unknown
  or failed read is not Closed. Driver cached/offline view says last known and retains its timestamp.
- E3: Status changes announce through existing live channels. Notify only relevant recipients; do not claim
  a person saw it without an actual acknowledgement. Existing notification system is preferred.
- E4: Status is advisory. It does not block departure, arrival, delivery or shop receipt or override windows.
- E5: Use existing role/depot/outlet checks, revision checks and reset/session rules. Independent outlets/days
  cannot overwrite one another. Tests cover authorization, day rollover, clear/reset and stale writes.

## F · Bounded what-if comparison (after feasibility check)

- F1: Dispatcher previews the same eligible snapshot with and without one selected vehicle. Read-only scenarios
  never change orders, splits, assignments, fuel usage or the saved plan. Only before publication/loading.
- F2: Display changes in served/deferred original orders and shops, fuel and vehicles, with actual planner reasons.
  Attribute split parts back to original orders; never sum cartons and pallets as meaningful capacity.
- F3: Both scenarios use the same inputs/policy/seed snapshot except the excluded vehicle. Label baseline as a
  generated baseline if it differs from the manually edited plan. Show checked feasibility and errors honestly.
- F4: No Apply, in-flight rerouting, optimality claims, invented forecasts, or new AI dependency in this scope.
- F5: Reuse the existing planner/checker and enforce dispatcher/depot access. Abort or invalidate changed-snapshot
  results. Timebox proof of feasibility before committing to building the UI.

## Verification and release

Business-rule regression tests are committed before implementation. Each builder runs focused checks; integration
runs typecheck, full API/web tests against its own disposable DB, build, lint and migration-drift check.
One independent review covers the joined A–D batch; another covers E–F, with corrections rechecked in batches.
An independent GPT-6.1 Sol low-reasoning agent uses the built-in browser against a dedicated local QA database,
phone and desktop viewports. Browser tests must not reseed the test runner DB or the shared Railway instance.
No browser capability is assumed: offline/camera/network tests not supported by the tool are explicitly unverified.
PRs and branches may be pushed, but main merge/deploy wait for Nabil. Leave AI disclosure untouched until finalization.
