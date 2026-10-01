# 028 · Sample shop orders from the demo control

**Status:** In progress  ·  **Owner:** Claude builder  ·  **Design:** none. The demo control has no frame (spec 008),
and this adds one item and one small panel to it, built from the style guide's buttons.

## Why
Nabil, 2 Oct: "need a feature to simulate some real shop orders, using that demo dropdown in the orders open
section". A presenter who wants orders to arrive while the audience watches would otherwise sign in as one shop after
another and place each order by hand.

## What it does
While the clock is in "Orders open", the dispatcher's demo control has one more button, **Add sample shop orders**.
It opens a small panel in place of the control, as **Reset the demo day** does: "10 shops", "25 shops" and "Every shop
that hasn't ordered", the depot the orders are for, and **Place the orders**. Each shop then places its own order for
the open day, through the same server code as the shop's own Place, signed as that shop's store manager. When the
shops that have not ordered run out, "10 shops" and "25 shops" go on with small top-ups from shops that already
ordered, as a shop adds a few cartons before 16:00. The panel answers with what it did, and the dispatcher's Orders and Dashboard follow at once, as they do for any shop's order.

## Screen states
| State | What shows |
| --- | --- |
| Control, orders open, dispatcher | Under the orange "Next" button, the plain button "Add sample shop orders", above "Reset the demo day". |
| Control, any other part or role | No such button. |
| Choosing | "Add sample shop orders" and the line "Each shop places its own order for Thu 25 Jun, as if its manager pressed Place. At Peliyagoda." (on Both: "At Peliyagoda and Kandy, that many at each.") Then how many of the depot's shops have not ordered yet, such as "10 of Peliyagoda's 75 shops have not ordered yet." Three choices, "10 shops", "25 shops" and "Every shop that hasn't ordered", 10 chosen first. The line "When the shops that have not ordered run out, 10 and 25 shops go on with small top-ups from shops that already ordered." The orange "Place the orders" and the plain "Back". |
| Placing | "Placing…", and neither button can be pressed again. |
| Done | The answer, one line per depot: "Placed 10 orders from 10 shops at Peliyagoda; 65 shops already had an order or a draft.", or with top-ups "Placed 25 orders at Peliyagoda: 10 from shops that hadn't ordered, 15 top-ups." The plain "Done" goes back to the control. |
| Nothing to place | "Every shop at Peliyagoda already has an order or a draft for Thu 25 Jun. Nothing was placed." |
| Refused or no connection | The server's sentence in red above the buttons, such as "Sample orders can be added only while orders are open, before 16:00.", or "Could not reach Wayfinder. Try again." |

## Rules, with worked examples
1. **A shop's own Place.** Each order is saved as the shop's draft and placed, through the code behind
   `PUT /store/next-order/draft` and `POST /store/next-order/place`, as the shop's store manager (the first active one
   by staff ID). So it passes every check a shop's order passes (its brand's active items, whole numbers 1 to 999, a
   note of at most 200 characters, the open day and its cut-off), is written the same way (`created_by`, `placed_by`,
   `saved_at`, `placed_at`), and announces `orders` to the shop and its depot. A Fresh shop with chilled and dry
   cartons places two orders, as on its own screen (D-05).
2. **Who orders.** First the free shops: the depot's shops that are not archived, have a store manager, have no draft
   and have no order for the open day that is not cancelled. A shop with a draft is never touched, so Nadeesha's seeded
   draft (OUT001) is still there for the walkthrough. When the free shops run out, "10 shops" and "25 shops" go on with
   top-ups from shops that have an order for the open day, until the number is reached. "Every shop that hasn't
   ordered" takes the free shops only. No shop orders twice in one press, and a shop topped up by an earlier press may
   be topped up again.
3. **Which shops, and how many.** The depot's shops are shuffled with a seed made of the delivery day and the depot.
   The free shops are taken in that order, then the top-ups in the same order. The same press on the same day picks
   the same shops in the same order, after a reset too. A second press skips the free shops the first one placed, so
   it adds other shops.
4. **What each shop orders.** Its own brand's items, sized from the seeded day's rules for that shop (spec 008), where
   `n` is the number in its id, with the shop's own seed (the delivery day and the shop):
   - Fresh: dry cartons from 45 + (11 × n mod 21), and chilled cartons from 38 + (5 × n mod 23) when the number does
     not end in 0, 4 or 7.
   - Style: folded, hanging, shoes and bags from the seeded day's four sizes for that shop.
   - Tech: one of the nine Tech orders written out in the seed, such as 2 televisions and 1 small appliance pallet,
     or 3 refrigerator crates. A shop only a van can reach gets one with nothing that needs a tail lift (D-24).
   - Most shops order 90% to 110% of that, about one in seven 60% to 80% and about one in seven 120% to 140%. A Tech
     shop that orders less has one less of each item (never below 1), and one that orders more has one more of the
     first. About one shop in seven adds a note for the driver, such as "Call the shop 10 minutes before you arrive."
   - A top-up is smaller, with its own seed (the delivery day, the shop and how many orders it has for the day), 10% to
     35% of the shop's usual order and no note: one line of one temperature for a Fresh shop, half or so of a Style
     shop's four kinds of box (at least one), and one crate or pallet for a Tech shop. So each top-up is one order.
5. **When each was placed.** In the order the shops were picked, each 40 to 90 seconds after the one before, by the
   shop's seed, and the last one at the app clock's time of the press. So every time has already passed and none is
   in the future. If that would reach back before midnight of the day, the gaps are shortened to fit. *At 15:20, ten
   shops are placed between about 15:10 and 15:20.*
6. **On Both,** each depot gets its own shops, the number chosen at each, and one answer line each.
7. **One press at a time.** A press holds the demo clock's row while it places, so a second press, a move of the clock
   or a reset waits for it. The clock cannot reach 16:00 halfway through a press.
8. **Reset** removes them like every other order of the day.

*On the seeded day at Wed 15:00, Peliyagoda's shops without an order are four Style shops (OUT015, OUT020, OUT035,
OUT070) and six Tech shops (OUT021, OUT023, OUT024, OUT038, OUT049, OUT064). So "10 shops" and "Every shop" each place
those 10 orders: "Placed 10 orders from 10 shops at Peliyagoda; 65 shops already had an order or a draft." "25 shops"
places the 10 and 15 top-ups: "Placed 25 orders at Peliyagoda: 10 from shops that hadn't ordered, 15 top-ups." At
Kandy only OUT090 and OUT120 have not ordered, so on Both "10 shops" gives Kandy those 2 and 8 top-ups.*

## Permissions
The dispatcher only, and only with demo mode on. Any other role, admin too, gets 403 `forbidden`. It acts on the
depot the dispatcher's session is on, or both on Both, so it is not on D-95's list of requests that go on whatever
depot is named: a tab that shows another depot than the session is refused with 409 `depot_changed`. With demo mode
off the routes are not there (404), like the clock's move and the reset.

## Failure paths
- **Outside "Orders open".** 409 `orders_not_open`: "Sample orders can be added only while orders are open, before
  16:00." Nothing is placed.
- **A shop orders at the same moment.** Its own save and the sample's queue on the shop's lock. If the shop's draft
  came first, the sample's save is refused as stale, the shop is left alone and counts as one that already had one.
- **A request that fails halfway.** Each shop's order is its own transaction, as a shop's own Place is, so the orders
  placed before the failure stay, and the answer says the request failed.

## Data in and out
Two endpoints under `/api/v1/demo/sample-orders`, mounted only in demo mode.

- `GET /demo/sample-orders` answers `SampleOrdersPreview`: the open day and, for each depot of the session, its shops
  and how many may still order.
- `POST /demo/sample-orders` takes `SampleOrdersRequest` `{ shops: 10 | 25 | 'all' }` and answers `SampleOrdersResult`:
  the delivery day and, for each depot, every order placed, the orders from shops that had not ordered and those shops
  (ids), the shops topped up (ids, one order each), the shops that already had an order or a draft, and the shops
  with no account or nothing on their list.

It reads `demo_day`, `outlets`, `users`, `orders` and `products`, writes `orders` and `order_lines` through the shop's
own code, and one `audit_log` row `demo.sample_orders` with what it placed.

## Acceptance criteria
- [ ] **AC-1** When the dispatcher asks for 10 shops at Peliyagoda while orders are open, the system shall place each
  chosen shop's order as rule 1 says, and answer with the orders, the shops and how many already had one.
- [ ] **AC-2** When fewer free shops may order than the 10 or 25 asked for, the system shall place theirs and then
  top-ups from shops that ordered, by the same shuffle, until the number is reached, never a shop with a draft and
  never a shop twice, and answer how many of each. *On the seeded day, 25 shops give 10 orders from the free shops and
  15 top-ups.* A top-up shall be one order of 10% to 35% of the shop's usual order with no note.
- [ ] **AC-3** When "Every shop that hasn't ordered" is pressed, the system shall order only for shops with no draft
  and no order for the open day. *On the seeded day, 10 orders, and a second press places none.*
- [ ] **AC-4** When the same press is made on the same day with the same shops free, the system shall place the same
  shops with the same lines and notes. A second press shall place none of the first press's shops.
- [ ] **AC-5** When each order is placed, its time shall be no later than the app clock at the press, and the orders
  shall be 40 to 90 seconds apart in the order the shops were picked.
- [ ] **AC-6** Every sample order shall pass the shop's own checks: its brand's active items, whole numbers 1 to 999,
  a note of at most 200 characters, and it shall show in the shop's own list of open orders, placed by its manager.
- [ ] **AC-7** When the orders are placed, the system shall announce `orders` to each shop and its depot, after each
  shop's order is saved.
- [ ] **AC-8** When the session is on Both, the system shall place the number chosen at each depot and answer for
  each.
- [ ] **AC-9** When the clock is in any other part, the system shall answer 409 `orders_not_open` and place nothing.
- [ ] **AC-10** When a store manager, loader, driver or admin asks, the system shall answer 403 `forbidden`. Signed
  out, 401. With demo mode off, 404.
- [ ] **AC-11** When the day is reset, the sample orders shall be gone like every other order.
- [ ] **AC-12** The control shows "Add sample shop orders" to the dispatcher only while orders are open, and to no
  one else.
- [ ] **AC-13** The panel shows the three choices, the depot, how many shops have not ordered, the top-up line, "Place
  the orders" and "Back", and after the press the answer line for each depot, counting the top-ups apart.

## Out of scope
- Sample orders in any other part of the day, for another day, or for the walkthrough's later steps.
- Top-ups from "Every shop that hasn't ordered", and drafts left in a shop's form.
- Choosing other numbers, brands or districts, and orders that break a rule on purpose.

## Departures from the design
1. The demo control gains "Add sample shop orders" and its panel. It is a presenter's tool, like the control itself.
