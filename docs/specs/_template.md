# NNN · Feature name

**Status:** Draft / Ready / In progress / Done  ·  **Owner:**  ·  **Design:** Figma frame name(s)

<!-- Small feature: this one file, skip the sections marked "big features".
     Big feature: make a folder docs/specs/NNN-name/ with spec.md (this file), plan.md and tasks.md,
     using the two templates at the bottom. -->

## Why
Who needs this and what problem it solves. Quote the booklet line if there is one.

## What it does
The behaviour in plain words, as the user sees it.

## Screen states (big features)
Every state, each with its Figma frame: normal, empty, loading, error, offline, conflict, done.

## Rules, with worked examples (big features)
Each rule once in plain words, then at least one example with real numbers from the seed data.
Example: "Koggala opens 07:30. The truck arrives 07:25, so it waits 5 minutes and unloading starts at 07:30."

## Permissions (big features)
Which role can see and do what.

## Failure paths (big features)
What happens when the signal drops, two people change the same thing, the server refuses, or data is missing.

## Data in and out
Endpoints, request and response shapes (Zod schemas in `packages/contracts`), tables read or written.

## Acceptance criteria
Written so each one becomes a test: **When** something happens, **the system shall** do something.
- [ ] When …, the system shall …

## Out of scope
What this spec deliberately does not do.

---

<!-- plan.md (big features)

# NNN · Plan
## Data changes      tables and columns added or changed, and the migration that adds them
## Contracts         new or changed schemas in packages/contracts, with error codes
## How it works      the approach, in a few paragraphs; where the code lives (modules, files)
## Risks             what could go wrong and how we will notice
## Test plan         which acceptance criteria are unit, integration or browser tests
-->

<!-- tasks.md (big features)

# NNN · Tasks
Each task is one pull request, small enough to review in 15 minutes, and names the criteria it closes.
- [ ] T1 · … (closes: criteria 1, 2) · owner
- [ ] T2 · … depends on T1
-->
