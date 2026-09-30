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
