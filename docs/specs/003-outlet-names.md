# 003 · Outlet names

**Status:** Done  ·  **Design:** every screen that names a shop (Fresh Nugegoda, Fresh Koggala, …)

## Why
`outlets.csv` has ids but no names, so the seed calls them "Fresh Colombo 1". The designs use real places.
Names that match the design make every screen and the demo read like a real business.

## What it does
`data/fixtures/outlet-names.csv` (`outlet_id,name`, 120 rows) gives each outlet a brand plus a real town or mall
inside its district. The seed uses it and falls back to the numbered name.

## Data in and out
Reads the fixture in `apps/api/src/db/seed.ts`; updates `outlets.name`.

## Acceptance criteria
- [x] All 120 outlets have a unique name inside their own district, brand first.
- [x] OUT001 is Fresh Nugegoda, and other names already in the Figma file are reused where the district fits.
- [x] After seeding, existing outlets get the new names too.
- [x] Running the seed twice changes nothing.
- [x] The README says these names are ours, not from the booklet.

## Out of scope
Coordinates or maps.
