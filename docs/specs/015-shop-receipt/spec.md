# 015 · The shop's receipt

**Status:** Done, with five open questions at the bottom  ·  **Owner:**  ·  **Design:** Shop · Confirm delivery; Shop · Short delivery · receipt pending sync; Shop · Receipt sent; Shop · Help; the received cards of Shop · Today, Shop · Today · desktop, Shop · Orders · Past and Shop · Orders · desktop; and the right-hand column of Dispatcher · Live day · issue open and · issue open · decision sent.

Pieces A5 and A6 of [the map](../000-map.md): the shop confirms what arrived and reports what is short or damaged, and
the receipt waits on the shop's phone when there is no signal (D-43). It starts where spec 013 ends, with Dilshan's
delivery at Fresh Nugegoda saved and its three orders `delivered`. The shop's screens are spec 009's, the problems and
Live day's "Needs you" column spec 012's, and the stops, the delivered counts, the photos and the phone's save-first queue
spec 013's.

## Why
The booklet gives the store manager no way today to confirm what arrived or to report what is wrong with it, and asks for
one (page 6). The shop checking its goods in is the last stage of the day the system connects (page 7), and the judges'
walkthrough ends with the goods taken in at the shop (page 11). A shop's signal fails like a driver's, and what is
recorded with no signal has to match up with the server once it is back (pages 4 and 5). Offline operation and recovery
is a tenth of the marks (page 13).

## What it does
Once the driver has handed a delivery over, the shop opens Deliveries and counts what came, one line at a time, against
what the driver handed over. Anything missing or damaged is said in the same step, the chilled goods get a cold check,
and a photo can go with the report. The receipt is saved on the phone first and sent once, so a counter with no signal
confirms anyway and never confirms twice. A receipt that reports something goes to the dispatcher, who sends replacements
on the next run or decides there are none. The shop's cards say what happened on the road, what the shop received and
what the depot answered. On the walkthrough Nadeesha confirms Thursday's delivery at 08:31 with the network off, one of
her 12 chilled cartons missing, the receipt reaches the depot when the network is back, and Ruwan sends one replacement
for Friday.

## Decisions
These are in `docs/decisions.md`.
- **D-56 · The shop confirms each delivery whole, one stop's orders at once, and counts against what the driver handed
  over** (our pick, open question 1). The orders of a stop arrive together, and a carton short from the depot or refused
  at the door was reported where it was found, so the receipt shows those and asks only what the shop counts.
- **D-57 · A receipt is saved on the shop's phone first and sent once, through the driver's queue: one table of applied
  phone writes, one store, sender and signal on the phone, the same time rule with the handover as its lower bound, and a
  view function of its own in the contracts. A receipt waiting or refused on the phone shows from the phone's own copy of
  it, and in the shop's area only Deliveries waits for the tab that owns the queue** (our pick for the tabs, open question
  5). One way to keep a write safe without a signal is easier to get right than two, a receipt the depot turned down must
  stay where the shop can read and clear it even after its delivery is gone, and the shop's other screens keep working
  online in any tab, as spec 009 built them.
- **D-58 · A receipt with anything missing, damaged or not cold is a problem of kind `receipt`, answered once from Live
  day's "Needs you" with "Send N replacements" or "No replacement"** (our pick for the second answer, open question 3).
  The dispatcher decides every problem in one place (D-36), reporting a carton does not replace it, and the depot may
  have none to send.
- **D-59 · "Send N replacements" places a new order for the shop, one per temperature, and another for each 999 units
  of one product beyond the first, for the day an order placed at that moment is for, pointing at the problem it answers.
  It answers a shop's report and, beside "Bring them back", a driver's refusal. Neither it nor a part of it, when the plan
  splits it, counts as the shop's own next order.** An order of its own is planned, checked, loaded and confirmed like
  any other, so a replacement needs no new path, and the shop never sees the depot's order counted as one it placed. No
  line of it holds more than the 999 a receipt counts on a line, though two of the shop's orders can hold more of one
  product between them, so the shop can confirm everything it is sent. A part of a split replacement is still a
  replacement, through the link every part keeps to its original (D-30). This takes over the replacements half of D-48's
  last sentence. Writing cartons off is still not built.
- **D-60 · "Still cold on arrival? No" is a report even when every carton is there** (our pick, open question 2). Warm
  chilled goods are the depot's to know about, and an answer that reaches nobody would make the question decoration.
- **D-61 · A receipt is kept on the orders it covers: each line's received count, and on each order when the shop
  confirmed, when the receipt reached the depot and, for a chilled order, whether it arrived cold.** Every shop card reads
  its own order, also history that never travelled on a planned trip.
- **D-62 · The seeded shop history arrives received, with its counts and times, and Wednesday's 6 dry cartons were
  received at 07:42.** A delivered order that the seed puts on no trip could never be confirmed, and the design's Today
  and Past draw the shop's history as received. This changes spec 009's seed, where Wednesday's order waited to be
  confirmed. An existing install takes it through a demo reset, since the seed writes nothing on a day already seeded.

## Screen states
"No frame" means the smallest state that fits the style guide. The shop's screens are built at 390 wide first, and from
1024 wide Deliveries keeps one column, as Help does. Words in quotes are the walkthrough's.

| Screen | State | Frame | What shows |
| --- | --- | --- | --- |
| Deliveries `/store/deliveries` and `/store/deliveries/:stopId` | Loading | Loading · skeleton | Grey blocks for the title, two line cards and the button, on the first load with nothing kept on the phone. |
|  | To confirm | Shop · Confirm delivery | "Confirm delivery" and "Arrived 03:34 · VEH035 · Dilshan" (the day is added when it is not today). A card per line in spec 012's order: the goods picture (chilled or dry for Fresh, the brand's for Style and Tech), "Chilled cartons" or "Dry cartons" (the item's name for Style and Tech), "12 expected" on the right, then "Received" with −, the count and +. The count starts at what was handed over and can be typed. Under a line below it, the yellow chip "1 carton missing", or "damaged" as chosen. Under a line short from the depot, the design's shortfall picture and "1 short from the depot"; under a line refused at the door, "2 refused at the door". When a chilled line came, the card "Still cold on arrival?" with "Yes", chosen, and "No". The orange "Confirm delivery", at the foot of a phone screen. |
|  | Something is wrong | No frame | Once a count is lower: "What's wrong?" with "Missing", chosen, and "Damaged", as the loader's flag form draws its reasons. Once a count is lower or the answer is "No": the plain "Add a photo (optional)", which opens the camera, or the file picker on a laptop. |
|  | A photo | No frame, spec 013's photo tile | The photo in the tile with "Retake photo", or "That picture could not be used. Take it again." in red. |
|  | Sending | No frame | The button says "Sending…" and waits, while the phone has a signal and the receipt is on its way. |
|  | Saved on this phone | Shop · Short delivery · receipt pending sync | Drawn from the phone's own copy of the receipt, whether or not its delivery is still in the list. The design's tray picture, "Receipt saved on this phone", and "The connection dropped while sending." after a send that got no answer, or "There is no signal right now." A card per line: "12 chilled cartons expected", "Received 11 cartons" and, when short, "Missing 1 carton" in yellow ("Damaged" as chosen). The card "Not sent to the depot yet", yellow, with "Your receipt and report are kept together. They will retry when the connection returns. You do not need to confirm this delivery again." ("Your receipt is kept on this phone. …" when it reports nothing). The orange "Retry sending", and "Saved at 08:31 · waiting to sync". |
|  | Sent, waiting for the depot | Shop · Receipt sent | The design's receipt picture, "Receipt sent to the depot", "Confirmed at 08:31 · Fresh · Nugegoda", the line cards, the green chip "Awaiting depot review" with "The depot has your receipt and shortage report. The missing carton still needs a resolution. Reporting it does not mark it as replaced." ("damage report", "The damaged carton…", or "your report that the chilled goods were not cold" as reported), the orange "View past orders", and "Sent at 08:33 · shortage unresolved". |
|  | Sent, all received | No frame | As above, with the green chip "All received", "The depot has your receipt.", and "Sent at 08:33". |
|  | Sent, answered | No frame | The green chip "Replacement on Fri 26 Jun" with "The depot is sending 1 chilled carton on Fri 26 Jun. It shows in your open orders.", or the grey chip "No replacement" with "The depot will not replace the missing carton. Place another order if you need it." The foot: "Sent at 08:33 · replacement on Fri 26 Jun" or "· no replacement". |
|  | Nothing to confirm | No frame | "Deliveries", "No delivery is waiting for you to confirm." and the plain "View past orders". |
|  | Not accepted | No frame | On the saved screen, in red: "The depot did not accept this receipt." and the server's sentence, such as "This delivery was already confirmed." or "That delivery is not on your list.", with "Clear", which takes it off the phone and shows the delivery as the depot has it, or "No delivery is waiting for you to confirm." when the depot no longer has it. It shows from the phone's copy, also after a reset or a reload, until it is cleared. |
|  | Sign in again | No frame, spec 013's line | A yellow line: "Sign in again to send this receipt." with "Sign in". |
|  | Could not save | No frame | "Could not save on this phone. Try again." in red on top of the form, which keeps its counts. Nothing is sent. |
|  | Could not load | No frame | "Could not load your deliveries." and "Try again", only when nothing is kept on the phone. |
|  | Another tab | No frame, spec 013's line | "Wayfinder is open in another tab." in place of Deliveries, in every tab but the one that owns the shop's queue. The shop's other pages work there. |
|  | Not on your list | No frame | "This delivery is not on your list." with "Back to Deliveries", for an address of another shop's stop. |
| Today `/store` | Handed over | No frame | Spec 009's card with the chip "Delivered" and "Delivered 03:38 · VEH035 · Dilshan", and when less came than was ordered, "3 of 4 delivered · 1 short from the depot" or "46 of 48 delivered · 2 refused, damaged". |
|  | Received | Shop · Today, and its desktop frame | The chip "Received 08:31" in green, and "All 8 received" or "11 received · 1 short". |
|  | Nobody at the shop | No frame | The chip "Loaded" and "Nobody at the shop at 03:45 · VEH035". |
|  | The depot's answer | No frame | One line per problem of the delivery that counts the order, under the card's other lines (rule 11). |
| Orders `/store/orders` | Received | Shop · Orders · Past, Shop · Orders · desktop | The chip "All 8 received" in green or "11 received · 1 short" in yellow, and "Received 08:31", or "Arrived 08:25, after your window". A card whose receipt reported something opens that receipt. |
|  | Handed over, nobody at the shop, answers | No frame | Today's lines, on the open list's card. |
|  | A replacement | No frame | Spec 009's card for its status, and "Replacement for Thu 25 Jun", also on each part when the plan splits it. |
|  | Past, from a receipt | Shop · Orders · Past | "View past orders" opens Orders with Past chosen on a phone. |
| Help `/store/help` |  | Shop · Help | Spec 009's screen. "Open delivery confirmation" now opens the real Deliveries. |
| Live day `/dispatcher/live` | A shop's report open | No frame, the card of Dispatcher · Live day · issue open | Spec 012's card: "08:31", "1 chilled carton missing", "Fresh Nugegoda · stop 1 · VEH035 · Dilshan · delivered 03:38", the rows "Shop · Nadeesha · 08:31", "Received · 11 of 12 chilled cartons", "Cold on arrival · yes" and "Photo" when there is one, which opens it. "What should the depot do?", the option cards "Send 1 replacement on Fri 26 Jun" ("The shop gets it on the next run."), chosen, and "No replacement" ("Nothing more is sent. The shop is told."), and the orange "Send to shop". |
|  | A refusal open | Dispatcher · Live day · issue open | Spec 013's card with a second option, "Send 2 replacements on Fri 26 Jun" ("The driver brings them back, and the shop gets 2 on the next run."), and the orange "Send to driver and shop", as the design draws it. A closed shop's card keeps its two answers and its button says the same, since the shop now sees the answer too. |
|  | Answer sent | Dispatcher · Live day · issue open · decision sent, its green card | "✓ Sent 08:35" and "Fresh Nugegoda · 1 replacement on Fri 26 Jun, Nadeesha told", or "Fresh Nugegoda · no replacement, Nadeesha told". Spec 013's lines for a driver's problem end "Dilshan and the shop told", and a refusal answered with replacements reads "VEH035 · 2 cartons back, 2 replacements on Fri 26 Jun, Dilshan and the shop told". |

## Rules
Examples use the seeded day with the walkthroughs of specs 009, 010, 012 and 013 done: VEH035 trip 1, Dilshan driving,
stop 1 Fresh Nugegoda (OUT001: the 12 chilled cartons carried over from Wed 24 Jun, the 8 chilled and 3 of the 4 dry
cartons Nadeesha placed, window 05:00 to 07:30, street) arrived 03:34 and handed over at 03:38, and stop 2 Fresh
Wellawatte (OUT002: 48 chilled and 46 dry) where the shop refused 2 damaged chilled cartons. The clock is then moved on to
Thu 08:30. Times are depot time and depend on the judge's pace.

1. **A delivery (D-56).** A delivery is one stop of a sent plan at the shop that the driver saved as delivered or
   refused (spec 013, rules 4 and 5). Its orders arrived together and are confirmed together. Deliveries holds the shop's
   deliveries whose orders are still `delivered`, oldest handover first, and those confirmed on the app clock's today. It
   opens the first receipt waiting or refused on the phone, else the first delivery to confirm, else says nothing is
   waiting. A stop where nobody was at the shop is not a delivery: nothing was handed over (spec 013, rule 6). *At Thu
   08:30 Nadeesha has one delivery: VEH035's stop 1. Fresh Wellawatte's is OUT002's and never hers.*
2. **What the shop counts against (D-56).** A line expects what the driver handed over. What the depot sent short and
   what the shop refused at the door were reported where they were found (specs 012 and 013), so the line says so and
   the shop is not asked about them again. *Nugegoda's lines expect 12 and 8 chilled cartons and 3 dry ones, with "1 short
   from the depot" under the dry line. At Wellawatte the chilled line would expect 46, with "2 refused at the door".*
3. **Confirming.** Each line's count starts at what was handed over, and goes from 0 to it. Under a line below it the
   form shows the units missing. Once a count is lower, the shop says what is wrong, "Missing" or "Damaged", once for the
   receipt. When a chilled line came, the shop answers "Still cold on arrival?", which starts at Yes. A photo may be added
   once the receipt reports something: a count is lower, or the answer is No. "Confirm delivery" sends every line of the
   delivery once, a line handed over at 0 at 0. A receipt can name every line a stop can hold: up to 300 orders of up to
   20 lines each, 6,000 lines. *Nadeesha lowers the 12 to 11: "1 carton missing", Missing, Yes.*
4. **What a receipt records (D-61).** Each line's received count. On each order of the delivery: `received`, when the shop
   confirmed (the time kept, rule 8), when the receipt reached the depot, and for a chilled order whether it arrived
   cold. The stop's revision goes up by one. *Her three orders are received at 08:31 and sent at 08:33, with 11, 8 and 3,
   the two chilled ones cold.*
5. **The report (D-58, D-60).** A receipt with a line below what was handed over, or No to the cold check, is also a
   problem of kind `receipt`. Its id is the receipt's. Its reason is the shop's, `missing` or `damaged`, or `not_cold` when
   nothing is short. It counts each short line at the units short, and when the chilled goods were not cold, each chilled
   line too, at 0 when nothing is short on it. The photo goes with it. *Nadeesha's report: missing, the 12-carton line
   counted at 1. Had she answered No with every count full: not cold, the 12 and 8 chilled lines counted at 0.*
6. **Saved on the phone first (D-57).** Spec 013's rule 10, with the shop's own parts. "Confirm delivery" saves the
   receipt in the phone's database as the exact request it will send, photo and all, under the signed-in account, before
   the screen moves on, and the tab that owns the shop's queue sends it, oldest first and one at a time. The receipt names
   the stop's revision, which the phone reads from the delivery on screen. The deliveries the server sends list the ids of
   the receipts the account had applied in the last 48 hours, and a receipt leaves the phone once they list it. A
   receipt the server refuses is never sent again: it stays on the screen with the server's sentence until the shop
   clears it. A receipt waiting or refused on the phone shows from the phone's own copy of it, the request and the
   delivery as the form showed it, whether or not its delivery is still in the list the server sends, so it outlives a
   reset and a reload. One answered `signed_out` waits for the same account to sign in again. While the phone has a
   signal the button says "Sending…" until the receipt is listed; with no signal, or after 15 seconds with no answer, the
   screen shows the receipt saved on this phone. In the shop's area only Deliveries waits for the owning tab. Today,
   Orders, New order and Help work in any tab, online, as spec 009 built them. *With the network off, Nadeesha's receipt
   waits on the phone at 08:31 and reaches the depot once, at 08:33, when the network is back.*
7. **Once per delivery.** A delivery is confirmed once. The same receipt sent again is answered as done, and its id sent
   with anything else is refused, `write_reused`. Any other receipt for a delivery already confirmed is refused, `stale`:
   "This delivery was already confirmed.", whatever revision it names. The server reads the stop and its orders once it
   holds the trip's lock and judges the receipt on those, so of two receipts sent at once only the first applies, and a
   receipt that waited behind a driver's write on the same trip sees what that write left. Nothing changes a receipt once
   it is in.
8. **Times (D-46, D-57).** A receipt carries the app clock as the phone knew it. The server reads its own clock once it
   holds the trip's lock, and keeps the phone's time when it lies between the handover, the stop's done time, and that
   clock, otherwise the nearer of the two. The time the receipt reached the depot is the server's clock. A receipt never
   moves the trip's last event time, which belongs to the driver's writes (spec 013, rule 11). The audit row keeps both
   times.

   | The phone says | Handed over | The server's clock | Kept |
   | --- | --- | --- | --- |
   | 08:31 | 03:38 | 08:33 | 08:31 |
   | 08:40 | 03:38 | 08:33 | 08:33 |
   | 03:30 | 03:38 | 08:33 | 03:38 |

9. **The answers (D-58, D-59).** The dispatcher answers a shop's report once, from Live day's "Needs you" (spec 012):
   "Send N replacements" or "No replacement". A driver's refusal keeps "Bring them back" (spec 013) and gains "Send N
   replacements": the driver still brings the refused cartons back, and the shop gets N on the next run. N is the units
   the problem counts, and the answer needs at least 1, so a report about the cold alone offers only "No replacement".
   The shop sees every answer on its order cards, and the answer to its own report on its receipt as well. The answer to
   a driver's refusal shows on the order cards only, and on the driver's phone. *Ruwan sends 1 replacement for
   Nugegoda's missing carton.*
10. **Replacements (D-59).** "Send N replacements" places one order per temperature for the shop, and another for each
    999 units of one item beyond the first, for the day an order placed at that moment is for (spec 009, rule 2), with a
    line per item holding the units the problem counts on it, never more than the 999 a receipt counts on a line. The
    dispatcher places it at the app clock's time, and it points at the problem. It is planned, loaded, handed over and
    confirmed like any other order. The shop's next order does not count it as one the shop placed. With no day open the
    answer is refused. When the board or the suggested plan splits a replacement, both parts are replacements (D-30), and
    joined again it is one; the answer's replacement stays what it placed, whatever the plan does with it. *At 08:35, 1
    chilled carton for Fresh Nugegoda for Fri 26 Jun, placed by Ruwan. Answered at Thu 16:05 it would be for Sat 27 Jun. A
    report of 1 chilled and 1 dry carton makes two orders, and a refusal of two orders of 500 dry cartons an order of 999
    and one of 1.*
11. **The shop's cards.** Spec 009's card, with what happened from the order's latest stop on a sent plan on:
    - Handed over and not yet confirmed: "Delivered 03:38 · VEH035 · Dilshan", and when less came than was ordered, "3 of
      4 delivered · 1 short from the depot" or "46 of 48 delivered · 2 refused, damaged".
    - Confirmed: on Today the chip "Received 08:31" and "All 8 received" or "11 received · 1 short". In Orders the chip
      "All 8 received", green, or "11 received · 1 short", yellow, and "Received 08:31", or "Arrived 08:25, after your
      window" when the truck arrived after the shop's window closed (its mall slot, as spec 007 times it). The short from
      the depot or refused line stays.
    - Nobody at the shop: "Nobody at the shop at 03:45 · VEH035", also once the order is placed again.
    - One line per problem of that stop that counts the order: a refusal "The depot decides what happens to the 2
      refused cartons.", "The 2 refused cartons go back to the depot." or "2 replacements come on Fri 26 Jun."; nobody
      at the shop "The depot decides: today or another day.", "The driver comes back after the other stops." or "It
      goes on the next plan."; a report "The depot is reviewing your report.", "1 replacement comes on Fri 26 Jun." or
      "No replacement is coming."
    - A replacement: "Replacement for Thu 25 Jun", the day of the delivery it replaces, also on each part when the plan
      splits it.
    - A card whose receipt reported something opens that receipt, as the design's "View shortage report" does.

    *Nadeesha's 12-carton card after the answer: "11 received · 1 short", "Received 08:31", "1 replacement comes on Fri 26
    Jun."*
12. **What the dispatcher sees.** A shop's report is a card in "Needs you", oldest first with the others (spec 012): the
    title by reason, "1 chilled carton missing", "1 chilled carton damaged" or "Chilled goods not cold"; the place line
    with the stop, truck, driver and handover time; the rows "Shop", "Received" (each counted line as received of handed
    over), "Cold on arrival" when chilled goods came, and "Photo" when there is one; the two answers, the first with the
    day a replacement would be for now; and "Send to shop". The answer becomes the green line until the next answer or a
    reload, and the bell counts open reports with the other problems.
13. **The numbers.** Every count on the receipt screens comes from `deliveryFigures` in the contracts, over the deliveries
    the server last sent with the waiting receipt applied by `receiptView` (D-50's way for the driver). The form keeps its
    own counters and the units missing under each. The cards' and Live day's numbers come from the API. The screens
    format them and add nothing up.

## Permissions and failure paths
Only a store manager with a shop reads its deliveries and confirms them, and only on stops at that shop. Only a dispatcher
with a depot answers a report, on that depot (D-32). Another role gets 403 `forbidden`, an admin 403 `no_outlet` on the
shop's endpoints and 403 `no_depot` on the dispatcher's, and no session 401 `signed_out`, with the sentences every route
already answers. The server checks the rest in this order, and each refusal comes with one sentence, which the screen
shows as it is:

| The server checks | Code | Sentence |
| --- | --- | --- |
| The request is at most 2 MB | 413 `too_large` | "That request is too big." |
| The request names the session's account in `X-Wayfinder-Account`, as the phone names the account that saved it | 409 `other_account` | "This record was saved by another account. Sign in as that account to send it." |
| The request has the receipt's shape, with at most 6,000 lines | 400 `invalid_input` | "Some fields are missing or wrong." |
| The stop is at the caller's shop, on a sent plan | 400 `unknown_record` | "That delivery is not on your list." |
| The receipt's id was not sent before with other content, kind or trip | 409 `write_reused` | "This record was already sent with other details." |
| The delivery is not confirmed yet, whatever revision the receipt names | 409 `stale` | "This delivery was already confirmed." |
| The receipt names the stop's revision | 409 `stale` | "This delivery changed after this phone read it." |
| The stop was handed over, delivered or refused | 409 `not_delivered` | "This delivery has not been handed over." |
| Every line named is on the stop | 400 `unknown_record` | "That line is not on this delivery." |
| Every line of the stop is named once | 400 `invalid_input` | "Count every line of the delivery once." |
| Each count is from 0 to what was handed over | 400 `invalid_input` | "Count no more than was handed over on each line." |
| The cold check is answered exactly when a chilled line came with something on it | 400 `invalid_input` | "Say whether the chilled goods were still cold." or "Answer the cold check only when chilled goods came." |
| What is wrong is said exactly when a line is short | 400 `invalid_input` | "Say what is wrong with the cartons that are short." or "Say what is wrong only when a line is short." |
| A photo goes only with a report, as a whole JPEG of at most 500 KB and 2000 px a side | 400 `invalid_input` | "Add a photo only to a report." or "The photo must be a whole JPEG of at most 500 KB." |
| An answered problem is the caller's depot's | 400 `unknown_record` | "That problem is not on this depot's list." |
| The answer names the open problem's revision | 409 `stale` | "This problem was already answered." |
| The answer fits the problem's kind | 400 `invalid_input` | "That answer does not fit this problem." |
| "Send N replacements" has at least one unit to replace | 400 `invalid_input` | "Nothing is short, so there is nothing to replace." |
| A delivery day is open for the replacement | 409 `no_delivery_day` | "No delivery day is open for a replacement." |

- **No signal (D-57).** The receipt is saved on the phone and the screen says so. It goes when the signal is back.
- **The answer is lost.** The next deliveries the phone fetches list the receipt as applied, for 48 hours, and the phone
  takes it off its queue. A send before that fetch is answered as done.
- **A request hangs.** After 15 seconds the phone gives up on a send or a fetch and tries again on spec 013's retry
  schedule, with the same id.
- **Two tabs.** Only the tab that owns the shop's queue fetches, keeps and sends. Deliveries in another tab says
  "Wayfinder is open in another tab." and the rest of the shop's area works there.
- **Two phones, one delivery.** The later receipt is refused `stale`, "This delivery was already confirmed.", whatever
  revision it names, also when both arrive at once. It shows under "Not accepted" until cleared, and the delivery shows
  as the depot has it.
- **Waiting behind the driver.** A receipt that waits for the trip's lock behind a driver's write on the same trip is
  judged on the stop and its orders as that write left them.
- **An id reused.** `write_reused`, "This record was already sent with other details."
- **The day was reset.** A receipt for the old day gets `unknown_record`, "That delivery is not on your list.", and stays
  under "Not accepted", drawn from the phone's copy, also after a reload, until it is cleared.
- **Signed out.** A receipt answered `signed_out` waits, never refused, under its account, with "Sign in again to send this
  receipt." Another account on the phone never sees or sends it.
- **Another account's session.** Another account signed in in another tab after the phone read the deliveries, even a
  manager of the same shop, holds the session the send carries. The server answers `other_account`, and the receipt waits
  as when signed out, never applied as theirs and never refused, until its own account signs in again.
- **The phone cannot save.** "Could not save on this phone. Try again." The form stays and nothing is sent.
- **A photo that is not right.** The phone shrinks it first (spec 013). The server takes only a whole JPEG of at most 500
  KB and 2000 px a side, `invalid_input`, "The photo must be a whole JPEG of at most 500 KB."
- **Opened with no signal.** The service worker, the kept account and the kept clock are spec 013's. Deliveries opens at
  once from the deliveries and receipts the phone kept. Today, Orders and New order say they could not load, as spec 009
  has them.
- **The phone's clock moved.** The server keeps the time rule (rule 8).
- **The depot's answer.** A second answer to the same report gets spec 012's `stale`. "Send N replacements" with no day
  open gets `no_delivery_day`, "No delivery day is open for a replacement.", and one that does not fit the problem
  `invalid_input`.
- **Out of order.** The screens never offer it, and the server refuses a receipt for a stop that was not handed over with
  `not_delivered`, "This delivery has not been handed over."

## Data in and out
Three new endpoints under `/api/v1`, with shapes and steps in `plan.md`. For a store manager: `GET /store/deliveries`,
`GET /store/deliveries/:stopId` and `POST /store/receipts` with one receipt. Spec 009's `GET /store/orders` gives each
order what its card needs, and spec 012's `GET /issues` and `POST /issues/:issueId/decide` take the report's kind and the
replacement answer. The dispatcher opens a report's photo through spec 013's `GET /issues/:issueId/photo`. They read the
plan tables, orders and their lines, products, outlets, vehicles, users, the calendar, the problems and `phone_writes`,
and write `orders`, `order_lines`, `stops`, `issues`, `issue_lines`, `photos`, `phone_writes` and `audit_log`. After a
receipt commits, `orders` is announced to the shop and its depot, and `issues` to the depot when it reports something.
After an answer, `issues` goes to the depot and `orders` to the shop and its depot, and for a driver's problem `driver` to
the depot as spec 013 does.

## Acceptance criteria
API criteria are integration tests on the seeded day of a fresh database, clock set, each file ending with spec 008's
reset. A helper runs the walkthroughs of specs 009, 010, 012 and 013 to Nugegoda handed over at 03:38, with Wellawatte's
refusal when a criterion asks, and sets the clock to Thu 08:30. *Unit* ones use made-up data. Screens get a click-through
in Nabil's Chrome on the built app at 390 wide and 1440 × 900 as `nadeesha`, and at 1440 × 900 as `ruwan`, with the
network turned off in DevTools where a criterion says so.

### The deliveries
- [ ] **AC-1** When `nadeesha` reads her deliveries at Thu 08:30, the system shall answer one delivery to confirm: VEH035's
  stop 1 on Thu 25 Jun, Dilshan, arrived 03:34, handed over 03:38, delivered, not late, with the stop's revision and its
  lines in spec 012's order: 12 chilled cartons ordered, loaded and handed over 12; 8 chilled 8, 8 and 8; dry ordered 4,
  loaded 3 and handed over 3; none received and no receipt. It shall list no applied id and write nothing.
- [ ] **AC-2** When stop 1 is arrived and not handed over, the system shall list no delivery. A closed stop, another
  shop's stop and a delivery confirmed on an earlier day shall not be listed. *Wellawatte's refusal is never in OUT001's
  list.*
- [ ] **AC-3** When `nadeesha` reads one delivery by its stop, the system shall answer it whatever its day. A stop of another
  shop, or one not handed over, shall get 400 `unknown_record`.
- [ ] **AC-4** When a request has no session, the system shall answer 401 `signed_out` on the three new endpoints. A
  dispatcher, loader or driver shall get 403 `forbidden`, and an admin 403 `no_outlet`.

### The receipt on plain values
- [ ] **AC-5** *Unit.* When `applyReceipt` applies a receipt, it shall set each line's received count, raise the stop's
  revision by one, add the receipt with the phone's time, and add a report with the write's id when a line is short or the
  answer is No, counting the lines as rule 5 says. When `receiptView` gets deliveries that list a waiting receipt's id, it
  shall drop that receipt and apply only the others. When `deliveryFigures` reads a delivery, it shall give each line's
  expected, received, short, short from the depot and refused units, the totals, and whether a chilled line came.

### Confirming
- [ ] **AC-6** When `nadeesha` confirms stop 1 with 12, 8 and 3 and Yes, the system shall write the received counts, make
  the three orders `received` with the time kept and the server's clock as the time sent, mark the two chilled orders
  cold and leave the dry one empty, raise the stop's revision, record the write's id in `phone_writes`, write the audit
  row `stop.received`, raise no problem, answer her deliveries with the delivery received, and after the commit announce
  `orders` to OUT001 and the depot.
- [ ] **AC-7** When she confirms 11, 8 and 3, Missing, Yes, with a photo, the system shall do what AC-6 says and raise an
  open problem with the write's id, kind `receipt`, reason `missing`, Nadeesha and the time kept, counting the 12-carton
  line at 1, store the photo under the write's id with the problem, and announce `issues` to the depot as well.
- [ ] **AC-8** When she answers No with every count full, the system shall raise a problem with reason `not_cold`
  counting the 12 and 8 chilled lines at 0, and mark the two chilled orders not cold.
- [ ] **AC-9** When a receipt names more than 6,000 lines, leaves a line out or names one twice, counts above what was
  handed over, leaves out the cold answer when a chilled line came or gives one when none did, leaves out the reason when
  a line is short or gives one when none is, carries a photo when it reports nothing, or carries a photo that is not a
  whole JPEG, the system shall answer 400 `invalid_input`, and a line that is not on the stop 400 `unknown_record`. It
  shall write nothing.
- [ ] **AC-10** When a receipt names a stop not handed over, the system shall answer 409 `not_delivered`, and a closed one
  the same, and change nothing.
- [ ] **AC-11** When a delivery holds 41 orders of one carton each, the system shall take a receipt that names all 41
  lines and write each line's count. *A test makes the stop: a shop may place many orders for one day (spec 009), and a
  stop holds up to 300 orders.*

### Saved once
- [ ] **AC-12** When a receipt arrives again with the id and content of one the server applied, the system shall answer the
  deliveries as they are and change nothing, and when two copies arrive at once, apply one and answer both as done, with
  one audit row.
- [ ] **AC-13** When a receipt arrives with the id of a phone write the server applied and other content, kind or trip,
  the system shall answer 409 `write_reused` and change nothing. *The receipt's id with 10 in place of 11, and a driver
  write's id.*
- [ ] **AC-14** When a receipt with a new id arrives for a delivery already confirmed, the system shall answer 409 `stale`
  with "This delivery was already confirmed." and change nothing, whether it names the stop's current revision or the one
  before the first receipt.
- [ ] **AC-15** When two receipts with different ids for stop 1 arrive at once, the system shall apply exactly one and
  answer the other 409 `stale` with "This delivery was already confirmed.", leaving one set of received counts, one audit
  row and at most one report.
- [ ] **AC-16** When a receipt waits for the trip's lock behind a driver's write on the same trip, the system shall judge
  it on the stop and its orders as that write left them, read once it holds the lock, and take its time sent from the
  clock read then. *The test holds the trip's row in a transaction of its own while it writes stop 1 as Nugegoda's
  delivery leaves it, and moves the clock a minute on before it lets go: the receipt, naming the revision the delivery
  leaves, applies with the counts the delivery wrote and the later minute as its time sent.*
- [ ] **AC-17** When the answer to a receipt is lost, the deliveries read next shall list its id, `receiptView` shall take it
  off the queue, and the delivery shall show received. A receipt answered more than 48 hours ago shall not be listed until
  it is sent again, when it shall be answered as done and listed once more.
- [ ] **AC-18** When a receipt's time lies before the handover or after the server's clock, the system shall keep the nearer
  bound, keep the server's clock as the time sent, leave the trip's last event time as it was, and hold the phone's time
  and the time kept in the audit row.
- [ ] **AC-19** When the walkthrough's receipt is sent, the answer shall equal `receiptView` of the deliveries before it
  and the receipt, apart from the time sent, which only the server knows.
- [ ] **AC-20** When a receipt and a demo reset arrive at once, both shall finish, and the receipt shall be refused with
  `unknown_record` if the reset committed first.

### The answers
- [ ] **AC-21** When `ruwan` reads what needs him after AC-7, the system shall list the report with its kind, reason,
  Nadeesha, time and photo, cold true, VEH035 with Dilshan and stop 1 handed over at 03:38, the 12-carton line loaded 12,
  handed over 12, received 11 and counted 1, 1 short, and Fri 26 Jun as the day a replacement would be for.
- [ ] **AC-22** When `ruwan` answers it `send_replacements`, the system shall place a chilled order for OUT001 for Fri 26
  Jun with 1 chilled carton, placed by Ruwan at the app clock's time and pointing at the problem, decide the problem with
  that replacement, write `issue.decided` with the order's id, and announce `issues` to the depot and `orders` to OUT001
  and the depot. Nadeesha's open list shall hold the order, replacing Thu 25 Jun, and her next order shall not count it
  as placed.
- [ ] **AC-23** When `ruwan` answers it `no_replacement`, the system shall decide it, place no order and announce `issues`
  and `orders`.
- [ ] **AC-24** When `ruwan` answers Wellawatte's refusal `send_replacements`, the system shall place a chilled order for
  OUT002 for Fri 26 Jun with 2 chilled cartons and decide the refusal, the trip shall stay as it was, Dilshan's day shall
  show the answer, and OUT002's chilled order shall carry the answer and Fri 26 Jun among its problems, for its card.
- [ ] **AC-25** When a report counts 1 chilled and 1 dry carton short and is answered `send_replacements`, the system shall
  place two orders, one per temperature. *A second run confirms 11, 8 and 2.*
- [ ] **AC-26** When an answer does not fit its problem's kind, or `send_replacements` answers a report that counts nothing
  short, the system shall answer 400 `invalid_input`. With no day open it shall answer 409 `no_delivery_day`. Spec 012's
  `stale` and `unknown_record` shall hold for the report. Nothing changes. *The clock set to Fri 26 Jun 16:30.*
- [ ] **AC-27** When the answer comes at Thu 16:05, the replacement shall be for Sat 27 Jun, and what needs Ruwan shall say
  Sat 27 Jun before he answers.

### A replacement in the plan
- [ ] **AC-28** When Ruwan splits OUT002's replacement of 2 chilled cartons on Friday's board into 1 and 1 (spec 010),
  both parts shall carry Thu 25 Jun as the day they replace, OUT002's next order shall count neither, and the refusal's
  replacement shall still read 2 chilled cartons on Fri 26 Jun.
- [ ] **AC-29** When the suggested plan for Friday splits a replacement (spec 014), both parts shall carry the day they
  replace, the shop's next order shall count neither, and the problem's replacement shall still read the whole. *The test
  gives the replacement more chilled cartons than one fridge trip can carry, so the planner splits it.*
- [ ] **AC-30** When the two parts of AC-28 are joined back on the board, the order shall carry Thu 25 Jun as the day it
  replaces again, and OUT002's next order shall still not count it.

### The shop's cards
- [ ] **AC-31** When Nadeesha's lists are read through the walkthrough, each order shall carry its delivery, receipt,
  problems and replacement as rule 11 needs them: before the receipt the three orders handed over at 03:38 on VEH035 by
  Dilshan, not late, with 12, 8 and 3 delivered and 1 short from the depot on the dry one; after the answer received 11,
  8 and 3 with 1, 0 and 1 short, the 12-carton order with its report answered by a replacement on Fri 26 Jun, and the
  replacement order replacing Thu 25 Jun.
- [ ] **AC-32** When a store manager made by the test at OUT002 reads Wellawatte's orders, the chilled one shall carry 46
  delivered, 2 refused and damaged, and the refusal with its answer. With the closed shop instead: the stop's attempt
  and an open problem, then after "Try again" no delivery and the answer, and after "Bring them back" the order placed
  with the attempt and the answer. An arrival after the window's close shall be late. *A test sets Wellawatte's arrival
  at 08:05.*
- [ ] **AC-33** When the day is seeded or reset, Wednesday's 6 dry cartons shall be received at Wed 07:42 with 6 received
  and no delivery, the 24 earlier orders shall be received in full with a time on their day, and OUT001's received orders
  shall add up to 25 orders, 205 cartons, 1,414.5 kg and 7.585 m³.

### The screens
- [ ] **AC-34** When `nadeesha` opens Deliveries at 390 wide, the screen shall show Confirm delivery with the walkthrough's
  numbers, "1 short from the depot" under the dry line and Yes chosen. Lowering the 12 to 11 shall show "1 carton
  missing", "What's wrong?" with Missing chosen and "Add a photo (optional)", and the counter shall stop at 0 and at 12.
- [ ] **AC-35** When the network is off in DevTools and she taps Confirm delivery, the screen shall show the saved state with
  "There is no signal right now." and "Saved at 08:31 · waiting to sync". Reloaded cold with the network still off, it
  shall open at once on the same screen. When the network is back, within 5 seconds it shall show Receipt sent with
  "Awaiting depot review" and "Sent at 08:33 · shortage unresolved", and the audit log shall hold one `stop.received`.
- [ ] **AC-36** When a receipt is saved with the network off, the day is reset from another browser and the network comes
  back, the screen shall show the receipt under "Not accepted" with "That delivery is not on your list.", show it again
  after a reload, and "Clear" shall take it off the phone and say that no delivery is waiting.
- [ ] **AC-37** When Ruwan's browser is open beside the phone, his bell shall show 1 within a second of the sync, the card
  shall show the screen states' rows with "Send 1 replacement on Fri 26 Jun" chosen, and "Send to shop" shall show the
  green card. Within a second Nadeesha's receipt shall show "Replacement on Fri 26 Jun". View past orders shall open Past
  with the three received cards of the walkthrough, the 12-carton card shall open its receipt, Open shall hold the
  replacement, and Today shall show the three "Received 08:31" cards.
- [ ] **AC-38** When Wellawatte's refusal is open on Live day, its card shall offer "Bring them back to Peliyagoda" and "Send
  2 replacements on Fri 26 Jun" with "Send to driver and shop", and after the second Dilshan's phone shall show its answer.
- [ ] **AC-39** When the other states occur, the screen shall show them as the table says: loading, nothing to confirm,
  sending, damaged, No to the cold check, a photo and an unusable one, not accepted (two browsers as `nadeesha`, the
  second confirming offline after the first), sign in again (the session cookie deleted while the receipt waits), could
  not save (DevTools' storage quota at its smallest), could not load (API stopped, nothing kept), another tab, not on your
  list, and after a reset Wednesday's "6 dry cartons · Received 07:42 · All 6 received".
- [ ] **AC-40** When the screens are 1440 × 900, Deliveries shall keep one column, Orders shall show Past's received cards
  beside the open ones as in Shop · Orders · desktop, and Today its received cards as in Shop · Today · desktop.
- [ ] **AC-41** When a reviewer reads `features/store` and `features/live`, they shall find no count worked out there but
  through `deliveryFigures`, the form's own counters and formats; the shop's receipts saved and sent only through the
  shared queue in `lib/phone`, with no second store or sender; and, as spec 012's AC-33 asks, no write's answer put in the
  view.

## Walkthrough
It follows spec 013's: Dilshan handed Fresh Nugegoda's 23 cartons over at 03:38, 1 dry carton short from the depot, and
closed the trip at 03:55. The times below are examples.

1. Move the clock on to "Morning deliveries done, Thu 08:30".
2. On a phone, or Chrome at 390 wide, sign in as `nadeesha`. Today: "Thu 25 Jun · Fresh Nugegoda", and under Coming today
   "12 chilled cartons", "8 chilled cartons" and "4 dry cartons", each "Delivered" with "Delivered 03:38 · VEH035 ·
   Dilshan", and the dry one "3 of 4 delivered · 1 short from the depot".
3. Tap Deliveries: "Confirm delivery", "Arrived 03:34 · VEH035 · Dilshan", "Chilled cartons · 12 expected · Received 12",
   "Chilled cartons · 8 expected · Received 8", "Dry cartons · 3 expected · Received 3" with "1 short from the depot",
   and "Still cold on arrival?" with Yes chosen.
4. On the first card tap − once: "11" and "1 carton missing". "What's wrong?" shows with Missing chosen, and "Add a photo
   (optional)". Add one if you like; on a laptop any picture will do.
5. Turn the network off: in Chrome, DevTools, Network, "Offline". Tap "Confirm delivery": "Receipt saved on this phone",
   "There is no signal right now.", "12 chilled cartons expected · Received 11 cartons · Missing 1 carton", the two other
   cards, "Not sent to the depot yet" with its three lines, "Retry sending" and "Saved at 08:31 · waiting to sync". Reload
   the page with the network still off: the same screen opens at once.
6. Turn the network back on. Within a few seconds: "Receipt sent to the depot", "Confirmed at 08:31 · Fresh · Nugegoda",
   "Awaiting depot review" with "The depot has your receipt and shortage report. The missing carton still needs a
   resolution. Reporting it does not mark it as replaced.", "View past orders" and "Sent at 08:33 · shortage unresolved".
7. In a desktop browser, sign in as `ruwan`. The bell shows 1. Live day: "1 chilled carton missing", "Fresh Nugegoda · stop 1
   · VEH035 · Dilshan · delivered 03:38", "Shop · Nadeesha · 08:31", "Received · 11 of 12 chilled cartons", "Cold on
   arrival · yes", and "Send 1 replacement on Fri 26 Jun" chosen. Tap "Send to shop": "✓ Sent 08:35" and "Fresh Nugegoda ·
   1 replacement on Fri 26 Jun, Nadeesha told". The bell clears.
8. On the phone, without a reload: "Replacement on Fri 26 Jun", "The depot is sending 1 chilled carton on Fri 26 Jun." and
   "Sent at 08:33 · replacement on Fri 26 Jun". Tap "View past orders": under "Thu 25 Jun", "12 chilled cartons · 11
   received · 1 short", "Received 08:31" and "1 replacement comes on Fri 26 Jun."; "8 chilled cartons · All 8 received";
   "4 dry cartons · 3 received · 1 short" with "1 short from the depot". The first card opens its receipt. Open holds "1
   chilled carton · Waiting for the delivery plan", "Fri 26 Jun · 05:00–07:30 · street" and "Replacement for Thu 25 Jun".
9. Today shows the three cards "Received 08:31", with "11 received · 1 short", "All 8 received" and "3 received · 1 short".

**Other paths.** "Damaged" in place of Missing, "No" to the cold check, and "No replacement" in place of the replacement.
At spec 013's step 8 Ruwan can answer Wellawatte's refusal "Send 2 replacements on Fri 26 Jun": Dilshan still brings the 2
cartons back, and OUT002 gets a placed order of 2 chilled cartons for Friday's plan. After a reset, Nadeesha's Today at Wed
15:00 shows "6 dry cartons · Received 07:42 · All 6 received", as the design's Today does.

**The data.** The seed changes only the shop's history (D-62), which an install seeded before this piece takes by pressing
Reset the demo day once. The receipt is Nadeesha's own, on stop 1 of VEH035 in spec 010's walkthrough. The short dry
carton is spec 012's.

## Not in this piece
- **A7:** a card on its way: "Running late", "08:25 expected", "was due 05:30 to 08:00 · VEH004 · Ruwan · rear dock" and
  "Delivery help"; and on Live day "Next · Fresh Nugegoda · 1 carton short · Open next", "Drops and events" ("short 1,
  reported") and "Undo".
- **A8:** the dispatcher's look-up of receipts in History and Orders.
- **Open question 4:** a replacement for cartons short from the depot. The loader's answers stay "Go short" and "Load it
  all" (D-37), and the shop sees "1 short from the depot" and can order it again.
- **Not planned:** a note on the receipt and a signature (neither is drawn), changing a receipt once it is in, writing
  cartons off and "shop credited, claim opened", "Tuesday works for me" and a new date for a deferred order (spec 009),
  the shop's other screens with no signal, a count of waiting deliveries on the tab, push notifications and sounds, and
  accounts for more shops (D-27): a judge sees Wellawatte's refusal on Live day and the driver's phone only.

## Departures from the design
1. Confirm delivery lists every line of the drop, so Nugegoda's three orders are three cards, as the driver's Unload does
   (spec 013). The frame shows one order.
2. A line expects what the driver handed over, and says when the depot sent it short or the shop refused some at the door
   (D-56).
3. "What's wrong?" with "Missing" and "Damaged" shows once a count is lower. The frame's chip only says "missing".
4. "Add a photo (optional)" shows once the receipt reports something, as in the frame, and not on a receipt with nothing
   wrong.
5. The saved screen says "There is no signal right now." when the phone knew it had none, and the frame's "The connection
   dropped while sending." after a send that got no answer.
6. Today's received card says "All 6 received" without "and signed": there is no signature, and the shop's receipt is the
   confirmation.
7. The sent receipt's chip and words follow the depot's answer, and a receipt with nothing wrong says "All received". No
   frame draws these.
8. A shop's report on Live day uses the issue-open card with "Send N replacements on <day>", "No replacement" and "Send to
   shop". The design draws only the "Next" line for it.
9. A refusal's answers are "Bring them back to Peliyagoda" and "Send 2 replacements on Fri 26 Jun", with "Send to driver and
   shop". There is no "Write off on the road" and no "shop credited, claim opened".
10. States the design lacks: something wrong, a photo, sending, sent and all received, sent and answered, nothing to
    confirm, not accepted, sign in again, could not save, could not load, another tab, not on your list, and the shop's
    cards for a delivery not yet confirmed, nobody at the shop, the depot's answers and a replacement.

## Open questions
1. **What does the shop count against: what it ordered, or what the driver handed over?** The frame says "12 expected" for
   a 12-carton order, but in our data a carton can be short from the depot or refused at the door, and both were already
   reported. Our pick: what the driver handed over, with the earlier differences shown under the line (D-56). Counting
   against the order would report the same carton twice.
2. **Is "Still cold on arrival? No" a report on its own?** The frame asks it and says nothing of what follows. Our pick:
   yes, a report with reason "not cold", which the dispatcher answers like any other (D-60). The other choice is to keep
   the answer as a record only, and then nobody hears about warm chilled goods.
3. **What may the dispatcher answer to a shop's report?** The design draws answers only for a driver's refusal. Our pick:
   "Send N replacements", the design's own answer, and "No replacement", for when the depot has none to send (D-58).
4. **Should the shop get a replacement for cartons short from the depot?** The loader's "Go short" sends the truck without
   them, and the design's loader line promised "it goes on Monday's run". Our pick: not in this piece. The shop sees "1
   short from the depot" on its receipt and card and can order it again. A later small task can add "Go short and send N"
   to the loader's answers through D-59's replacement.
5. **Does a second tab of the shop's area wait for the first, as the driver's does?** Spec 013 gives the driver's app to one
   tab so no two tabs send. Our pick: in the shop's area only Deliveries waits, with spec 013's line; Today, Orders, New
   order and Help work in any tab, online (D-57). The tab that opened the shop's area first keeps sending waiting receipts
   whichever page it shows.
