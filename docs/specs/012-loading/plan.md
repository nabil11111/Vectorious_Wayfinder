# 012 · Plan

## Data changes
One migration, `loading`, written by the lead in T0 once spec 010's is in.

| Table | Change | Why |
| --- | --- | --- |
| `trips` | Column `revision integer not null default 0`. | Two loaders can change one truck, so every loader write names the revision it saw (rule 10). |
| `trips` | Column `last_write_id uuid`, the id of the last loader write applied to the trip, made on the phone. | The same id again is a retry, answered as done. Only the last one is kept: an older write's retry already fails on the revision, so nothing counts twice. |
| `trips` | Column `ready_at timestamptz`, from the app clock. | "ready 02:36" (D-18). |
| `stops` | Column `loaded_at timestamptz`, from the app clock. Empty until the stop is loaded. | A stop is loaded whole (D-12, D-35). |
| `order_lines` | Column `loaded_qty integer`, with the check `loaded_qty between 0 and quantity`. Empty until the truck is ready. | Counts follow the goods (D-35). A4 and A5 add theirs beside it. |
| `issues` | New table: `id uuid` key, `kind issue_kind not null`, `reason text not null`, `status issue_status not null default 'open'`, `revision integer not null default 0`, `stop_id uuid not null` pointing at `stops` on delete cascade, `raised_by uuid not null` and `raised_at timestamptz not null`, `note text`, and `decision text`, `decided_by uuid` and `decided_at timestamptz`, empty while open. The check `issues_decided`: the three decision columns are set exactly when the status is `decided`. Index `issues_stop` on `stop_id`. | One problem record whoever raises it (D-36). `reason` and `decision` are text checked against their lists in the contracts, as `deferrals.code` is, because each kind brings its own. |
| `issue_lines` | New table: `issue_id uuid` pointing at `issues` on delete cascade, `order_line_id uuid` pointing at `order_lines` on delete cascade, and `counted integer not null` with the check `counted >= 0`. Key on both ids. | The lines a problem counts. For a loader's flag, `counted` is the good units at the dock. |

The enums `issue_kind` (`loading`) and `issue_status` (`open`, `decided`) come from the lists in the contracts, as
`trip_status` does. A4 adds its kinds with `alter type … add value`. A reset's truncate reaches both new tables through
`stops` and `order_lines` (spec 008). The seed does not change: the walkthrough makes the plan, and `kasun` exists.

## Contracts
The lead writes these into two new files, `packages/contracts/src/issues.ts` and `loading.ts`, both passed on by
`index.ts`. A time of day on screen comes from an instant: days are `YYYY-MM-DD` and moments ISO strings.

| Shape | What it holds |
| --- | --- |
| `ISSUE_KINDS`, `ISSUE_STATUSES`, `FLAG_REASONS`, `LOADING_DECISIONS` | `['loading']`, `['open', 'decided']`, `['short', 'damaged', 'wrong_item', 'wont_fit']` and `['go_short', 'load_all']`, with their Zod enums. `wont_fit` is a truck that cannot take it all, counted by what fits. |
| `IssueLine` | `lineId`, `orderId`, `temp`, `productId`, `name`, `unit`, `quantity` and `counted`. |
| `Issue` | `id`, `revision`, `kind`, `reason`, `status`, `raisedBy` (a name), `raisedAt`, `note` or null, `decision`, `decidedBy` (a name) and `decidedAt`, each null while open, `short` (the units the lines are short), `trip` (`id`, `vehicleId`, `tripNo`, `leavesAt`), `stop` (`id`, `seq`, `outletId`, `shopName`) and `lines`. |
| `IssueList`, `DecideIssueRequest`, `DecideIssueResponse` | The list: `day` (the loader's day, or null) and `issues`. The answer: `revision` and `decision`. Its response: the list with `decided`, the problem just answered. |
| `LoadingLine` | `lineId`, `orderId`, `temp`, `productId`, `name`, `unit`, `quantity`, `going` (rule 5) and `short`. |
| `LoadingStop` | `id`, `seq`, `outletId`, `shopName`, `loaded`, `units`, `going`, `short` and `lines`, chilled before dry, then the order placed first, then the product list's order. |
| `LoadingTruck` | `tripId`, `revision`, `vehicleId`, `vehicleType` (`truck`, `van`), `vehicleTemp` (`reefer`, `ambient`), `tripNo`, `brand` or null when the trip mixes brands, `district`, `status` (`planned`, `loading`, `ready`), `leavesAt`, `readyAt` or null, `driver` (a name) or null, `weightCapKg`, `volumeCapM3`, `units`, `on` (`units`, `kg`, `m3`), `short`, `stops` (last stop first), `issues` (the open ones first, then the answered ones, latest first) and `outOn`: the vehicle's earlier trip that is `out`, as `tripNo` and `backBy` (its kept check's return), or null. |
| `LoadingDay` | `depot`, `day` (the loader's day, or null), `plan` (`id`, `revision`) or null when that day has no sent plan, and `trucks` in the order of rule 2. |
| `StartLoadingRequest`, `StopLoadedRequest`, `RaiseFlagRequest`, `MarkReadyRequest` | Each has `writeId` (a UUID made on the phone) and `revision` (the trip's). The start adds `plan` (`id`, `revision`). Stop loaded adds `stopId`. The flag adds `stopId`, `reason`, `lines` (1 to 20 of `lineId` and `counted`, 0 to 999, each `lineId` once) and `note` (trimmed, up to 200, may be empty). |

New error codes, each with a sentence the screens show as it is:

| Code | Status | Details | For example |
| --- | --- | --- | --- |
| `plan_changed` | 409 | none | "The plan for Thu 25 Jun changed after this screen loaded it." |
| `not_loading` | 409 | `TripDetails` (spec 010) | "VEH035 is not being loaded." |
| `load_order` | 409 | `stopSeq`, the stop to load first, or to take off first | "Load stop 2 first. The last stop goes in first.", or "Undo stop 1 first. The last stop loaded comes off first." |
| `already_flagged` | 409 | `lineId` | "The 4 dry cartons for Fresh Nugegoda are already flagged." |
| `stops_left` | 409 | `stopSeqs` | "Stop 1 is not loaded yet." |
| `flag_open` | 409 | `issueIds` | "The dispatcher has not answered the flag on VEH035 yet." |

Codes of spec 010 used again: `no_depot` 403, `unknown_record` 400 with `id` ("That truck is not on this depot's
list."), `day_moved` 409 with `date`, the loader's day now ("Loading has moved on to Fri 26 Jun."), `no_plan_day` 409
when there is no loader's day at all ("No delivery day is left."), `stale` 409
("VEH035 changed on another screen." or "This problem was already answered.") and `invalid_input` 400.

## How it works
| File | What it holds |
| --- | --- |
| `apps/api/src/loading/loader-day.ts` | `loaderDay(today, minutesNow, operatingDays)`: rule 1 on plain values, with `CUTOFF_MINUTES` from `orders/orderable-day.ts`. |
| `apps/api/src/loading/going.ts` | `goingOf(quantity, flag)`: rule 5 on plain values. |
| `apps/api/src/loading/day.ts` | `loadingDayOf(tx, depotId, at)`, which the GET and every loader write answer with. |
| `apps/api/src/loading/writes.ts` | `startLoading`, `markStopLoaded`, `undoStopLoaded`, `raiseFlag` and `markReady`, and `openTrip`, the steps they share. |
| `apps/api/src/issues/read.ts`, `issues/decide.ts` | `issuesOf(tx, where)`, a problem with its truck, stop and people, for the loading day and for the dispatcher. `listIssues` and `decideIssue`. |
| `apps/api/src/lib/day-lock.ts` | `lockDay(tx)` and `lockDepotDay(tx, depotId)`: step 1 of spec 010's writes, moved here by the lead in T0 so both pieces take the same locks in the same order. Each answers the clock instant read from the locked `demo_day` row. |
| `apps/api/src/routes/loading.ts`, `routes/issues.ts` | The routes behind `requireRole('loader')` or `requireRole('dispatcher')` and the depot check. The lead mounts them as `/loading` and `/issues`. |
| `apps/web/src/features/loader/` | `LoaderHome` (the routes `/loader`, `/loader/trucks/:tripId` and `/loader/trucks/:tripId/flag`, so `app/router.tsx` does not change), `TrucksPage`, `TruckPage`, `FlagPage`, `loading.ts` (the query and the writes), `ticks.ts`, `words.ts` and `parts/`. |
| `apps/web/src/features/live/` | `LiveDayPage`, `NeedsYou`, `IssueCard` and `issues.ts` (the query and the answer). |
| `apps/web/src/features/live/Bell.tsx` | The design's bell with its red count, which `DispatcherHome` passes to the shell's `bell` slot (T0) in place of the plain one. |

**Reading**, in one read-only snapshot (`snapshot` from `orders/store-orders.ts`). The snapshot first takes the
`orders` table's lock in access share mode: a reset truncates `orders` first, so a read and a reset queue one behind
the other instead of deadlocking over the other tables (added at spec 010's join, with its test). `GET /loading`:
1. The loader's day from the app clock and the operating days (rule 1). None gives `day: null`.
2. The caller's depot's plan for that day, if it is `published`. Otherwise `plan: null` and no trucks.
3. Its trips that are `planned`, `loading` or `ready`, each with its vehicle, driver, stops, the stops' orders and lines
   with their products and shops, and its problems (`issuesOf`).
4. Each line's count going out (`goingOf`), then per stop and truck the units, going, on and short, and the load on
   the truck from `computeLoad` over the loaded stops' lines at their counts, leaving out any line at 0.
5. Each trip's leaving time from its plan's `sent_check`: the `times.leaveAt` of its vehicle and trip number, as an
   instant on the plan's day.

`GET /issues` answers the depot's open problems (`issuesOf`), oldest first, and the loader's day for the title.

**Every loader write**, in one transaction:
1. `lockDay`: in demo mode the `demo_day` row `for share`, and the clock instant from that locked row. A start takes
   `lockDepotDay` instead, which then locks the depot's row `for no key update`, the order spec 010's writes use, so a
   start and an unsend queue one behind the other (D-33). A reset locks `demo_day` `for update` first, so a write and a
   reset take turns and never deadlock.
2. Read the trip with its plan and lock the trip's row `for update`. A trip that is not the caller's depot's is
   `unknown_record`.
3. A `writeId` equal to the trip's `last_write_id` is a retry: answer the loading day and change nothing.
4. The write's own checks below, then its work. Set `last_write_id`, raise the trip's revision, write the audit row,
   answer `loadingDayOf` from inside the transaction, and announce after the commit.

- **Start.** The trip's plan must be the one named, `published`, at the named revision (`plan_changed`), and on the
  loader's day (`day_moved`, or `no_plan_day` when there is none). The trip must be `planned` at the named revision (`stale`). It becomes `loading`. Audit
  `trip.loading_started`. Announce `loading` and `plans` to the depot.
- **Stop loaded.** The trip must be `loading` (`not_loading`) at the named revision (`stale`). The stop must be the
  trip's (`unknown_record`) and not loaded (`stale`), and every stop with a higher number loaded (`load_order`, naming
  the highest one that is not). `loaded_at` is the clock instant. Audit `stop.loaded`. Announce `loading`.
- **Undo a stop** (`/undo-stop`, the stop-loaded request). The trip must be `loading` at the named revision, the stop
  the trip's and loaded (`stale`), and no stop with a lower number loaded (`load_order`, naming the lowest). `loaded_at`
  goes back to empty, and the stop's lines and flags stay. Audit `stop.load_undone`. Announce `loading`.
- **Flag.** The trip must be `loading` at the named revision, and the stop the trip's. Every line named must be on an
  order of that stop (`unknown_record`), on no other loading problem (`already_flagged`), and counted from 0 to one
  below its quantity (`invalid_input`). Insert the problem, kind `loading`, raised by the caller at the clock instant,
  and its lines. Audit `issue.raised`. Announce `loading` and `issues`.
- **Ready.** The trip must be `loading` at the named revision, every stop loaded (`stops_left`, naming the others) and
  no problem of it open (`flag_open`, naming them). Write each line's `loaded_qty` from `goingOf`, each order `loaded`
  with its revision up (all are `planned`, as the send left them), and the trip `ready` with `ready_at`. Audit
  `trip.ready` with the counts. Announce `loading` to the depot, and `orders` to each shop on the truck with its depot,
  as a shop's place does.

**The answer**, in one transaction. `lockDay` and its clock instant, then the problem's row `for update` with its stop,
trip and plan. Another depot's problem is `unknown_record`, and a revision not the problem's or a status not `open` is
`stale`. Write the decision, `decided_by`, `decided_at` and the revision up. Audit `issue.decided`. Answer the open list
with the decided problem, and announce `issues` and `loading` to the depot. It locks no trip, because it changes no
column of the trip: a ready reads the problems under the trip's lock, so it sees the answer whole or not at all.

**The screen.**
- `/loader` and its pages read `GET /loading` under `['loading']`, and a page finds its truck in it by id. Every write
  answers the loading day, which the tests read, but the screen never puts that answer in the query: after a write it
  fetches `['loading']` again. An answer can arrive after a newer fetch (another tablet's write, a reset), and
  installing it would bring back an older truck. The live stream fetches it again on `loading`, and a `clock` or
  `demo` message fetches everything (spec 008).
- A write's id is made when the button is pressed, as a v4 UUID from `crypto.getRandomValues`, and kept until an answer
  comes, so "Try again" sends the same body. Only a write with no answer, a 5xx or a 429 is tried again, and only when
  the loader taps. A refusal shows its sentence, drops the write and fetches again. One write at a time on a screen,
  so its buttons wait while one is out.
- `ticks.ts` keeps the tick boxes in memory for the tab, by trip and line. The flag form keeps its picked line, reason,
  counts and note in the page, so a refusal or a fetch leaves them.
- `/dispatcher/live` reads `GET /issues` under `['issues']`, and so does the bell for a dispatcher. After an answer
  the screen fetches `['issues']` again, for the same reason, and keeps only the decided problem from the answer for the
  green line.

**Words**, in `features/loader/words.ts`, which may use the formats of `features/plan/words.ts` and
`features/store/words.ts`, and which Live day imports for the problem's words:
- Vehicles as spec 010 says them: "reefer", "dry", "van reefer", "van". Units of a truck in its brand's word, "cartons",
  "boxes" or "items", and "units" when the trip mixes brands. A line: "12 cartons chilled" for Fresh, and "10 boxes ·
  Folded clothing" or "2 pallets of 8 · Televisions" with the item's name for Style and Tech.
- "leaves 04:36", "in 42 min", "in 2 h 6 min" and "12 min late", from `leavesAt` and the app clock on screen. The load
  figure "165 / 1,040 kg · 0.9 / 7.0 m³" for a vehicle under 2 t, and "4.5 / 6.8 t · 21.0 / 33.4 m³" for a truck: the
  weight rounded down and never at the limit's figure while weight is free, at or over the limit the limit's own
  figure ("4.0 / 4.0 t" for a full 3,990 kg truck), and the cubic metres to one decimal.
- A problem's title by reason: "1 dry carton short", "2 chilled cartons damaged", "1 dry carton was the wrong item",
  "4 chilled cartons won't fit", and "3 items short" when its lines differ.
- The loader's answer line: "Ruwan, dispatcher · 02:35", then "Go with 1 dry carton short for Fresh Nugegoda." or
  "Load it all for Fresh Nugegoda. The rest comes from stock.", and for won't fit "Go without the 4 chilled cartons
  that won't fit for Fresh Mahaiyawa." or "Load it all for Fresh Mahaiyawa. Make room for the rest." The dispatcher's
  sent line: "VEH035 goes 1 dry carton short, Kasun told", "VEH057 goes without the 4 chilled cartons that won't fit,
  Sarath told" or "VEH035 loads it all, Kasun told".
- Ready: "23 of 24 on · 1 short, dispatcher told 02:35 · leaves 04:36", and "Dilshan sees the short carton on stop 1
  before driving.", "The driver sees …" with no driver, and "cartons" and "stops 1 and 2" when there are more.
- Icons from the design, in `assets/icons/`: the reefer lorry, lorry, van, chilled and dry goods pictures, the
  dispatcher's picture and the bell. The tick of a ready truck and of a loaded stop is the outline set's, as the design
  draws a plain tick there.

## Changes to other specs
- **Spec 010.** Its send and unsend also announce `loading` to the depot, so the loader's list follows the plan (T1,
  in `plans/send.ts`). Step 1 of its writes moves unchanged into `lib/day-lock.ts` (T0). Its AC-30 keeps the database
  set trip; this spec's AC-9 and AC-10 test the real start against the unsend.
- **The map.** The A3 row points here.

## Risks
- A3 builds on spec 010's send, its kept check and its locks. T0 starts once 010 is merged and follows the code as it
  landed, not this plan, where the two differ.
- Two tablets on one truck will sometimes see `stale`. The live stream keeps it rare, and the screen says what happened.
- `crypto.randomUUID` needs HTTPS or localhost, and a phone on a plain `http://` address during development would fail,
  so the id comes from `crypto.getRandomValues`, which works everywhere.
- Every loader write answers the whole day, about 50 KB for a full one. That is fine for one depot and one process
  (D-01).
- Live day's column will sit inside A7's page. A7 keeps `NeedsYou` and `['issues']` as they are and builds around them.

## Test plan
| Criteria | Kind | Where |
| --- | --- | --- |
| AC-1, AC-8 | Unit | `apps/api/src/loading/loader-day.test.ts`, `loading/going.test.ts` |
| AC-2 to AC-6 | Integration | `apps/api/tests/loading-read.test.ts` |
| AC-7, AC-9 to AC-13 | Integration | `apps/api/tests/loading-start.test.ts` |
| AC-14 to AC-17, AC-22 to AC-24 | Integration | `apps/api/tests/loading-writes.test.ts` |
| AC-18 to AC-21 | Integration | `apps/api/tests/issues.test.ts` |
| AC-25 to AC-33 | Click-through in Nabil's Chrome at 390 wide and 1180 × 820 as `kasun` and 1440 × 900 as `ruwan`, two browsers for AC-28 to AC-30, and a read of the two feature folders for AC-32 and AC-33 | The lead, on the joined branch |

Integration tests run in the builder's own seeded database (AGENTS.md) and assert the seeded day's numbers. Each file
starts from the seeded day, puts it back at its end with spec 008's `clearDemoDay` and `seedDemoDay` in one transaction,
and lets the clock go. `apps/api/tests/loading-plan.ts` places Nadeesha's draft at Wed 15:30, sends the walkthrough's
plan at Wed 16:00 through the endpoints of specs 009 and 010 (VEH035 with OUT001's three orders on stop 1 and OUT002's
two on stop 2, driver `dilshan`), deferring every other order of the day with
`dispatcher_choice`, adds VEH004's trip when asked, and sets the clock to Thu 25 Jun 02:30. A file signs in once per
account.
