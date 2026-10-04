# 030 · Dispatcher planning, in plain words

Status: In progress on `nabil/dispatch-polish`. The checker stays the authority. Screens do not invent a second set of rules.

## What changed

- A crew that fails weight, volume, refrigeration, van access, fuel quota or an unfixable window cannot be chosen for those orders. A missing driver or a warning is shown as needing attention, and can still be chosen.
- "Plan these orders" previews a checked arrangement and applies it only on "Use this arrangement". "Create empty trip" adds no orders. Dropping the same orders opens the same preview.
- When no single vehicle can take the selection, the preview can use more than one vehicle and says what is still waiting. Orders already on other trips stay there.
- Find a slot tries each stop position for any waiting order, not only carried-over orders at the end of a trip.
- View plan shows original-order coverage, estimated fuel and vehicle-hours. "Compare with suggested plan" reads a suggestion for the same demand and does not change the draft until "Use suggested plan".
- "Planned trips" and "Finish editing" only leave the editor. A mixed trip is labelled from every stop. A plan is Suggested, Suggested then edited, or Manual.

## Not claimed

"Suggest a quantity that fits" on a split is the order's own load shared by units, shown next to the trip's checked load, not a second capacity check. Exception rows open the trip and name a missing driver; they do not each launch split, slot and crew actions.
