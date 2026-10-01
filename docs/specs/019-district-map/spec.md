# 019 · The dashboard's district map

**Status:** Done  ·  **Owner:** Claude builder  ·  **Design:** Dispatcher · Dashboard (`53:11540`), the map card
right of "Needs you" (Figma component "Fleet map · Warehouse", drawn by the design's `map-fleet-overview.js`)

## Why
The dashboard frame puts a map of the depot's districts beside "Needs you": where the trucks are heading and how
many shops each district has had delivered. We cut it to the README's departures ("No district map") when Live day
was built. Judges score fidelity to the design, and the map is the dashboard's most visible part. Nabil asked for it,
visually the same as the Figma file (1 Oct, D-92).

## What it does
Beside "Needs you", a card shows the dispatcher's depot on a schematic map of Sri Lanka's districts: the depot as a
small diamond, one line from it to each district it serves, an orange arrow for each truck on the road on its
district's line, a small "2" on a truck's second trip, and a list of how many shops in each district have had their
delivery today. It changes as the day does, with the rest of the dashboard.

The design drew a replay of February's records; the app draws the live day (D-92). The design's numbers become:

| Design | App |
| --- | --- |
| "Replay · 07:30" | "Live · 07:30", the time of the dashboard's last read on the app clock |
| 75 stores | the depot's shops (75 for Peliyagoda) |
| 38 vehicles | `counts.vehiclesTotal`, the depot's fleet (38) |
| 21 routes | `counts.tripsTotal`, trips on today's plan |
| 12 active | `counts.vehiclesOut`, the same number as the "trucks out now" tile |
| Stores delivered, 29 of 75 | shops whose every stop today was delivered, per district, of all its shops |

## Screen states

| State | What shows |
| --- | --- |
| Normal | The card as the frame draws it (sizes, colours and positions from `map-fleet-overview.js`, the source of truth for this card): header "Live · 07:30", "Map view" and the view switch; "75 stores · 38 vehicles · 21 routes" and the "12 active" chip; the 340 x 280 map with the "Stores delivered" list beside it; the legend (Vehicle, Second trip, Warehouse, Shared route); "Schematic district routes · not GPS" with "© OpenStreetMap contributors" after it. |
| No plan yet, or nothing out | The same map with every line muted, no arrows, "0 active", and every district 0 of its shops. |
| Loading | A grey block the card's size, with the rest of the dashboard's skeleton. |
| Could not load | The dashboard's existing "Could not update" state covers it; the card keeps the last read it drew. |
| Kandy or Both pressed | Greyed like the top bar's depot switch, with "You plan Peliyagoda" on hover or press (D-32). |
| Below 1280 wide | The card goes under "Needs you" at full width; below 640 the "Stores delivered" list goes under the map. The map scales with the card and never scrolls sideways. |

## Rules, with worked examples
1. **Lines.** One line per district the depot has shops in, from the depot's diamond to the district's centre,
   exactly as the shapes module draws it. A line is orange when a truck on the road is going to that district, muted
   otherwise. At "Trucks leave, Thu 03:30" Dilshan's VEH035 is out to Colombo: Colombo's line is orange, the others
   muted.
2. **Arrows.** One arrow per trip on the road, on its district's line: alone at 55% of the line's length; two or more
   spread from 24% to 78%, ordered by vehicle id, as the design does. The arrow points along the line, away from the
   depot. A trip with `tripNo` 2 or more carries the small white "2" badge.
3. **Stores delivered.** A shop counts when it had at least one stop on today's plan and each of its stops counts on
   the "stops delivered" tile: goods were handed over, whether the stop ended `delivered` or `refused` in part
   (`stopCounts` in `apps/api/src/operations/figures.ts`). A drop refused in full and a closed shop do not count.
   Fresh Nugegoda and Fresh Wellawatte are in Colombo: after Dilshan delivers Nugegoda (one dry carton short) and
   Wellawatte refuses 2 of its chilled cartons, Colombo shows 2 of its 24 shops and the list's line reads "2 of 75
   stores". Shops with no stop today stay in the total. On a plan sent before the driver's piece, whose stop details
   were not recorded, the counts are unknown and the list shows a dash, as the tile does.
4. **Labels.** The served districts' names at the design's offsets from their centres, "Peliyagoda" by the depot,
   "INDIAN OCEAN" in the sea. No individual shop markers.
5. **The view switch** shows the dispatcher's depot chosen; the other two are greyed and say whose depot this is,
   as the top bar does (D-32). It never fetches another depot.

## Permissions
The dispatcher's dashboard only, from the existing operations read, which already checks the role and the depot.

## Failure paths
- The read fails: the dashboard's "Could not update" line, and the card keeps the last good read.
- A district with shops but no shape in the module (an outlet added in a new district): it is still listed under
  Stores delivered and has no line, and the build's test fails, so the shapes get regenerated (`docs/map-data.md`).

## Data in and out
`GET /api/v1/operations` (`OperationsDay`) gains `map: { shops, districts: [{ district, shops, shopsDelivered }] }`
for the depot's districts, from the same snapshot. Everything else the card needs is already in the read. The
shapes come from `apps/web/src/lib/map/fleet-map-shapes.ts` (`docs/map-data.md`).

## Acceptance criteria
- [x] AC-1 When the operations read is made, the system shall answer `map.districts` with each of the depot's
  districts, its active shops and the shops delivered by rule 3 (null when the plan's details were not recorded),
  and `map.shops` as their total, all from one snapshot.
- [x] AC-2 On the seeded day at "Trucks leave", the system shall answer 75 Peliyagoda shops in 7 districts (Colombo
  24, Galle 9, Gampaha 15, Kalutara 10, Kurunegala 8, Matara 6, Puttalam 3) and 0 delivered; after the walkthrough's
  Nugegoda delivery and Wellawatte's partial refusal, Colombo shall have 2 shops delivered; a drop refused in full
  shall not count.
- [x] AC-3 When the dashboard shows a read, the card shall show the header, the stats line and the chip from
  `counts` and `map` as the table above says.
- [x] AC-4 When trips are on the road, the system shall draw one arrow per trip on its district's line at the design's
  spacing, the "2" badge on later trips, and that line orange; every other line muted.
- [x] AC-5 The Stores delivered list shall list the depot's districts by name with "delivered/total" and a bar.
- [x] AC-6 When Kandy or Both is pressed, the system shall not change the map and shall say the dispatcher plans
  their own depot.
- [x] AC-7 At 1440 wide the card shall sit beside Needs you as in the frame; below 1280 under it; at 390 wide the
  page shall not scroll sideways.
- [x] AC-8 The card shall credit OpenStreetMap, and the README shall drop "No district map" from its departures and
  list this spec's differences.

## Out of scope
Kandy's or both depots' live map, hover details on districts and trucks, real road routes and GPS positions.
