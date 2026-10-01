# 011 · Plan

## Data changes
None. No migration or shared request shape. The caller supplies 010's eligible orders and 008's availability
and fuel history. The engine returns proposed splits without changing the shop's records.

## Contracts
The lead adds these engine-only types to `planning/types.ts` and exports the entry point from `planning/index.ts`.

| Type | Fields |
| --- | --- |
| `PlannerOrder` | `EngineOrder` plus `deliveryDate: string` (YYYY-MM-DD), `timesDeferred: number` (integer >= 0), `splitFrom: string \| null`. History includes the parent's deferrals for an existing child, as 010 does. |
| `PlannerInput` | `Omit<PlanInput, 'orders' \| 'plan'>` plus `date: string` and `orders: PlannerOrder[]`. No existing draft, persistence reference or clock. |
| `PlannerSplit` | `orderId: string`, `keep: OrderLineQty[]`, `keptOrderId: string`, `remainderOrderId: string`. `keep` lists every original product once, including zero quantities. |
| `PlannerChoice` | `orderId: string`, `rank: number` (1-based), `resultOrderIds: string[]`, `reason: string`. One per input order; explain its priority and the actual deciding candidate preference, or the best-ranked refused candidate's checker sentence (a compact factual form if needed to fit 200 characters). A split choice explains where both parts go or why the remainder waits. |
| `PlannerDecision` | A union: `early_leave` has `vehicleId`, `tripNo`, `leaveAt`; `waited_again` and `late_order` have effective `orderId`. Every member has `kind` and a plain `reason`; an early-leave reason names the order whose insertion forced it. |
| `PlannerResult` | Success: `{ status: 'suggested' \| 'needs_decision', input: PlanInput, check: PlanCheck, splits: PlannerSplit[], choices: PlannerChoice[], decisions: PlannerDecision[] }`. Failure: `{ status: 'unavailable', check: PlanCheck }`. |
| `BuildSuggestedPlan` | `(input: PlannerInput) => PlannerResult`, implemented by `buildSuggestedPlan`. |

Success always has `check.ok: true`; status is `needs_decision` exactly when decisions are nonempty. Both are
previews. A future caller must show and obtain the listed choices before applying one, and ordinary Send still
checks the current day, snapshot and leaving times. A checker warning is not proof of dispatcher consent.

## How it works
All production files are in `apps/api/src/planning/planner/`. Reuse sibling modules directly, without importing
the board or seed. `Problem.leaveAt` from 010 AC-17 has landed with the plan board's API: the time rule in
`planning/rules/time.ts` now gives each departure fix as a number. Use it, and do not write a second
earlier-departure search here.

| File | What it holds |
| --- | --- |
| `priority.ts` | Input validation, canonical copies and the numbered priority key. |
| `candidates.ts` | Candidate slots, ordering, both-trip checks and structured leaving fixes. |
| `split.ts` | Whole-line then whole-unit packing, conservation and temporary references. |
| `reasons.ts` | Deferral stages, choices and decisions. |
| `build.ts` | The priority loop, effective orders and the final complete `checkPlan`. |

Process one original at a time. A candidate merges that order into its outlet's stop or adds a stop, sorts stops
as AC-7, and recalculates departures from defaults before AC-9. Whole candidates are exhausted before partial
ones. Do not reshuffle accepted orders between vehicles or districts. A failed trial changes nothing.

Rank passing candidates by: no departure change before earlier departure; no needless reefer; no needless van;
existing trip before new trip; first trip before second trip; greater volume; greater weight; greater km per
litre; vehicle ID; trip number. The first-trip preference comes after existing-trip reuse, exactly as AC-6 says.
Retain the decisive comparison and rejected checker evidence for explanations instead of a generic claim that
the first feasible or largest truck won. Try all whole candidates before choosing a split by the same tuple.

Check a trial on its vehicle's complete day, using only the effective orders on those trips and that vehicle.
That makes `checkPlan` meaningful while other orders are still unplanned; final checking uses every effective
order and every supplied vehicle. Classify rejected candidates by AC-17's stages, irrespective of the checker's
problem display order. Each stage filters only survivors of every preceding stage, across whole and allowed
partial attempts. A smaller part may clear capacity but cannot repair timing or fuel. Reject mixed brands when
the switch is off before timing.

For an explicit timing fix, recheck trip 1 before trip 2. A fix that breaks another constraint is refused. Do not
apply long-wait fixes, which could delay the second trip. Test a vehicle's two trips even when only its first
changes. Keep loads indexed and reuse unchanged calculations to meet AC-22, but keep checker semantics intact.
Keep the order that forced each earlier departure with the accepted trial, so its final decision names the
cause. A candidate keeping usual departures wins over one needing an earlier time. A failed trial must not
replace that accepted cause or add a decision.

Split references are `split:<original ID>:keep` and `split:<original ID>:rest`; reject input IDs beginning
`split:` so they cannot collide. New parts inherit their parent's priority and history. Store only positive
lines in effective orders; zero lines belong only in `keep`. After accepting the kept part, try the remainder
whole against the updated plan immediately, before moving to the next original. It cannot split again; it is
deferred only when those whole attempts fail. Fully carried waiting splits do not add `waited_again`. Output
orders use priority order, with each parent's children adjacent, whether both children go or the remainder waits.

Classify a deferred remainder with the same stage evidence as any whole order. Shop-facing deferrals are one
trimmed sentence of at most 200 characters, with a shop name or district, weekday and relevant time. Use cartons,
boxes or items for Fresh, Style or Tech, and no outlet IDs, ISO dates or search jargon. A remainder's sentence
uses a semicolon to connect sent and waiting quantities without becoming two sentences. State a split-write or
second-split limit only when a trip could otherwise carry part, never when no slot exists. For window failures,
keep enough checker evidence to distinguish this shop being late from an insertion making another shop late.
Dispatcher choices stay within 200 characters and include rank, priority facts and the actual winning preference;
a rejected choice preserves the best-ranked candidate's checker sentence or a compact factual form when needed
to fit that limit, retaining the actual relevant times and shop name or district rather than identifiers or ISO dates.

### Hand-off to the board, for the later integration
1. Read the board and engine snapshot together. Keep its `PlanRef` outside the engine. Review the complete
   replacement, splits and decisions before any write; a changed revision or day requires a fresh suggestion.
2. Without splits, map `input.plan` directly to `DraftPlan`: take `mixBrands` from settings, missing `leaveAt`
   becomes `null`, and `driverId` is `null`. With splits, first save a staging draft: replace each kept temporary
   ID with its original and omit remainder references from both stops and deferrals. Drop stops and trips made
   empty by that omission, preserving the final suggestion separately. Blocks in this intermediate draft are
   allowed by D-29; the staging draft includes each original once even when both children will be delivered.
3. For each split in priority order, call the existing split write with the latest `PlanRef`, original `orderId`
   and `keep`. No original is deferred in that draft. Identify the kept child on the original's stop and the
   other child by `splitFrom`; this also resolves equal halves. Use the returned board's revision for the next
   write. The original becomes `split`, and the two real children inherit 010's stored metadata (D-30).
4. Replace temporary IDs everywhere in the preserved final suggestion with those child UUIDs, including a
   carried remainder's own stop, then save the final whole `DraftPlan` and check it
   through the ordinary board path. Temporary IDs are never sent to `DraftPlan`, whose order IDs must be UUIDs.
5. If any write fails or its reply is lost, stop and refetch. Some splits may already be stored; do not blindly
   replay them or claim the sequence was atomic. The saved board is recoverable through ordinary edit/join.

The lead may instead give the board one write that runs these steps in a single transaction on the server,
which makes the whole apply atomic; the engine's output is the same either way. Only each existing write is atomic. This protocol specifies reuse, not new endpoints or an implemented apply
button. It creates no automatic send. Spec 010's Find a slot remains an append-or-merge search on existing trips;
the planner's sorted stops and new trips are a separate search, sharing the checker rather than that route.

## Risks and test plan
The greedy order may miss a better rearrangement; AC-23's pass recovers the ones where a run can be freed by sharing
stops or moving a run whole, and `planner/quality.test.ts` measures served goods, deferrals and time together on the
seeded days. Explanations state the actual cause in the shop's words. The seed is short
of usable fridge runs, not aggregate m³: its comment is not evidence for a particular planner deferral count.
Reconstruct its orders, workshop flags and fuel formulas in test-only `planner/demo-fixture.test.ts` from the
shared rows and the written constants in `db/demo-day.ts`; never import that database module. Pin source facts
separately from planner outcomes, so fixture drift cannot silently become a new allocation expectation.

| Criteria | Unit tests |
| --- | --- |
| AC-2, AC-19 | `planner/priority.test.ts` |
| AC-4 to AC-12 | `planner/candidates.test.ts` |
| AC-13 to AC-16 | `planner/split.test.ts` |
| AC-3, AC-17 | `planner/reasons.test.ts` |
| AC-1, AC-18, AC-20 to AC-22 | `planner/build.test.ts`, `planner/demo-fixture.test.ts` |
| AC-23 | `planner/repair.test.ts`, `planner/quality.test.ts` |

Every criterion is written and seen to fail before implementation. Include empty input, every rejection stage,
two equal split halves, 10/11-line and 999/1,000-unit split boundaries, multi-product conservation, exact capacity,
same-outlet consolidation, and trip 1 delaying trip 2. If candidate A clears windows but fails fuel and B clears
fuel but fails windows, expect `fuel`. Record benchmark machine, runtime and medians outside fixture loading.
Include a waiting 180-carton OUT001 split across VEH035 and VEH036 before a new OUT002 order, a spare identical
Badulla truck avoiding an early departure, the exact AC-6 comparison order, both window-failure meanings, each
shop-facing sentence rule, Fresh's 07:59 sort cap, the mall example through the public builder and `keep` parsed
with `SplitOrderRequest`. Re-pin the seeded outcome after the new candidate order and preserve quantity checks.
