# Submission hardening implementation notes

This accompanies [the spec](spec.md). It describes the implemented receiving and scenario boundaries;
acceptance criteria and regression requirements remain in the spec.

## Receiving readiness

`packages/contracts/src/receiving.ts` defines the request and response shapes. The `outlet_receiving` table
and migration 0013 store one declaration per outlet and calendar date. Demo reset clears the declarations.

- `GET /api/v1/store/receiving` reads the shop's declaration.
- `PUT /api/v1/store/receiving` saves it using the session's outlet and actor.
- `GET /api/v1/operations/receiving?depot=...` reads declarations for the authorized depot.

The date is the application-clock calendar day, not tomorrow's planning day after cutoff. Writes check date,
demo generation and revision under the outlet lock. The declaration and audit entry commit together.
Readiness writes require a connection and never enter the offline queue.

Driver reads attach the declaration for the trip's actual plan date. Cached views say Last known.
Notifications are restricted to the relevant dispatcher and assigned drivers and filtered by demo generation.
A declaration is advisory: it does not permit a forbidden plan or block delivery actions.

## Delivery-impact comparison

`packages/contracts/src/scenario.ts` defines the shapes. `POST /api/v1/plans/:date/scenario` is a read-only
calculation despite using POST for its structured input. It reads an authorized snapshot and runs the same
planner twice, with only the selected vehicle's availability changed.

Both outputs use actual checker results and planner reasons. Generated and persisted split parts are mapped
back to original outstanding orders. The baseline is a generated plan, not the dispatcher's saved manual draft.
Fuel totals describe the proposed trips, not all fuel already used during the week.

The comparison does not create split orders, change assignments, save a plan or write fuel usage. There is no
Apply action. The client discards results when the account, depot, day, reset generation, board or selected
vehicle changes. Calculation failures remain errors rather than being replaced with invented results.
