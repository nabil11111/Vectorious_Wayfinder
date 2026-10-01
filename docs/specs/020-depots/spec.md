# 020 · Every shop, both depots, and the dispatcher's depot switch

**Status:** Done  ·  **Owner:** Claude builders (T0 and T1, T2)  ·  **Design:** the depot switch in every Dispatcher
frame's top bar ("Peliyagoda · Kandy · Both") and the dashboard map card's "Map view" switch (`53:11540`)

## Why
Nabil wants the QA run to be "a real live test, with as much data as possible" (1 Oct): today only 3 of the 120 shops
can sign in, Kandy has one driver and no loader, the seeded day has no Kandy orders, and no dispatcher can plan Kandy
(D-32 kept each dispatcher on their own depot, and the only dispatcher is Peliyagoda's). He chose a working depot
switch with "Both" later (1 Oct). So every shop gets an account, Kandy gets its staff and its day, and Ruwan switches
between the two depots as the design's top bar shows (D-93, D-94).

## What it does
- **Accounts.** Every shop has a store manager: `S-001` Nadeesha (OUT001), `S-002` Ishara (OUT017) and `S-003` Tharindu
  (OUT064) stay as they are, and `S-004` to `S-120` are the other 117 shops in outlet order (OUT002 is S-004, OUT003 is
  S-005, and so on, skipping OUT017 and OUT064). Kandy gets one driver for each of its vehicles not in the workshop on
  Thursday (Prasanna stays `D-002`; the others are `D-037` onwards in vehicle order) and a loader, `L-002`. Everyone
  uses the demo PIN. `docs/accounts.md` lists every account with its staff ID, name and shop or depot.
- **Kandy's day.** The seeded day gains Thursday's orders from Kandy's 45 shops, by the same rules as Peliyagoda's
  (spec 008): every Fresh shop orders dry cartons and most order chilled ones, a Style shop orders unless its number is
  a multiple of 5, and Kandy's Tech shops each have one written-out order. All placed on Wednesday before 15:00. Kandy
  starts with no earlier plans and no orders that waited. Peliyagoda's day, and every number in the README walkthrough,
  is unchanged.
- **The depot switch.** In the top bar, a dispatcher presses Kandy and every page shows and acts on Kandy: the
  dashboard and its map, the plan board (with its suggested plan), Live day, Orders, History and Fleet. Pressing
  Peliyagoda switches back. "Both" stays greyed and says "Both depots together come later." The dashboard map card's
  "Map view" switch does the same, so a dispatcher on a narrow screen (where the top bar hides its switch) can switch
  too. Signing in starts at the dispatcher's own depot.

## Screen states

| State | What shows |
| --- | --- |
| Switch, from 1280 wide | "Peliyagoda · Kandy · Both" in the top bar, the chosen depot filled; Both greyed with its line on hover or press |
| Switching | The pressed depot shows chosen at once; the page shows its loading state until the new depot's read arrives |
| Could not switch | The switch goes back to the depot that was chosen and a line says "Could not switch depots. Try again." |
| Map card | Its switch shows the chosen depot and works the same; the map draws that depot's view from the shapes module |
| Below 1280 wide | The top bar hides its switch (as today); the dashboard map card's switch is the way to switch |

## Rules, with worked examples
1. **One depot at a time.** After Ruwan switches to Kandy, the plan board shows Kandy's unplanned Thursday orders and
   none of Peliyagoda's; "Build the suggested plan" plans Kandy's; Peliyagoda's 104 are untouched.
2. **The choice belongs to the session.** It lasts until Ruwan switches again or signs out; signing in again starts at
   Peliyagoda. A second tab of the same session follows the switch on its next read.
3. **Only a dispatcher switches,** and only to a depot that exists. A loader, driver, shop or admin asking is refused.
4. **Live updates follow the depot.** After the switch, Kandy's changes reach Ruwan's open pages and Peliyagoda's no
   longer do.
5. **Every account signs in.** S-047 signs in to its own shop and orders for it; L-002 loads Kandy's trucks; D-037
   drives a Kandy trip.

## Permissions
A dispatcher plans, answers and looks up the depot chosen on their session. Every other role keeps its own shop or
depot. This replaces D-32's "own depot only" (D-93).

## Failure paths
- The switch request fails: the switch goes back and says so (above); nothing else changes.
- A page open in another tab of the same session reads the newly chosen depot on its next read or live message.
- A tab that fell behind a switch made elsewhere (another tab, or a switch whose answer never arrived) never acts on
  the other depot: every dispatcher request names the depot its tab shows, the server refuses a mismatch with 409
  `depot_changed`, and the tab reads the session and takes its depot (D-95, added after the first merge).
- An install seeded before this spec: the seed adds the missing accounts and Kandy's orders on its next start, without
  touching existing accounts or Peliyagoda's records; "Reset the demo day" brings back both depots' day.

## Data in and out
- `PUT /api/v1/me/depot` takes `{ depotId }` and answers `Me` with the chosen depot as `depotId`. 403 for any role but
  dispatcher, 400 for an unknown depot.
- `sessions.depot_id` (nullable: the user's own depot until switched), migration `0010_depot_switch`.
- The session middleware gives a dispatcher's requests the session's depot; every existing route keeps reading the
  caller's depot as it does today.
- Every dispatcher request from the web app carries `x-wayfinder-depot`, the depot its tab shows; a mismatch with the
  session's depot is answered 409 `depot_changed` before the route runs (D-95).

## Acceptance criteria
- [x] AC-1 When the seed runs, the system shall give every one of the 120 shops exactly one store manager with the
  staff IDs above, Kandy one driver per vehicle not in the workshop on Thursday and loader L-002, all on the demo PIN,
  and `docs/accounts.md` shall list the same accounts.
- [x] AC-2 When the seed runs, Kandy's shops shall have Thursday orders by the rules above, with totals pinned by a
  test, and every Peliyagoda total pinned before this spec shall be unchanged.
- [x] AC-3 When a dispatcher puts `{ depotId: 'Kandy' }`, the system shall answer their `Me` with Kandy, and every
  dispatcher read and write on that session (plan board, suggested plan, send, answers, operations, look-ups) shall use
  Kandy until switched back or signed out; a new sign-in starts at their own depot.
- [x] AC-4 When a loader, driver, shop or admin asks to switch, the system shall answer 403; an unknown depot 400.
- [x] AC-5 After a switch, the dispatcher's live stream shall carry the chosen depot's announcements and not the
  other's.
- [x] AC-6 When the dispatcher presses Kandy in the top bar or on the map card, the system shall switch, read every
  open dispatcher page again for Kandy without showing Peliyagoda's data under Kandy's name, and draw the map's Kandy
  view; Both shall stay greyed with its line; a failed switch shall go back and say so.
- [x] AC-7 A store manager, the Kandy loader and a Kandy driver created by this spec shall sign in and reach their
  home pages with their own shop or depot.
- [x] AC-8 The README shall describe the accounts (pointing to `docs/accounts.md`), Kandy's day and the switch, and
  drop the greyed-switch departures.

## Out of scope
"Both" views, a Kandy dispatcher account, and earlier days' plans or waited orders for Kandy.
