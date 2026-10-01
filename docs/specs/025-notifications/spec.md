# 025 · Notifications for every role

**Status:** Ready  ·  **Owner:** Claude builders (T1 server, T2 screens)  ·  **Design:** the bell in every role's
top bar, with its red count (Dispatcher frames, `53:11540`; Loader, Driver and Shop frames). No frame draws what the
bell opens, so the pop-up follows the style guide's card, its 3D icons and the app's popover.

## Why
Nabil, 1 Oct: "the notification pop-ups for each and every user. When I click on the bell icon, it should show a small
pop-up ... The live push notifications". Today the dispatcher's bell only counts open problems and opens Live day.
The loader's opens the plan's changes. The shop's and the driver's bells do nothing.

## What it does
- **The bell, for every role.** It shows a red count of the person's unread updates. Pressing it opens a small pop-up
  under it, a sheet from the bottom on a phone, with the person's updates for the day being worked, newest first, up
  to 30. Each row has:
  - the design's icon for its kind;
  - one plain line;
  - its time on the app clock;
  - unread rows marked.

  Pressing a row goes where the person acts on it, and the pop-up closes. "Mark all read" clears the count. The
  dispatcher's pop-up keeps "Open Live day" at its foot, and the loader's keeps "See what changed".
- **Live.** When a new update arrives, it also shows at once as a toast with the same line and a link. If the tab is in
  the background and the person allowed it, it also shows as a system notification. The pop-up has "Turn on alerts
  when Wayfinder is in the background", which asks the browser's permission. The app never asks on its own.
- **What each role is told** (all from records the app already keeps; times are the app clock's):
  - **Store manager.**
    - Their order placed.
    - Their Thursday order on a sent plan: "Thursday's delivery is planned: VEH035, window 05:00 to 07:30".
    - An order moved to another day, with its reason.
    - The truck leaving the depot.
    - The driver arriving, delivering, being refused or finding the shop closed.
    - The depot's answer to their receipt report: a replacement and its day, or none.
  - **Dispatcher, for the depot on show (both under Both).**
    - Every new problem: a loader's flag, a driver's problem or a shop's receipt report.
    - A truck loaded and ready, leaving, and back.
  - **Loader.**
    - The plan sent: "Thursday's plan is out: 27 trucks to load".
    - The plan changed after sending.
    - The dispatcher's answer to their flag.
  - **Driver.**
    - Their trip sent and changed.
    - Their truck ready.
    - The dispatcher's answer to their problem.
- **The driver's answers, glanceable** (Nabil, 1 Oct: a driver "sees everything in text ... in case he's driving,
  that's not a good way to show it"; he chose a glanceable card that is "dismissible ... auto-dismiss ... should just
  pop open and go away").
  - When the dispatcher's answer to a driver's problem arrives, it pops up as a large card over the driver's screen:
    the design's icon for the answer, three words with the count in large type ("↩ Bring back · 3 chilled", "↻ Try
    again · Fresh Nugegoda", "✓ Go short"), and under it, small, "Ruwan · 03:38" and the full sentence.
  - It closes with a tap or a swipe and goes away by itself after 8 seconds.
  - After it goes, the trip's top line keeps only the short form (icon and three words), not the full sentence. The
    full sentence stays in the bell's pop-up and on the stop's own screen.
  - Each answer kind has its short form, written once beside the answer's words, so the card, the top line and the
    bell's row agree.
- **Read state** is kept in the browser per account: the newest time the person has seen. A new device starts with
  the day's updates unread.

## Rules, with worked examples
1. **Derived, never invented.** Every update comes from a record that exists, at that record's time: an order's
   `placed_at`, a plan's `published_at`, a problem's raise and answer times, a trip's departure and stops. The
   seeded day therefore gives each role its updates on a fresh install, and a demo reset brings them back.
2. **Each person sees only their own.** Nadeesha sees Fresh Nugegoda's orders and deliveries only. Kasun sees
   Peliyagoda's dock. Dilshan sees his own trips. Ruwan sees the depot on show. A route never answers another
   shop's or depot's updates (403, as every route).
3. **One toast per update.** An update shown as a toast is not shown again in that tab, after a reload or when the
   stream reconnects. The live stream's topic triggers a fresh read, and only updates newer than the newest the
   tab has seen become toasts.
4. **Worked example.** Ruwan sends Peliyagoda's plan at 16:06. Nadeesha's bell reads 1, and her pop-up's top row is
   "Thursday's delivery is planned: VEH035, window 05:00 to 07:30 · 16:06". Pressing it opens Today.

## Data in and out
- `GET /api/v1/notifications` answers `{ items: [{ id, kind, at, line, link, tone }] }` for the person signed in,
  newest first, at most 30. A dispatcher's read takes `?depot=` as every dispatcher read does (spec 021). `id` is
  stable (for example `deliver:<stopId>`), so a tab can tell which updates it has shown.
- Read state is in `localStorage` under the account's id: `{ seenUpTo }`. No new table.
- The live stream's existing topics (`orders`, `plans`, `loading`, `driver`, `issues`) are what trigger a fresh read.

## Acceptance criteria
- [ ] AC-1 For each role, `GET /notifications` shall answer that person's updates by the lists above, from existing
  records at their own times, newest first, at most 30, and never another shop's or depot's.
- [ ] AC-2 The bell of every role shall show the unread count and open the pop-up with each row's icon, line, time
  and link, "Mark all read", and the role's own foot link.
- [ ] AC-3 A new update shall show once as a toast with its link. When the tab is hidden and the browser allows it,
  it shall show as a system notification. The permission is asked only from the pop-up's own button.
- [ ] AC-3b When the dispatcher's answer to a driver's problem arrives, the driver's screen shall pop up the glanceable
  card (icon, three words with the count, then the time and the full sentence small). It shall close on a tap or swipe
  and by itself after 8 seconds, and leave only the short form in the trip's top line.
- [ ] AC-4 On the seeded day, each walkthrough person (Nadeesha, Ruwan, Kasun, Dilshan) shall see their updates by
  the lists above after each walkthrough step, pinned by tests.
- [ ] AC-5 The README shall describe the bell and the pop-up in the walkthrough and list the pop-up under
  "Departures from the design" as ours.

## Out of scope
Server push to a closed browser, e-mail or SMS, and notification settings per kind.
