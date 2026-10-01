# 013 · The driver

**Status:** Done, with three open questions at the bottom  ·  **Owner:**  ·  **Design:** Driver · Today's trip, · Next stop, · Unload, · Proof, · photo preview, · delivery saved locally, · No signal, · connection restored, · Something's wrong · refused and · shop closed, · Next stop · after refusal and · after no answer, · Trip done, · Trip done · refused and · shop closed, · Day done, the offline and last stop variants of Unload, Proof and delivery saved locally, and the right-hand column of Dispatcher · Live day · issue open and · issue open · decision sent.

Piece A4 of [the map](../000-map.md), with the driver's no-signal screens the map first put in A6 (D-43). It starts where
spec 012 ends, with a truck marked `ready` and its loaded counts written. The clock, live updates and the seeded day are
spec 008's, the sent plan and its times spec 010's, and the "Needs you" column of Live day spec 012's.

## Why
The driver works on the road from their own phone, today with a paper run sheet and phone calls, and needs to record what
happened at each stop with a proof of delivery, so a dispute does not rest on memory (booklet, page 6). Today the depot
hears of a problem only after the driver has reached the shop (page 4). Coverage drops in the hills, on the Kandy corridor
and in rural districts, so work away from the depot has to carry on with no signal and reconcile when it returns (pages 4
to 7). Judges try the driver on a phone (page 11), and offline operation and recovery is a tenth of the marks (page 12).

## What it does
Once the loader marks the truck ready, the driver sees the whole trip and starts it. Then it is one stop and one job per
screen: the next shop and its window, "I've arrived", counting the cartons off, a photo of them at the door, and the
delivery is saved. When the shop refuses some cartons or is closed, "Something's wrong" records it and the dispatcher
answers from Live day. Every action is saved on the phone before the screen moves on, and sent when there is a signal,
oldest first, once. With no signal the driver keeps working, sees what waits to send, and gets one line when it has all
gone. "I'm back at the depot" closes the trip. On the walkthrough Dilshan drives VEH035 from Thu 25 Jun 03:31: Fresh
Nugegoda takes its 23 cartons, and at Fresh Wellawatte, with the network off, the shop refuses 2 damaged chilled cartons.
Back online, Ruwan tells him to bring them back.

## Decisions
These are in `docs/decisions.md`.
- **D-43 · The driver's no-signal screens come with A4, and A6 keeps only the receipt that waits on the shop's phone,
  built with A5.** The design draws the driver's no-signal states beside the driver's own screens and they share one
  save-first queue, and the waiting receipt belongs with the shop confirming what arrived.
- **D-44 · The driver's day is the loader's day (D-34), and a trip that is out stays on the phone until the driver ends
  it.** The depot has one morning for both, and a late trip must not vanish from its driver at 16:00.
- **D-45 · Every driver action is saved on the phone first, as the request it will send, and sent oldest first, one at a
  time, by the one tab that holds the driver's app. The server keeps each applied write's id with its account, trip, kind
  and a hash of its body, the driver's day lists the ids the account had applied in the last 48 hours, and a write leaves
  the phone once the day lists it. Each write names the revision of the stop or trip it changes, which the phone works out
  as it saves.** A delivery happened whether there was a signal or not, so it must never need doing again or count twice,
  an id cannot be reused for something else, and a trip that has left the day must not strand its last write.
- **D-46 · A time recorded on the phone is kept when it lies between the trip's last event time and the server's clock,
  read once the trip is locked, and otherwise the nearer of the two is kept. Reopening a stop never moves the last event
  time back.** The phone counts the app clock on from its last contact and can fall behind after a sleep or a clock move,
  but a record must never land in the future or before what it follows.
- **D-47 · A delivery needs a photo of the goods at the door, and a refused or closed stop may add one. The phone shrinks
  it to 1280 px and 500 KB, it rides inside the write, and the server takes only a whole JPEG.** The booklet wants proof
  so disputes do not rest on memory, and one write means a delivery never exists without its photo.
- **D-48 · The driver raises two problems, a shop that refused some and a shop that is closed. The dispatcher answers a
  refusal with "Bring them back", and a closed shop with "Try again on this trip", which sends the stop after the other
  stops in the order stops were sent back, or "Bring them back", which puts the stop's orders back as placed with their
  counts cleared while the stop stays closed and keeps that attempt's counts.** The cartons are on the truck either way,
  a retried stop must not jump the queue, and the old stop keeps what happened there while its orders start again for
  the next plan. Writing cartons off, and sending replacements, are the depot's records to add later.
- **D-49 · The phone keeps the app's files, the signed-in account, the clock's last state, the driver's trip and the
  waiting writes, and reads them at once on start, so the driver's screens open with no signal. A service worker keeps the
  files and never an answer from the API.** A phone reloads tabs, the camera often does it, and a queue behind a page that
  cannot load would strand the driver.
- **D-50 · The phone shows the day the server last sent with the still-waiting writes applied, through one function in the
  contracts that a test holds the server to, and never shows a write's answer: after each write it fetches the day
  again.** With no signal the phone must show what the server will say, one function cannot drift from itself, and an
  answer that arrives late must not bring back an older day.

## Screen states
"No frame" means the smallest state that fits the style guide. The driver's screens are built at 390 wide and nowhere
wider than 480. Every driver screen has the design's top bar: the time, the status chip, the demo chip (spec 008, "Demo"
alone below 640 wide beside a status chip), the avatar and the plain bell. Words in quotes are the walkthrough's.

| Screen | State | Frame | What shows |
| --- | --- | --- | --- |
| Every driver screen | The status chip | The chip beside the time in every driver frame | "● Online" in green. "Offline" with the design's no-signal picture in yellow when there is no signal (rule 12). Whenever records wait, a thin line and the design's queued-offline tray with their number: "Offline │ 1", or "● Online │ 1" while they send. "1 not accepted" in red when the server refused a record. A tap opens the waiting sheet. |
|  | The waiting sheet | No frame | "Waiting to send · 1", a row per record: "Stop 2 · Fresh Wellawatte · saved 03:48". "Not accepted · 1", a row per refused record with the server's sentence: "Stop 2 · Fresh Wellawatte · That trip is not on your list.", and "Clear". "Retry sync" in orange while something waits. |
|  | Sign in again | No frame | A yellow line: "Sign in again to send 1 waiting record." with "Sign in". |
|  | Not saved | No frame | "Could not save on this phone. Try again." in red on top, the screen stays where it was, and nothing is sent. |
|  | Another tab | No frame | "Wayfinder is open in another tab." in place of the driver's screens, in every tab but the one that holds the driver's app, until that tab closes (rule 10). |
| Today's trip `/driver` | Loading | Loading · skeleton | Grey blocks for the day line, the card and two rows, on the first load with nothing kept on the phone. |
|  | Ready | Driver · Today's trip | "Thu 25 Jun · trip 1". The card: the design's van, "VEH035", "leaves 04:36 · in 1 h 5 min", "Fresh · Colombo · back by 06:10" and the green chip "✓ Loaded · 117 of 118 · 1 dry short for Nugegoda". "2 stops", then a row per stop in plan order: "1", "Fresh Nugegoda", "05:00 to 07:30", "23 of 24 cartons"; "2", "Fresh Wellawatte", "05:30 to 08:00", "94 cartons". The orange "Start trip". |
|  | Not loaded yet | No frame | The same card with the grey chip "Not loaded yet", or "Being loaded" while the loader works, "Start trip" greyed and "Start trip works once VEH035 is loaded." |
|  | No trip | No frame | "No trip for Thu 25 Jun yet. It shows here once the dispatcher sends the plan." With the plan sent and no trip for this driver: "You have no trip on Thu 25 Jun." With no day: "No delivery day is left." |
|  | Could not load | No frame | "Could not load your trip." and "Try again", only when nothing is kept on the phone. |
| Next stop `/driver` | A stop to go to | Driver · Next stop | The top line (below). "Stop 2 of 2". The brand's shop picture and "Fresh Wellawatte", "Colombo · street", "05:30 to 08:00" as the biggest thing, "window · on time" in green, or "window · late" in red once the app clock is past the window's close. The chips "Unload 94 cartons", "48 chilled" in blue and "46 dry". The note card, with the store manager's picture, "Note" and the shop's words, when it left one: Nugegoda's is "Ring the bell at the side door." The trip bar, a dot per stop, filled when done and ringed for this one, "Left Peliyagoda 03:31" and "back by 06:10". The orange "I've arrived". |
|  | The top line | Driver · Next stop, · after refusal, · after no answer | The latest problem of the trip, else the last stop done. Green: "✓ Stop 1 Fresh Nugegoda delivered 03:38" with "synced", or "on this phone" while it waits. Yellow: "! Stop 2 · 92 delivered · 2 refused" with "sent" or "on this phone", and "Keep the 2 cartons on the truck. The depot will tell you what to do." Yellow: "! Stop 2 · not delivered · nobody there" and "The depot decides: retry on this trip or another day." Once answered, the second line is the answer: "Ruwan, dispatcher · 03:52 · Bring the 2 chilled cartons back to Peliyagoda." |
|  | No signal | Driver · No signal | The yellow bar with the no-signal picture, "No signal · 1 waiting to send", or "No signal · everything is sent", in place of the top line. |
|  | Back online | Driver · connection restored | The green bar with the design's sync picture, "Back online · 1 stop sent" and "Wellawatte reached the depot", and the dark tick that closes it. It also goes once the next stop is done. |
|  | Try again | No frame | The stop the dispatcher sent back comes after the other unfinished stops and after any stop sent back before it (rule 4), with the answer as the top line: "Ruwan, dispatcher · 03:52 · Try Fresh Wellawatte again after the other stops." |
| Unload `/driver` | Counting | Driver · Unload, · last stop, · offline | "Stop 1 of 2", the shop picture and "Fresh Nugegoda", "street". A card per line, chilled before dry: the design's chilled or dry goods picture and "Chilled" or "Dry" (the item's name for Style and Tech), −, the count, "/12" and +. The count starts at 0 and can be typed. Under a line the loader went short on, the design's shortfall picture and "Loader flagged 1 carton short at the depot", and that line counts to "3 /4". The orange "Done unloading", greyed until every line is counted to what was loaded, and "Something's wrong". |
| Proof `/driver/proof` | Take it | Driver · Proof, · last stop, · offline | "Stop 1 of 2", the shop, "Photo of the cartons at the door", the dashed box with the design's proof-photo picture, and the orange "Take photo", which opens the camera, or the file picker on a laptop. |
|  | Preview | Driver · photo preview | "Check that the cartons are visible", the photo in the box, the orange "Save delivery" and "Retake photo". |
|  | Unusable | No frame | "That picture could not be used. Take it again." in red. |
| Saved `/driver/saved` | Saved with no signal | Driver · delivery saved locally, · 3 | The tray picture, "Saved on this phone", "Fresh Wellawatte · stop 2 of 2", "Sends by itself when the signal is back", the orange "Continue route" and "Retry sync". It follows a delivery, a refusal or a closed shop saved while there is no signal. With a signal the screen goes straight on and the top line says it. |
| Something's wrong `/driver/wrong` | Refused | Driver · Something's wrong · refused | "Stop 2 of 2", the shop, "street", "What's wrong?", and the chips "Shop refused some" and "Shop closed". For a refusal, the stop's lines to pick, "48 cartons chilled" and "46 cartons dry"; a picked line shows two counters over what was loaded, "Accepted 46 /48" with the chilled picture and "Refused 2 /48" with the design's damaged box, and + on one takes from the other. "Why" with "Damaged", "Expired" and "Not ordered". A "Photo" tile with the proof-photo picture, which shows the photo once taken, and a note, "What happened? (optional)". The orange "Save partial delivery" once a carton is refused and a reason chosen, and "Back to unload". |
|  | Shop closed | Driver · Something's wrong · shop closed | The card "Nobody at the shop" with "since 03:45", the arrival, and "Waited" with "3 min", counted from it on the app clock. The "Photo" tile and the note. "94 cartons stay on the truck" with the design's cartons picture. The orange "Save attempt and move on" and "Back to unload". |
| Trip done `/driver` | Every stop done | Driver · Trip done | The top line. "Trip done", "Head back to Peliyagoda · back by 06:10". A card: "Stops 2 of 2", "Cartons delivered 117 of 118", "Short from the depot 1 dry · Nugegoda". A yellow card with the damaged box, "Nothing to hand back" and "The dry carton for Nugegoda never left the depot." "Trip 2" with "none today", or "leaves 07:10" when the vehicle has one. The orange "I'm back at the depot". |
|  | A refusal | Driver · Trip done · refused | "Cartons delivered 115 of 118", "Refused 2 · Wellawatte", "Short from the depot 1 dry · Nugegoda". "Still on the truck": "2 chilled cartons refused at Wellawatte. Hand them to the depot check with the refusal photo. The dry carton for Nugegoda never left the depot." |
|  | A closed shop | Driver · Trip done · shop closed | "Cartons delivered 23 of 118", "Not delivered 94 · Wellawatte", "Short from the depot 1 dry · Nugegoda". "Still on the truck": "94 cartons for Wellawatte, nobody at the shop. The depot decides what happens to them.", and after "Bring them back": "… Hand them in; they go on the next run." |
| Day done `/driver` | The day's trips done | Driver · Day done | Green "✓ Trip closed · 2 of 2 stops · all records sent", or yellow "Trip closed · 1 waiting to send". "Back at Peliyagoda", "Checked in at the depot 03:55", the trip's card and hand-back card, "Trip 2 · none today", and the orange "Sign out", greyed with "Sign out once everything is sent." while records wait. |
| Live day `/dispatcher/live` | A refusal open | Dispatcher · Live day · issue open, its right column | Spec 012's card: "03:48", "2 chilled cartons refused", "Fresh Wellawatte · stop 2 · VEH035 · Dilshan · damaged, the shop took 46 of 48 chilled", the rows "Driver · Dilshan · 03:48", "Note · 2 crushed at the bottom", "Photo" when there is one, which opens it, "At the dock · loaded 02:31, nothing flagged" and "Still on VEH035 · 2 chilled cartons · no stops left". "What should the driver do with them?", the one option card "Bring them back to Peliyagoda" ("The driver hands them in at the depot."), chosen, and the orange "Send to driver". |
|  | A closed shop open | No frame, the same card | "Nobody at Fresh Wellawatte", "stop 2 · VEH035 · Dilshan · arrived 03:45, saved 03:48", the note and photo rows, "Still on VEH035 · 94 cartons · no stops left". "What should the driver do?", "Try again on this trip" ("The driver goes back after the other stops.", not offered once the trip is back) and "Bring them back" ("The orders wait for the next plan."), and "Send to driver". |
|  | Answer sent | Dispatcher · Live day · issue open · decision sent, its green card | "✓ Sent 03:52" and "VEH035 · 2 cartons back to Peliyagoda, Dilshan told", "VEH035 · tries Fresh Wellawatte again, Dilshan told" or "VEH035 · 94 cartons back to Peliyagoda, Dilshan told". |

## Rules
Examples use the seeded day with the walkthroughs of specs 009, 010 and 012 done: VEH035 trip 1, van reefer, driver
Dilshan, ready at Thu 25 Jun 02:36, leaving 04:36 and back by 06:10, stop 1 Fresh Nugegoda (OUT001: 12 and 8 chilled
cartons and 3 of 4 dry, window 05:00 to 07:30, street) and stop 2 Fresh Wellawatte (OUT002: 48 chilled and 46 dry, window
05:30 to 08:00, street). Times are depot time and depend on the judge's pace.

1. **The driver's day (D-44).** Spec 012's rule 1, whose table holds for the driver too, and a trip of the driver's that
   is `out` stays on the phone, whatever day it is, until the driver ends it. *At Wed 24 Jun 16:30, Dilshan's day is
   Thu 25 Jun. At Thu 25 Jun 16:00 it is Fri 26 Jun, and VEH035 is still his if it is out.*
2. **The trips.** The day's sent plan's trips whose driver is the caller, in leaving order, with a trip still out from an
   earlier day first. A trip's stops come in plan order and their lines in spec 012's order. The phone opens on the first
   trip that is not done: its Today's trip until it is out, then its stops, then Trip done. With every trip done it shows
   Day done. *Dilshan has one trip, VEH035 trip 1.*
3. **Starting.** "Start trip" makes a `ready` trip `out` at the time kept. It is offered only on a ready trip, and a
   vehicle's two trips are never out at once: a start takes the depot's lock, so two starts of one vehicle's trips go one
   after the other and the second finds the first out. The leaving time is the plan's, not a gate (open question 1).
   *Dilshan starts at 03:31, 1 h 5 min before 04:36.*
4. **A stop.** The next stop is the first unfinished stop in plan order among those not sent back, and the stops sent back
   by "Try again" come after them, in the order they were sent back. An arrival or a save at any other stop is refused
   (`not_next`). "I've arrived" records the arrival. The unload counts are the driver's own tally, as the loader's ticks
   are (spec 012, rule 4): they are kept in the tab, not saved, and "Done unloading" works once every line is counted to
   what was loaded. A delivery is then
   every line as loaded, with a photo (D-47): a whole JPEG, starting `FF D8` and ending `FF D9`, of at most 500 KB, whose
   frame header gives at most 2000 px a side. Anything less than every line goes through "Something's wrong", so the
   counts add up (rule 9). Saving makes the stop `delivered`, each line's delivered count its loaded count, and each order
   at the stop `delivered`. *Dilshan arrives at Fresh Nugegoda at 03:34, counts 12, 8 and 3, takes the photo and saves at
   03:38. The three orders are delivered with 12, 8 and 3.*
5. **The shop refused some.** The driver picks lines and, for each, how many the shop refused, from 1 to what was loaded,
   a reason (damaged, expired or not ordered), and may add a photo and a note of up to 200 characters. Saving makes the
   stop `refused`, each line delivered at what was loaded less what was refused, each order at the stop `delivered`, and
   raises a problem of kind `refused` that counts the cartons refused (D-36, D-48). The refused cartons stay on the truck.
   *At Fresh Wellawatte the shop takes 46 of 48 chilled cartons and all 46 dry ones: 2 chilled refused, damaged, "2
   crushed at the bottom". OUT002's two orders are delivered at 46 and 46, 92 in all.*
6. **The shop is closed.** The driver may add a photo and a note, and "Save attempt and move on" makes the stop `closed`.
   Nothing is delivered, the stop's orders stay `loaded`, and a problem of kind `closed` goes to the dispatcher, counting
   what stays on the truck line by line. From then on a closed stop's lines show that attempt, on the phone and on Live
   day: loaded as its problem counted them and nothing delivered, whatever later happens to its orders. *At Fresh
   Wellawatte instead: "Nobody at the shop · since 03:45", "Waited · 3 min", "Lights off, gate locked", "94 cartons stay
   on the truck", counted 48 and 46.*
7. **Back at the depot.** "I'm back at the depot" is offered once every stop is delivered, refused or closed, and makes
   the trip `done` at the time kept. *At 03:55: "Back at Peliyagoda", "Checked in at the depot 03:55".*
8. **The answers (D-48).** The dispatcher answers a driver's problem once, from Live day's "Needs you" (spec 012). A
   refusal's one answer is "Bring them back". A closed shop's are "Try again on this trip", which opens the stop again
   while the trip is out, marked with the app clock's time it was sent back, so it comes after the other unfinished stops
   and after any stop sent back before it, and "Bring them back", which
   makes the stop's orders `placed` again with their lines' loaded and delivered counts cleared, so the next plan lists
   them as carried over and loads them afresh. The old stop stays `closed`, and the audit row of the answer keeps what that
   attempt counted. The driver sees who answered, when and one sentence. *"Bring them back": "Ruwan, dispatcher · 03:52
   · Bring the 2 chilled cartons back to Peliyagoda." "Try again": "Try Fresh Wellawatte again after the other stops.",
   and delivering it ends the trip at 117 of 118. "Bring them back" for the closed shop: OUT002's two orders are placed
   again, Friday's board lists them once its orders close, and Thursday's stop 2 still reads closed.*
9. **The counts add up.** Every carton ordered is delivered, refused, not delivered, or short from the depot. *Normal:
   117 + 1 = 118. The refusal: 115 + 2 + 1 = 118. The closed shop: 23 + 94 + 1 = 118.*
10. **Saved on the phone first (D-45, D-49, D-50).** An action is saved in the browser's database, as the exact request
    it will send with its photo, under the signed-in account, before the screen moves on. If the phone cannot save it,
    the screen says so and stays, and nothing is sent. One tab owns the driver's app: the tab that holds the browser's lock
    `wayfinder-driver`, for as long as it is open, fetches the day, keeps it and sends, and any other tab says "Wayfinder
    is open in another tab." and does nothing until that one closes. It sends oldest first, one write at a time. A send,
    or a fetch of the day, with no answer in 15 seconds is dropped and tried again on the retry schedule, a write with the
    same id. A write's answer is never shown: after each write the phone fetches the day again. The day lists the ids of
    every write the account had applied, or had answered again, in the last 48 hours, whichever trips it shows, and the
    phone takes those writes off its queue before it shows the trip or sends anything. A write stays on the phone until
    a fetched day lists it, so one whose answer was lost is never applied twice on screen or on the server, even once
    its trip has left the day. The server answers an id it has applied, with the same content, as done, and refuses the
    same id with anything else as `write_reused`. Each write names the revision of its stop, or of the
    trip for a start and an end, worked out from what the phone has saved before, so a phone that missed another phone's
    change is refused as `stale`. A refused write is never sent again: it moves to "Not accepted" with the server's
    sentence until the driver clears it, and the writes after it carry on. A write answered `signed_out` waits until the
    same driver signs in again, and another account signed in on the phone neither sees nor sends it. *Dilshan's arrival
    and refusal at Wellawatte wait on the phone and reach the server once, in that order, when the network is back.*
11. **Times (D-46).** A write carries the app clock as the phone knew it, counted on from its last contact with the
    server. The server reads its own clock only once it holds the trip's lock, and keeps the phone's time when it lies
    between the trip's last event time and that clock, otherwise the nearer of the two. The last event time is the latest
    time kept on the trip, or its ready time before the first write, and "Try again" never moves it back. The audit row
    keeps both times.

    | The phone says | The trip's last event | The server's clock | Kept |
    | --- | --- | --- | --- |
    | 03:45 | 03:38 | 03:50 | 03:45 |
    | 03:52 | 03:38 | 03:50 | 03:50 |
    | 03:30 | 03:38 | 03:50 | 03:38 |

    *After "Try again" empties stop 2's 03:45 and 03:48, an arrival the phone says was at 03:40 is kept at 03:48, the
    trip's last event.*
12. **The signal on screen.** The phone has no signal when the browser says it is offline, or when its last request got
    no answer within 15 seconds, until one gets an answer. With no signal it asks `/api/v1/health` on the retry schedule,
    after 2, 4 and 8 seconds, then every 15, whatever the browser says, and at once when the browser says it is back. The
    Next stop screen then shows the yellow bar and a saved stop shows "Saved on this phone". When the signal is back and
    everything waiting has gone, one green line names the stops that reached the depot. The waiting count counts stops
    with something waiting, and the trip's start and end, as the design's bar counts deliveries. *After the refusal with
    no signal: "Offline │ 1", then "Back online · 1 stop sent · Wellawatte reached the depot".*
13. **The numbers (D-50).** Every count on the driver's screens comes from `tripFigures` in the contracts, over the day the
    server last sent with the still-waiting writes applied by `phoneView`. The screen formats them, counts the minutes to
    leaving and waited from the app clock, and keeps the tally and the accepted and refused pair of its own forms. Live
    day's numbers come from the API, as in spec 012.

## Permissions and failure paths
Only a driver with a depot reads and writes the driver's day, and only on trips they drive. Another role gets 403
`forbidden`, an admin 403 `no_depot`, no session 401 `signed_out`, and a trip that is not theirs, or a stop or line not on
it, 400 `unknown_record`. The answers and the photo are the depot's dispatcher's, as spec 012 says. A refusal comes with
one sentence (`plan.md`, Contracts), which the phone keeps under "Not accepted".
- **No signal (D-45).** The action is saved on the phone and the screen moves on. The chip and the bar say so, and the
  write goes when the signal is back.
- **The answer is lost.** The next fetch of the day lists the write as applied, for 48 hours and whatever trips the day
  shows, and the phone takes it off its queue. A send before that fetch is answered as done.
- **A request hangs.** After 15 seconds the phone gives up on a send or a fetch and tries again on the retry schedule, a
  write with the same id, which stays on the phone until a fetched day lists it.
- **Two tabs.** Only the tab holding the driver's app fetches, keeps and sends. Another says "Wayfinder is open in
  another tab." and does nothing.
- **An id reused.** The same id with other content is refused, `write_reused`, "This record was already sent with other
  details."
- **Two phones on one trip.** The later write names an old revision: `stale`, "Fresh Wellawatte was changed on another
  phone."
- **The dispatcher answered while the phone had no signal.** After "Try again", an end of the trip saved with no signal is
  refused with `stops_left`, "Stop 2 is not done yet.", and the phone shows Wellawatte as the next stop.
- **The day was reset.** Writes for the old trip get `unknown_record`, "That trip is not on your list.", and wait under
  "Not accepted" until cleared.
- **Signed out, or another account.** A write answered `signed_out` stays waiting, never refused, under its account. The
  phone says "Sign in again to send 1 waiting record.", and the writes go once the same driver signs in. Another account
  on the phone never sees or sends them.
- **The phone cannot save.** "Could not save on this phone. Try again." The screen stays and nothing is sent.
- **A photo that is not right.** The phone shrinks it first. The server refuses anything but a whole JPEG of at most 500
  KB and 2000 px a side with `invalid_input`, "The photo must be a whole JPEG of at most 500 KB."
- **Opened with no signal (D-49).** The service worker serves the app, and the phone shows at once the account, the clock,
  the trip and the waiting writes it kept, the time counting on from the last clock it saw.
- **The phone's clock moved.** The time on screen may be wrong until the phone hears the server, and the server keeps its
  time rule (rule 11).
- **Out of order.** The screens never offer these, and the server refuses them anyway with `trip_not_ready`,
  `other_trip_out`, `trip_not_out`, `not_next`, `not_arrived`, `stop_done` and `stops_left`, and an answer that does not
  fit its problem with `invalid_input`.

## Data in and out
Three new endpoints under `/api/v1`, with shapes and steps in `plan.md`. For a driver: `GET /driver`, and `POST
/driver/writes` with one write (`start`, `arrive`, `deliver`, `refuse`, `closed` or `finish`). For a dispatcher: `GET
/issues/:issueId/photo`, and spec 012's `GET /issues` and `POST /issues/:issueId/decide` with the driver's kinds and
answers. The phone also asks the existing `GET /health`. They read the plan tables, orders and their lines, products,
outlets, vehicles, users, depots, the calendar and the problems, and write `trips`, `stops`, `order_lines`, `orders`,
`issues`, `issue_lines`, `photos`, `driver_writes` and `audit_log`. After each change commits, `driver` is announced to
the depot. A start also announces `loading`, a refusal, a closed shop and an answer also `issues`, and a delivery, a
refusal and a closed shop brought back `orders` to the shop and the depot.

## Acceptance criteria
API criteria are integration tests on the seeded day of a fresh database, clock set, each file ending with spec 008's
reset. A helper runs the walkthroughs of specs 009, 010 and 012 to VEH035 ready at Thu 02:36 and sets the clock to Thu
03:30. *Unit* ones use made-up data. Screens get a click-through in Nabil's Chrome on the built app at 390 wide as
`dilshan` and at 1440 × 900 as `ruwan`, with the network turned off in DevTools where a criterion says so.

### The driver's day
- [ ] **AC-1** When `dilshan` reads his day at Wed 24 Jun 16:00 before any send, the system shall answer Thu 25 Jun with
  `planSent` false and no trips, at Wed 24 Jun 15:59 Wed 24 Jun and no trips, and at Sat 27 Jun 16:00 no day. It shall
  write nothing.
- [ ] **AC-2** When VEH035 is ready, the day shall list no applied write and hold VEH035 trip 1: van, reefer, Fresh,
  Colombo, `ready`, ready 02:36, leaving 04:36, back by 06:10, and stops in plan order, none sent back: Fresh Nugegoda,
  Colombo, street, window 05:00 to 07:30, note "Ring the bell at the side door.", lines 12 and 8 chilled and 4 dry loaded
  at 12, 8 and 3; then Fresh Wellawatte, window 05:30 to 08:00, no note, 48 chilled and 46 dry, all loaded. Nothing is
  arrived or delivered.
- [ ] **AC-3** When a trip of the caller's is `out` on an earlier day, it shall come first, and a `done` trip of the day
  shall stay listed. Another driver's trips shall not be listed. *A test sets the rows.*
- [ ] **AC-4** When spec 012's ready and spec 010's send and unsend commit, the system shall also announce `driver` to the
  depot.

### Who may call
- [ ] **AC-5** When a request has no session, the system shall answer 401 `signed_out` on both driver endpoints and the
  photo. A store manager, a loader and a dispatcher on the driver's endpoints and a driver or loader on the photo shall
  get 403 `forbidden`, and an admin 403 `no_depot`.
- [ ] **AC-6** When a write names a trip the caller does not drive, or a stop or line that is not on it, the system shall
  answer 400 `unknown_record` with that id and change nothing. *`chaminda` writes to VEH035.*

### Spec 012 after the contracts widen
- [ ] **AC-7** When `Issue` gains the driver's kinds, the loading day shall still hold only problems of kind `loading`, a
  flag shall be refused as `already_flagged` only for a line flagged on its own trip, and spec 012's loading and issues
  tests shall pass.

### The rules on plain values
- [ ] **AC-8** *Unit.* When a time is kept, the system shall give each row of rule 11's table.
- [ ] **AC-9** *Unit.* When `applyDriverWrite` applies each of the six writes, it shall set what rules 3 to 7 set and raise
  its record's revision by one, and a refusal or a closed shop shall add its problem with the write's id. When
  `tripFigures` reads the three endings of rule 9, it shall give their counts, what is still on the truck and the next
  stop, the stops sent back coming after the other unfinished ones in the order they were sent back. When `phoneView`
  gets a day that lists a waiting write's id as applied, it shall drop that write and apply only the others.
- [ ] **AC-10** *Unit.* When a photo is checked, the system shall take a whole JPEG of at most 500 KB and 2000 px a side,
  and refuse a truncated file with no `FF D9` end, a forged start with no frame header behind its `FF D8`, a file over
  500 KB, and a picture 2400 px wide.

### Starting and the stops
- [ ] **AC-11** When `dilshan` starts VEH035 naming its revision, the system shall make it `out` with the time kept, raise
  its revision, write the audit row `trip.started`, answer the day, and after the commit announce `driver` and `loading`
  to the depot. Kasun's loading day shall no longer list VEH035.
- [ ] **AC-12** When a start names a trip that is `planned` or `loading`, the system shall answer 409 `trip_not_ready`, and
  when the vehicle's other trip is `out`, 409 `other_trip_out`, and change nothing. *VEH004's two trips, set by the test.*
- [ ] **AC-13** When starts of one vehicle's two trips arrive at once, exactly one shall succeed, and the other shall get
  409 `other_trip_out`.
- [ ] **AC-14** When Dilshan arrives at Fresh Nugegoda, the system shall write the arrival with the time kept, raise the
  stop's revision, write `stop.arrived` and announce `driver`. On a trip that is not `out` it shall answer 409
  `trip_not_out` and change nothing.
- [ ] **AC-15** When an arrival or a save names a stop that is not the next one, the system shall answer 409 `not_next`
  naming the next stop, and change nothing. *An arrival at Wellawatte before Nugegoda is done.*
- [ ] **AC-16** When Nugegoda's delivery is saved with a photo, the system shall make the stop `delivered` with the time
  kept, write the delivered counts 12, 8 and 3, store the photo under the write's id, make the three orders `delivered`
  with their revisions up, write `stop.delivered`, and announce `driver` to the depot and `orders` to OUT001 and the
  depot. Nadeesha's open list shall show her three orders delivered.
- [ ] **AC-17** When an arrival or a save names a stop already done, the system shall answer 409 `stop_done`, not
  `not_next`, though a done stop is never the next one; a save at a stop not arrived 409 `not_arrived`; and a delivery
  with no photo or one the check refuses 400 `invalid_input`. Nothing changes.

### Problems and the end of the trip
- [ ] **AC-18** When the refusal of rule 5 is saved, the system shall make Wellawatte `refused`, write the delivered counts
  46 and 46, make OUT002's two orders `delivered`, raise an open problem with the write's id, kind `refused`, reason
  `damaged`, the note, Dilshan, the time kept and the chilled line counting 2 refused, store the photo when there is one,
  write `stop.refused`, and announce `driver`, `issues` and `orders`.
- [ ] **AC-19** When a refusal refuses no carton or more than was loaded, names a line not on its stop or a line twice, or
  has a reason not in the list or a note over 200 characters, the system shall answer 400 and write nothing.
- [ ] **AC-20** When the closed shop of rule 6 is saved, the system shall make Wellawatte `closed`, leave its delivered
  counts empty and its orders `loaded`, raise an open problem of kind `closed` counting 48 and 46 on the truck, write
  `stop.closed`, and announce `driver` and `issues`.
- [ ] **AC-21** When Dilshan ends the trip with every stop done, the system shall make it `done` with the time kept,
  raise its revision, write `trip.finished` and announce `driver`. With a stop not done it shall answer 409 `stops_left`
  naming it.

### Saved once
- [ ] **AC-22** When a write arrives again with the id and content of one the server applied, the system shall answer the
  day as it is and change nothing, and when two arrive at once, apply one and answer both as done. *Each of the six writes
  sent twice writes one audit row.*
- [ ] **AC-23** When a write arrives with the id of one the server applied and another trip, kind or content, the system
  shall answer 409 `write_reused` and change nothing. *The id of Nugegoda's arrival reused for Wellawatte's, and the
  same arrival sent again with its time changed.*
- [ ] **AC-24** When a stop write names a revision that is not the stop's, or a start or end one that is not the trip's,
  the system shall answer 409 `stale` and change nothing. *Two phones arrive at Nugegoda.*
- [ ] **AC-25** When the answer to Nugegoda's arrival is lost, the day read next shall list the arrival's id, `phoneView`
  shall take it off the queue, and the delivery built from that view shall be accepted, with one `stop.arrived` and one
  `stop.delivered` in the audit log. Sent without the drop, the delivery would name a revision one too high and be refused
  as `stale`. When the answer to the end of the trip is lost and the clock moves past 16:00, so the day no longer shows
  VEH035, the day read next shall still list the end's id and the queue shall empty. A write answered more than 48 hours
  ago shall not be listed until it is sent again, when it shall be answered as done and listed once more.
- [ ] **AC-26** When a write's time lies after the server's clock or before the trip's last event time, the system shall
  keep the nearer bound, and its audit row shall hold the phone's time and the time kept. After "Try again" empties a
  stop's times, an arrival the phone dates before them shall be kept at the trip's last event time.
- [ ] **AC-27** When a second write to a trip waits for the lock held by a first, the system shall read its clock after it
  gets the lock, so the second's time kept is never before the first's. *Two writes at once, the first held in its
  transaction by the test.*
- [ ] **AC-28** When the walkthrough's writes are sent in order, each answer shall equal `phoneView` of the answer before it
  and the write.
- [ ] **AC-29** When a driver write and a demo reset arrive at once, both shall finish, and the write shall be refused with
  `unknown_record` if the reset committed first.

### The answers
- [ ] **AC-30** When `ruwan` reads what needs him after the refusal, the system shall list the problem with its kind,
  reason, note, photo, Dilshan and time, VEH035 `out` with Dilshan and no stops left, the stop's arrival, save and loaded
  times with nothing flagged at the dock, and the chilled line loaded 48, 46 delivered and 2 refused.
- [ ] **AC-31** When `ruwan` answers the refusal "Bring them back", the system shall decide it with Ruwan and the time,
  write `issue.decided`, and announce `issues` and `driver`, and Dilshan's day shall show the answer. Any other answer to
  a refusal shall get 400 `invalid_input`.
- [ ] **AC-32** When `ruwan` answers a closed shop "Try again on this trip", the system shall empty the stop's arrival,
  save time and outcome, mark it with the app clock's time it was sent back, raise its revision and leave its orders
  `loaded`, and on a trip that is `done` answer 409 `trip_not_out`.
- [ ] **AC-33** When Nugegoda is closed and sent back while Wellawatte is unfinished, Wellawatte shall be next and an
  arrival at Nugegoda shall get 409 `not_next`. When Wellawatte is then closed and sent back too, Nugegoda, sent back
  first, shall be next. When Nugegoda is closed and sent back a second time, Wellawatte shall be next, and once it is
  delivered Nugegoda shall take its arrival and delivery.
- [ ] **AC-34** When `ruwan` answers the closed shop "Bring them back", the system shall make OUT002's two orders `placed`
  with their revisions up and their lines' loaded and delivered counts empty, keep the counts of that attempt in the audit
  row, leave the stop `closed`, and announce `orders` to OUT002 and the depot. Dilshan's day shall still show Wellawatte's
  lines loaded at 48 and 46 and none delivered, and at Thu 25 Jun 16:00 Friday's board shall list the two orders as
  carried over.
- [ ] **AC-35** When Nugegoda is closed and brought back, then planned for Fri 26 Jun, loaded again with its dry line
  flagged again at 2 of 4 and sent short, and delivered on Friday, the system shall take the second flag, and Thursday's
  stop 1 shall still read `closed` with its lines loaded at 12, 8 and 3 and none delivered, in Dilshan's day read at
  Thursday's time and in the problem as Live day reads it.
- [ ] **AC-36** When an answer does not fit its problem's kind, the system shall answer 400 `invalid_input`, and spec 012's
  `stale` and `unknown_record` shall hold for the driver's kinds. Nothing changes.
- [ ] **AC-37** When `ruwan` asks for the refusal's photo, the system shall answer the JPEG. Another depot's problem shall
  get 400 `unknown_record` and a problem with no photo 404 `not_found`.

### The screens
- [ ] **AC-38** When `dilshan` opens the driver's screen with VEH035 ready, the screen shall show Today's trip with the
  walkthrough's numbers at 390 wide, and "Start trip" shall open Next stop for Fresh Nugegoda.
- [ ] **AC-39** When Dilshan arrives, counts, takes a photo and saves Nugegoda with the network on, the screen shall keep
  "Done unloading" greyed until 12, 8 and 3 are counted, show the loader's line under the dry one, and open Wellawatte's
  Next stop with "✓ Stop 1 Fresh Nugegoda delivered 03:38 · synced".
- [ ] **AC-40** When the network is off in DevTools and Dilshan arrives at Wellawatte and saves the refusal, the screen
  shall show "Offline", "Saved on this phone" and the tray at 1, then Trip done · refused with 115 of 118. When the page is
  then reloaded cold with the network still off, it shall open at once on the same screen from the account, clock, trip
  and queue the phone kept, not on the browser's offline page or a sign-in. When the network is back, within 5 seconds it
  shall say "Back online · 1 stop sent", and the audit log shall hold one `stop.arrived` and one `stop.refused` for
  Wellawatte.
- [ ] **AC-41** When Ruwan's browser is open beside the phone, his bell shall show 1 within a second of the sync, the card
  shall show the screen states' rows with "Bring them back to Peliyagoda" as its one answer, and "Send to driver" shall
  show the green card. Dilshan's phone shall show the answer within a second, and "I'm back at the depot" shall open Day
  done.
- [ ] **AC-42** When "Shop closed" is saved at Wellawatte instead, the screens shall show the closed-shop states, "Try
  again on this trip" shall bring Wellawatte back after the other stops with "Try Fresh Wellawatte again after the other
  stops.", and delivering it shall end at 117 of 118. After a reset, "Bring them back" shall show "Hand them in; they go
  on the next run."
- [ ] **AC-43** When the day is reset while writes wait on a phone with no signal, the screen shall list them under "Not
  accepted" with "That trip is not on your list." once the network is back, and "Clear" shall empty the list.
- [ ] **AC-44** When the phone cannot save a write (DevTools' simulated storage quota set to its smallest), the screen
  shall say "Could not save on this phone. Try again.", stay where it was, and send nothing.
- [ ] **AC-45** When a waiting write meets 401 (the session cookie deleted in DevTools), it shall stay waiting and not be
  marked refused, the phone shall ask the driver to sign in again, and once `dilshan` has, it shall be sent and applied
  once. When writes wait for `dilshan` and `chaminda` signs in on the same browser, the screen shall show no waiting
  record and send none of them, and when `dilshan` signs in again they shall be sent. *The writes are held by blocking
  `/api/v1/driver/writes` in DevTools.*
- [ ] **AC-46** When the computer's clock is moved two hours ahead and the page reloaded with the network off, against the
  hosted app, the screen shall open and save an arrival, and once the network is back the server shall keep the arrival
  at its own clock, not two hours ahead.
- [ ] **AC-47** When a send hangs (a DevTools network profile with 20 seconds of latency), the phone shall give it up after
  15 seconds and send the same write again later, and it shall be applied once. When the fetch after a write fails (the
  day's own address blocked in DevTools once the write is sent), the write shall stay waiting and not be sent again, the
  fetch shall be tried on the retry schedule, and once a fetched day lists the write it shall leave the phone, applied
  once. With the network off, the network tab shall show `/api/v1/health` asked on the retry schedule.
- [ ] **AC-48** When a second tab of the driver's screen is opened, it shall show "Wayfinder is open in another tab." and
  never fetch the day, keep it or send a write, as its network tab and the phone's database show, and when the first tab
  closes the second shall take over.
- [ ] **AC-49** When the other states occur, the screen shall show them as the table says: loading, could not load with the
  API stopped and nothing kept, no trip before the send, not loaded yet, sign in again, the photo that cannot be used, and
  Day done with records waiting.
- [ ] **AC-50** When a reviewer reads `features/driver`, they shall find no count worked out there but through
  `tripFigures`, only formats, the minutes to leaving and waited, and the forms' own tally and counters; the whole sync
  loop, fetching the day, keeping it and sending, inside `navigator.locks.request('wayfinder-driver', …)` held for the
  tab's life; a 15 second limit on each send and each fetch; the health probe independent of `navigator.onLine`; and, as
  spec 012's AC-33 asks, no write's answer put in the view, only the day fetched again after each write.
- [ ] **AC-51** When a reviewer reads the service worker's settings and the network tab with the network off, `/api`
  requests shall fail and never come from the service worker.

## Walkthrough
It follows spec 012's: Kasun marked VEH035 ready at 02:36, 117 of 118 cartons on and 1 dry carton short for Fresh
Nugegoda, and Dilshan drives it. The times below are examples.

1. Move the clock on to "Trucks leave, Thu 03:30".
2. On a phone, or Chrome at 390 wide, sign in as `dilshan`. Today's trip: "Thu 25 Jun · trip 1", "VEH035", "leaves 04:36
   · in 1 h 5 min", "Fresh · Colombo · back by 06:10", "✓ Loaded · 117 of 118 · 1 dry short for Nugegoda", then "1 ·
   Fresh Nugegoda · 05:00 to 07:30 · 23 of 24 cartons" and "2 · Fresh Wellawatte · 05:30 to 08:00 · 94 cartons". Tap
   "Start trip".
3. Next stop: "Stop 1 of 2", "Fresh Nugegoda", "Colombo · street", "05:00 to 07:30", "window · on time", "Unload 23
   cartons", "20 chilled", "3 dry", the note "Ring the bell at the side door.", "Left Peliyagoda 03:31". Tap "I've
   arrived".
4. Unload: count 12 and 8 chilled and 3 dry, where "Loader flagged 1 carton short at the depot" sits under the dry line.
   Tap "Done unloading", then "Take photo" (on a laptop, pick any picture), then "Save delivery". Next stop shows "✓ Stop
   1 Fresh Nugegoda delivered 03:38 · synced" and "Stop 2 of 2 · Fresh Wellawatte".
5. Turn the network off: in Chrome, DevTools, Network, "Offline". The chip turns "Offline" and the bar says "No signal ·
   everything is sent". Tap "I've arrived": the chip shows the tray with 1.
6. Tap "Something's wrong", keep "Shop refused some", pick "48 cartons chilled", tap + on "Refused" twice to "Accepted 46
   /48" and "Refused 2 /48", choose "Damaged", write "2 crushed at the bottom" and tap "Save partial delivery": "Saved on
   this phone", "Fresh Wellawatte · stop 2 of 2". Tap "Continue route": Trip done, worked out on the phone: "! Stop 2 ·
   92 delivered · 2 refused · on this phone", "Stops 2 of 2", "Cartons delivered 115 of 118", "Refused 2 · Wellawatte",
   "Short from the depot 1 dry · Nugegoda", and "Still on the truck". Reload the page with the network still off: it
   opens at once on the same screen, "Offline │ 1".
7. Turn the network back on. Within a few seconds: "Back online · 1 stop sent" and "Wellawatte reached the depot", and the
   chip turns "● Online".
8. In a desktop browser, sign in as `ruwan`. The bell shows 1. Live day: "2 chilled cartons refused", "Fresh Wellawatte ·
   stop 2 · VEH035 · Dilshan · damaged, the shop took 46 of 48 chilled", "Note · 2 crushed at the bottom" and "Still on
   VEH035 · 2 chilled cartons · no stops left", with "Bring them back to Peliyagoda" chosen. Tap "Send to driver": "✓ Sent
   03:52" and "VEH035 · 2 cartons back to Peliyagoda, Dilshan told".
9. On the phone, without a reload: "Ruwan, dispatcher · 03:52 · Bring the 2 chilled cartons back to Peliyagoda." Tap
   "I'm back at the depot": "✓ Trip closed · 2 of 2 stops · all records sent", "Back at Peliyagoda" and "Checked in at the
   depot 03:55".
10. As `nadeesha`, Orders shows her three Thursday orders "Delivered", ready for the shop to confirm (A5).

**The closed shop.** At step 6 choose "Shop closed" instead: "Nobody at the shop · since 03:45", "Waited · 3 min" and "94
cartons stay on the truck", then "Save attempt and move on". Ruwan's card is "Nobody at Fresh Wellawatte". "Try again on
this trip" makes Wellawatte Dilshan's next stop again, after any stop still to do, and delivering it ends at 117 of 118.
"Bring them back" ends with "Hand them in; they go on the next run.", and OUT002's two orders are placed again for
Friday's plan while Thursday's stop 2 stays closed.

**The data.** Nothing new is seeded. Both problems happen at Fresh Wellawatte, stop 2 of VEH035 in spec 010's walkthrough
(OUT002's 48 chilled and 46 dry cartons), by the driver's choice under "Something's wrong". The short dry carton is spec
012's.

## Out of scope
- **A5:** the shop's receipt (Shop · Confirm delivery, "12 expected", the cold check), its short or damaged report as a
  kind of problem, the receipt that waits on the shop's phone (Shop · Short delivery · receipt pending sync, Shop ·
  Receipt sent), the driver's outcomes and the dispatcher's answers on the shop's cards, and "Send 2 replacements on Tue
  29", a new order for the shop.
- **A7:** the rest of Live day (the trucks' timelines, counts, "Drops and events" such as "VEH041 · Fresh Hatton · 5 ·
  photo", "Undo", "Next · … · Open next", a truck shown "offline · 12:38" and the "Watching" row, "35 min behind" and
  arrival estimates), and the bell's count on the driver's phone.
- **A8:** History, where every stop keeps its receipt and photo, and the attempts the audit log keeps.
- **Spec 012, open question 1:** the loader's flag photo. It can use `photos` with the flag's problem id in a small task
  after this piece.
- **Not planned:** "Call the shop", the "Called the shop · 2 tries, no answer" row and "Call Prasanna" (the data has no
  phone numbers, D-40), "Get a signature instead", "dock 2" (D-40), the "Damaged", "Wrong item" and "Cannot reach" chips,
  "Write off on the road", "shop credited, claim opened", push notifications, sounds, Background Sync, a map or GPS, and
  an installable app.

## Departures from the design
1. No "Call the shop", no "Called the shop" row and no "Call Prasanna": the data has no phone numbers (D-40).
2. No "Get a signature instead": the design has no frame for signing, and the photo is the proof (D-47).
3. "What's wrong?" has "Shop refused some" and "Shop closed". A damaged or wrong carton is one the shop refuses, with
   "Damaged" or "Not ordered" as its reason, and "Cannot reach" has no frame.
4. Today's trip names no dock (D-40), and a stop's line under its name is the district and entrance, "Colombo · street":
   the data has no address.
5. A stop lists its lines, so Nugegoda's two chilled orders are two counters, as the loader's screens do (spec 012). Style
   and Tech lines name the item.
6. A refusal has one answer, "Bring them back", and the button says "Send to driver". There is no "Write off on the road"
   and no "Send 2 replacements" (D-48), and no "shop credited, claim opened": the cartons are on the truck, and a
   write-off or a replacement is a record the depot adds later.
7. A closed shop is answered with "Try again on this trip" or "Bring them back"; no frame draws them.
8. "Nothing to hand back" says the short carton never left the depot, without "It goes on Monday's run": nothing here
   makes a new order for it, as in spec 012's departure 8.
9. The driver's bell has no count. Spec 016 (A7) leaves it out too.
10. The top bar also carries the demo chip, as "Demo" alone next to the status chip on a phone (spec 008).
11. States the design lacks: not loaded yet, no trip, could not load, the waiting sheet, not accepted, sign in again, could
    not save on this phone, the unusable photo, the answer on the phone, a stop to try again, and Day done with records
    waiting.

## Known limits
1. **The server checks a photo's structure and never decodes the picture.** It takes a file that starts `FF D8`, ends `FF
   D9`, is at most 500 KB and whose frame header gives at most 2000 px a side. The phone makes every photo from a canvas,
   so a real one always decodes. A file made to pass the check without decoding would show as a broken picture on the
   dispatcher's card and harm nothing else.

## Open questions
1. **May the driver start before the trip's leaving time?** The demo clock starts the road at 03:30 and VEH035 leaves at
   04:36, so without it a judge waits an hour. A real driver leaving early reaches a shop before its window and waits
   there. Our pick: yes, as built. The dispatcher chose the time (D-19), and the app records when the truck really left.
2. **Must every delivery have a photo?** The design offers a photo or a signature, and we build no signature. On a laptop a
   judge picks any picture file. Our pick: yes. Proof of delivery is what the booklet asks the driver for, and a delivery
   without it is the dispute the design exists to prevent.
3. **"Send replacements on the next run" now, or with the shop's receipt?** It is the design's third answer to a refusal
   and needs a new order for the shop. Our pick: with A5, whose short receipt needs the same answer, so both make the
   order one way. Until then the shop can place another order (spec 009) and the README lists it.
