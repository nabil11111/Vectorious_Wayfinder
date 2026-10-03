# Data model

Supplied ids (OUT001, VEH001) stay as primary keys, so the Designathon screens, this app and the Datathon all
talk about the same records. New records get UUIDs.

```mermaid
erDiagram
    depots ||--o{ outlets : serves
    depots ||--o{ vehicles : "home of"
    depots ||--o{ district_travel : "travel from"
    outlets ||--o{ orders : places
    outlets ||--o{ outlet_receiving : "declares for a day"
    users ||--o{ outlet_receiving : "last updated by"
    orders ||--|{ order_lines : has
    products ||--o{ order_lines : "ordered as"
    users }o--o| outlets : "store manager of"
    users }o--o| depots : "works at"
    users ||--o{ sessions : "signed in with"
    depots |o--o{ sessions : "switched to"
    depots ||--o{ plans : "plans a day"
    plans ||--o{ trips : has
    vehicles ||--o{ trips : drives
    trips ||--|{ stops : "in order"
    stops ||--o{ stop_orders : carries
    orders ||--o| stop_orders : "is on"
    plans ||--o{ deferrals : "defers"
    orders ||--o{ deferrals : "deferred in"
    vehicles ||--o{ vehicle_days_off : "off on"
    vehicles ||--o{ fuel_log : "used fuel"
    trips ||--o| fuel_log : "costs"
    stops ||--o{ issues : "flagged at"
    issues ||--|{ issue_lines : counts
    order_lines ||--o{ issue_lines : "counted in"
    users ||--o{ issues : "raises or decides"
    users ||--o{ driver_writes : sends
    trips ||--o{ driver_writes : applies
    stops ||--o{ photos : proves
    issues ||--o| photos : shows
    issues ||--o{ orders : "replaced by"
```

## Groups

| Group | Tables | Notes |
| --- | --- | --- |
| Reference (from the booklet CSVs) | `depots`, `outlets`, `vehicles`, `calendar_days`, `district_travel`, `service_allowance` | Loaded by the seed. Outlets keep dock type, parking rule (normal, van only, mall dock), mall window and delivery window. |
| Products (ours) | `products` | The fixed list in `product-list.md`. Weight and volume are per unit, so a load is always quantity times these. |
| People | `users`, `sessions` | One role per user. A store manager belongs to an outlet, the others to a depot. A user signs in with a staff ID and a four-digit PIN, kept hashed; `failed_pins` counts wrong PINs in a row and `locked_until` holds the 15-minute lock after five (spec 018). A session's `depot_id` is the depot a dispatcher switched to, and stays empty while they work on their own (spec 020); `all_depots` is true while they look at both depots together, with `depot_id` empty (spec 021). |
| Demand | `orders`, `order_lines` | One order per temperature, because chilled and dry go on different trucks. An order starts as a draft, and a shop has one draft per temperature at most. Lines store only a quantity, one line per item. |
| Planning | `plans`, `trips`, `stops`, `stop_orders`, `deferrals` | One plan per depot per day. At most two trips per vehicle. Every order is on a stop or deferred with a reason. A sent plan keeps the checker's result it was sent with (`sent_check`). Once the planner has built it, a plan keeps its suggestion (`suggestion`): when it was built, the draft the build saved, the planner's reason for every order and the decisions the dispatcher accepts before sending. Hand edits leave it as built, and the next build replaces it (spec 014). |
| Loading and problems | `issues`, `issue_lines`, and on `trips`, `stops` and `order_lines` | A problem is one record whoever raises it: a loader's flag now, a driver's and a shop's later. Its lines hold the counts it found, and on a shop's report each short line's own reason, missing or damaged (Q-40), with the shop's note on the problem; the dispatcher decides it once. A trip carries a revision, its ready time and the id of its last loader write; a stop its loaded time; an order line its loaded count (spec 012). |
| Driver | `driver_writes`, `photos`, and on `trips`, `stops` and `order_lines` | Photos commit with their delivery or problem. Trips keep departure, return and last event times; stops keep revisions, retries, arrival, outcome and completion; lines keep delivered counts (spec 013). |
| Phone writes | `driver_writes` | Every write a phone saved first and the server applied, the driver's and the shop's receipts alike (D-45, D-57): its UUID bound to the account, trip, kind and body hash, and when it was last answered, on the real clock. The SQL table and its account column keep spec 013's names, `driver_writes` and `driver_id`; the schema calls them `phoneWrites` and `userId`, so no migration renamed them. |
| Shop receipts | on `orders` and `order_lines`, and `issues` of kind `receipt` | A receipt is kept on the orders it covers (D-61): `received_at`, when the shop confirmed as the time rule keeps it, `receipt_sent_at`, when it reached the server, and `arrived_cold` on a chilled order; each line keeps its `received_qty` beside its loaded and delivered counts. A receipt that reports something short, damaged or not cold is a problem of kind `receipt` with the receipt's id, its photo in `photos`. A replacement is an order whose `replaces_issue_id` points at the problem its answer placed it for; a part of a split replacement reaches it through `split_from` (spec 015). |
| Receiving readiness | `outlet_receiving` | One advisory declaration per outlet and calendar date, with status, optional note, revision, updater and app-clock update time. Missing means unconfirmed; yesterday is never carried forward. This is separate from customer opening hours and recorded delivery actions. Demo reset clears these declarations. |
| Fleet days | `vehicle_days_off`, `fuel_log` | A vehicle that cannot be used on a date, with the reason. Litres a vehicle used on a date: one history row a day, and one row for each sent trip. The plan checker reads both. |
| The demo day | `demo_day` | One row: the app's clock, stored as the app's time and the real time it was set, and whether the seeded day has been written. |
| History | `audit_log` | Who changed what and when, with before and after. |

Driver problems keep each closed attempt’s counts even when its orders go on another trip.
