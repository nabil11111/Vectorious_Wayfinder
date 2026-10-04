# 025 · Tasks

> Build record: this describes the original implementation sequence. See the [spec guide](../README.md)
> for current status and the later specs that supersede parts of this work.

- [x] T1 · Server: `GET /api/v1/notifications` for every role, derived from existing records (AC-1), with the seeded
  day's updates pinned for the walkthrough people (AC-4). API tests first. · Claude server builder
- [x] T2 · Screens: the bell and its pop-up for every role, the toast and the system notification with its permission
  button, read state in the browser, and the README (AC-2, AC-3, AC-5). Web tests first. Starts from T1's contract
  shape in this spec. · Claude screens builder
- [ ] T3 · Join, review by Codex, click-through in Chrome as each role, pull request. · lead
