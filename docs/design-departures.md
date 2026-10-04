# Major departures from the design

We kept the four-role delivery flow. These are the main changes from the submitted Designathon design.

- **Planning became more interactive.** Trucks and drivers are picked together as crews. We added checked
  previews before creating trips, drag and drop, and Undo/Redo so dispatchers can try changes before sending.
  The planner explains its choices, but we did not build the design's reason chips for every manual edit.
- **Added delivery-impact checks and shop readiness.** Dispatchers can preview what happens when a vehicle
  is unavailable. Shops can tell the driver they are ready to receive. These help people coordinate without
  changing the saved plan or blocking a delivery.
- **Added a combined depot view.** Dispatchers can watch Peliyagoda and Kandy together. Planning still happens
  one depot at a time.
- **Used recorded events instead of replay and live estimates.** History shows planned and actual times,
  and the map is schematic. Trips have individual departure times rather than fixed waves. The supplied data
  does not support GPS tracking or live traffic estimates.
- **Kept order and loading changes limited.** Placed orders cannot be edited; shops can place another order
  before cutoff. A plan cannot be withdrawn once loading starts, to protect goods already counted.
- **Added working notifications and demo controls.** The bell opens updates for every role, with sounds and
  optional background alerts. The shared clock, reset and sample orders let judges run a full day in minutes.
- **Left out some designed features.** The build is English only, with no six-week forecast or vehicle hiring.
  Delivery proof uses photos and shop confirmation rather than signatures. Call buttons and automatic credits
  were also left out; the data has no phone numbers and the app has no credit-accounting flow.

[Back to the README](../README.md#departures-from-the-design).
