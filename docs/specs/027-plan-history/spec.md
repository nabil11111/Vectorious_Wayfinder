# 027 · Undo, redo and starting over on the plan board

**Status:** Done  ·  **Owner:** Claude builder  ·  **Design:** Dispatcher · Edit plan (`66:48982`). The design
draws no undo, redo or start-over, so this spec adds them to its header and rows.

## Why
Nabil, 1 Oct 23:25: "in the plan board we need: a reset or undo button, or a remove button, for the trips; a fully reset
button, which goes back to everything unplanned, of course, with a confirmation. We should be able to reset but we
should have an undo button (or Ctrl+Z). We should also have an undo icon and a redo icon. We should be able to remove a
stop from the planning section".

## What it does
- **Undo and Redo.** Two icon buttons in the board's header. Each has a label and a tooltip that names the change it
  undoes or redoes: "Undo: Fresh Dehiwala added to Wasantha's reefer van". Ctrl+Z (Cmd+Z on a Mac) undoes, and
  Ctrl+Shift+Z, Cmd+Shift+Z or Ctrl+Y redoes; none of them fires while the focus is in a text box. With nothing to
  undo or redo, the button is off and greyed in the app's disabled look, and its tooltip says "Nothing to undo" or
  "Nothing to redo".
- **The history** holds this tab's changes of the draft, up to 50, each one step: a drop, a crew picked, a stop moved or
  taken off, a deferral, a leaving time, a driver, Mix brands, building the suggested plan, and starting over. It clears
  on a send, a depot switch and a reload, and when the draft is replaced by a change from elsewhere: another tab, a
  refetch that differs, or a split or join, which change the orders themselves. The green Undo line under a trip stays,
  and undoes the same step as the header's Undo.
- **Remove a trip.** Besides the open trip's "Remove trip", each card in Done has a ⋮ menu with "Remove trip". Its
  orders go back to Unplanned orders as one step.
- **Remove a stop.** Every row in "Stops in order" has a visible × that takes the stop off the trip, labelled "Take
  Fresh Dehiwala off this trip". Its orders go back to Unplanned orders as one step. The stop's ⋮ menu keeps "Take off"
  for each order.
- **Start over.** A header button opens a confirmation in the app, never the browser's: "Take every trip and deferral off
  Thursday's plan? Every order goes back to Unplanned. You can undo this." It empties the draft as one step, which Undo
  brings back. It shows only while the plan is a draft; the plan board is always one depot's.
- Every one of these is a change of the draft, saved and checked as the buttons' changes are.

## Rules, with worked examples
1. **One step each.** Ruwan drops Fresh Dehiwala on Wasantha's reefer van and then defers Fresh Pannala. Undo's tooltip
   reads "Undo: Fresh Pannala deferred"; Undo puts Pannala back, and the tooltip then reads "Undo: Fresh Dehiwala added
   to Wasantha's reefer van". Redo defers Pannala again.
2. **A new change ends the redo.** After an Undo, any new change clears what Redo would have done.
3. **Undo is a save.** Undo and Redo send the draft they put back, as any change does, and the checker judges it.
4. **Start over is undone whole.** On a draft with 27 trips and 6 deferrals, Start over leaves 102 unplanned orders,
   and Undo brings back all 27 trips and 6 deferrals in one step.
5. **The history is this tab's.** Ruwan's change in another tab, a split or a join replaces the draft, and Undo and Redo
   are then off until the next change.
6. **Undo opens what was open.** With Chaminda's trip open, Ruwan starts a second trip on Wasantha's reefer van, which
   opens, and adds Fresh Puttalam to it. Undo twice: Puttalam goes back to Unplanned, the second trip goes, and
   Chaminda's trip is open again, with the address naming it. Undoing "Remove trip" on the open trip, a truck swap or
   Start over opens the trip that was open before it, and Redo opens the one after it, or none. A trip the draft no
   longer has is never left open or in the address.

## Acceptance criteria
- [ ] AC-1 When a change of the draft is made, the system shall let Undo put back the draft before it and Redo make it
  again, one step each, up to 50 steps, with the header's buttons, Ctrl or Cmd+Z, Ctrl or Cmd+Shift+Z and Ctrl+Y, and
  never while the focus is in a text box. Each button shall name its change in its label and tooltip, and with nothing
  to undo or redo shall be off, look it, and say so in its tooltip.
- [ ] AC-2 The history shall clear on a send, a depot switch, a reload and a draft replaced from elsewhere, and the green
  Undo line shall undo the same step as the header's Undo.
- [ ] AC-3 Each card in Done shall offer "Remove trip", and each stop in "Stops in order" a × labelled "Take <shop> off
  this trip", each taking the orders back to Unplanned orders as one step.
- [ ] AC-4 Start over shall ask first in the app, then take every trip and deferral off the draft as one step that Undo
  brings back, and show only while the plan is a draft.
- [ ] AC-5 The README's walkthrough shall use Undo, and its departures shall say what the design does not draw.

## Out of scope
A history kept across reloads or shared between tabs, and undoing a send, a split or a join.
