# AI tool disclosure

Claude Code and Cursor wrote most of the code, including almost all of the frontend. We wrote the planning
engine and some of the other code ourselves. Almost all the decisions were ours, including the business
rules, architecture and design changes.

## How we used the tools

- Claude Code and Cursor helped build the app. Claude also helped with the database schema, seed data,
  sign-in, Docker setup, CI, specifications and documentation.
- Codex did most of the code reviews. It reviewed both AI-written code and code we wrote ourselves. It
  also helped draft the technical proposal and this disclosure.
- We had already completed the designs before the Hackathon build. We used the Figma MCP to read those
  designs and pull images and other assets for the UI.
- AI wrote all the automated tests. We also used Grokbot and Codex to test the app through their built-in
  browsers.

## How we built from specs

We worked spec first. The Figma designs covered how the screens should look. The specs covered how the app
should behave. AI helped write the specs from our decisions.

1. We mapped the build into smaller features. Each spec named the screens, the inputs and outputs, and
   the acceptance criteria: what had to work before we could call it done. Larger features also had a
   plan and a task list. Decisions made along the way went into a decision log.
2. We defined the shared database tables and API request shapes before splitting the work. Each task had
   its own branch and a clear list of files it could change.
3. AI wrote tests from the acceptance criteria. For business rules, our process required the tests to be
   written before the implementation.
4. The builder worked from the spec. Codex did most of the reviews, checking the code against those same
   criteria and looking for security and data mistakes. The reviewer was separate from the builder.
5. Before merging, the process called for type checks, tests, a build and manual screen checks, including
   phone layouts against Figma. Review findings went back for fixes and another check.

The process is in [docs/specs/README.md](specs/README.md), alongside the feature specs.

## What we did ourselves

We wrote the planning engine, decided how the business rules should work, chose the architecture and made
the design changes. AI helped draft proposals and specifications, but we made the decisions about what to
build and how it should behave.

We did our own manual QA across the app, alongside the browser QA done by Grokbot and Codex. The automated
tests were AI-written, the team's own testing was manual.
