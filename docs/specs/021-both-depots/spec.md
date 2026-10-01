# 021 · Both depots together

**Status:** Done  ·  **Owner:** Claude builders (T0 and T1, T2)  ·  **Design:** the depot switch in every Dispatcher
frame's top bar ("Peliyagoda · Kandy · Both") and the dashboard map card's "Map view" switch (`53:11540`). No frame
draws a Both screen, so Both reuses each page's frame for the two depots together.

## Why
Spec 020 made Peliyagoda and Kandy work in the switch and left Both greyed ("Both depots together come later"). Nabil
asked for Both to work too (1 Oct): one dispatcher looks after both depots, so he wants to see the whole day at once.
A plan, its send and its checks still belong to one depot, so Both is for watching and looking up. Planning still
picks one depot (D-96).

## What it does
- **The switch.** Pressing Both in the top bar, or on the map card's "Map view", puts every dispatcher page on both
  depots together. The line under Ruwan's name reads "Dispatcher · Both depots". Pressing Peliyagoda or Kandy goes back
  to one depot. Signing in still starts at the dispatcher's own depot.
- **Dashboard.** Each tile adds the two depots up:
  - need you;
  - stops delivered;
  - trucks out, out of all 60;
  - orders for Thursday;
  - fuel, as used over quota for both;
  - deferred.

  Needs you lists both depots' problems. Next run has one line per depot, each with its own View plan. Trucks out now
  lists both depots' trucks. Every problem and truck row says its depot. The map card draws the Both view from
  `FLEET_MAP`: both depots, their districts, their trucks on the road and every shop delivered. Its figures are 120
  stores and 60 vehicles.
- **Live day, Orders, History and Fleet.** Each shows Peliyagoda's part and then Kandy's, each under its depot's
  name, with the page's own layout. The page header's counts add the two up.
- **Problems.** Under Both, Ruwan answers any problem from either depot. The answer goes to the problem's own depot,
  and the loader or driver who raised it hears it as before. The bell counts both depots' open problems.
- **The plan board and View plan** say "A plan belongs to one depot. Pick the depot to plan:" with Peliyagoda and
  Kandy. Pressing one switches to it and opens its board. A View plan button on the dashboard under Both switches to
  that line's depot and opens its plan.

## Screen states

| State | What shows |
| --- | --- |
| Both chosen, from 1280 wide | "Peliyagoda · Kandy · Both" with Both filled; "Dispatcher · Both depots" under the name |
| Below 1280 wide | The map card's switch, with Both working, as for the two depots (spec 020) |
| Switching to or from Both | As spec 020: the pressed option shows chosen at once, and the page shows its loading state until the reads arrive |
| One depot's read fails under Both | That depot's part shows its own failed state with Try again; the other depot's part stays. The page never shows one depot's numbers as if they were both |
| Plan board or View plan under Both | The line and the two depot buttons, no board |
| Could not switch | As spec 020: the switch goes back and "Could not switch depots. Try again." |

## Rules, with worked examples
1. **Both adds up, never mixes.** On the seeded day before any plan, the tiles read as follows: orders for Thursday
   166 (Peliyagoda's 102 with its 4 carried over, plus Kandy's 64), trucks out 0 / 60, and fuel 6,945 / 29,260 L,
   which is 24%. Each row of Needs you, Trucks out, Live day, Orders, History and Fleet belongs to exactly one depot
   and says which.
2. **Planning is per depot.** Under Both, no plan route changes anything. The board asks for a depot, and a plan
   write sent with the session on Both is refused with 409 `pick_a_depot` and changes nothing. Kandy's draft and
   Peliyagoda's sent plan stay as they were.
3. **Answers go to the problem's depot.** Under Both, Ruwan answers Kasun's flag on VEH035 (Peliyagoda). The answer is
   saved on Peliyagoda's problem exactly as it would be with Peliyagoda chosen.
4. **Live updates from both.** Under Both, a change at either depot reaches Ruwan's open pages without a reload.
5. **Every request still names its scope (D-95).** A tab on Both names Both, and the server refuses it once the
   session has moved to one depot, and the reverse.

## Permissions
Only a dispatcher can choose Both. A dispatcher on Both reads and answers for both depots and plans neither. Every
other role keeps its own shop or depot, as in spec 020.

## Failure paths
- A switch to Both that fails goes back and says so, as in spec 020.
- One depot's read failing under Both shows that depot's part failed and keeps the other's (screen states above).
- A plan write, from any tab, while the session is on Both: 409 `pick_a_depot`, nothing changes, and the tab follows
  the session (D-95).

## Data in and out
- `PUT /api/v1/me/depot` also takes `{ depotId: 'Both' }`. It answers `Me` with `depotId: 'Both'`, and keeps the
  choice on the session (`sessions.all_depots`, migration `0011_both_depots`).
- On a session that is on Both, every dispatcher read names one depot with `?depot=Peliyagoda` or `?depot=Kandy`. On
  a session that is on one depot, a read may name only that depot, or none. A read on Both that names none, or names
  a depot that does not exist, is answered 400 `pick_a_depot` or `unknown_record`.
- Plan writes on Both: 409 `pick_a_depot`. A problem's answer on Both goes to the problem's own depot.
- The live stream on Both carries both depots' announcements.

## Acceptance criteria
- [x] AC-1 When a dispatcher puts `{ depotId: 'Both' }`, the system shall answer `Me` with `depotId: 'Both'` and keep
  it on the session. Peliyagoda or Kandy afterwards shall bring back one depot. A loader, driver, shop or admin shall
  get 403, as in spec 020.
- [x] AC-2 While the session is on Both, every dispatcher read (operations, problems, look-ups, photos) shall answer
  the depot its `?depot=` names. With none named, it shall answer 400 `pick_a_depot`. With a depot named on a session
  that is on the other depot, it shall answer 409 `depot_changed`.
- [x] AC-3 While the session is on Both, every plan write shall answer 409 `pick_a_depot` and change nothing. A
  problem's answer shall be saved on the problem's own depot.
- [x] AC-4 While the session is on Both, the live stream shall carry both depots' announcements.
- [x] AC-5 With Both chosen, the dashboard shall add the two depots up as rule 1 says. Every row shall say its depot,
  and the map card shall draw the Both view with 120 stores and 60 vehicles.
- [x] AC-6 With Both chosen, Live day, Orders, History and Fleet shall show Peliyagoda's part and then Kandy's, under
  their names, and the plan board and View plan shall ask for a depot.
- [x] AC-7 With Both chosen, one depot's failed read shall show only that depot's part as failed, and switching to or
  from Both shall follow spec 020's switching and failure states.
- [x] AC-8 The README's departures shall say what Both shows, and that planning picks one depot (D-96).

## Out of scope
A plan covering both depots, moving orders or trucks between depots, and a combined plan board.
