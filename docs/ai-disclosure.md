# AI tool disclosure

The booklet asks which work was AI-assisted, which was not, and how we used the tools. Add an entry when
the work happens, not at the end.

## Tools used

| Tool | Used for |
| --- | --- |
| Claude Code | Scaffolding, schema drafting, docs, tests, reviews |
| Codex | Technical proposal draft, reviews |

## Log

| Date | Who | Area | What the AI did | What we did ourselves |
| --- | --- | --- | --- | --- |
| 28 Sep | Nabil | Technical proposal | Codex drafted it; Claude reviewed it against the booklet | Chose the stack (Drizzle, Express, Railway, shadcn), decided scope and what stays out |
| 29 Sep | Nabil | Foundation | Claude wrote the workspace, schema, seed, sign-in, Docker, CI and docs from our decisions | Set the data model rules, security requirements and development process; reviewed the result |
| 30 Sep | Nabil | Security fixes | Codex reviewed the foundation; Claude wrote the fixes and the tests for them | Chose what to fix first, decided how the demo accounts, admin password and proxy setting should work; reviewed the result |
| 30 Sep | Nabil | Build process and map | Claude proposed the build loop and wrote it up with the decision log and a draft map of the build | Set what the process had to do (finish in four days, split work between agents, review before merging), approved the loop, and decides the open points in the map |
| 30 Sep | Nabil | Spec 007, planning engine | Claude wrote the spec and worked every example out from the shared data files | Made the planning decisions it rests on: one real timeline per vehicle, which rules are hard and which are defaults, splitting orders, leaving times and the fuel week |
