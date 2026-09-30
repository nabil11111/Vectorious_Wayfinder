# 008 · The demo day: clock, live updates and the seeded day

**Status:** Done  ·  **Owner:**  ·  **Design:** the time in the top bar of every role's screens (Shop · Today, Loader · Today's trucks, Driver · Today's trip). The demo control has no frame. It is a judge's tool and is listed as a departure.

## Why
The booklet asks for "at least one realistic delivery day so the walkthrough works on a fresh installation" and a
system that can "handle a day when demand exceeds available capacity". A judge walks that day in a few minutes,
at any hour, and the booklet's calendar ends on 28 Jun 2026. So the real clock cannot drive the screens.

## What it does
Piece A0 of [the map](../000-map.md): one clock, a control to move it through the day, a stream that tells open
screens what changed, and a seeded day, Thu 25 Jun 2026 from Peliyagoda. Every later piece reads this clock,
starts its query keys with its topic, announces a change after saving it, and adds its records to this seed.

## Screen states
| State | What shows |
| --- | --- |
| Clock running | The app's time in depot time, such as 15:18, on the right of a desktop's top bar. Beside it the chip "Demo · Wed 24 Jun". |
| Clock waiting | The time stays on the part's last minute, such as 15:59. A small yellow dot on the chip. The open control says "The clock waits here. Go to the next part when you are ready." |
| Control open | "Demo day" and one line: "Wed 24 Jun 2026, 15:18. The app runs on its own clock so you can walk a whole delivery day." The five parts with their times, the current one marked. The orange button "Next: Orders closed, 16:00", which names the day when that changes: "Next: Loading, Thu 02:30". Under it the plain button "Reset the demo day". A sheet from the bottom on a phone, a small panel under the chip on a desktop, built from the style guide's chip, sheet and buttons. |
| Moving | The orange button says "Moving…" and cannot be tapped twice. |
| Last part | No orange button. One line: "The demo day is over. Reset to start again." |
| Asking before a reset | "Reset the demo day? Every order, plan and delivery made in this demo is removed, and the day starts again on Wednesday at 15:00. Everyone using the demo is affected." The buttons "Reset the day" and "Keep going". |
| Someone else moved it | One line on top of the screen: "The clock moved to Loading, Thu 02:30." The time and every list follow. |
| Someone else reset the day | "The demo day was reset. It is Wednesday 15:00 again." Every list loads again. |
| Loading | The time shows "--:--" until the clock has arrived. No chip. |
| No connection | The time keeps running from the last value the screen had. A button that fails says "Could not reach Wayfinder. Try again." |
| Demo mode off | The time only. No chip and no control. |

## Rules
### The clock
| Part | Key | Starts | What it is for |
| --- | --- | --- | --- |
| Orders open | `ordering` | Wed 24 Jun, 15:00 | Shops place orders for Thursday. The clock starts here. |
| Orders closed | `planning` | Wed 24 Jun, 16:00 | The dispatcher plans Thursday. |
| Loading | `loading` | Thu 25 Jun, 02:30 | The loader loads the trucks. |
| Trucks leave | `on_the_road` | Thu 25 Jun, 03:30 | Drivers deliver. |
| Morning deliveries done | `delivered` | Thu 25 Jun, 08:30 | Shops confirm what arrived. Style and Tech trucks are still out. |

- **Running and waiting (D-18, D-25).** The clock runs at real speed inside a part and waits at its end until
  someone moves it on. Without the wait, a hosted demo left alone would leave the delivery day and the calendar.
  A part changes the time and nothing else. What a role can do then is up to the piece that owns the screen.
- **Which clock writes which time.** Every time a person sees has its own column, written from the app clock:
  `placed_at`, `saved_at` for a draft, `published_at` and the ones later pieces add. `created_at`, `updated_at`
  and the time on an audit row stay on the real clock and are never shown on a screen. Sign-in sessions and their
  12 hour limit stay on the real clock too, so moving the clock signs nobody out.
- **Demo mode off** is the clock's honest real-time path, kept under test. The competition build never uses it.

### Live updates
- **A message says what changed, never the data (D-21).** It holds a topic and sometimes one id, such as
  `{"topic":"orders","id":"…"}`, and the screen fetches through the normal API. So the stream can never show a
  person something their role may not read. This spec brings the topics `clock` and `demo` (the day was reset).
- **The screen's side.** Every query key starts with its topic (`['clock']`, `['orders', …]`), so a message for a
  topic refetches everything under it. A `clock` or `demo` message refetches everything, because "today" has
  changed for every screen. Every query also refetches once a minute, the backup when the stream is down, and a
  stream that comes back after a break refetches everything once.

### The seeded day
| Placed for Thu 25 Jun 2026 | Rule, where `n` is the number in the outlet's id (OUT026 is 26) | In the seed |
| --- | --- | --- |
| Fresh, dry | Every Fresh shop of Peliyagoda but OUT001. 45 + (11 × n mod 21) cartons. | 48 orders, 2,605 cartons, 17,974.5 kg, 96.385 m³ |
| Fresh, chilled | The same shops whose number does not end in 0, 4 or 7. 38 + (5 × n mod 23) cartons. | 34 orders, 1,669 cartons, 11,516.1 kg, 61.753 m³ |
| Style | Every Style shop whose number is not a multiple of 5. Folded 10 + (4 × n mod 9), hanging 6 + (5 × n mod 7), shoes 4 + (n mod 6), bags 3 + (n mod 4). OUT017 is the design's big order instead, the one View plan splits: 50, 45, 25 and 15, which is 1,815 kg and 31.1 m³. | 12 orders, 501 units, 6,674 kg, 113.02 m³ |
| Tech | OUT022 (Colombo, mall slot 10:00 to 12:00): 2 television pallets and 1 small appliance pallet, 530 kg, 1.82 m³. OUT039 (Gampaha): 3 refrigerator crates, 750 kg, 2.55 m³. OUT058 (Galle): 2 washing machine crates and 2 small appliance pallets, 800 kg, 2.64 m³. OUT072 (Kurunegala): 1 washing machine crate, 210 kg, 0.7 m³. The last three need a tail lift. | 4 orders, 11 units, 2,290 kg, 7.71 m³ |

| Chilled order that waited | Cartons | Wanted for | Waited | Latest deferral |
| --- | --- | --- | --- | --- |
| OUT001, Colombo, van only | 12 | Wed 24 Jun | once | `over_capacity` · "The fridge van was full." |
| OUT030, Gampaha | 50 | Wed 24 Jun | once | `no_reefer` · "No fridge truck was left for Gampaha." |
| OUT054, Galle | 55 | Wed 24 Jun | once | `window` · "The truck could not reach the shop before its window closed at 07:30." |
| OUT060, Matara | 39 | Tue 23 Jun | twice | `no_reefer` · "No fridge truck was left for Matara. Two were in the workshop." |

| In the workshop | Off on | Reason |
| --- | --- | --- |
| VEH003, fridge truck, 26.4 m³ | Tue 23, Wed 24 and Thu 25 Jun | Fridge unit repair |
| VEH005, fridge truck, 33.4 m³ | Wed 24 and Thu 25 Jun | Brake service |
| VEH036, fridge van, 7.0 m³ | Thu 25 Jun | Gearbox repair |

- **Placed at.** Each placed order was placed on Wed 24 Jun at 08:00 plus 5 minutes × n, before the clock starts.
- **Short of fridge trucks, not of space (D-26).** The 38 chilled orders due are 67.525 m³ against 140.7 m³ of
  working fridge space. But they lie in seven districts, a trip stays inside one (D-23), and the three van-only
  shops share the one working fridge van. About six orders wait.
- **Fuel used this week.** The quota week is Mon 22 to Sat 27 Jun (D-20). Every Peliyagoda vehicle has one row
  for each of Mon 22, Tue 23 and Wed 24 Jun on which it was not in the workshop: its weekly quota × (9 + (5 × v
  mod 8)) ÷ 100 litres, rounded down, `v` being the number in its id. VEH001 is the exception with 100 litres a
  day, which leaves it 40 of its 340. Kurunegala, the nearest far district, takes 40.4.

## Failure paths
- **A reset while someone is in the middle of a task.** Their screen is told at once and shows the fresh day. A
  request that still names a removed order or plan gets the usual "not found" answer and changes nothing.
- **The rest are criteria:** the stream dropping or cut by a proxy (AC-27), two moves at once (AC-5), two resets
  (AC-41), the seed run twice (AC-35) or failing halfway (AC-37), a restart (AC-7), a stop with open streams
  (AC-26), too many streams (AC-25) and a wrong device clock (AC-14).

## Permissions, data in and out
Four endpoints under `/api/v1`. Every signed-in role may use all four, because judges hold one account per role
(D-25). `GET /clock` gives the time now, if demo mode is on, the part, where the clock waits, the next part, the
revision and the day number. `POST /demo/clock/next` carries the revision and moves the clock, and `POST
/demo/reset` resets the day. Both answer with the clock, in demo mode only. `GET /events` is the live stream.

Three new tables: `demo_day` (one row: the clock and whether the day is written), `vehicle_days_off` and
`fuel_log`. The seed also writes `orders`, `order_lines`, `plans` and `deferrals`. The plan checker (spec 007)
gets `available` from `vehicle_days_off` and `litresUsedThisWeek` from `fuel_log`. Reading them is A2's job.

## Acceptance criteria
### The clock
- [ ] **AC-1** When the seed has run on an empty database in demo mode, the system shall hold the clock at Wed 24
  Jun 2026 15:00 depot time, in the part `ordering`, with revision 0 and day 1.
- [ ] **AC-2** When real time passes inside a part, the system shall move the clock by the same amount. *Set to
  15:00, 18 real minutes later it says 15:18.*
- [ ] **AC-3** When the clock reaches one second before the next part, the system shall keep it there, and in the
  last part at Thu 25 Jun 23:59:59. *Set to 15:00, 70 real minutes later it says 15:59:59.*
- [ ] **AC-4** When a signed-in person of any role asks for the next part with the current revision, the system
  shall move the clock to its start, raise the revision by one and return it. *15:20 in `ordering` to 16:00:00.*
- [ ] **AC-5** When that request carries an older revision, the system shall answer 409 `stale_clock` with the
  current clock and change nothing.
- [ ] **AC-6** When the clock is in the last part, the system shall answer 409 `no_next_part`.
- [ ] **AC-7** When the server starts again, the system shall carry on from the stored time plus the real time
  passed, no further than the waiting point. *Set to 16:00 at 10:00:00 real time, it says 16:05:20 at 10:05:20.*
- [ ] **AC-8** When the clock is moved or the day is reset, the system shall write one `audit_log` row with the
  person and the clock before and after.
- [ ] **AC-9** When a signed-out person calls a clock or demo endpoint, the system shall answer 401 `signed_out`.
- [ ] **AC-10** When demo mode is off, the system shall return the real time with `demo` false and no part, and
  shall answer the next-part and reset requests with 404.
- [ ] **AC-11** When asked for the depot date and time of an instant, the system shall give them in Sri Lanka
  time whatever time zone the server runs in. *18:45 UTC on 24 Jun 2026 is Thu 25 Jun 2026, 00:15.*
- [ ] **AC-12** When a test sets the clock, the system shall return exactly that time until the test lets it go,
  with no running and no waiting point. *A test sets Sat 20 Jun 2026 10:00 and reads it back.*
- [ ] **AC-13** When a source file outside the short list in `plan.md` reads the system time, the one-clock check
  shall fail. *`new Date()` with nothing in the brackets in a route file fails the test run.*
- [ ] **AC-14** The time on screen. For each role, on a phone and a desktop, the top bar shows the app's time and
  the chip "Demo · Wed 24 Jun". With the laptop on another time zone and a wrong time, both stay the same.
- [ ] **AC-15** Tapping the chip shows the five parts and times, the current one marked, and an orange button
  naming the next part and time. Reset asks first. The last part has no orange button, demo mode off no chip.
- [ ] **AC-16** Someone else's move. With two browsers signed in as different roles, a move or a reset in one
  changes the time in the other within a second, shows the one-line message and loads every list again.

### Live updates
- [ ] **AC-17** When a signed-in person opens the stream, the system shall answer with `text/event-stream`, keep
  the connection open and send a heartbeat at least every 20 seconds, which keeps proxies from closing it.
- [ ] **AC-18** When a signed-out person opens the stream, the system shall answer 401 `signed_out`.
- [ ] **AC-19** When a change is announced for a depot, the system shall send it only to its dispatcher, loaders
  and drivers and to admins. *Peliyagoda: `ruwan` and `admin` get it, `prasanna` in Kandy and `nadeesha` do not.*
- [ ] **AC-20** When a change is announced for an outlet and its depot, the system shall also send it to the
  store manager of that outlet, and to no other store manager. *A change for OUT001 reaches `nadeesha`.*
- [ ] **AC-21** When a change is announced for everyone, the system shall send it to every open stream.
- [ ] **AC-22** When the system sends a message, it shall hold the topic and at most one id, and nothing else.
- [ ] **AC-23** When the clock is moved, the system shall announce `clock` to every open stream after the move is
  saved. When the day is reset, it shall announce `demo`.
- [ ] **AC-24** When a person opens the stream, the request shall not count toward the API's rate limit. *The
  answer carries no `RateLimit` header, while `/health` carries one.*
- [ ] **AC-25** When the number of open streams has reached the limit, which is 200 unless the setting says
  otherwise, the system shall answer a new one with 503 `too_many_streams`. That screen works on the timer.
- [ ] **AC-26** When the server is told to stop, the system shall end every open stream, so it can exit.
- [ ] **AC-27** Live on screen. With two browsers, a change in one shows in the other within a second with no
  reload, and within a minute with the stream blocked in the browser. Unblocked, the screen refetches at once.

### The seeded day and reset
- [ ] **AC-28** When the seed has run on an empty database in demo mode, the system shall hold 98 placed orders
  for Thu 25 Jun 2026, all for Peliyagoda outlets: 48 Fresh dry, 34 Fresh chilled, 12 Style and 4 Tech.
- [ ] **AC-29** When those loads are added up from the product list, the system shall give 2,605 dry and 1,669
  chilled cartons, 501 Style units at 113.02 m³ and 11 Tech units at 2,290 kg. *OUT026 has 58 dry and 53 chilled
  cartons. OUT017's Style order is 31.1 m³.*
- [ ] **AC-30** When the seed has run, OUT001 shall have two draft orders for Thu 25 Jun 2026 made by `nadeesha`,
  with 8 chilled cartons and 4 dry cartons, and no placed order for that day.
- [ ] **AC-31** When the seed has run, the four chilled orders that waited shall be `deferred` and keep the date
  the shop wanted. Each has a deferral, with a code from spec 007's list and a reason, in Peliyagoda's sent plan
  for Wed 24 Jun, and OUT060 a second one in the plan for Tue 23 Jun. Both plans have no trips.
- [ ] **AC-32** When the seed has run, `vehicle_days_off` shall hold the six rows of the workshop table. *On Thu
  25 Jun the working fridge vehicles at Peliyagoda are VEH001, VEH002, VEH004, VEH006, VEH007 and van VEH035.*
- [ ] **AC-33** When the chilled orders due on Thu 25 Jun are counted, placed and deferred, the system shall hold
  38 orders and 1,825 cartons. Van-only shops aside, they lie in seven districts. Five fridge trucks work.
- [ ] **AC-34** When the seed has run, `fuel_log` shall hold 111 rows, all for Peliyagoda vehicles and all on 22,
  23 or 24 Jun 2026. *VEH001's rows add up to 300 of its 340 litres. VEH002's add up to 201.*
- [ ] **AC-35** When the seed runs again, on a restart or by hand, the system shall add nothing and change
  nothing, whatever people have done since. *Change the draft to 9 chilled, run the seed, it still says 9.*
- [ ] **AC-36** When the seed writes the day, every row shall get the same id and content each time. *The id of
  OUT002's chilled order for Thursday is the same before and after a reset.*
- [ ] **AC-37** When the seed fails partway, the system shall have written none of the day.
- [ ] **AC-38** When demo mode is off, the seed shall write no clock row and no record of the day.
- [ ] **AC-39** When any signed-in role resets the day, the system shall remove every order and plan and what
  hangs off them, empty the fuel and workshop rows, clear `archived_at` on vehicles, outlets and products (D-25),
  seed the day again, set the clock to Wed 24 Jun 15:00, raise the day number by one and return the clock.
- [ ] **AC-40** When the day has been reset, every table except the users, the sessions and the audit log shall
  hold exactly what it held after the first seed. *Place the draft, add a plan with a trip, move the clock twice,
  reset. The 104 orders and 142 order lines are back and nothing else is left.*
- [ ] **AC-41** When two resets come at once, the system shall answer both and leave one seeded day, not two.
- [ ] **AC-42** A reset on screen. With two browsers, a reset in one shows the fresh day in the other within a
  second, with the one-line message. A form that was open shows the seeded values again.

## Out of scope
- Moving the clock backwards, over a part or by some minutes. A later piece can add "15 minutes on" through the
  same endpoint if a screen needs it to show a late truck.
- A second seeded day, one for Kandy, and trips, loading, deliveries and receipts in the seed (later specs add
  their own, and a reset brings them back). The 16:00 cut-off (spec 009). A sign that the stream is down and the
  time on a phone with no signal (A6). Push notifications, sounds, sockets and a second server process (D-01).

## Departures from the design
1. A demo chip beside the time in every top bar, with a control that moves the clock to the next part of the day
   and resets the day. Judges need it to walk a whole delivery day in a few minutes.
