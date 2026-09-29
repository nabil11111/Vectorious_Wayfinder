# Ideas

New ideas land here, one line each, and are never built in the middle of a task. We go through them after
the evening walkthrough. An idea gets built only when all four roles already work end to end, and only if
it answers a booklet requirement, a judging criterion, or a question a judge would reasonably ask.

## Parked

- **Decisions explain themselves.** Every deferred order says why, and what would fix it ("one more reefer
  van would serve these 4 orders").
- **Reset demo day.** One button restores the seeded day so a judge cannot break the walkthrough.
- **Run the day.** A simulator plays the seeded day forward: trucks move, one loses signal, one runs late,
  a shop refuses cartons, and every role reacts live.
- **Proof, not claims.** A load test showing rate limiting holds, and test results on every push, both
  linked from the README.
- **Sinhala and Tamil** on the driver and loader screens.
- **Order timeline.** One history per order from placed to confirmed, with who did what and when.
- **Datathon predictions in the planner.** Stop time and lateness risk from the Datathon model, with the
  booklet formula as the fallback when the model is unavailable. Demand forecast drives the capacity screen.
- **Route solver.** A proper routing library in place of the simple truck fill, once the core works.
- **Ask the late driver.** When a truck falls behind, the driver screen asks how much longer to the next stop:
  5 min, 10 min or more. One tap updates the ETA the shop and dispatcher see; unanswered, it dismisses itself.
  A subtle popup that never blocks the screen or asks for attention, and goes away by itself.
