# 005 · Admin: outlets

**Status:** Ready (start after 004 is merged)  ·  **Owner:**  ·  **Design:** admin list pattern (Dispatcher · Fleet table style)

## Why
The super admin manages master data. Rows are archived rather than deleted, because old plans still point at
them.

## What it does
The admin's Outlets tab lists every outlet with search, and an Archive button that asks first. Same page and route pattern as 004.

## Data in and out
- `GET /api/v1/admin/outlets`: all rows, archived last. Admin only.
- `POST /api/v1/admin/outlets/:id/archive`: sets `archivedAt`, writes an `audit_log` row with before and after,
  returns the row. Admin only.
- Columns shown: id, name, brand, district, depot, dock type, parking rule, delivery window.

## Acceptance criteria
- [ ] Signed in as `admin`, the Outlets tab lists every row and search filters it.
- [ ] Archive asks for confirmation, then moves the row to the bottom marked archived.
- [ ] Each archive writes one `audit_log` row with the admin, before and after.
- [ ] Any other role gets 403 from both endpoints (tested).

## Out of scope
Creating and editing rows (a later spec).
