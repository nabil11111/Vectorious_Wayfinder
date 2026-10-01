# 021 · Plan

## Data changes
Migration `0011_both_depots`: `sessions.all_depots boolean not null default false`. When it is true the session is on
Both, and `depot_id` is null. A new sign-in creates a session with neither set, so it starts at the dispatcher's own
depot.

## Contracts
- `BOTH_DEPOTS = 'Both'`: the scope name a dispatcher's `Me.depotId` and the D-95 header carry when the session is on
  Both.
- `SwitchDepotRequest.depotId` also takes `'Both'`.
- `DepotRead = z.object({ depot: z.string().min(1).max(64).optional() })`: the query every dispatcher read takes.
- The error codes `pick_a_depot` and `depot_changed` are cross-cutting, like `signed_out`.

## How it works
**Server.**
- The session middleware gives a dispatcher on Both `req.user.depotId = 'Both'`. A route that compares it with a
  table's depot then matches nothing, so a route not yet taught Both shows nothing rather than the wrong depot.
- One helper, `readDepotOf(req)`, decides the depot of a read:
  - on one depot: that depot, with `?depot=` absent or equal to it, and 409 `depot_changed` if it names another;
  - on Both: the depot `?depot=` names, which must exist, and 400 `pick_a_depot` if none is named.
- Every dispatcher read uses `readDepotOf`: operations, the problems list and bell, the problem and proof photos, and
  the look-ups. Plan writes keep `depotCallerOf` and get a 409 `pick_a_depot` guard on Both.
- A problem's answer takes the problem's own depot when the session is on Both. It still checks the problem belongs
  to one of the dispatcher's depots.
- The D-95 header check compares the header with the session's scope, so 'Both' is a scope like a depot.
- The live stream on Both subscribes to every depot.

**Screens.**
- The switches enable Both through the same `useSwitchDepot`. The line under the name reads "Dispatcher · Both
  depots".
- `lib/api.ts` names 'Both' in the D-95 header.
- Every dispatcher read takes the depot it reads as a parameter and puts it in its query key. Under Both, a page reads
  Peliyagoda and Kandy separately and shows each part with its depot's name. Under one depot, each page reads as now.
- The dashboard sums the two snapshots for the tiles and lists both depots' rows, each with a depot tag, using the
  style guide's chip. It composes the map card's Both view from both snapshots' map data and `FLEET_MAP.Both`.
- Live day, Orders, History and Fleet render their existing body once per depot, under a heading with the depot's
  name.
- The plan board and View plan show the depot picker.

## Risks
- A route that reads the depot outside `readDepotOf` would show one depot as both. API tests on a Both session hit
  every dispatcher read and expect 400 without `?depot=`.
- Query keys without the depot would mix the two parts. Web tests render Both with two different snapshots and check
  every row's depot.
- Sums must never double count. Pin rule 1's numbers on the seeded day.

## Test plan
- AC-1 to AC-4: integration tests on a seeded database (`apps/api/tests/both-depots.test.ts`).
- AC-5 to AC-7: web unit tests of the switch, the dashboard sums and tags, the map's Both view, each page's two
  parts, the depot picker, and a failed part. Then a Chrome check next to the frames.
- AC-8: read in review.
