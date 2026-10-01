# 026 · Crews: a truck and its driver picked as one, and trucks named by their drivers

**Status:** Ready  ·  **Owner:** Claude builder  ·  **Design:** Dispatcher · Edit plan (`66:48982`) and Edit plan ·
empty (`78:67860`). This spec departs from both on purpose: the "Unassigned trucks" panel goes.

## Why
Nabil, 1 Oct:
- "Calling the vehicle by the number feels very odd to me. It's confusing."
- "the user is not going to remember trucks by IDs and drivers can be remembered using names. Most of the time the same
  driver uses the same truck and most of the time the same truck goes on the same road".
- "if we remove the unassigned truck section, we can just increase the height of the unplanned order section so more
  of the orders are visible ... in the dropdown ... show information about the trucks and the driver while
  selecting".

## What it does
- **A crew is a truck with its driver.** Every truck has a usual driver: the driver who drove it on the depot's latest
  sent plan, or failing that the one the suggested plan gives it (D-97). Starting a trip, swapping a truck and changing
  a trip's driver all happen in one place, the crew picker, and picking a crew sets both the truck and the driver.
- **The crew picker.** It opens from:
  - a group's "Start a trip";
  - an order dropped in the middle (spec 023);
  - "Swap truck";
  - the driver's name in a trip's header.

  It is a dropdown of crews, each row reading "Chaminda · dry truck · 7.2 t · 38 m³", with what matters for these
  orders under it, such as "fits", "ran Galle last time", "fuel 62% left" or "cannot reach Tech Kadugannawa: van only".
  The order:
  1. crews whose truck fits the trip's orders (weight, volume, fridge, every shop reachable);
  2. then those that ran this district on the latest sent plan;
  3. then the most fuel left.

  A truck in the workshop, or already on its two trips, is listed at the end, greyed, with its reason ("in the
  workshop: brakes") and cannot be picked. A crew that does not fit stays pickable: the checker decides (spec 007),
  and the row says why it may not fit.
- **No trucks panel.** "Unassigned trucks" leaves the left column, and Unplanned orders takes its whole height. The
  header keeps "26 / 35 trucks". The empty middle's drop area reads "or drag an order here to start a trip".
- **Trucks named by their drivers in words.** Every sentence names a truck by its driver: "Chaminda's dry truck", or
  "the second trip of Chaminda's dry truck". That covers the checker's lines (spec 024), the planner's "why?" and
  notifications. A truck with no driver falls back to "the dry truck VEH044". Cards and headers keep the frame's
  "VEH044 · Chaminda", so the number is there to find in Fleet.

## Rules, with worked examples
1. **One pick sets both.** Ruwan presses "Start a trip" on Fresh · Galle · 4 and picks "Chaminda · reefer truck · 6.8 t
   · 33.4 m³". The trip opens on VEH006 with Chaminda, in one change of the draft, with one Undo.
2. **A crew stays together.** Picking a crew whose driver is on another truck moves the driver to this truck, and that
   truck's own trips are left with no driver. The picker says so before the press ("Chaminda drives VEH004 now; it
   will have no driver"). The checker marks the driverless trip as today.
3. **History decides the usual driver.** On the seeded day, VEH035's usual driver is Dilshan if he drove it on the
   latest sent Peliyagoda plan. Otherwise it is the one the suggestion gives it. Kandy has no earlier plan, so its
   usual drivers come from the suggestion.

## Acceptance criteria
- [ ] AC-1 When a trip is started, a truck swapped or a trip's driver changed, the system shall open the crew picker.
  It shall list crews by fit, then the district last run, then fuel. The workshop's and fully used trucks shall come
  last with their reasons and not be pickable. Picking one shall set the truck and the driver as one change of the
  draft.
- [ ] AC-2 The plan board shall show no "Unassigned trucks" panel. Unplanned orders shall take the left column's full
  height, and the header shall keep the trucks count.
- [ ] AC-3 Every sentence the checker, the planner's "why?" and the notifications write shall name a truck by its
  driver ("Chaminda's dry truck"), or by kind and number when it has no driver.
- [ ] AC-4 The usual driver shall come from the latest sent plan, or else the suggestion's choice, pinned by tests on
  the seeded day.
- [ ] AC-5 The README's departures shall say the trucks panel is gone and why, and the walkthrough's plan board steps
  shall use the crew picker.

## Out of scope
Drivers' hours and rest, driver skills or licences, and a crew moving between depots.
