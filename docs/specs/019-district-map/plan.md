# 019 · Plan

> Build record: this describes the original implementation sequence. See the [spec guide](../README.md)
> for current status and the later specs that supersede parts of this work.

## Data changes
None. The read uses `outlets` (the depot's active shops by district) and the current plan's stops it already reads.

## Contracts
`OperationsDay.map = { shops: Count, districts: [{ district: string, shops: Count, shopsDelivered: Count | null }] }`,
districts ordered by name. No new error codes.

## How it works
**Server** (`apps/api/src/operations/`). In the same snapshot, count the depot's active shops per district, and per
shop decide rule 3 from the current plan's recorded stops with the same per-stop test `stopCounts` uses (goods handed
over: outcome `delivered` or `refused` with something delivered), so the tile and the map can never disagree. Pull
that per-stop test out into one function both use. Unknown (a trip without recorded detail) makes every
`shopsDelivered` null, as `stopsDelivered` is.

**Shapes.** `apps/web/src/lib/map/fleet-map-shapes.ts` and `geometry.ts` (`docs/map-data.md`): the 340 x 280 frame of
each view with district outlines, centres, the depot anchors and one connection per depot and district.

**Screens** (`apps/web/src/features/dispatcher/`). A `FleetMap` card ported from the design's
`~/Documents/tech-triathlon-ops/tools/figma-runner/scripts/hifi/map-fleet-overview.js`, which is the source of truth
for its sizes, colours, offsets and text: header, view switch, stats and chip, the SVG map (sea, districts, white
borders, labels and endpoints, lines, arrows with their spacing and rotation, the "2" badges, the depot diamond and
label, "INDIAN OCEAN"), the Stores delivered list and the legend. The card is drawn in the frame's 520-wide
coordinates inside an SVG or a fixed-ratio box that scales to its column. The view switch reuses the top bar's
`DepotSwitch` behaviour (D-32). `DashboardPage` places it beside Needs you from 1280 wide, as the frame does, and
under it below that.

## Risks
- Drift from the frame: the card is checked side by side with `dispatcher-dashboard--53-11540.png` at 1440 wide.
- The tile and the map disagreeing on "delivered": one shared per-stop test.
- A new district from an added outlet has no shape: the shapes test fails and `docs/map-data.md` says how to
  regenerate.

## Test plan
- AC-1 and AC-2: integration tests on the seeded day (`apps/api/tests/operations-map.test.ts`), walking the day as
  `operations-events.test.ts` does.
- AC-3 to AC-6: web unit tests of the card's numbers, arrows (count, spacing, badges), line colours and the list.
- AC-7 and AC-8: Chrome at 1440, 1100 and 390 wide next to the frame, and review.
