# 029 · Clearer planner decisions

Status: Done. Baseline: 0326a1b. Owner: lead plus scoped builder and independent reviewer.
Design: existing dispatcher Edit plan / View plan frames, tokens and responsive layout from specs 010, 023, 026 and 027. This is one grouped usability batch.

## Why and scope
Dispatchers need to see what remains for a partly planned shop, find Defer without opening an overflow menu, and understand that editing a sent plan withdraws it. Existing planner, permission, revision, save queue, undo and loading locks stay authoritative.

## Data and approach
Use existing PlanBoard orders and current draft trip/deferral assignments only. No schema, API, contract or dependencies. Summary counts must come from current draft so add/remove/defer/undo immediately update them. A split parent must not be counted as an extra active order. If counting split pieces, label them as parts rather than falsely claiming original-order totals. Never add quantities of unlike product units.

## Acceptance criteria
- U1: When a shop has some demand assigned and some still waiting, visible shop rows clearly state how many active orders (or explicitly labelled split parts) are on trips, waiting and deferred. Carried-over orders remain included in that shop's day summary. Available shop rows in grouped and list views get consistent summaries; fully planned shops need not be added to the unplanned column.
- U2: When a draft changes through add/remove/defer/restore/undo, summary counts reflect the current assignments without double-counting or implying deferred goods are planned. Cover multiple orders, split pieces and carried-over demand in focused tests before implementing count logic.
- U3: When an order/shop/group can be deferred through the existing UI, a visible, keyboard-reachable Defer action opens the existing reason form without requiring the overflow menu. Preserve existing add, split/join, group deferral and undo semantics; do not duplicate conflicting controls. Deferred entries keep their actual reason and existing restore/edit actions.
- U4: When a sent plan is withdrawable, its action reads Withdraw plan and edit and nearby text explains that this takes the plan back from loaders/drivers until resent. Use the same existing unsend operation and error state. Draft Back to edit stays a navigation action. The busy label clearly says Withdrawing.
- U5: When loading has started or the server denies withdrawal, existing lock reason and rejection remain visible and withdrawal cannot bypass the lock. Preserve account/depot/day stale-response guards and save sequencing.
- U6: At desktop and narrow widths the added summary/actions wrap without hiding actions or overflowing rows. Reuse existing components and tokens. Update README design departures.

## Verification and delivery
One builder owns the joined frontend batch. Tests-first for count logic; focused render/regression checks for controls and locked/draft/sent states. Full web suite, workspace typecheck and production build, with full combined suite against wf_sub_integration (never live/browser DB). One independent review for the whole diff; reproduce and fix real findings, then recheck together. Local browser QA only, with exact coverage limits. Push a reviewable PR after checks. No merge or deployment: the deployed live-retest target must stay unchanged.

## Out of scope
New planning rules, replacing the planner, admin work, new notifications, automatic scenario application, broad redesign, or new persistence. Do not edit AI disclosure.
