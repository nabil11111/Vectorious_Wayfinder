# 020 · Tasks

- [x] T0 · Shared parts, pushed on their own before T2 starts: migration `0010_depot_switch` and `sessions.depot_id`,
  `SwitchDepotRequest`, the middleware and the `PUT /api/v1/me/depot` route, and every new account in `DEMO_USERS`
  with `docs/accounts.md`, so everything compiles and every test passes. · Claude server builder (the lead hands it the
  schema and contracts for this spec)
- [x] T1 · Server: Kandy's day in the seed and the reset, the once-only step for older installs, and AC-1 to AC-5 and
  AC-7 in full, plus the README's accounts and Kandy (AC-8). Depends on T0. · the same builder
- [x] T2 · Screens: `useSwitchDepot`, the top bar's switch and the map card's, the cache and stream on a switch, the
  lines, and AC-6. Depends on T0. · Claude screens builder
- [x] T3 · Join, review by Codex, click-through in Chrome, pull request. · lead
