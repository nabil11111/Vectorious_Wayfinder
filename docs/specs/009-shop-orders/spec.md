# 009 · Shop orders

**Status:** Done, with one open point at the bottom  ·  **Owner:**  ·  **Design:** the shop's frames for Today, New orders (Fresh, Style, Tech), Orders, Orders placed and Help, on a phone and a desktop

Piece A1 of [the map](../000-map.md). The frames are exported in `tech-triathlon-ops/design/export`.

## Why
The booklet's first step is "Place order: capture and confirm the order before the cutoff". Today a store
manager orders by phone or message, "without confirmation that they received or scheduled them". So the shop
gets a form that cannot take a wrong item or a late order, a confirmation, and a list of its orders.

## What it does
The store manager sees what is due today and the next order with the time it closes, fills the order from the
brand's fixed list, and places it with one tap. The form saves itself as a draft on the server. A confirmation
says what was placed and for which day. Orders shows open and past orders, and Help says who to contact.

The dates, times, window and entrance in the frames are demo data. The build reads the day and time from the
app clock (D-18) and the window and entrance from the shop's record: 05:00 to 07:30 and Street for OUT001.

## Screen states
"No frame" means the design has no screen for a state that must exist, so we describe the smallest one that
fits the style guide. Loading is the style guide's "Loading · skeleton", on the first load only.

| Screen | State | Frame | What shows |
| --- | --- | --- | --- |
| Today `/store` | Draft waiting | Shop · Today, and its desktop frame | The date and the shop's name. A card per order due today: icon, "12 chilled cartons", status chip. "Your next order": "For Thu 25 Jun", a Draft chip, "8 chilled + 4 dry · closes 16:00" and the orange "Continue draft". Style and Tech say "100 boxes" or "3 items". |
|  | Nothing started | No frame | The same card with no chip, "Nothing ordered yet · closes 16:00" and "Start order". |
|  | Placed | Shop · Today · orders submitted | On top: "Thursday's orders are placed", "8 chilled + 4 dry · waiting for the plan" and "View confirmation". At the bottom: "Thursday orders close today at 16:00." |
|  | Nothing due, no open day, could not load | No frame | One line under "Coming today". A card that says no day is open and to contact the depot. A card with a plain "Try again". |
| New order `/store/orders/new` | Fresh | Shop · New orders, and its desktop frame | "For Thu 25 Jun · closes 16:00 today". Chilled and Dry with − and +, Delivery window, Entrance, Note for the driver. Footer: "12 cartons · draft saved 15:02" and "Place 2 orders". On a desktop a card "Your order" on the right holds the lines, the summary and the button. |
|  | Style | Shop · New orders · Style | "Style Colombo 3 · for Thu 25 Jun · closes 16:00". Four items with unit, kilos and cubic metres. Footer: "100 boxes · 1,350 kg · 22.8 m³ · draft saved 15:02" and "Place order". |
|  | Tech | Shop · New orders · Tech | Four items, and an item at 0 is greyed. A yellow line names every item that needs a tail lift: "Needs a truck with a tail lift · washing machines, refrigerators". Footer: "3 items · 630 kg · 2.15 m³ · draft saved 15:02" and "Place order". |
|  | Nothing added | No frame | Every number is 0, the footer says "Nothing added yet" and the orange button is off. |
|  | Saving, not saved, changed elsewhere | No frame | The footer ends with "saving…", or "not saved · trying again" in the warning colour, and the numbers stay. A draft changed on another device reloads with one line that says so. |
|  | Day closed | No frame | A yellow line: "Orders for Thu 25 Jun closed at 16:00. This order is now for Fri 26 Jun." The title shows the new day. |
|  | Placing, could not place, no open day | No frame | "Placing…" cannot be tapped twice. A refusal shows its reason in red above the button. With no open day there is one card and no form. |
| Orders placed `/store/orders/placed` | Two orders | Shop · Orders placed | "Your 2 orders are placed", "Requested for Thursday, 25 June.", a row per line, the chip "Waiting for the delivery plan", "The depot has received both requests. We'll let you know when delivery dates and times are confirmed.", "Orders for Thursday close at 16:00 today." (open point 1), the orange "Back to Today" and "Submission confirmation · 15:05". |
|  | One order, nothing placed | No frame | "Your order is placed" and "The depot has received your request.", with a row per item for Style and Tech. With nothing placed the screen goes to Orders. |
| Orders `/store/orders` | Open | Shop · Orders | "Orders", the plain "+ New order", "2 open orders", the Open and Past tabs and a card per open order. |
|  | Past | Shop · Orders · Past | "Wed 24 Jun and earlier · newest first", a heading per day, and at the end "Older orders load as you scroll". |
|  | Desktop | Shop · Orders · desktop | Open orders on the left, past orders on the right, no tabs. "+ New order" is in the header. |
|  | Empty, could not load | No frame | One line for an empty list. A card with "Try again" when loading fails. |
| Help `/store/help` |  | Shop · Help | The frame's text. The orange "Open delivery confirmation" opens the Deliveries tab (A5). |

## Rules
Examples use the seed: Nadeesha at OUT001, a Fresh shop in Colombo, with the clock at Wed 24 Jun 2026 15:00.

1. **The shop.** A store manager orders for their own outlet only, from the active items of its brand, in
   whole numbers from 0 to 999. One order per temperature (D-05), so 8 chilled and 4 dry are two orders.
2. **The delivery day.** An order is for the first operating day whose cut-off has not passed. A day's cut-off
   is 16:00 on the operating day before it, in depot time on the app clock. The table is below.
3. **Drafts.** The form saves itself after each change. A request names each draft by its id and revision. A
   draft that was removed and made again has a new id, so an old request can never match it. A draft whose day
   closes moves to the open day, and the form says so until it is saved or placed.
4. **Placing.** The cut-off is judged at the moment the server holds the shop's lock. Placing the same drafts
   again answers with the orders already placed and makes nothing new. A placed order cannot be changed (open
   point 1), and the shop can place another one for the same day until the cut-off.
5. **The summary.** Units, kilos, cubic metres and the tail-lift line come from the load calculator (spec 007)
   with each save. The screen never multiplies. Fresh shows only "12 cartons", as in the frame.
6. **The card.** The title is the units, such as "8 chilled cartons". "Waiting for the delivery plan" and
   "Planned · Thu 25 Jun" are grey, "Date changed" is yellow with the latest deferral's reason, and Loaded,
   Delivered and Received are green. A placed or planned card adds "Thu 25 Jun · 05:00–07:30 · street".
7. **The lists.** An order counts for its scheduled day, the day of the sent plan it is on, and until then for
   the day the shop wanted. Coming today holds the orders that count for today, so one that was carried over
   and planned for today shows today. Chilled comes before dry. A draft is in no list.

| The clock says | The order is for | It closes |
| --- | --- | --- |
| Wed 24 Jun, 15:59 | Thu 25 Jun | today at 16:00 |
| Wed 24 Jun, 16:00 | Fri 26 Jun | Thu at 16:00, shown as "closes Thu 16:00" |
| Sat 20 Jun, 10:00 | Mon 22 Jun, because Sunday is closed | today at 16:00 |
| Sun 21 Jun, 10:00 | Tue 23 Jun, because Monday's orders closed on Saturday | Mon at 16:00 |
| Thu 30 Apr, 10:00 | Sat 2 May, because Fri 1 May is a holiday | today at 16:00 |
| Fri 26 Jun, 16:30 | no day, because the calendar ends on Sun 28 Jun | |

## Permissions and failure paths
A store manager sees and changes only their own outlet. Every other role is refused, and so is an admin.

- **The signal drops.** While saving, the numbers stay and the footer says "not saved · trying again". The
  orange button waits for the save. While placing, the draft is kept and trying again is safe.
- **Two devices, or two requests at once.** They queue on the shop's lock. The later one names an old draft
  and is refused, and its screen loads the latest and says so. The same for a save after the order was placed.
- **The cut-off passes while the form is open.** The server refuses, and the form shows the new day.

## Data in and out
Four endpoints under `/api/v1/store`, for store managers only. Their shapes and steps are in `plan.md`:
`GET /store/next-order`, `PUT /store/next-order/draft`, `POST /store/next-order/place` and
`GET /store/orders?list=today|open|past`. They read `outlets`, `products`, `calendar_days`, `orders`,
`order_lines`, `deferrals` and the plan tables, and write `orders` and `order_lines`. The time comes from the
app clock (spec 008) and the summary from `computeLoad` (spec 007). After an order is placed, the topic
`orders` is announced (D-21) to the shop and to its depot.

## Acceptance criteria
API criteria are integration tests on the real database with the app clock set. The day rule has unit tests on
the rows of the table above. Screens get a written click-through at 390 and 1440 wide on the seeded day.

### The delivery day
- [ ] **AC-1** When it is before 16:00 on an operating day, the system shall offer the next operating day.
- [ ] **AC-2** When it is 16:00 or later, the system shall offer the operating day after that one.
- [ ] **AC-3** When closed days lie in between, the system shall skip them. *A Sunday, and the 1 May holiday.*
- [ ] **AC-4** When today is closed, the system shall offer the first day whose cut-off is still ahead.
- [ ] **AC-5** When no later operating day has an open cut-off, the system shall say no delivery day is open.

### Who may call
- [ ] **AC-6** When a request has no session, the system shall answer 401 `signed_out` on every endpoint.
- [ ] **AC-7** When a dispatcher, loader or driver calls, the system shall answer 403 `forbidden`.
- [ ] **AC-8** When the signed-in person has no outlet, the system shall answer 403 `no_outlet`. *Admin.*
- [ ] **AC-9** When a store manager reads a list, the system shall return only their own outlet's orders.

### The next order and its draft
- [ ] **AC-10** When the next order is opened, the system shall return the shop's window and entrance, the
  active items of its brand, the delivery day and the cut-off. *OUT001: 05:00 to 07:30, street, two items.*
- [ ] **AC-11** When a draft is saved, the system shall keep one draft order per temperature and return each
  draft's id and revision, its saved time and the summary. *8 chilled, 4 dry: 82.8 kg and 0.444 m³.*
- [ ] **AC-12** When a draft is saved again, the system shall replace its lines and its note and add no order.
  When every quantity is 0, it shall remove the draft.
- [ ] **AC-13** When a line names an item that is not an active item of the shop's brand, the system shall
  answer 400 `unknown_product` and change nothing. *OUT001 asks for `style-shoes`.*
- [ ] **AC-14** When a quantity is not a whole number from 0 to 999, or the note is longer than 200
  characters, the system shall answer 400 `invalid_input` and change nothing.
- [ ] **AC-15** When a save or a place names a day that is no longer the open one, the system shall answer 409
  `cutoff_passed`, name the open day and change nothing. The open day is read from the app clock at the moment
  the server holds the shop's lock. *Opened at 15:58 for Thursday, sent at 16:01.*
- [ ] **AC-16** When a save or a place names a draft by an id or a revision that is not the current one, or
  leaves out a draft that exists, the system shall answer 409 `stale` and change nothing. When two first saves
  arrive at the same moment, one is saved and the other gets `stale`, never a database error.
- [ ] **AC-17** When the next order is opened after a draft's day has closed, the system shall offer the draft
  for the open day and say which day it moved from, until it is saved or placed. *At Wed 16:05.*
- [ ] **AC-18** When no delivery day is open, the system shall return no day from the GET and answer 409
  `no_delivery_day` to a save or a place.

### Placing
- [ ] **AC-19** When the draft is placed before the cut-off, the system shall turn each draft order into a
  placed order, record the app clock's time and the person, and announce `orders` to the shop and its depot.
- [ ] **AC-20** When only one temperature has units, the system shall place one order.
- [ ] **AC-21** When a place names drafts that are already placed, the system shall answer with those placed
  orders and change nothing. It checks this first, before the cut-off. *A retry at 16:01.* When a place names
  no draft and the shop has none, it shall answer 409 `nothing_to_place`.
- [ ] **AC-22** When two place requests arrive at the same moment, the system shall place each draft once, and
  both requests get the same placed orders.
- [ ] **AC-23** When orders are placed, the next order shall have no draft and shall list what is placed for
  that day. Placing again for that day adds new orders and leaves the earlier ones.
- [ ] **AC-38** When a draft is placed and one of its lines is no longer an active item of the shop's brand,
  the system shall answer 400 `unknown_product` and place nothing. *The item was archived after the save.*

### The lists
- [ ] **AC-24** When `list=today`, the system shall return the placed, planned, loaded, delivered and received
  orders scheduled for the clock's today, and the ones not yet on a sent plan whose wanted day is today.
- [ ] **AC-25** When `list=open`, the system shall return the placed, planned, deferred, loaded and delivered
  orders, earliest day first and chilled before dry, with how many there are.
- [ ] **AC-26** When `list=past`, the system shall return received orders, newest day first, 20 at a time with
  a cursor. The next page continues with no order repeated or missed.
- [ ] **AC-27** When an order is deferred, the system shall return the reason of its latest deferral with it.
- [ ] **AC-39** When an order wanted for an earlier day is on a sent plan for today, `list=today` shall
  include it with its scheduled day. *Wanted Tue 2 Jun, planned for Wed 3 Jun.*

### The screens
- [ ] **AC-28** Today. As `nadeesha` on the seeded day: the date and the shop's name, a card for Wednesday's
  dry order, and the draft card with "8 chilled + 4 dry · closes 16:00". "Continue draft" opens the form.
- [ ] **AC-29** New order, Fresh. − and + change the numbers, − stops at 0, the footer follows each save, the
  button says "Place 2 orders" or "Place order", and a reload or the other screen size shows the same draft.
- [ ] **AC-30** New order, Style. Four items with unit, kilos and cubic metres, and a footer from the server.
- [ ] **AC-31** New order, Tech. An item at 0 is greyed, and the yellow tail-lift line shows only while a
  washer or fridge crate is in the order.
- [ ] **AC-32** Placing. "Place 2 orders" opens the confirmation with both rows, the day written out, the chip
  and the time. "Back to Today" shows the placed card, and "View confirmation" opens it again.
- [ ] **AC-33** Orders. Open shows the two placed orders with their chip, day, window and entrance, the seeded
  chilled order that waited with "Date changed" and its reason (spec 008), and the count. Past shows earlier
  orders by day, newest first, and loads more at the end. A desktop shows both lists side by side.
- [ ] **AC-34** Help. The text of Shop · Help, and the button opens the Deliveries tab.
- [ ] **AC-35** The cut-off. With the clock moved to Wed 16:00, the form shows the yellow line and Fri 26 Jun,
  and an order placed from a form opened before 16:00 is not placed until the manager taps again.
- [ ] **AC-36** The other states. Loading shows grey blocks. With the API stopped, each screen shows "could
  not load" and the form says "not saved · trying again". Empty lists and a missing draft show their line.
- [ ] **AC-37** No sums in the screen. A reviewer reads the store screens' code and finds no place where
  kilos, cubic metres or the tail-lift need are worked out. They come from the API.

## Out of scope
- Confirming a delivery, short or damaged reports, the receipt states and what arrived on a past order. A5.
- On a delivery card: the expected time, "Running late", the vehicle and driver, "Delivery help". A2 to A4.
- The new date on a "Date changed" card, "… works for me", Shop · Deferred date accepted, "plan updated 16:10"
  and the dispatcher's view of orders. A2.
- Changing or withdrawing a placed order (open point 1), and drafts with no signal.
- Ordering further ahead than the next open day, or a fixed weekly day for Style. The data has no schedule.

## Departures from the design
1. The confirmation says "Orders for Thursday close at 16:00 today." The frame says "Edits close at 16:00
   today." A placed order cannot be edited. The shop places another order if it needs more.
2. The tail-lift line names every item that needs one. The frame names only the fridge crate.
3. The number between − and + can also be typed, so 48 cartons do not take 48 taps.
4. States the design lacks: nothing started, empty, could not load, not saved, day closed, no open day.
5. After placing, Today keeps the date and shop name as its header. The frame has the plain title "Today".

## Open points
1. **Can a placed order be changed before the cut-off?** The confirmation frame says "Edits close at 16:00
   today", but no frame shows how. Our pick, and what this spec builds: not in this build. The shop can place
   another order for the same day until 16:00. Edits would need a "Change order" path, a cancel, and a
   re-check of any plan the order is on.
