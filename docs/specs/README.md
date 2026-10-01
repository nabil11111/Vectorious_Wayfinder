# Specs

We build Wayfinder spec first. Every feature starts here, before any code. The flow follows the spec, plan,
tasks shape used by GitHub Spec Kit and Amazon Kiro.

Start with [the map](000-map.md). It lists every piece of the build in order, what the pieces share, and what
we cut first if time runs short.

## How a piece gets built

We do not write every spec up front. The map fixes what all pieces share, then each piece goes through the
same loop, and the spec for the next piece is written while the current one is being built.

A builder can be a teammate or a coding agent working from the spec. The rules are the same for both, and
`docs/ai-disclosure.md` records which it was.

1. **Spec.** Copy `_template.md`. Say what the piece does, which Figma screens it follows, what data goes in
   and out, and the acceptance criteria. Anything not in the spec is out of scope. A decision made on the way
   goes into [`docs/decisions.md`](../decisions.md).
2. **Shared parts first.** Database tables, the migration and the request shapes in `packages/contracts` are
   written by one person before anyone builds on them. Two people changing tables at the same time produce
   migrations that clash.
3. **Tests from the spec.** Each acceptance criterion becomes a test. For business rules (planning, validation,
   load maths) the tests are written and committed before the code.
4. **Build.** One branch per task. A task names the files it may touch, so the API and the screens of one
   piece can be built at the same time without stepping on each other.
5. **Check.** Typecheck, the full test suite and the build run again on the joined branch. Then someone clicks
   through the screens at phone size, next to the Figma frames.
6. **Review.** The reviewer is never the one who wrote it: a teammate, or a second AI tool that did not build
   it. They check the code against each acceptance criterion, not against taste, and look for security and
   data mistakes. A finding that is real gets a failing test first, then the fix.
7. **Merge.** The pull request says what changed, how it was checked and how it works. CI must be green.
   Nabil merges. `main` is always deployable.

## Done means

- Every acceptance criterion has a test or a written click-through check, and they pass.
- CI is green: typecheck, fresh migrate and seed, schema matches migrations, tests, build.
- Someone who did not write it has reviewed it.
- Loader and driver screens work at phone size.
- No sample data in components and no silent fallbacks. If a request fails, the screen says so.
- The README walkthrough and the departures from the design are updated when the piece touches them.
- The person who opened the pull request can explain every line of it.

## Spec files

- **Small feature:** one file, `NNN-name.md`.
- **Big feature** (planner, offline driver, loading): a folder `NNN-name/` with `spec.md` (what and why),
  `plan.md` (data, contracts, approach) and `tasks.md` (one line per pull request).

Acceptance criteria are written as "When …, the system shall …", so each one maps to one test.

The Figma file is the spec for how screens look. These files are the spec for how the system behaves. New
ideas go to `docs/ideas.md` and only become a spec when the team picks them up.

| Spec | Feature | Status |
| --- | --- | --- |
| [000](000-map.md) | The map: every piece, in build order | Ready |
| [003](003-outlet-names.md) | Outlet names | Done |
| [004](004-admin-vehicles.md) | Admin: vehicles | Done |
| [005](005-admin-outlets.md) | Admin: outlets | Building |
| [006](006-admin-products.md) | Admin: products | Ready |
| [007](007-plan-checker/spec.md) | Plan checker: load calculator, trip timeline and rules | Done |
| [008](008-demo-day/spec.md) | The demo day: clock, live updates and the seeded day | Done |
| [009](009-shop-orders/spec.md) | Shop orders | Done |
| [010](010-plan-board/spec.md) | The plan board: the dispatcher plans by hand | Done |
| [011](011-planner/spec.md) | The planner: the suggested plan's engine | Done |
| [012](012-loading/spec.md) | Loading: the loader loads and flags, the dispatcher answers | Done |
| [013](013-driver/spec.md) | The driver: the trip, proof, a refused delivery, a closed shop and working with no signal | Done |
| [014](014-suggested-plan/spec.md) | The suggested plan on the board: build it, explain it, decide and send | Done |
| [015](015-shop-receipt/spec.md) | The shop's receipt: confirm what arrived, report what is short, and the receipt that waits on the phone | Done |
| [016](016-live-day/spec.md) | Watching the day: dashboard, Live day and the loader's changed plan | Done |
| [017](017-look-up-pages/spec.md) | The dispatcher's look-up pages: Orders, History and Fleet Today | Done |
| [018](018-sign-in/spec.md) | Sign-in as designed: staff ID and PIN, the district artwork, English only | Done |
| [019](019-district-map/spec.md) | The dashboard's district map: districts, trucks on the road and shops delivered | Done |
| [020](020-depots/spec.md) | Every shop and both depots: accounts, Kandy's day and the depot switch | Done |
| [021](021-both-depots/spec.md) | Both depots together: the switch's Both, planning still one depot | Done |
| [022](022-trip-times-and-drivers/spec.md) | The trip's depot times, each stop's times on hover, and every trip's driver | Done |
| [023](023-plan-drag/spec.md) | Planning by drag and drop | Done |
| [024](024-checker-words/spec.md) | The plan checker in plain words | Done |
| [025](025-notifications/spec.md) | Notifications for every role | In progress |
| [026](026-crews/spec.md) | Crews: a truck and its driver picked as one | In progress |
| [027](027-plan-history/spec.md) | Undo, redo and starting over on the plan board | In progress |
