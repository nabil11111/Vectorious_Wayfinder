# 021 · Tasks

> Build record: this describes the original implementation sequence. See the [spec guide](../README.md)
> for current status and the later specs that supersede parts of this work.

- [x] T0 · Shared parts, pushed on their own before T2 starts. They include migration `0011_both_depots`,
  `BOTH_DEPOTS`, `SwitchDepotRequest` taking Both, `DepotRead`, and the middleware giving a Both session
  `depotId: 'Both'`. They also include `PUT /api/v1/me/depot` taking Both, the D-95 check treating Both as a scope,
  and `readDepotOf`, so everything compiles and every test passes. · Claude server builder (the lead hands it the
  schema and contracts in plan.md)
- [x] T1 · Server: every dispatcher read on `readDepotOf`, the plan write guard, answers on the problem's own depot,
  and the live stream on Both, with AC-1 to AC-4 in full. Depends on T0. · the same builder
- [x] T2 · Screens: Both in both switches, the depot in every dispatcher read and its key, the dashboard's sums, tags
  and map, the two parts of Live day, Orders, History and Fleet, the depot picker on the plan pages, AC-5 to AC-7, and
  the README's departures (AC-8). Depends on T0. · Claude screens builder
- [x] T3 · Join, review by Codex, click-through in Chrome, pull request. · lead
