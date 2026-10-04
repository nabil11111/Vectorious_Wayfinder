# 017 · Tasks

> Build record: this describes the original implementation sequence. See the [spec guide](../README.md)
> for current status and the later specs that supersede parts of this work.

This PR is documents only. These tasks implement A8 **only if it survives the cut line**. T0 starts after 016
is merged and the joined four-role/offline journey and A7 checks pass. Orders and Fleet require merged 013;
History's confirmations and replacements additionally wait for merged 015. That extra gate does not hold up
Orders/Fleet. Every automated criterion gets its named test written and run failing before implementation (D-07).
One PR per task, with T1/T2 split into their page steps if History is still waiting for 015. No built-screen or
runtime-test results are claimed here.

- [x] **T0 · Shared parts** · lead, `nabil/lookup` from main **after 016 merges**. Confirm 013's reviewed driver
  fields/helpers and the reduced picks in this spec. Add `packages/contracts/src/lookup.ts` and its export:
  Orders with inline detail/Skipped lately, History, Fleet Today, date/range queries and scoped proof metadata.
  No detail/search/availability contract, new error code, schema, migration, seed or package. Mount the empty
  `routes/lookup.ts` behind dispatcher/depot checks in `app.ts`. Reviewed 016 has no proof route: assign the new
  proof handler to A8's T1 in `routes/lookup.ts` / `lookup/photo.ts`. If an equivalent route is already merged,
  reuse it unchanged and name it in the contract; never write into 016's files. Add lookup's invalidation fan-out
  in web `lib/live.ts`, AC-28 failing first, preserving existing invalidations. Own `DispatcherHome.tsx` for the
  three page mounts and wide shell, preserving the joined 016 routes/bell; hand minimal page export shells to
  T2 with no fake data. Define History's shape against reviewed 015; confirm its actual fields/helpers before
  T1b/T2b starts, resolving any contract difference here without editing 015. Mark A8 Building only when work
  starts. Push T0 separately so the API and screens builders share the same contracts.
- [x] **T1 · The reads** · API builder, after T0, with these two dependency steps:
  **T1a Orders and Fleet** closes AC-1, AC-2, AC-3, AC-4, AC-5, AC-7, AC-8, AC-20, AC-21, AC-22, AC-23, AC-24,
  AC-27 and AC-37 for those routes. Start from 013's joined code, with no 015 read. Implement delivery-day sets,
  inline order detail and Skipped lately, then Fleet Today/fuel and snapshot races. **T1b History and proof** waits
  for 015 to merge for confirmations/replacements and closes AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16,
  AC-17, AC-18, plus AC-1/2/3/27 on these routes. Use retained issue facts only; no audit arrival or legacy-trip
  branch. Proof stays in A8's own route/helper. Files: `apps/api/src/lookup/` (`orders.ts`, `history.ts`,
  `attempts.ts`, `fleet.ts`, `photo.ts`, only needed `figures.ts`/`dates.ts` and local pure tests), plus
  `apps/api/src/routes/lookup.ts` after T0 hands it over. Integration files: `apps/api/tests/lookup-plan.ts`,
  `lookup-access.test.ts`, `lookup-orders.test.ts`, `lookup-history.test.ts`, `lookup-attempts.test.ts`,
  `lookup-fleet.test.ts`, `lookup-snapshot.test.ts`. Reuse earlier walkthrough helpers without editing them.
  AC-14 uses `setClockForTests` for Thursday/Friday and restores it; no browser substitutes for this test.
- [x] **T2 · The screens** · screens builder, beside T1 after T0. **T2a Orders and Fleet** can start with merged
  013 and T0's shapes; no dependency on receipt code. **T2b History** confirms 015's actual receipt/replacement
  fields before completion; never turn missing implementation into an empty confirmation. Close AC-6 and AC-29
  with failing tests first, and build the screens checked by AC-30–35. Files are exclusively
  `apps/web/src/features/lookup/`: `api.ts`, `queries.ts`, `queries.test.ts`, `filters.ts`, `filters.test.ts`,
  `OrdersPage.tsx`, `OrderDetail.tsx`, `HistoryPage.tsx`, `HistoryDetail.tsx`, `PhotoViewer.tsx`, `FleetPage.tsx`,
  `VehicleDetail.tsx`, `parts/`, `words.ts` and local tests. Orders filters the full response locally and takes
  selected detail from that row; no second query. Use existing clock, query, live and shell seams. No new business
  sums, EventSource, persistent cache, phone queue, availability screen or custom narrow cards. All tables stay
  inside their own scrolling boxes; below 1024 the detail stacks underneath. Fixtures are for tests only. T3
  must verify the real API; contractual component tests alone do not mark screens done.
- [x] **T3 · Join and click through** · lead, after both builders and 015's History gate. Closes AC-30, AC-31,
  AC-32, AC-33, AC-34 and AC-35 and checks every automated criterion. Join, freshly migrate/seed the private
  database, run typecheck/tests/build, then click through the **built app in Nabil's visible Chrome**. Match the
  three built dispatcher frames and style guide; record both six-week frames as excluded. Record results below,
  actual test totals and failures fixed in the PR. Files: agreed T0 shared files for integration, `README.md`
  for actual judge steps/departures, map/specs index/this folder for scope/status/results. Record the narrowing
  of 013's A8 promise for the lead's documentation join. No edits to 016's files or another role's implementation.
- [x] **T4 · Independent review** · a teammate/tool that did not build T0–T3, AC-36 and the full criterion table.
  Check own-day memberships/counts, skipped-shop grain, active-only headers, source/receipt separation,
  depot/photo access, kept schedules and snapshot/reset behavior. Report material defects with reproducible
  checks to the owning builder; lead joins fixes and reruns affected checks plus the required suite. Mark A8
  Done only after checks/review pass. Nabil merges.

## Ownership and parallel work
T1 and T2 branch from `nabil/lookup` after T0 is pushed. Their Orders/Fleet steps run side by side without 015;
History's confirmation/replacement work waits for that merge. A stubbed receipt response is not a way past the
gate. T3 waits for both complete sides. No production fixtures or new business record may bridge missing work.

| Owner | Exclusive files while builders work |
| --- | --- |
| Lead / T0, then T3 | `packages/contracts/src/lookup.ts` and export, `apps/api/src/app.ts`, web `lib/live.ts`/`live.test.ts`, `features/dispatcher/DispatcherHome.tsx`; initial route/page mounts handed over once. |
| API / T1 | `apps/api/src/lookup/**`, `apps/api/src/routes/lookup.ts` after T0, named `apps/api/tests/lookup-*` files. |
| Screens / T2 | `apps/web/src/features/lookup/**`, including handed-over page shells. |
| Lead / T3–T4 | Integration documentation/status and review fixes assigned back to their owner. |

No edits to `operations/**`, `routes/operations.ts`, `features/operations/**` or other 016-owned feature files.
No edits to other roles' features, schema, migrations, seed, clocks, packages, service worker or existing commands.
The shared live/router changes happen once under T0 after 016's merge. Builders needing anything outside their
files stop and name it to the lead. Never commit `.env` or `AGENTS.md`.

## Checks at join
Each named check below gets a written result with viewport, date and observed counts, in visible Chrome on the
built app. These are future implementation gates, not claims about this spec PR.

1. **Orders desktop lookup (AC-30).** At 1440, board day Thursday gives 102 → 104 after placement; Last 4 weeks
   127 → 129. Send gives five planned and 99 deferred on Thursday's own 104 rows. Search/filter/select without
   a search/detail request, inspect split original detail and dated History links. Fresh Skipped lately has four
   shops with Dickwella twice, the other three once; table filters leave that panel and the summary unchanged.
2. **History desktop lookup and proof (AC-31).** Manual VEH035: one trip, two stops, five orders, 99 deferred,
   118 ordered → 117 loaded → 115 handed over with two refused. Open actual proof, loading flag, decided refusal
   and Nugegoda's one confirmation / three orders / 22 cartons after 015. In a separate retry run inspect each
   closed issue's own facts. Seeded Tue/Wed have no trips and one/four deferrals. Thursday/Friday receipt
   isolation belongs only to AC-14's API test with `setClockForTests`, not this browser check.
3. **Fleet desktop Today only (AC-32).** Check 38 active / nine reefers / four vans and three workshop vehicles,
   VEH001's 40 L left, fuel 6,945 → 6,947.7 on Send, recorded start/return and dated History links. Archiving
   VEH003 gives 37 / eight / four with its own old records retained. No Next 6 weeks toggle, forecast, hire,
   booking-off control or availability substitute. Compare the frame's groups/detail rail and clear labels.
4. **Lookup narrow tables and boundary (AC-33).** At 390 and 820 the table scrolls inside its bounded box and
   detail stacks below it; at 1024 use table/detail rail. All filters, columns, photos and Close are keyboard
   reachable. No page-wide horizontal scroll, custom card layouts or focus traps.
5. **Lookup failure empty and session states (AC-34).** Exercise no publication, empty delivery day, no default
   board day, search miss, no skipped shops, absent proof, unavailable fuel week, initial failure, failed refresh,
   photo failure, lost connection and expired session. Keep states distinct; stale data never wears a new
   date/depot heading. Retrying reads writes nothing. There is no selected-order-gone or legacy-trip state.
6. **Joined roles and offline sync end showing accepted facts (AC-35).** Keep Ruwan's lookup open with separate
   loader, driver and shop sessions. Place/send/load/answer/start/deliver/receive, and archive in a separate run;
   the final view reflects accepted facts. Several announcements/refetches from a delivery are allowed. Queue
   driver proof/delivery offline then sync; hold a shop receipt offline and confirm it appears only after sync.
   Test default board-day rollover, calendar midnight, backward reset, reconnect, sign-out and a slow photo
   while changing selection. Old-run selected identities/photos clear without inventing a missing-order screen.

Follow plan.md's one-to-one named criterion table, including removed ids AC-9/19/25/26 and the new AC-37. Each
integration file signs in once per account, uses its private seeded database, restores the seeded day at file end
and restores the clock. No skipped/disabled tests, empty catches or sample production data. Screenshots and smoke
tests do not replace the exact API assertions, receipt isolation and snapshot races.

After each implementation task: freshly migrate/seed its private database, then `npm run typecheck`, `npm test`
and `npm run build`, all passing. Repeat on the joined branch before the built-app Chrome checks; use free ports
other than 3000/5173. The documents-only draft checks its six-file scope, facts, references and 33-criterion
coverage without starting the app or claiming runtime results.
