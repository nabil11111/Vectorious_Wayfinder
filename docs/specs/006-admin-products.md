# 006 · Admin: products

**Status:** Ready (start after 004 is merged)  ·  **Owner:**  ·  **Design:** admin list pattern (Dispatcher · Fleet table style)

## Why
The super admin manages master data. Rows are archived rather than deleted, because old plans still point at
them.

## What it does
The admin's Products tab lists every product with search, and an Archive button that asks first. Same page and route pattern as 004.

## Data in and out
- `GET /api/v1/admin/products`: all rows, archived last. Admin only.
- `POST /api/v1/admin/products/:id/archive`: sets `archivedAt`, writes an `audit_log` row with before and after,
  returns the row. Admin only.
- Columns shown: name, brand, unit, kg and m³ per unit, chilled or dry, tail lift.

## Acceptance criteria
- [ ] Signed in as `admin`, the Products tab lists every row and search filters it.
- [ ] Archive asks for confirmation, then moves the row to the bottom marked archived.
- [ ] Each archive writes one `audit_log` row with the admin, before and after.
- [ ] Any other role gets 403 from both endpoints (tested).

## Out of scope
Creating and editing rows (a later spec).
