# 009 · Plan

> Build record: this describes the original implementation sequence. See the [spec guide](../README.md)
> for current status and the later specs that supersede parts of this work.

## Data changes
No new table. One migration, written by the lead after spec 008's.

| Table | Change | Why |
| --- | --- | --- |
| `orders` | Column `placed_by uuid`, pointing at `users`. | `created_by` started the draft. Someone else may place it. |
| `orders` | Column `saved_at timestamptz`, written from the app clock like `placed_at`. | The footer's "draft saved 15:02". People see these two times (D-18). `created_at` and `updated_at` stay on the real clock, as spec 008 says. |
| `orders` | Unique index `orders_one_draft` on `(outlet_id, temp)` where `status = 'draft'`. | One draft per temperature, whatever two devices do. |
| `orders` | Index `orders_outlet_date` on `(outlet_id, delivery_date)`. | Every list reads one shop's orders by day. |
| `order_lines` | Unique `order_lines_order_product` on `(order_id, product_id)`. | One line per item in an order. |

**The seed** gains OUT001's dry order due Wed 24 Jun (6 cartons, received at 07:42 since spec 015's D-62, so it is in
Past, not Open), at least 21 received orders for OUT001 on earlier operating days, and store managers at OUT017 (Style)
and OUT064 (Tech) (D-27). The draft, the chilled order that waited and the rest come from spec 008. A reset brings it
all back.

## Contracts
The lead writes these into `packages/contracts/src/store.ts`. Dates are `YYYY-MM-DD`, moments ISO strings.

| Shape | What it holds |
| --- | --- |
| `StoreOutlet`, `StoreProduct`, `OrderLine`, `OrderLineInput`, `OrderStatus` | The shop (id, name, brand, window as `HH:MM` in depot time, dock type), an item (id, name, unit, kilos and cubic metres per unit, temperature, tail lift), a line (item, name, unit, quantity), a line to save (item, quantity 0 to 999) and the eight statuses. |
| `DraftRefs` | Per temperature the draft order's `id` and `revision`, or nothing when there is no draft. |
| `SaveDraftRequest`, `PlaceOrdersRequest` | `deliveryDate`, `lines`, `driverNote` (200 at most) and `refs`. Place sends only `deliveryDate` and `refs`. |
| `StoreOrder` | id, `deliveryDate` (the wanted day), `scheduledDate` (the day of the sent plan it is on, or empty), temperature, status, lines, units, `placedAt`, `deferralReason`. |
| `StoreNextOrder` | The outlet, its products, `deliveryDate`, `cutoffAt`, `cutoffIsToday`, `movedFrom`, the `draft` (lines, note, `refs`, `savedAt`, summary `Load`, `tailLiftItems`) and `placed` (orders, lines, `lastPlacedAt`, summary). |
| `PlaceOrdersResponse`, `StoreOrderList` | `StoreNextOrder` plus `placedOrders`, the orders this request placed or had already placed. The list: the outlet, `today`, `orders`, `openCount`, `nextCursor` (past only). |

New error codes: `no_outlet` 403, `unknown_product` 400, `cutoff_passed` 409 with the open day and its cut-off
in `details`, `stale` 409, `nothing_to_place` 409 and `no_delivery_day` 409.

## How it works
| File | What it holds |
| --- | --- |
| `apps/api/src/orders/orderable-day.ts` | `orderableDay(today, minutesNow, operatingDays)`. Plain values in and out, no database and no `Date`. |
| `apps/api/src/orders/store-orders.ts`, `store-lists.ts` | `getNextOrder`, `saveDraft`, `placeOrders`, and `listOrders` for today, open and past. |
| `apps/api/src/routes/store.ts` | The four routes behind `requireRole('store_manager')` and the outlet check. The lead mounts it as `/store`. |
| `apps/web/src/features/store/StoreHome.tsx` | The routes `/store`, `/store/orders`, `/store/orders/new`, `/store/orders/placed`, `/store/help` and the Deliveries placeholder, so `app/router.tsx` does not change. |
| `TodayPage`, `HelpPage`, `NewOrderPage`, `OrdersPlacedPage`, `OrdersPage`, `parts/`, `words.ts` | One page per screen. Orders is two columns from 1024 px wide. `parts/` holds `OrderCard`, `StatusChip`, `NextOrderCard`, `QuantityStepper`. `words.ts` holds the chip words, unit words and formats. |
| `next-order.ts`, `orders.ts` | The query hooks. Keys start with the topic, `['orders', 'store', …]`, so the `orders` announcement refetches them. A clock move or a reset refetches everything (spec 008). |
| `apps/web/src/components/ui/` | New: `chip.tsx`, `segmented.tsx`, `skeleton.tsx`, after the style guide. |

**Saving**, in one transaction:
1. Lock the shop's row in `outlets`. Every save and place of that shop queues here.
2. Read the app clock now and find the open day. None is `no_delivery_day`, another day is `cutoff_passed`.
3. Check every line against the brand's active items. Two lines for one item are `invalid_input`.
4. `refs` must match the drafts: per temperature both missing, or the same id and revision. Else `stale`.
5. A temperature with units gets its draft made or updated: the open day, the note, the lines above 0,
   `saved_at` and the next revision. A temperature with none loses its draft.
6. Answer as the GET does. The summary is `computeLoad` over the draft's lines.

**Placing**, in one transaction:
1. Lock the shop's row.
2. The retry. If every draft in `refs` is one of the shop's own orders and no longer a draft, answer with
   those orders and stop. This comes before the cut-off, so a retry after 16:00 still gets its answer.
3. Steps 2 and 4 of saving. No draft named and none there is `nothing_to_place`.
4. Check the drafts' lines against the active items again. A miss is `unknown_product`, and nothing is placed.
5. Set each draft to `placed` with the open day, `placed_at`, `placed_by` and the next revision.
6. After the commit, announce `orders` to the shop and its depot (D-21).

Reading never writes: a draft whose day has closed is offered under the open day with `movedFrom` set.
`scheduledDate` is the date of the latest sent plan that has the order on a stop. Past is paged by day and id.

- **The form.** A change starts a save 600 ms later. One save runs at a time and the newest change waits. The
  orange button is off while a save is waiting, running or failed. − and + are real buttons, at least 44 px.
- **Words and formats**, in depot time: "Wed 24 Jun", "Thursday, 25 June", "15:02", "1,350 kg", "331.2 kg",
  "22.8 m³", and an item's own "0.20 m³". Entrance: Street, Rear dock, Mall loading bay.
- **Icons**, copied by the lead from the design assets into `apps/web/src/assets/icons/`: `icon-chilled`,
  `icon-goods-dry`, `icon-brand-style`, `icon-brand-tech`, `icon-order-list`, `icon-order-placed`,
  `icon-order-waiting`, `icon-delivery-window`, `icon-truck-lorry`, `icon-call`, `icon-alert`,
  `icon-person-store-manager`.

## Risks
- T2 needs the app clock and the announcement from spec 008. T1 takes plain values and does not wait.
- The frames show demo data. The reviewer checks that window, entrance, dates and shop name come from the API.
- A2 to A5 add lines to `StoreOrder` and the cards. The card is one component, so they add and do not rewrite.
- Moving the demo clock past Fri 26 Jun 16:00 leaves no open day. The state exists, and a reset fixes it.

## Test plan
| Criteria | Kind | Where |
| --- | --- | --- |
| AC-1 to AC-5 | Unit | `apps/api/src/orders/orderable-day.test.ts` |
| AC-6 to AC-8, AC-10 to AC-23, AC-38 | Integration, app clock set | `apps/api/tests/store-orders.test.ts` |
| AC-9, AC-24 to AC-27, AC-39 | Integration | `apps/api/tests/store-lists.test.ts` |
| AC-28 to AC-37 | Click-through at 390 and 1440 wide, and a read of `features/store` for AC-37 | The lead, on the joined branch |

The integration tests make their own store managers at OUT002, OUT017 and OUT064 on Tue 2 Jun 2026 and never
write to OUT001. The race tests send two first saves, two places, and a save against a place at once.
