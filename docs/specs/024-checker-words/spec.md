# 024 · The plan checker in plain words

**Status:** Done  ·  **Owner:** Claude builder  ·  **Design:** the checks lines in Edit plan (`66:48982`), such as
"stop 6 Koggala arrives 08:05 · 5 min after close", and View plan's checks (`78:68956`)

## Why
Nabil, 1 Oct, of "VEH044 trip 1 stops at Tech Kadugannawa, which only a van can reach, and VEH044 is a truck.": "this
info doesn't seem to be understandable with the vehicle id". Every checker sentence starts "VEHxxx trip N". A
dispatcher reads an id and a trip number before learning what is wrong, and never learns what kind of vehicle VEH044
is.

## What it does
Every sentence the plan checker writes, a problem's `message` and its `fix`, follows five rules. The checks
themselves, their codes, levels, figures and suggested leaving times stay exactly as they are; only the words change.
1. **What is wrong comes first.** It names the shop, or the order, first when the problem is at a stop or about an
   order.
2. **A vehicle is named by its kind and id**, in the board's own words: "the reefer truck VEH001", "the dry truck
   VEH044", "the reefer van VEH035", "the van VEH036". The kind comes from the vehicle's type and temperature.
3. **A trip number only where it tells trips apart.** A vehicle's second trip is "its second trip". A vehicle with one
   trip gets no number.
4. **The fix says what to do,** in one short sentence, wherever the check knows one: "Move it to a van."
5. **Short sentences.** Times, kilos, cubic metres and minutes are written as now.

## Worked examples, before and after
| Code | Before | After (message · fix) |
| --- | --- | --- |
| van_only | VEH044 trip 1 stops at Tech Kadugannawa, which only a van can reach, and VEH044 is a truck. | Tech Kadugannawa only takes vans, and it is on the dry truck VEH044. · Move it to a van. |
| needs_reefer | VEH044 trip 1 carries the 276 kg chilled order for Fresh Nugegoda, and VEH044 is not a fridge vehicle. | The 276 kg chilled order for Fresh Nugegoda needs a fridge, and it is on the dry truck VEH044. · Move it to a reefer truck or van. |
| no_tail_lift | VEH036 trip 1 carries the 380 kg dry order for Tech Matara, which needs a tail lift, and VEH036 is a van without one. | The 380 kg dry order for Tech Matara needs a tail lift, and it is on the van VEH036; vans are taken to have no tail lift. · Move it to a truck, or check how the shop unloads it. |
| over_weight | VEH044 trip 1 carries 7,450 kg and its limit is 7,200 kg. | The dry truck VEH044 carries 7,450 kg, 250 kg over its 7,200 kg limit. · Take 250 kg off this trip. |
| mixed_brands | VEH012 trip 1 mixes shops of 2 brands, Fresh and Style. | The dry truck VEH012 has Fresh and Style shops on one trip. · Split them, or turn on Mix brands. |
| cross_district | VEH012 trip 1 has stops in 2 districts, Kandy and Matale, and a trip stays inside one district. | The dry truck VEH012 goes to Kandy and Matale on one trip, and a trip stays in one district. · Move the Matale stops to another trip. |
| window_missed | VEH006 trip 1 reaches Fresh Koggala at 08:05, 5 minutes after its delivery window closes at 08:00. | Fresh Koggala is reached at 08:05 by the reefer truck VEH006, 5 minutes after its window closes at 08:00. · (the fix as now) |
| long_wait | VEH006 trip 1 reaches Fresh Hikkaduwa at 05:15 and waits 15 minutes for its delivery window to open at 05:30. | Fresh Hikkaduwa is reached at 05:15 by the reefer truck VEH006 and waits 15 minutes for its window to open at 05:30. · (the fix as now) |
| trips_overlap | VEH001 trip 2 leaves at 07:00, before VEH001 is back from trip 1 and reloaded at 08:10. | The second trip of the reefer truck VEH001 leaves at 07:00, before it is back and reloaded at 08:10. · Leave at 08:10 or later. |
| over_time_budget | VEH006's Fresh trips take 410 minutes of driving and unloading, and their budget for the day is 360. | The reefer truck VEH006's Fresh trips take 410 minutes of driving and unloading, 50 over the day's 360. |

Every other code, including the checks for empty trips, repeated stops, orders on no trip or on two trips, the wrong
depot, too many trips, a vehicle not available, leaving early and the mall's hours, is rewritten by the same five
rules.

## Acceptance criteria
- [x] AC-1 Every message and fix the checker writes shall follow the five rules. A test shall pin the new sentence of
  each code, including both variants of the codes that have two.
- [x] AC-2 Every check shall keep its code, level, figures, flagged stop or order, and suggested leaving time. Every
  existing rule test shall keep its outcome, with only the expected words updated.
- [x] AC-3 Every place that quotes a checker sentence (the README walkthrough, the planner's reasons, web tests'
  fixtures that match words) shall read the new words.

## After the build
Trucks are also named by their drivers ("Chaminda's dry truck") where a trip has one, as spec 026 (D-100) asks,
and the planner's own short reasons follow the same five rules.

## Out of scope
New checks, changed limits, and the planner's own reasons for an order, which already lead with the order.
