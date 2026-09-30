# 004 · Admin: vehicles

**Status:** Done  ·  **Owner:**  ·  **Design:** admin list pattern (Dispatcher · Fleet table style)

## Why
The super admin manages master data. Rows are archived rather than deleted, because old plans still point at
them.

## What it does
The admin's Vehicles tab lists every vehicle with search, and an Archive button that asks first.

## Data in and out
- `GET /api/v1/admin/vehicles`: all rows, archived last. Admin only.
- `POST /api/v1/admin/vehicles/:id/archive`: sets `archivedAt`, writes an `audit_log` row with before and after,
  returns the row. Admin only.
- Columns shown: id, type, fridge or dry, weight and volume caps, weekly fuel quota, home depot.

## Acceptance criteria
- [x] Signed in as `admin`, the Vehicles tab lists every row and search filters it.
- [x] Archive asks for confirmation, then moves the row to the bottom marked archived.
- [x] Each archive writes one `audit_log` row with the admin, before and after.
- [x] Any other role gets 403 from both endpoints (tested).

## Out of scope
Creating and editing rows (a later spec).
