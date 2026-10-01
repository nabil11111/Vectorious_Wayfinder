# 023 · Planning by drag and drop

**Status:** Done  ·  **Owner:** Claude builder  ·  **Design:** Dispatcher · Edit plan (`66:48982`), Edit plan · empty
(`78:67860`), and the "stops swapped" state (`215:104652`)

## Why
Nabil, 1 Oct: "Make the planning thing interactive. Let them drag and drop and allow dragging the order of the trips
up and down ... When in empty space, rather than clicking on 'Start a blank trip,' it should be either 'Build
suggested plan' or else drag a trip or a truck to start planning". Today every board change goes through a button or
a menu (Start a trip, Add a stop, Move up, Move down, Take off). Drag and drop makes the board feel like a planning
board. The buttons and menus stay, for the keyboard and for anyone who prefers them.

## What it does
- **An order onto a trip.** Drag an unplanned order, or a whole "brand · district" group, from Unplanned orders onto
  the open trip's stops: it becomes a stop where it is dropped, between two stops or at the end. Dropped on a trip's
  card in Done, it joins that trip at the end.
- **An order onto a truck.** Dropped on a truck in Unassigned trucks, it starts that truck's trip with it, and the
  trip opens in the middle.
- **A truck into the middle.** Drag a truck from Unassigned trucks into the middle to start its trip, which opens
  empty with "Add a stop".
- **Stops up and down.** Drag a stop up or down in "Stops in order" to change the order. The other stops make room as
  it moves, and the timeline and checks follow once it is dropped.
- **A stop off its trip.** Drag a stop onto Unplanned orders to take it off the trip. Drag it onto another trip's card
  in Done to move it to that trip.
- **The empty middle.** "No trip open" keeps "Build the suggested plan" in orange. In place of "Start a blank trip" it
  shows a dashed drop area: "or drag an order or a truck here to start a trip". Dropping an order there starts its
  trip the way its group's "Start a trip" does. Dropping a truck there starts that truck's trip.
- **While dragging.** The dragged order, stop or truck follows the pointer as a small card naming it. Every place it
  can land is outlined, and the place under it is filled with the brand's light tint. Releasing anywhere else, or
  pressing Escape, puts it back with nothing changed.

## Rules, with worked examples
1. **One drop, one change.** Every drop is one change of the draft. It is saved, checked by the plan checker and
   undone like the same change made with a button. Its Undo line names it, for example "Fresh Nugegoda added to
   VEH035" or "Stops 2 and 4 moved".
2. **The checker decides.** A drop is never refused because of where it lands. Fresh Galle Fort's chilled cartons
   dropped on a dry truck land, and the checker marks the trip as it would for the same change made with a menu, with
   its fix. The board keeps no rules of its own (AGENTS.md: one source of truth).
3. **The keyboard can do it too.** A focused order, stop or truck picks up with Space or Enter, moves with the arrow
   keys, drops with Space or Enter and cancels with Escape. Each step is announced. The menus and buttons stay as they
   are.
4. **Nothing moves on a sent plan.** On a sent plan, or while the board holds still during a split, join, send or
   build, nothing can be dragged, exactly as nothing can be changed.

## Acceptance criteria
- [x] AC-1 When an unplanned order or group is dropped on the open trip's stops, a Done trip card or an unassigned
  truck, the system shall make the same change the matching button makes, as one change of the draft.
- [ ] ~~AC-2 When a truck is dropped in the middle, the system shall start that truck's trip and open it.~~ Dropped
  before the build: spec 026 removes the trucks panel (D-100), so no truck is dragged; a trip starts from an order
  and the crew picker.
- [x] AC-3 When a stop is dragged up or down in "Stops in order", the system shall reorder the stops as one change. A
  stop dropped on Unplanned orders shall come off its trip, and one dropped on another trip's card shall move there.
- [x] AC-4 The empty middle shall show "Build the suggested plan" and the drop area "or drag an order or a truck here
  to start a trip", in place of "Start a blank trip".
- [x] AC-5 Every drop shall be checked by the plan checker like the same change made with a button. A dropped
  change shall be undone with one Undo.
- [x] AC-6 Dragging shall work with the pointer and the keyboard, with each step announced. Nothing shall be draggable
  on a sent plan or while the board holds still.
- [x] AC-7 The README's "Departures from the design" shall say the empty middle has the drop area in place of "Start
  a blank trip", and the walkthrough shall still work with its buttons.

## Out of scope
Dragging between depots, dragging deferred orders back out of Deferred (its Undo stays), and touch dragging on phones:
the plan board is a desktop page.
