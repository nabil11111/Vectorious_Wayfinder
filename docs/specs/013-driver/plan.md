# 013 · Plan

## Data changes
One migration, `driver`, written by the lead in T0 once spec 012 is merged, because A4 reads its loaded counts, its
problems and its locks.

| Table | Change | Why |
| --- | --- | --- |
| `issue_kind` | Values `refused` and `closed`, added with `alter type … add value` and not used in the migration, as Postgres requires. | The driver's two problems (D-36, D-48). |
| `stop_outcome` | New enum `delivered`, `refused`, `closed`, from `STOP_OUTCOMES` in the contracts. | How a stop ended. |
| `trips` | `left_at timestamptz` and `back_at timestamptz`, empty until the driver starts and ends the trip, and `last_event_at timestamptz`, the latest time kept on the trip, which nothing but a driver write moves. | "Left Peliyagoda 03:31", "Checked in at the depot 03:55" (D-18), and the lower bound of the time rule, which "Try again" must not move back (D-46). |
| `stops` | `revision integer not null default 0`, `retried_at timestamptz`, the app clock's time "Try again" last sent the stop back, and `arrived_at timestamptz`, `done_at timestamptz` and `outcome stop_outcome`, all empty until then. The check `stops_done`: `outcome` and `done_at` are empty together or set together, and set only once `arrived_at` is. | The driver and the dispatcher both change a stop, so a driver write names its revision (D-45). Stops sent back come after the others, in the order they were sent back (spec rule 4). "Nobody at the shop · since 03:45". |
| `order_lines` | `delivered_qty integer`, with the check `delivered_qty between 0 and loaded_qty`. Empty until its stop is delivered or refused, and emptied with `loaded_qty` when a closed shop's orders are brought back. | Counts follow the goods: what the shop took sits beside what went on the truck, and an order sent again starts clean. |
| `driver_writes` | New table: `id uuid` key, made on the phone, `driver_id uuid not null` pointing at `users`, `trip_id uuid not null` pointing at `trips` on delete cascade, `kind text not null`, `body_hash text not null`, the SHA-256 of the write as it was applied, and `answered_at timestamptz not null default now()`, when the server applied it or last answered a repeat of it, on the real clock like `created_at` and never shown (spec 008). Index `driver_writes_driver` on `driver_id` and `answered_at`. | Every driver write applied, bound to what it did, so the same write sent again is answered as done and an id reused for something else is refused. The account's writes answered in the last 48 hours are listed in its day whatever trips it shows, so a trip that left the day never strands its last write (D-45), and a repeat answered later is listed again, so a write older than that still leaves the phone. Real time, because the demo clock is moved and reset. |
| `photos` | New table: `id uuid` key, the write's id, `stop_id uuid not null` pointing at `stops` on delete cascade, `issue_id uuid` pointing at `issues` on delete cascade, `jpeg bytea not null` through Drizzle's `customType`, `taken_by uuid not null` pointing at `users`, and `taken_at timestamptz not null`. Unique `photos_issue` on `issue_id`, and unique `photos_proof` on `stop_id` where `issue_id` is null. | Photos live in the database (D-22, D-47). A problem's photo names its problem, so the loader's flag can use the table later. |

`stop_outcome` comes from the list in the contracts, as `trip_status` does. A reset's truncate reaches `driver_writes` and
`photos` through `trips`, `stops` and `issues` (spec 008). The seed does not change: the walkthroughs make the day.

## Contracts
The lead writes a new `packages/contracts/src/driver.ts`, passed on by `index.ts`, and changes `issues.ts` and
`loading.ts`. Days are `YYYY-MM-DD`, moments ISO strings and a time of day `HH:MM`.

| Shape | What it holds |
| --- | --- |
| `STOP_OUTCOMES`, `DRIVER_WRITE_KINDS` | `['delivered', 'refused', 'closed']` and `['start', 'arrive', 'deliver', 'refuse', 'closed', 'finish']`, with their Zod enums. |
| `DriverLine` | `lineId`, `orderId`, `temp`, `productId`, `name`, `unit`, `quantity`, `loaded` (null until the truck is ready) and `delivered` (null until the stop is delivered or refused). On a closed stop, `loaded` is what its problem counted on the truck and `delivered` is null, whatever later happens to the orders (spec rule 6). |
| `DriverStop` | `id`, `seq`, `revision`, `retriedAt` (null unless sent back), `outletId`, `shopName`, `district`, `dockType`, `windowOpen` and `windowClose` (the shop's window narrowed to its mall slot, as spec 007 times it), `note` (its orders' notes for the driver, in the order placed, or null), `arrivedAt`, `doneAt`, `outcome`, and `lines` in spec 012's order. |
| `DriverProblem` | `id`, `kind` (`refused`, `closed`), `stopId`, `reason`, `note` (null when empty), `raisedAt`, `hasPhoto`, `lines` (`lineId` and `counted`: the cartons refused, or those left on the truck), and `decision`, `decidedBy` (a name) and `decidedAt`, null while open. |
| `DriverTrip` | `tripId`, `revision`, `vehicleId`, `vehicleType`, `vehicleTemp`, `tripNo`, `brand` or null, `district`, `status` (`TripStatus`), `leavesAt` and `backBy` (instants from the plan's kept check), `readyAt`, `leftAt` and `backAt`, `stops` in plan order, and `problems`, oldest first. |
| `DriverDay` | `depot` (its name), `driver` (the caller's name), `day` (D-44) or null, `planSent`, `appliedWriteIds` (every driver write the account had applied in the last 48 hours, whatever trips the day shows), and `trips` in the order of spec rule 2. |
| `DriverWrite` | A union told apart by `kind`. Each has `writeId` (a UUID made on the phone), `tripId`, `at` (the app clock on the phone) and `revision`: the trip's for `start` and `finish`, the stop's for `arrive`, `deliver`, `refuse` and `closed`, which add `stopId`. `deliver` adds `photo`. `refuse` adds `reason` (`RefusalReason`), `lines` (1 to 20 of `lineId` and `refused`, 1 to 999, each line once), `note` (trimmed, up to 200, may be empty) and `photo`, which may be left out. `closed` adds `note` and `photo`, which may be left out. A photo is a data URL of a JPEG, `data:image/jpeg;base64,…`, at most 700,000 characters. |
| `applyDriverWrite(day, write)` | The day as the server answers once the write is applied, on plain values: what spec rules 3 to 7 set, with `at` as the time, the record's revision up by one, the write's id added to the day's `appliedWriteIds`, and for `refuse` and `closed` the problem raised, whose id is the write's. A write whose trip or stop is not in the day changes nothing. |
| `nextStop(trip)` | Spec rule 4: the first unfinished stop in plan order among those with no `retriedAt`, else the unfinished stop sent back earliest, by `retriedAt` and then plan order, else none. The server's `not_next` check and the phone both use it. |
| `tripFigures(trip)` | The numbers of spec rules 9 and 12, from the stops' lines: stops done and stops, units ordered, loaded and delivered, per stop the units refused, not delivered and short from the depot, per stop what is still on the truck after the answers (a refusal's counted cartons, and a closed shop's loaded cartons unless it was tried again), and the next stop. A closed stop's lines already carry that attempt's counts, so the counts add up after a bring-back too. |
| `phoneView(day, writes)` | The writes the day does not list as applied, in order, and the day with them applied by `applyDriverWrite`: what the phone shows and what it still has to send (D-50). |

In `issues.ts` and `loading.ts`:

| Shape | Change |
| --- | --- |
| Kinds, reasons, answers | `ISSUE_KINDS` gains `refused` and `closed`. `REFUSAL_REASONS` (`damaged`, `expired`, `not_ordered`) and `CLOSED_REASONS` (`nobody_there`) join `FLAG_REASONS` in `IssueReason`. `REFUSAL_DECISIONS` (`bring_back`) and `CLOSED_DECISIONS` (`try_again`, `bring_back`) join `LOADING_DECISIONS` in `IssueDecision`, and `DECISIONS_BY_KIND` says which answers fit which kind. |
| `Issue` | Gains `hasPhoto`; on `trip` `status`, `driver` (a name, or null) and `stopsLeft`; on `stop` `arrivedAt`, `doneAt`, `loadedAt` and `flaggedAtDock`; and on each line `loaded` and `delivered`. A line's `counted` is, by kind, the good units at the dock, the cartons refused, or the cartons left on the truck, and `short` is the units short at the dock, refused, or not delivered. A closed shop's lines read that attempt, as on the phone: `loaded` from the problem's own lines and `delivered` null. |
| `LoadingIssue` | `Issue` narrowed to kind `loading`, its `FlagReason` and its `LoadingDecision`. `LoadingTruck.issues` holds these, so the loader's screens keep their types. |
| `DecideIssueRequest` | Unchanged: `revision` and `decision`. |

New error codes, each with a sentence the screens show as it is:

| Code | Status | Details | For example |
| --- | --- | --- | --- |
| `trip_not_ready` | 409 | `TripDetails` (spec 010) | "VEH035 is not loaded yet." |
| `other_trip_out` | 409 | `TripDetails`, the trip that is out | "VEH004 is still out on trip 1." |
| `trip_not_out` | 409 | `TripDetails` | "VEH035 is not out on the road." To an answer: "VEH035 is back at the depot, so it cannot go back to Fresh Wellawatte." |
| `not_next` | 409 | `stopSeq`, the next stop | "Fresh Nugegoda comes first." |
| `not_arrived` | 409 | `stopSeq` | "Tap I've arrived at Fresh Wellawatte first." |
| `stop_done` | 409 | `stopSeq` | "Fresh Wellawatte is already done.", or to an arrival "You already arrived at Fresh Wellawatte." |
| `write_reused` | 409 | `writeId` | "This record was already sent with other details." |

Codes used again: `stale` 409 ("Fresh Wellawatte was changed on another phone.", "VEH035 was changed on another phone.",
or spec 012's "This problem was already answered."), `stops_left` 409 with `stopSeqs` ("Stop 2 is not done yet."),
`unknown_record` 400 with `id` ("That trip is not on your list.", "That stop is not on this trip.", "That line is not on
this stop."), `invalid_input` 400 ("The photo must be a whole JPEG of at most 500 KB.", "That answer does not fit this
problem."), `no_depot` 403, and `not_found` 404 ("This problem has no photo.").

## How it works
| File | What it holds |
| --- | --- |
| `apps/api/src/driver/day.ts` | `driverDayOf(tx, caller, at)`, which the GET and every write answer with. |
| `apps/api/src/driver/writes.ts` | `applyWrite(caller, write)`: the steps every write shares, then one function per kind. |
| `apps/api/src/driver/kept-time.ts` | `keptTime(claimed, last, now)`: spec rule 11 on plain values. |
| `apps/api/src/driver/photo.ts` | `jpegOf(dataUrl)`: the bytes of a whole JPEG, or `invalid_input`. |
| `apps/api/src/routes/driver.ts` | The two routes behind `requireRole('driver')` and `requireDepot`. The lead mounts it as `/driver`. |
| `apps/api/src/issues/read.ts`, `issues/decide.ts` (spec 012) | The driver's kinds read with their context, and their answers. |
| `apps/api/src/routes/issues.ts` (spec 012) | Adds `GET /issues/:issueId/photo`. |
| `apps/api/src/lib/day-lock.ts` (T0) | Gains a way to read the clock instant from the locked `demo_day` row when asked, not only when the lock is taken. |
| `apps/api/src/loading/writes.ts`, `loading/day.ts` (spec 012, T0) | `already_flagged` looks only at flags of the flag's own trip, and the loading day builds its flags from problems of kind `loading` only. |
| `packages/contracts/src/driver.ts` | The shapes, `applyDriverWrite`, `nextStop`, `tripFigures` and `phoneView`, unit tested in `apps/api/src/driver/rules.test.ts`. |
| `apps/web/src/features/driver/` | `DriverHome` (the routes `/driver`, `/driver/proof`, `/driver/wrong` and `/driver/saved`, so `app/router.tsx` does not change), the pages, `store.ts` (the phone's database), `sender.ts`, `signal.ts`, `photo.ts`, `tally.ts`, `words.ts`, and `parts/` (the status chip, the waiting sheet, the top line, the trip bar and the counters). |
| `apps/web/src/features/live/` (spec 012) | `IssueCard` for the driver's kinds, with the photo link. |
| Shared web parts (T0) | `vite.config.ts` with `vite-plugin-pwa`, the kept clock in `lib/clock.ts`, the kept account in `features/auth/api.ts`, and the `status` slot in `AppShell.tsx`. |

**Reading** `GET /driver`, in one read-only snapshot (`snapshot` from `orders/store-orders.ts`, which takes the `orders`
table's lock first):
1. The driver's day from the app clock and the operating days: spec 012's `loaderDay`. None gives `day: null`.
2. The caller's trips: those of the depot's `published` plan for that day whose driver is the caller, and any other trip
   of theirs that is `out`, each with its vehicle.
3. Each trip's stops with their `retried_at`, the shop, its window narrowed to its mall slot, its orders' notes and its
   lines with their products and counts, and the trip's problems of kinds `refused` and `closed` with their lines and the
   names of who answered them. A closed stop's lines take `loaded` from its problem's own lines and `delivered` as null.
4. `leavesAt` and `backBy` from the plan's `sent_check`: `times.leaveAt` and `times.backAt` of the trip's vehicle and
   number, as instants on the plan's day.
5. `appliedWriteIds`: the ids in `driver_writes` of the caller's writes answered in the last 48 hours of real time,
   whatever trips steps 2 to 4 found.

**Every driver write**, `POST /driver/writes`, in one transaction:
1. `lockDay(tx)` (spec 012): in demo mode the `demo_day` row for share. A start takes `lockDepotDay(tx, depotId)`
   instead, which then locks the depot's row for no key update, as spec 012's start does, so two starts of one vehicle's
   trips go one after the other. A reset takes the `demo_day` row for update first, so a write and a reset take turns.
2. Read the trip with its plan and lock its row `for update`. A trip the caller does not drive, or one of another depot,
   is `unknown_record`, and so is a stop or line not on it.
3. Only now read the clock instant `now` from the locked `demo_day` row, so a write that waited behind another is judged
   at the moment it got the trip.
4. The write's id: one in `driver_writes` with the same trip, kind and body hash is a repeat, answered with the day as it
   is and nothing changed but the row's `answered_at`; with anything else it is `write_reused`. The hash is the SHA-256
   of the parsed write as JSON with its keys sorted, photo included. Two copies sent at once queue on the trip's lock, so
   the second finds the first's row.
5. The revision, the trip's for a start and an end and the stop's otherwise, must be the one named (`stale`). Then the
   kind's own checks below.
6. The time kept is `keptTime(at, last, now)`, `last` being the trip's `last_event_at`, or its `ready_at` before the first
   write.
7. The kind's work, its record's revision up by one, `last_event_at` set to the time kept, the `driver_writes` row with the
   caller, trip, kind and hash, and the audit row with the phone's time and the time kept. After the transaction commits,
   announce and answer both new writes and replays with `getDriverDay(caller)`, using the GET's repeatable-read snapshot
   so concurrent changes to other trips cannot mix old stops with new problems. The locked trip's checks stay inside
   the write transaction.

A kind's checks run in the order written, so a write at a stop already done gets `stop_done`, never `not_next`: a done
stop is never the next one.
- **start.** The trip must be `ready` (`trip_not_ready`), and no other trip of its vehicle `out` (`other_trip_out`). It
  becomes `out` with `left_at`. Audit `trip.started`. Announce `driver` and `loading` to the depot.
- **arrive.** The trip must be `out` (`trip_not_out`), the stop neither arrived nor done (`stop_done`), and the trip's next
  stop by `nextStop` (`not_next`). It gets `arrived_at`. Audit `stop.arrived`. Announce `driver`.
- **deliver.** The trip `out`, the stop not done (`stop_done`), the next one (`not_next`) and arrived (`not_arrived`), and
  the photo whole (`invalid_input`, below). Each line's `delivered_qty` is its `loaded_qty`, the stop is `delivered` with
  `done_at`, the photo is stored with no problem, and each order at the stop becomes `delivered` with its revision up.
  Audit `stop.delivered`. Announce `driver` to the depot and `orders` to each shop on the stop and the depot.
- **refuse.** As a delivery with the photo optional, and each line named on the stop (`unknown_record`) and refused from 1
  to its loaded count (`invalid_input`). A named line is delivered at loaded less refused and the others at loaded, the
  stop is `refused`, and its orders `delivered`. The problem: kind `refused`, the write's id, the reason, the note or
  null, raised by the caller at the time kept, its named lines counted at the cartons refused, and the photo with the
  problem's id. Audit `stop.refused`. Announce `driver`, `issues` and `orders`.
- **closed.** The trip `out`, the stop not done, the next one and arrived. The stop is `closed` with `done_at`, nothing is
  delivered and its orders stay `loaded`. The problem: kind `closed`, reason `nobody_there`, every line of the stop
  counted at what stays on the truck, its loaded count, and the photo when there is one. Audit `stop.closed`. Announce
  `driver` and `issues`.
- **finish.** The trip `out` and every stop done (`stops_left`, naming the others). It becomes `done` with `back_at`. Audit
  `trip.finished`. Announce `driver`.

**The photo check**, `jpegOf`: the data URL's base64 decodes to at most 512,000 bytes (500 KB) that start `FF D8` and end
`FF D9`, and the markers after the start lead to a frame header (`SOF0` to `SOF15`, other than `C4`, `C8` and `CC`) whose
height and width are each from 1 to 2000. Anything else is `invalid_input`. The phone's 1280 px pictures pass with room.
The check reads the file's structure and never decodes the picture, a known limit the spec records.

**A write that arrives late**, after the trip moved on without it, meets the trip as it is. A write the server already
applied is answered as done, and an id used for something else is `write_reused` (step 4). A stop or trip that another
phone or an answer changed is `stale` (step 5). A trip a reset removed is `unknown_record`. An end of the trip after "Try
again" opened a stop again is `stops_left`, and a save at a stop that is no longer next is `not_next`. The time it carries
is kept by step 6, so it still lands in order. None of these is sent again: the phone lists it under "Not accepted" and
fetches the day again (spec rule 10).

**The answer** to a driver's problem is spec 012's `decideIssue`, with these steps in one transaction:
1. `lockDay`, then, when the answer is `bring_back`, the caller's depot's row for share, as a shop's place takes it, so a
   plan's send sees a closed shop's orders placed again whole or not at all. The answer is in the request, so this comes
   before the problem is read.
2. The problem with its stop, trip and plan: another depot's is `unknown_record`. Lock the trip's row for update, then the
   problem's, the order the driver's writes take.
3. A revision not the problem's, or a problem not open, is `stale`. An answer not in `DECISIONS_BY_KIND` for its kind is
   `invalid_input`. `try_again` on a trip that is not `out` is `trip_not_out`.
4. Write the decision, `decided_by`, `decided_at` and the revision up. `try_again` empties the stop's `arrived_at`,
   `done_at` and `outcome`, sets `retried_at` to the answer's clock instant, and raises its revision; the trip's
   `last_event_at` stays. `bring_back` on a
   closed shop makes the stop's orders `placed` with their revisions up and their lines' `loaded_qty` and `delivered_qty`
   emptied, and the stop stays `closed`. `bring_back` on a refusal writes the decision alone. Audit `issue.decided`, and
   for a closed shop brought back the lines' loaded and delivered counts of that attempt in its `before`.
5. Answer the open list with the decided problem. Announce `issues` and `driver` to the depot, and `orders` to each shop
   and the depot when orders changed.

A loader's flag is answered as spec 012 has it, with no trip lock.

**The photo read.** `GET /issues/:issueId/photo` reads the problem's depot and photo in the snapshot and answers
`image/jpeg`. Another depot's problem is `unknown_record`, and a problem with none `not_found`.

**The phone.** The parts below live in `features/driver`, outside React where they outlive a render, as spec 009's
`draft-form.ts` does, and tell the screens through a small store they subscribe to.
- **What it keeps.** The browser's database (IndexedDB through `idb`), `wayfinder`, keeps per signed-in account the last
  `DriverDay` the server sent, and the writes not yet applied or refused, in the order saved: `seq`, `userId`, `write`
  (the exact body, photo and all), `savedAt`, `state` (`waiting` or `refused`) and `refusal` (the code and sentence).
  Another account signed in on the phone reads and sends only its own. The first save asks the browser to keep this
  storage with `navigator.storage.persist()`.
- **Saving an action.** The button makes the write: a v4 UUID from `crypto.getRandomValues` (spec 012), the app clock's
  time, and the revision of its record in the trip on screen. The write goes into the database, and only then does the
  screen move on. A save that fails shows "Could not save on this phone. Try again.", the screen stays, and nothing is
  sent. With no clock known yet, the buttons wait.
- **One tab owns the driver's app.** The driver's area asks for `navigator.locks.request('wayfinder-driver', …)` when it
  opens and holds the lock until the tab closes. Only the tab holding it runs the sync loop below and the query
  `['driver']`. Any other tab shows "Wayfinder is open in another tab.", waits for the lock and does nothing until it gets
  it, so no two tabs ever fetch, keep or send. Where a browser lacks Web Locks the tab runs as the owner, and the server's
  ids still keep a write from counting twice.
- **The sync loop**, in the owning tab, one step at a time: fetch the day, `GET /driver`, within 15 seconds; keep it, in one
  database transaction with taking off the queue every write whose id it lists as applied; then send the oldest waiting
  write within 15 seconds, and start again from the fetch. A write's answer is never put in the view, so the day is
  fetched again after each write, and a write leaves the queue only when a fetched day lists it: a fetch that fails leaves
  it waiting, not sent again, until a later fetch lists it. No answer, a 5xx or a 429, to a fetch or a send, waits for the
  retry schedule and starts again from the fetch, with the same write, id and body. A 401 stops the loop, with the write
  still waiting and not refused, until the same account signs in again. Any other refusal marks the write refused with
  its code and sentence, and the loop goes on. The live stream's `driver` message, a `clock` or `demo` message (spec 008)
  and the minute's refetch start the loop's fetch, and a new fetch cancels one still running, so an older answer never
  lands after a newer one.
- **What the screen shows.** `phoneView` of the kept day and the waiting writes, and every number from `tripFigures`
  (D-50). Refused writes are left out, and a write's answer is never shown.
- **The signal.** No signal while `navigator.onLine` is false, or from a request that got no answer within 15 seconds,
  until a request gets any answer. With no signal a probe asks `GET /api/v1/health`, also limited to 15 seconds, after 2,
  4 and 8 seconds and then every 15, whatever `navigator.onLine` says, and at once on the browser's `online` event, the
  app coming back to the front, the app opening, and "Retry sync". An answer to the probe brings the signal back, and
  the loop carries on. The chip, the bar, "Saved on this phone" and "Back online" follow it (spec rule 12).
- **The photo.** The file input takes `accept="image/*"` and `capture="environment"`. `createImageBitmap` turns the picture
  upright, a canvas draws it at most 1280 px on its long side, and `toBlob` makes a JPEG at quality 0.7, then at 0.5 and
  960 px if it is still over 500 KB. It is kept as a data URL, which is also the preview, because the app's content policy
  allows `data:` images and not `blob:` ones.
- **Opening with no signal (D-49).** `vite-plugin-pwa` builds a service worker that keeps every file of the built app and
  answers any page with `index.html`. It keeps nothing under `/api`, takes over on the next load after an update, and is
  off on the development server. `features/auth/api.ts` keeps the signed-in account in `localStorage` whenever `/auth/me`
  or a sign-in answers, and drops it on a sign-out or a 401. `lib/clock.ts` keeps the clock's last state with the
  device's reading at that moment. On start both are read from there at once as their queries' first data, the clock
  counted on by the time the device says has passed, so the screens open before any request answers. Both queries use
  TanStack's `networkMode: 'always'`, so an offline browser tries them, fails and keeps the kept ones instead of pausing.
- **The tally** is kept in memory for the tab, by stop and line, as spec 012's ticks are.

**Words**, in `features/driver/words.ts`, which may use spec 012's `features/loader/words.ts` for units, vehicles and "in
1 h 5 min":
- A shop without its brand where the design drops it: "Nugegoda", "Wellawatte". "Colombo · street", "rear dock", "mall
  bay".
- "window · on time" and "window · late"; "Unload 23 cartons", "20 chilled", "3 dry"; "23 of 24 cartons"; "92 delivered ·
  2 refused"; "Waited · 3 min".
- The top lines, the answers and the hand-back sentences of the screen states, among them "Try Fresh Wellawatte again
  after the other stops."; "1 waiting to send", "Back online · 2 stops sent" and "Nugegoda and Wellawatte reached the
  depot".
- Icons from the design, copied by the lead into `assets/icons/` from the design's asset folder: `icon-no-signal`,
  `icon-offline-queue`, `icon-sync`, `icon-proof-photo`, `icon-damaged`, `icon-shortfall` and `icon-goods-cartons`, beside
  the brand, goods and people pictures already there. The ticks are the outline set's, as in spec 012.

## Changes to other specs
- **Spec 012.** In T0 the lead scopes `already_flagged` in `loading/writes.ts` to flags of the flag's own trip, so a line
  brought back can be flagged again on its next trip, and has `loading/day.ts` build a truck's flags from problems of kind
  `loading` only, typed `LoadingIssue`, with spec 012's loading and issues tests green after the contracts change (AC-7).
  `lib/day-lock.ts` gains the clock read on demand, which spec 012's writes do not need. Its ready, and spec 010's send
  and unsend, also announce `driver` (T1). `issuesOf` and `decideIssue` handle the driver's kinds (T4), and `IssueCard`
  draws them (T7). Its open question 1, the flag's photo, can use `photos`.
- **Spec 008.** Its out-of-scope line gives "the time on a phone with no signal" to A6. This piece builds it in
  `lib/clock.ts`, and the lead updates the line at the join.
- **Spec 009.** Nothing changes. The shop's cards show `delivered` as spec 009 draws it, and a closed shop's orders brought
  back as placed.
- **The map.** A4 points here and includes the driver's no-signal screens, and A6 keeps the shop's waiting receipt, built
  with A5 (D-43). A5's receipt can wait on the shop's phone through the same store and sender, with writes of its own,
  once they move from `features/driver` to `lib/`.

## Risks
- A4 builds on spec 012's reads, locks, problems and Live day column. T0 starts once 012 is merged and follows the code as
  it landed, not this plan, where the two differ.
- The service worker runs only on the built app, over HTTPS or on localhost. A phone on a plain `http://` address during
  development gets no offline reload, so the click-through runs on the built app. `vite-plugin-pwa` 1.x supports Vite 8.
- DevTools' offline switch holds for the one tab it inspects, so the cold start is a reload of that tab. The moved clock
  runs against the hosted app, because a server on the same computer would move with it.
- An update reaches a phone on its next load. Every action is in the database first, so a reload loses at most a form in
  progress.
- `navigator.onLine` can say online with no working signal, or offline with one, so the phone also learns from requests
  and from the health probe.
- A phone's `performance.now()` can stop while it sleeps, so its clock may lag. D-46 keeps times in order, and the audit
  row keeps the phone's own.
- Base64 adds a third: a 500 KB photo is under 700 KB of JSON, inside the API's 1 MB body limit. Hashing it is quick.
- Web Locks are in every current browser. Where one lacks them each tab runs as the owner, and the server's ids keep a
  write from counting twice.
- The 48 hours of listed ids are real time. A phone offline for longer sends its oldest write again, the server answers it
  as done and lists it again, and the queue moves on.
- A browser can clear the phone's storage. `persist()` asks it not to, and the waiting count shows what is still at risk.

## Test plan
| Criteria | Kind | Where |
| --- | --- | --- |
| AC-7 | Integration, spec 012's suite with the kind and trip checks T0 adds | `apps/api/tests/loading-read.test.ts`, `loading-writes.test.ts` and `issues.test.ts` |
| AC-8 | Unit | `apps/api/src/driver/kept-time.test.ts` |
| AC-9 | Unit, on the contracts' functions | `apps/api/src/driver/rules.test.ts` |
| AC-10 | Unit, on made-up JPEG bytes | `apps/api/src/driver/photo.test.ts` |
| AC-1 to AC-5 | Integration | `apps/api/tests/driver-read.test.ts` |
| AC-6, AC-11 to AC-21 | Integration | `apps/api/tests/driver-writes.test.ts` |
| AC-22 to AC-29 | Integration | `apps/api/tests/driver-sync.test.ts` |
| AC-30 to AC-37 | Integration | `apps/api/tests/driver-answers.test.ts` |
| AC-38 to AC-49 | Click-through in Nabil's Chrome on the built app, at 390 wide as `dilshan` with the network turned off in DevTools and at 1440 × 900 as `ruwan`, two browsers for AC-41 to AC-43, two tabs for AC-48, DevTools' storage quota for AC-44, the session cookie deleted and request blocking for AC-45, a latency profile and the day's own address blocked for AC-47, and the hosted app for AC-46 | The lead, on the joined branch |
| AC-50, AC-51 | A read of `features/driver` and the service worker's settings, with the network tab | The lead and the reviewer |

Integration tests run in the builder's own seeded database (AGENTS.md) and assert the seeded day's numbers. Each file
starts from the seeded day, puts it back at its end with spec 008's `clearDemoDay` and `seedDemoDay` in one transaction,
and lets the clock go. `apps/api/tests/driver-plan.ts` runs spec 012's `loading-plan.ts` and its walkthrough's loader
writes, to VEH035 ready at Thu 02:36 with 1 dry carton short for Fresh Nugegoda, and sets the clock to Thu 03:30. AC-27's
test holds the trip's row in a transaction of its own and moves its last event time a second ahead before letting go.
AC-25's test moves the clock past 16:00 and sets one `answered_at` back 49 hours. AC-35's plans Friday through spec 010's
endpoints, loads it through spec 012's and delivers it through this piece's, then reads Thursday's day with the clock set
back to Thursday and the problem through `issuesOf`. A file signs in once per account, because one address gets ten
sign-ins in 15 minutes.
