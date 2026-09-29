# Specs

We build Wayfinder spec first. Every feature starts here, before any code. The flow follows the spec, plan,
tasks shape used by GitHub Spec Kit and Amazon Kiro:

- **Small feature:** one file, `NNN-name.md`.
- **Big feature** (planner, offline driver, loading): a folder `NNN-name/` with `spec.md` (what and why),
  `plan.md` (data, contracts, approach) and `tasks.md` (one line per pull request).

Acceptance criteria are written as "When …, the system shall …", so each one maps to one test.

1. **Spec.** Copy `_template.md` to `NNN-short-name.md`. Say what the feature does, which Figma screen it
   follows, what data goes in and out, and the acceptance criteria. Anything not in the spec is out of scope.
2. **Tests from the spec.** Each acceptance criterion becomes a test. For business rules (planning, validation,
   load maths) the tests are written and committed before the code.
3. **Build and review.** One branch per spec. The pull request links the spec, CI must be green, and the
   reviewer checks the result against the acceptance criteria, not against taste.

The Figma file is the spec for how screens look. These files are the spec for how the system behaves. New
ideas go to `docs/ideas.md` and only become a spec when the team picks them up.

| Spec | Feature | Status |
| --- | --- | --- |
| [001](001-load-calculator.md) | Load calculator | Ready |
| [002](002-plan-rules.md) | Plan rules as tests | Ready |
| [003](003-outlet-names.md) | Outlet names | Ready |
| [004](004-admin-vehicles.md) | Admin: vehicles | Ready |
| [005](005-admin-outlets.md) | Admin: outlets | Ready (after 004) |
| [006](006-admin-products.md) | Admin: products | Ready (after 004) |
