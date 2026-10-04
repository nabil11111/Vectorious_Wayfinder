# 014 · Plan

> Build record: this describes the original implementation sequence. See the [spec guide](../README.md)
> for current status and the later specs that supersede parts of this work.

## Data changes
One migration, `suggested-plan`, written by the lead in T0.

| Table | Change | Why |
| --- | --- | --- |
| `plans` | Column `suggestion jsonb`, empty until the plan's first build. It holds the `Suggestion` shape below. | The reasons and the decisions survive a reload (D-53), and the send reads the decisions (D-54). A column on the plan, as `sent_check` is, because a suggestion belongs to one plan and is read and written whole. |

The seed does not change, and a reset's truncate of `plans` removes the suggestion with its plan (spec 008). T0 also
copies the design's Second trip picture from the icon sheet as `apps/web/src/assets/icons/icon-second-trip.png`: the
design's Suggestions card and Planner row draw it, and the Decisions card takes their place.

## Contracts
The lead writes these into `packages/contracts/src/plans.ts`. Days are `YYYY-MM-DD`, moments ISO strings, and a time of
day is minutes after midnight on the plan's day, as in spec 010.

| Shape | What it holds |
| --- | --- |
| `SuggestPlanRequest` | A `PlanRef`, as the send's. A first build names the demo day. |
| `AcceptDecisionsRequest` | A `PlanRef` and `keys`: 1 to 700 decision keys, each once. |
| `DECISION_KINDS`, `DecisionKind` | `['early_leave', 'waited_again', 'late_order']`, spec 011's `PlannerDecision` kinds. |
| `SuggestionChoice` | `orderId` (the order as the planner got it), `rank` (from 1), `resultOrderIds` (that order, or its two parts, the first part first) and `reason` (the planner's words, 1 to 1,000 characters). |
| `SuggestionDecision` | `key`, `kind`, `reason` (the planner's), `orderId` for `waited_again` and `late_order` or null, `vehicleId`, `tripNo` and `leaveAt` for `early_leave` or null, and `acceptedAt` or null. A key is `early_leave:VEH002:1`, `waited_again:<order id>` or `late_order:<order id>`. |
| `Suggestion` | What `plans.suggestion` holds: `builtAt`, `plan` (the `DraftPlan` the build saved, as the board reads it back, which decisions are judged against), `choices` in rank order and `decisions` in the planner's order. |
| `BoardSuggestion` | What the board answers: `builtAt`, `choices`, and `decisions` each with `open` (spec, rule 6). The saved `plan` stays on the server. |
| `PlanBoard` | Gains `suggestion`: the plan's `BoardSuggestion`, or null when it was never built. |

New error codes in `PLAN_ERROR_CODES`, each with a sentence the screens show as it is:

| Code | Status | Details | For example |
| --- | --- | --- | --- |
| `planner_unavailable` | 409 | `blocks`, the planner's blocks, empty when the day has too many orders | "The planner could not build a plan that passes every check, so the draft is as it was." or "The planner plans at most 300 orders, and Thu 25 Jun has 301." |
| `decisions_open` | 409 | `keys` | "6 of the planner's decisions are still open. Accept them before sending." |

Codes of spec 010 used again: `stale`, `plan_sent`, `day_moved` with `date`, `orders_open` with `date` and `cutoffAt`,
`no_plan_day`, `no_depot`, and `invalid_input` ("That is not an open decision of this plan.").

## How it works
| File | What it holds |
| --- | --- |
| `apps/api/src/plans/suggestion.ts` | Plain functions with no database. `suggestionOf(result, parts, drivers, builtAt)` turns the planner's result into the draft to save and the `Suggestion` to keep, with every `split:` reference replaced by a part's id and a key on each decision. `decisionOpen(decision, suggested, draft)` is rule 6, and `boardSuggestion(stored, draft)` gives the board's shape. |
| `apps/api/src/plans/suggest.ts` | `suggestPlan` and `acceptDecisions`, and `plannerInputOf(board, input)`: the checker's input that `readBoard` returns, with each board order's wanted day, times deferred and original, as spec 011's `PlannerInput`. |
| `apps/api/src/plans/split.ts` | Spec 010's split and join, with their order work moved into `makeParts(tx, caller, original, keep)` and `joinParts(tx, caller, original, parts)`, which the build calls too. `splitOrder` and `joinOrder` behave as before. |
| `apps/api/src/plans/board.ts` | `readBoard` parses `plans.suggestion` with `Suggestion` and answers `suggestion` through `boardSuggestion` on the cleaned draft. |
| `apps/api/src/plans/send.ts` | After `not_ready`, `decisions_open` while a decision on the board is open. |
| `apps/api/src/routes/plans.ts` | `POST /:date/suggest` and `POST /:date/decisions`, behind the router's role and depot checks. |
| `apps/web/src/features/plan/` | `board.ts` gains `suggestPlan` and `acceptDecisions`. `parts/` gains `BuildPanel.tsx` (the middle with no trip open, Building, the dialog and a refusal), `Why.tsx` (the chip and its popover) and `Decisions.tsx` (View plan's card). |

**The build**, `POST /plans/:date/suggest`, in one transaction:
1. `openPlan` with the request's `PlanRef`, as every plan write: `lockDepotDay` from `lib/day-lock.ts` (on
   `nabil/loading`: the demo day's row `for share`, then the depot's row `for no key update`), the clock instant read
   under those locks, the day checks (`no_plan_day`, `day_moved`, `orders_open`) and the plan reference (`stale`,
   `plan_sent`). A first build makes the plan row. So a build queues behind every planning write and loader start of
   the depot, and a reset waits for it.
2. Read the board (`boardOf`) for the draft's driver on each vehicle and its "Mix brands".
3. Empty the draft: `replaceDraft` with no trip and no deferral, "Mix brands" kept, so no stop or deferral of this plan
   names a part any more.
4. Join back each split order that rule 4 names: `joinParts` deletes its two parts and gives the original back `placed`,
   or `deferred` if a sent plan deferred it, with its revision up and the audit row `order.joined`.
5. `readBoard` again, and hand its board and checker's input to `plannerInputOf`. More than 300 orders is
   `planner_unavailable` before the planner runs, as spec 011 refuses them with `PlanInputError`.
6. `buildSuggestedPlan`. Its `unavailable` is `planner_unavailable` with the check's blocks. The transaction rolls
   back, so steps 1 to 4 leave nothing behind.
7. For each of the planner's splits in its order, `makeParts` with the original and `keep`: the original `split` with
   its revision up, the two parts `placed` with their lines, `partsAddUp`, and the audit row `order.split`.
   `split:<id>:keep` becomes the first part's id and `split:<id>:rest` the second's.
8. `suggestionOf` makes the draft from `result.input.plan` exactly: the planner's trips (vehicle, trip number,
   `leaveAt` or null, step 2's driver for that vehicle or null, and stops) and deferrals (code and reason), with step
   2's "Mix brands" and every id mapped. Each part is wherever the planner put it: a remainder it carried is on its
   stop like any order, and one it deferred is in the deferrals with its reason. `validateDraft` checks the draft, as a
   save would, against the board read after step 7, which holds the new parts. A failure there is a planner fault,
   answered 500 with nothing written.
9. `replaceDraft` with that draft, then `plans.suggestion`: `builtAt` is the clock instant, `plan` the draft as
   `boardOf` reads it back, and the choices and decisions have their ids mapped and none accepted.
10. The audit row `plan.suggested`: before, the revision and the replaced draft's trips and deferrals; after, the trips,
    orders on trips, deferrals, parts made, splits joined back and decisions. `finishPlan` raises the revision, sets
    `saved_at` and answers `boardOf`. After the commit, `plans` goes to the depot, and `orders` to the depot and each
    shop whose order was split or joined back.

The planner takes about 60 ms on the seeded day and 250 ms for 300 orders (spec 011's benchmark), inside the
transaction.

**The accept**, `POST /plans/:date/decisions`, in one transaction: `openPlan`, then the plan's `suggestion`. Each key
must name one of its decisions that is open on the saved draft, else 400 `invalid_input`. Each gets `acceptedAt`, the
clock instant. Then the audit row `plan.decided` with the keys, `finishPlan`, and `plans` announced after the commit.

**Reading.** `readBoard` gives `suggestion` for a draft and a sent plan alike. `decisionOpen` is true when the decision
is not accepted and, for `early_leave`, the draft has that vehicle's trip with that number leaving at `leaveAt`, or,
for `waited_again` and `late_order`, the draft defers `orderId` with the code and reason the suggestion's saved draft
gave it.

**The send.** Spec 010's steps with one more check after `not_ready`: an open decision on the board is 409
`decisions_open` with the open keys. Warnings stop nothing, as before.

**The screen.**
- `board.ts`: `suggestPlan(date, ref)` and `acceptDecisions(date, body)`. The build goes through the queue's `act`, as
  split does, so it waits for the save on its way and the board holds still until it answers. A refusal that reloads
  the board does so with spec 010's line.
- `PlanBoardPage.tsx` gives the middle with no trip open to `BuildPanel`. "Build the suggested plan" asks first when
  the draft has a trip or a deferral (the style guide's alert dialog), shows Building while the write is out (on the
  Planning tab below 1024 wide), shows a refusal in red with "Try again", and after a build adds the line "Suggested
  plan · 16:00 · N decisions to make".
- `parts/StopRow.tsx` (through `TripPanel.tsx`) and the deferred rows of `parts/OrderLists.tsx` show `Why`, whose
  popover has the choice whose `resultOrderIds` names the order, and for a deferred order its decisions.
  `parts/lookup.ts` indexes the choices by result order and the decisions by order.
- `ViewPlanPage.tsx` puts `Decisions` above `ChecksPanel` and "Suggested plan · 16:00" beside the title. An accept takes
  the path View plan's send takes in `run`: through the board's queue (`act`) when the queue is set up for that day,
  otherwise a direct request naming the plan on screen, which a reload leaves as the only way. The send is greyed with
  spec 010's "Send plan · N checks open" while a block remains, else with "Send plan · N decisions open" while a
  decision is open, and orange once `check.ok` and none is open.
- `ChecksPanel.tsx` keeps listing every warning. Its tag is "Ready" with no warning, "Ready, with warnings" with some,
  and neither while a decision is open.

**Words**, in `features/plan/words.ts`:
- "Build the suggested plan", "Building the plan", "102 orders · 35 trucks", "Suggested plan · 16:00", "N decisions to
  make" and "no decisions to make".
- The dialog's sentences from the spec's screen states, with the draft's counts: "Your 1 trip and 99 deferred orders
  are replaced", singular for one.
- A decision's title by kind: "VEH002 trip 1 leaves early, at 03:07", "Fresh Dickwella waits again" and "Fresh Pannala
  would be late, so it waits". Then "to decide", "✓ Accepted 16:08", "Accept", "Accept all 6", "Decisions · 6", "6
  open", "Decisions · all made", "Accepted", "Send plan · 6 decisions open" and "Ready, with warnings".

## Changes to other specs
- **Spec 010.** The items of "Left for the planner" built here leave that list, and its AC-42 then covers only the ones
  this spec leaves out. Its send gains `decisions_open` (rule 11), and View plan's Checks says "Ready, with warnings"
  when warnings remain. `plans/split.ts` keeps its behaviour behind the two helpers, and its tests stay as they are.
- **Spec 011.** This is its "later board integration", with the one-transaction choice of its plan's hand-off.
  `PlanBoard.suggestion`, outside its scope, lands here.
- **The README.** The judge walkthrough keeps its hand-built plan. The planner's short walkthrough goes after it, with
  the departures, at T3, and the line "The suggested plan is not built yet" goes.
- **The map.** The B4 row points at 011 and here.

## Risks
- PR #15 can still move the planner's seeded numbers until it is merged. AC-2 holds the board to spec 011's pin, and T3
  reads the walkthrough's numbers again.
- The shop reads the planner's deferral sentence once the plan is sent (spec 010, rule 7). Spec 011 writes it for the
  shop, and the dispatcher can reword any of them.
- A build deletes the parts of this draft's splits and makes new ones, so a shop's Orders list shows new parts after
  each build. Shops see parts before sending anyway (spec 010, design question 2).
- The board's answer grows by the suggestion's choices and decisions, about 30 KB on the seeded day on top of spec
  010's 100 KB. Fine for one dispatcher and one process (D-01).
- The planner runs inside the transaction that holds the depot's lock. At its benchmarked times, a loader's start or a
  shop's place waits a fraction of a second.
- `split.ts` changes shape for the two helpers. Spec 010's split and join tests must pass unchanged, and the reviewer
  checks that the helpers keep rule 8.

## Test plan
| Criteria | Kind | Where |
| --- | --- | --- |
| AC-11 | Unit, made-up drafts and spec 011's VEH044 example | `apps/api/src/plans/suggestion.test.ts` |
| AC-1 to AC-10, AC-12, AC-13 | Integration | `apps/api/tests/plan-suggest.test.ts` |
| AC-14 to AC-20 | Click-through in Nabil's Chrome at 1440 × 900 and 390 wide as `ruwan`, with View plan reloaded before accepting for AC-18, and a read of `features/plan` for AC-20 | The lead, on the joined branch |

Integration tests run in the builder's own seeded database (AGENTS.md) and assert the seeded day's numbers. The file
starts from the seeded day, puts it back at its end with spec 008's `clearDemoDay` and `seedDemoDay` in one
transaction, and lets the clock go. AC-4 raises OUT001's carried-over line to 180 cartons, AC-5 writes a deferral into
the seeded plan of Wed 24 Jun, and AC-13 adds a workshop day for VEH035, each in the database before its build. AC-8's
`unavailable` mocks the planner module for that test only. AC-2 imports spec 011's test fixture
`planner/testing/demo.ts` into the test, which keeps it outside the production imports (spec 011, AC-20). The file
signs in once per account.
