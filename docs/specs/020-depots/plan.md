# 020 · Plan

> Build record: this describes the original implementation sequence. See the [spec guide](../README.md)
> for current status and the later specs that supersede parts of this work.

## Data changes
- Migration `0010_depot_switch`: `sessions.depot_id text references depots(id)`, nullable (null: the user's own depot).
- Seed: the new accounts in `DEMO_USERS` (`apps/api/src/db/fixtures.ts`), a fixed list of given names, no randomness;
  `demo-accounts.ts` adds any missing demo account on an older install as it already fills staff IDs and PINs. Kandy's
  Thursday orders are a new block in `demo-day.ts`, written by the seed and by "Reset the demo day" alike.

## Contracts
`SwitchDepotRequest = { depotId: string }` (checked against the depots table in the route). `Me` keeps its shape:
for a dispatcher, `depotId` is the depot the session works on.

## How it works
**Server.** The session middleware loads the session's `depot_id` with the user; for a dispatcher with one set, the
request's `depotId` is that depot, so every route that reads the caller's depot (plans, the suggested plan, sends,
answers, operations, look-ups, the live stream) follows the switch without its own change. Look for any place that
reads a dispatcher's depot from the users table instead of the request, and move it to the request. `PUT
/api/v1/me/depot` checks the role and the depot, sets `sessions.depot_id`, and answers `Me`. A new sign-in creates a
new session, so it starts at the user's own depot. The live stream takes its depot when it connects; the screens
reconnect after a switch.

**Seed.** Store managers for the other 117 shops in outlet order (S-004 onwards), Kandy's drivers (D-037 onwards,
one per Kandy vehicle not in the workshop on Thursday) and loader L-002, each with a given name from a fixed list and
a username built from it (unique). Kandy's Thursday orders follow spec 008's rules for Peliyagoda, by the number in
the shop's id, with Kandy's Tech orders written out. `docs/accounts.md` lists every account; a test reads it against
`DEMO_USERS` so the two cannot drift.

**Screens.** One `useSwitchDepot` mutation: on success it cancels every query, removes all but the account and the
clock, stores the new `Me`, and reopens the live stream; on failure the switch goes back with its line. The top bar's
`DepotSwitch` and the map card's switch both use it; Both stays greyed with "Both depots together come later." The map
draws the chosen depot's view from `FLEET_MAP`.

## Risks
- A read keyed without the depot showing the other depot's data for a moment: the switch empties the cache first.
- A route that reads the depot from the users table: integration tests switch to Kandy and exercise every dispatcher
  route family.
- Peliyagoda's walkthrough numbers moving: the existing demo-day test pins them and must not change.

## Test plan
- AC-1, AC-2: seed tests (accounts, `docs/accounts.md`, Kandy's totals, Peliyagoda unchanged).
- AC-3 to AC-5, AC-7: integration tests on a seeded database (`apps/api/tests/depot-switch.test.ts`).
- AC-6: web unit tests of the switch, the cache, the stream and the lines; then Chrome next to the frames.
- AC-8: read in review.
