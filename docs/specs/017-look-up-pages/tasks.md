# 017 · Tasks

This PR is the spec only. The unchecked tasks below are for implementation **if A8 survives the cut line**.
One pull request per task. Every business criterion gets its named test written, run failing and committed before
the implementation (D-07). No test totals or built screens are claimed by this draft.

- [ ] **T0 · Shared parts** · lead, on `nabil/lookup` from the joined main after 013–015 and the reviewed shared
  parts of 016, once the four-role/offline journey and A7's agreed checks pass. Resolve the open questions or
  explicitly retain these picks before handing out work. Add the
  five read/query shapes in `packages/contracts/src/lookup.ts` and its export in `index.ts`; no new error code,
  schema, migration, seed, package or clock. Mount the empty `routes/lookup.ts` behind the existing dispatcher
  role and depot checks in `app.ts`. Settle the shared 016 proof reader/route and its metadata/viewer interface:
  if not yet built, bring that one authorized JPEG GET forward with tests, not a second A8 endpoint. Confirm the
  joined 015 receipt fields and transaction-local helpers, plus 013's reviewed fixes. Add lookup's topic fan-out
  in the web's `lib/live.ts`, with AC-28's failing test first; preserve all prior invalidations. In
  `DispatcherHome.tsx` replace the three `ComingNext` mounts with the agreed lookup page imports and wide shell,
  keeping 016's routes/bell. T0 may supply minimal export shells only for those pages until T2 fills them; no
  fake rows. Agree the retained-attempt projection and helper exports once if a shared helper needs widening.
  Mark A8 Building only when this implementation starts. Push T0 separately so both builders start from it.
- [ ] **T1 · The lookup reads** (AC-1 to AC-27) · API builder, after T0. First the scoped order/history/attempt
  reads and their tests; then Fleet/fuel/42 dates; then the reset/write interleavings and photo integration.
  Files: `apps/api/src/lookup/` (`orders.ts`, `history.ts`, `attempts.ts`, `fleet.ts`, `availability.ts`, `figures.ts`,
  `dates.ts` and local pure tests), and the five GET handlers in `apps/api/src/routes/lookup.ts`. Tests:
  `apps/api/tests/lookup-plan.ts`, `lookup-access.test.ts`, `lookup-orders.test.ts`, `lookup-history.test.ts`,
  `lookup-attempts.test.ts`, `lookup-photos.test.ts`, `lookup-fleet.test.ts`, `lookup-availability.test.ts`,
  `lookup-snapshot.test.ts`. Reuse earlier walkthrough helpers; do not edit their scenarios or shared write code.
  Match plan.md's named tests and exact seeded numbers. Keep every answer in one reset-safe snapshot, every
  missing measure explicit, and all GETs without writes/announcements. Photo tests exercise the shared endpoint;
  any fix to that shared owner goes to the lead, not a duplicate route in lookup.
- [ ] **T2 · The lookup screens** (AC-29 and the screens for AC-30 to AC-35) · screens builder, after T0, beside
  T1. Files: everything in `apps/web/src/features/lookup/` only: `api.ts`, `queries.ts`, `queries.test.ts`,
  `OrdersPage.tsx`, `OrderDetail.tsx`, `HistoryPage.tsx`, `HistoryDetail.tsx`, `FleetPage.tsx`, `AvailabilityPage.tsx`,
  `VehicleDetail.tsx`, `parts/`, `words.ts` and local tests. Start with AC-29's failing tests for date/account/reset
  response order and photo cleanup, then build each page against the contracts. Use the existing clock, query,
  live, shell and proof-viewer seams; no copied business calculations, EventSource, persistent query cache or
  phone queue. Build the exact frame/no-frame states at desktop and below 1024. Test-only fixtures may support
  component checks, but the app renders only API responses and cannot be marked done until T3 uses the real API.
- [ ] **T3 · Join and click through** (AC-30 to AC-35, and completion of every automated criterion) · lead,
  after T1 and T2. Join the branches, run the private freshly migrated/seeded database checks, then execute the
  named browser checks below next to all five dispatcher PNGs and the style guide. Files: the agreed shared T0
  files for integration only; `README.md` for the actual judge steps/departures; `docs/specs/000-map.md`,
  `docs/specs/README.md` and this folder for status/results; the A8 exclusions in 013/016 to name the retained
  history boundary. No broader product feature or data-model change. Record the actual commands, API/web totals
  and browser results in the PR; fix a discovered rule failure with a failing test first.
- [ ] **T4 · Independent review** (AC-36 and the complete criterion table) · a teammate or tool that did not
  build T0–T3. Check depot/privacy/photo access, null-versus-zero/count grains, returned/retried receipts, saved
  schedule reads, snapshot/reset safety and every excluded control against the spec. Report material defects,
  each with a reproducible failing check, to its owner. The lead joins fixes and reruns affected checks plus the
  required suite. Mark A8 Done only after the named checks and independent review pass. Nabil merges.

## At the same time
Both builders branch from `nabil/lookup` **after T0 is pushed and its shared contracts are stable**. T1 and T2 can
run side by side; neither changes the other's tree. The screens builder need not wait for each route, but no
production placeholder/sample response is allowed. T3 waits for both; the full four-role journey remains the
priority if this piece is cut.

| Owner | Exclusive files while builders work |
| --- | --- |
| Lead / T0, then T3 | `packages/contracts/**`; `apps/api/src/app.ts`; shared `lib/**` and helper exports; 016's `operations/photo.ts` and `routes/operations.ts` proof seam; `apps/api/src/routes/issues.ts` if its shared photo read needs alignment; web `lib/**`, `features/dispatcher/DispatcherHome.tsx`, shared viewer/components/icons; relevant shared tests. |
| API / T1 | `apps/api/src/lookup/**`; `apps/api/src/routes/lookup.ts` **after T0 hands over its empty mount**; the named `apps/api/tests/lookup-*` files. |
| Screens / T2 | `apps/web/src/features/lookup/**`, including the minimal page shells handed over by T0. |
| Lead / T3–T4 | Integration documentation/status and changes requested by the independent review, assigned back to the owning builder where appropriate. |

Nobody adds or edits schema, migrations, seed data, clocks, `package.json`, Vite/service-worker configuration or
other roles' commands for A8. Nobody changes `features/plan`, `features/store`, `features/driver`, `features/loader`
or `features/live` to make a lookup work. A builder needing a shared change stops and names it to the lead; the lead
resolves the seam once before either builder resumes dependent work. Never commit `.env` or `AGENTS.md`.

## Checks at join
The named AC-30–35 checks in plan.md each get one written result, with the date, viewport and observed counts:

1. **Orders desktop lookup (AC-30).** At 1440, fresh seed wanted Thursday 98 → 100 and four-week 127 → 129 after
   Nadeesha places. Select/filter/search, open the original of a split and a replacement source, and follow its
   dated History link. Search/no-match/date changes must not change what the unfiltered summary means.
2. **History desktop lookup and proof (AC-31).** Run the manual VEH035 flow: five orders, two stops, 99 deferred,
   118 ordered → 117 loaded → 115 handed over with two refused. Open actual proof, loading flag, decided refusal
   and one Nugegoda confirmation of three orders / 22 cartons. A separate retry/closed-return run checks retained
   attempts and Friday isolation. Open a legacy publication; no schedule or trip is invented.
3. **Fleet desktop records and future view (AC-32).** Verify 38 active / nine reefers / four vans, the three
   workshop vehicles, VEH001's 40 L remaining, 6,945 → 6,947.7 litres on send, recorded start/return and dated trip
   links. Next 6 weeks is 25 Jun–5 Aug, with Sun 28 closed and Mon 29 unknown. Match the frame groups/detail rail
   while confirming that no forecast, hired-booking or workshop-write control is present.
4. **Lookup narrow layouts and boundary (AC-33).** Repeat representative list/filter/detail/photo access at 390,
   820 and 1024. Cards/inline details below 1024, table/rail at 1024; no page-wide overflow, hidden filters or
   keyboard traps. The History times and all 42 availability dates remain readable without a chart.
5. **Lookup failure empty legacy and session states (AC-34).** Exercise no publication, no wanted orders, a search
   miss, missing proof, legacy detail, unavailable week, initial failure, failed refresh, photo failure, lost
   connection and expired session. Distinguish each labelled state; stale data must never wear a new date/depot
   heading. Retrying a read changes no business record.
6. **Joined roles and offline sync update the lookups (AC-35).** Keep Ruwan's lookup open with separate loader,
   driver and shop sessions. Place/send/load/answer/start/deliver/receive; verify refresh after each relevant
   accepted action and admin archive. Queue driver proof/delivery offline, then sync: only accepted records
   appear. Hold a shop receipt offline: no confirmation until it syncs. Test clock midnight, backward reset,
   reconnect, sign-out and a slow photo response while changing the selection. Old-run selections/photos clear.

Each integration test file signs in once per account, uses its builder's private database, restores the seeded
day at file end and restores the app clock. Test fixture changes are confined to tests. Follow plan.md's coverage
table; screenshots or a green smoke test do not replace exact seeded assertions and the concurrency probes.

After each implementation task, on its private database: freshly migrate/seed, then `npm run typecheck`, `npm test`
and `npm run build`, all passing. Run the same gate on the joined branch before browser checks. Use free ports other
than 3000/5173. Record failures/fixes rather than skipping tests. These commands are **implementation gates**;
the documents-only spec PR checks its six-file scope, references, facts and AC coverage without starting the app.
