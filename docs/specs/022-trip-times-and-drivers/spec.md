# 022 · The trip's depot times, each stop's times on hover, and every trip's driver

> Current scope: Submission hardening supersedes optional driver assignment at publication: a draft can omit a driver, but Send cannot.

**Status:** Done  ·  **Owner:** Claude builder  ·  **Design:** Dispatcher · Edit plan (`66:48982`): the open trip's
timeline in the middle column, and Done's trip cards on the right ("VEH004 · Ruwan · Fresh · Colombo").

## Why
Nabil, 1 Oct, on the plan board:
- "the middle section has to show, on the timeline, the warehouse leaving time and warehouse return time. When I hover
  over the dots in that progress bar, it needs to show which store's estimated arrival time and leaving time ... like
  a tooltip ... just basic information".
- "on the right side under Planned Trips, show the driver's name after the vehicle".

Today the timeline runs from the leaving time to the last stop and its dots say nothing. Done's cards show a driver
only when the dispatcher picked one, and the suggested plan picks none, so a built plan reads "VEH039 ·" with no name.

## What it does
- **The depot on the timeline.** The open trip's line runs from the depot to the depot, from the minute it leaves to
  the minute it is back, using the checker's `leaveAt` and `backAt`. A small depot mark at each end carries its time:
  "Peliyagoda 03:30" at the start and "back 10:20" at the end, in the frame's mono type. The hour labels stretch to
  include the return.
- **A stop's details on its dot.** Each stop's dot is a button. Pointing at it, focusing it or tapping it shows a small
  tooltip with:
  - the stop number and shop: "Stop 3 · Fresh Karapitiya";
  - "arrives 06:35 · leaves 06:50", with any wait as "waits 15";
  - the shop's window: "window 03:00 to 08:00";
  - what is unloaded there: "12 cartons" or "3 items", as the stop list words it.

  A late stop's tooltip says "late" in the stop's red, with the minutes, as the stop list does. Nothing else goes in
  the tooltip.
- **Every trip names its driver.**
  - The suggested plan gives every vehicle it uses a driver. A vehicle keeps the driver the draft already had for it.
    Otherwise it gets the first free driver of its depot in staff ID order. A vehicle's second trip has the same driver
    (D-31).
  - Done's cards read "VEH004 · Chaminda", and a trip with no driver reads "VEH004 · no driver" in the warning colour.
    The open trip's header names its driver the same way.
  - In the driver menu, a driver already on another vehicle can still be chosen: the two vehicles swap drivers, on
    every trip of each, and the menu marks that driver "on VEH002 · swap".

## Rules, with worked examples
1. On the seeded day, Ruwan builds the suggested plan. Every one of the 26 trucks on it has a driver, and no driver is
   on two vehicles.
2. VEH035 got its driver from the suggestion. Ruwan chooses Dilshan for it in the menu. If Dilshan was on VEH001,
   VEH001 now has VEH035's old driver, and both changes save as one change of the draft (the README walkthrough's step
   5). Spec 026 replaced the swap with a move: VEH001 is left with no driver, and the menu says so before the press.
3. A trip that leaves 03:30, makes six stops and is back 10:20 shows "Peliyagoda 03:30" at the start of its line and
   "back 10:20" at the end. The line spans 03:00 to 11:00.
4. Pointing at Fresh Koggala's dot on a late trip shows "Stop 6 · Fresh Koggala", "arrives 08:05 · leaves 08:20",
   "window 05:30 to 08:00", "5 min late" in red, and its cartons.

## Acceptance criteria
- [x] AC-1 When a trip is open on Edit plan, its timeline shall run from its leaving time to its return time, with the
  depot's mark and time at each end.
- [x] AC-2 When a stop's dot is pointed at, focused or tapped, the system shall show that stop's number, shop, arrival
  and leaving times, any wait, its window, what is unloaded, and whether it is late. Each dot shall be reachable by
  keyboard and named for screen readers.
- [x] AC-3 When the suggested plan is built, the system shall give every vehicle on it a driver of its depot while the
  depot has a free one, keeping a vehicle's earlier driver, with no driver on two vehicles and the same driver on a
  vehicle's two trips. A truck left over when the drivers run out reads "no driver" in the warning colour (AC-4), as
  D-31 allows; the seeded depots have a driver for every working truck.
- [x] AC-4 Done's cards and the open trip's header shall name the driver after the vehicle, or say "no driver".
- [x] AC-5 Choosing in the driver menu a driver who is on another vehicle shall swap the two vehicles' drivers as one
  change of the draft.
- [x] AC-6 The README walkthrough's numbers and steps that these change shall say what the app now shows.

## Out of scope
Drivers' hours and rest, a driver's preferences, and moving a driver between depots.
