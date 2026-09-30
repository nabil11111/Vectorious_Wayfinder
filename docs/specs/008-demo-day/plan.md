# 008 · Plan

## Data changes
One migration, `demo-day`, with `apps/api/src/db/schema/demo.ts`, by the lead. No other table changes.

| Table | Columns |
| --- | --- |
| `demo_day`, one row | `id` smallint primary key, always 1 by a check. `clock_base` timestamptz not null, the app's time when the clock was last set. `clock_set_at` timestamptz not null, the real time at that moment. `revision` integer not null default 0, up by one on every move and every reset. `day` integer not null default 1, up by one on every reset. `seeded_at` timestamptz, empty until the day is written. |
| `vehicle_days_off` | `vehicle_id` text not null references `vehicles`. `date` date not null. `reason` text not null, plain words shown to the dispatcher. Primary key (`vehicle_id`, `date`). |
| `fuel_log` | `id` uuid primary key. `vehicle_id` text not null references `vehicles`. `date` date not null. `litres` numeric(6,1) not null, above 0 by a check. `trip_id` uuid references `trips` and is removed with its trip: empty on a history row, set when a sent trip writes its litres (A2). `note` text. Unique (`vehicle_id`, `date`) where `trip_id` is empty, so a vehicle has one history row a day, and unique (`trip_id`) where it is set. |

## Contracts
- In `packages/contracts/src/demo.ts`, by the lead: `DEPOT_TIME_ZONE` (`Asia/Colombo`), `DEMO_PARTS` and
  `DemoPart` (the five keys in the spec's table), and `DEMO_DAY`: depot `Peliyagoda`, order day `2026-06-24`,
  delivery day `2026-06-25`, each part's key, label and start instant, and `endsAt` `2026-06-25T23:59:59+05:30`.
- `ClockState`: `demo`, `now` (an instant, ISO 8601 ending in Z), `part` (null with demo mode off), `holdsAt`
  (where the clock waits), `next` (`{ part, at }`, null in the last part), `revision`, `day`. `MoveClockRequest`:
  `{ revision }`. `LiveEvent`: a strict `{ topic, id? }`, never a record.
- Errors: `stale_clock` (409, `details` is the `ClockState`), `no_next_part` (409), `too_many_streams` (503).
  `signed_out` (401) and `not_found` (404, a demo endpoint with demo mode off) exist already.
- Settings in `lib/config.ts`, `.env.example` and `compose.yaml`: `DEMO_MODE` (default `true`), and
  `LIVE_HEARTBEAT_MS` (20000) and `LIVE_MAX_STREAMS` (200), which tests make small.

## How it works
| File | What it holds |
| --- | --- |
| `apps/api/src/lib/clock.ts` | `initClock`, `now`, `clockState`, `moveToNextPart`, `restartClock`, `depotDate`, `depotMinutes`, `setClockForTests` and `realNow`. |
| `apps/api/src/lib/live.ts` | `openStream`, `announce` and `closeStreams`. The open streams are a list in memory. |
| `apps/api/src/routes/clock.ts`, `events.ts`, `demo-reset.ts` | `GET /clock` and `POST /demo/clock/next`. `GET /events`. `POST /demo/reset`. |
| `apps/api/src/db/demo-day.ts` | `seedDemoDay`, `clearDemoDay`, `demoId`, and the day's rules and fixed rows as constants at the top. A later piece adds its block to `seedDemoDay`. |
| `apps/web/src/lib/clock.ts`, `live.ts` | `useAppClock`, which replaces `useNow.ts`, and `useLive`, mounted once in the shell. |
| `apps/web/src/components/layout/DemoClock.tsx` | The chip and the control: a sheet on a phone, a panel on a desktop. |

**The clock.** Only `realNow()` reads the system time. `now()` is the earlier of `clock_base + (realNow −
clock_set_at)` and the waiting point: one second before the next part, or `endsAt` in the last part.
- `initClock()` reads the `demo_day` row once before the server listens, so `now()` makes no database call. A
  missing row in demo mode is an error: run the seed. Demo mode off has no row, and `now()` is real time.
- `moveToNextPart` locks the row, checks the revision, writes the clock and the audit row `demo.clock_moved` in a
  transaction, updates memory and announces `clock`. `restartClock(tx)` does it in a reset and raises `day`.
- `depotDate(instant)` and `depotMinutes(instant)` go through `Intl` with `DEPOT_TIME_ZONE`, never the server's
  zone. `setClockForTests(instant)` freezes `now()`, and `setClockForTests(null)` lets it go in `afterAll`.
- Times people see are their own columns, written from `now()`: `orders.placed_at`, `orders.saved_at` (spec 009),
  `plans.published_at`. `created_at`, `updated_at`, `audit_log.at` and sessions stay on real time, never shown.
- The one-clock check (AC-13) reads every file under `apps/api/src` and `apps/web/src` and fails on `new Date()`
  with empty brackets or `Date.now()`, except in `lib/clock.ts` on both sides, `middleware/auth.ts`,
  `routes/auth.ts` and test files. The web clock counts passing time with `performance.now()`.

**The live stream.** `GET /events` needs a session and answers with `Content-Type: text/event-stream`,
`Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`, sent at once, never compressed. `openStream`
keeps the connection until the request closes, or answers 503 when full. `announce({ topic, id?, depotId?,
outletId? })` writes `event: change` and the `LiveEvent` as one line of JSON to the streams AC-19 to AC-21 pick,
after the caller's transaction commits. A timer writes `: ping` each `LIVE_HEARTBEAT_MS`. The rate limiter and
request log skip it, and `server.ts` calls `closeStreams()` before `server.close()`.

**The web side.** Every query key starts with its topic: `['clock']`, `['orders', 'store', 'open']`. `useLive()`
opens one `EventSource('/api/v1/events')` for a signed-in person. A `change` message invalidates `[topic]`.
`clock` and `demo` invalidate every query, because "today" changed for every screen, and so does a stream that
opens again after an error. `main.tsx` gives every query `refetchInterval: 60_000`. `useAppClock()` fetches `GET
/clock` under `['clock']` and shows `now` plus the time passed by `performance.now()`, no further than `holdsAt`,
redrawn every 15 seconds in `DEPOT_TIME_ZONE`. On `stale_clock`, `DemoClock` takes the clock from `details`.

**The seed.** `seedDemoDay(tx)` runs at the end of `seed.ts` and does nothing with demo mode off or `seeded_at`
set. It writes the day in one transaction with plain inserts, in a savepoint when handed a transaction, so a
clash leaves nothing. Seeded orders have revision 0, and placed and waiting ones no `created_by`. The drafts have
`nadeesha` and no `placed_at`. An order that waited was placed the day before its wanted date, at 08:00 plus 5
minutes × n. The plans for Tue 23 and Wed 24 Jun are `published`, by `ruwan`, at 17:00 the day before. OUT060's
first deferral, in Tuesday's plan, is `no_reefer` with "No fridge truck was left for Matara." A fuel row has
whole litres, no trip and the note "Seeded history". `demoId(kind, key)` makes a UUID from a SHA-1 of a key like
`order:2026-06-25:OUT002:chilled`, for orders, lines, plans, deferrals and fuel rows.

**Reset.** `POST /demo/reset` runs one transaction, then reads the clock into memory again and announces `demo`.
1. Lock the `demo_day` row, so two resets run one after the other.
2. `TRUNCATE orders, plans, fuel_log, vehicle_days_off CASCADE`. The cascade empties what later pieces add too.
3. Clear `archived_at` on `vehicles`, `outlets` and `products`.
4. Clear `seeded_at`, call `seedDemoDay` and `restartClock`, and write the audit row `demo.day_reset`.

## Risks
- **The hosted proxy buffers or cuts the stream.** We deploy this piece first and watch a stream stay open for
  some minutes. The app still works on the one-minute timer.
- **A later table that a reset forgets.** AC-40 compares every table after a reset with the first seed.

## Test plan
| Criteria | Kind | Where |
| --- | --- | --- |
| AC-2 to AC-7, AC-9 to AC-12, AC-8 for a move | Integration, and unit tests for the arithmetic, which takes the real time as an argument, so no test waits. For demo mode off (AC-10) the test sets `DEMO_MODE=false`, loads the modules fresh and builds the app again | `apps/api/tests/clock.test.ts` |
| AC-13 | A test that reads the source files | `apps/api/tests/one-clock.test.ts` |
| AC-17 to AC-22, AC-24 to AC-26 | Integration against the app on port 0, reading the stream with `fetch` and the session cookie, because supertest cannot hold a stream open. `LIVE_HEARTBEAT_MS` is 50 and `LIVE_MAX_STREAMS` is 5 there | `apps/api/tests/live.test.ts` |
| AC-1, AC-28 to AC-38 | Integration. Each test opens a transaction, clears the day and the clock row, runs the seed, checks and rolls back. AC-37 first puts in a fuel row that clashes with a seeded one. AC-38 runs with `DEMO_MODE=false` | `apps/api/tests/demo-day.test.ts` |
| AC-39 to AC-41, AC-23, AC-8 for a reset | Integration. AC-40 reads every table into a sorted list without the real-time columns, changes things, resets and compares | `apps/api/tests/demo-reset.test.ts` |
| AC-14 to AC-16, AC-27, AC-42 | Written click-through at 390 and 1440 wide, two browsers | The pull request's description |
