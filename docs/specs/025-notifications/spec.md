# 025 · Notifications for every role

> Current scope: Spec 031 extends this with sounds and server web push. Server push requires VAPID configuration and a successful browser subscription.

**Status:** Done  ·  **Owner:** Claude builders (T1 server, T2 screens)  ·  **Design:** the bell in every role's
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
- **What each role is told** (all from records the app already keeps; times are the app clock's). Trucks are named as
  spec 026 names them: by their driver for the dispatcher and the shop ("Wasantha's reefer van"), and by the vehicle
  number for the loader and the driver ("VEH035"), who must find the actual truck. The updates are those of the day
  being worked, the loader's day (D-34: today until 16:00, then the next operating day), and of the operating day after
  it, which the shops order for:
  - **Store manager.**
    - Their order placed.
    - Their Thursday order on a sent plan: "Thursday's delivery is planned: Wasantha's reefer van, window 05:00 to
      07:30".
    - An order moved to another day, with its reason.
    - The truck leaving the depot.
    - The driver arriving, delivering, being refused or finding the shop closed.
    - The depot's answer to their receipt report: a replacement and its day, or none.
  - **Dispatcher, for the depot on show (both under Both).**
    - Every new problem: a loader's flag, a driver's problem or a shop's receipt report.
    - A truck loaded and ready, leaving, and back.
  - **Loader.**
    - The plan sent: "Thursday's plan is out: 27 trucks to load".
    - The plan changed after sending: sent again, or taken back to edit.
    - The dispatcher's answer to the dock's flags.
  - **Driver.**
    - Their trip sent and changed.
    - Their truck ready.
    - The dispatcher's answer to their problem.
- **The driver's answers, glanceable** (Nabil, 1 Oct: a driver "sees everything in text ... in case he's driving,
  that's not a good way to show it"; he chose a glanceable card that is "dismissible ... auto-dismiss ... should just
  pop open and go away").
  - When the dispatcher's answer to a driver's problem arrives, it pops up as a large card over the driver's screen:
    the design's icon for the answer, three words with the count in large type ("Bring back · 3 chilled", "Try
    again · Fresh Nugegoda"), and under it, small, "Ruwan · 03:38" and the full sentence.
  - It closes with a tap or a swipe and goes away by itself after 8 seconds.
  - After it goes, the trip's top line keeps only the short form (icon and three words), not the full sentence. The
    full sentence stays in the bell's pop-up and on the stop's own screen.
  - Each answer kind has its short form, written once beside the answer's words, so the card, the top line and the
    bell's row agree. The driver's phone words its own screens with no signal, so both forms are in the contracts
    (`driverAnswerSentence`, `driverAnswerShort`), from the same figures the phone and the API both read, and the
    screens give each answer kind one picture. "Send replacements" reads to the driver as bringing the cartons back.
- **Read state** is kept in the browser per account and demo day: the newest time the person has seen. A new device
  starts with the day's updates unread, and so does a reset, whose clock starts earlier.

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
   "Thursday's delivery is planned: Wasantha's reefer van, window 05:00 to 07:30 · 16:06". Pressing it opens Today.

## Data in and out
- `GET /api/v1/notifications` answers `{ demoDay, items: [{ id, kind, at, time, line, link, tone, issueKind, decision,
  answer }] }` for the person signed in, newest first, at most 30 (`NotificationList` in the contracts). `time` is `at`
  as the row shows it, "16:06" today and "Tue 23 Jun 17:00" another day. `issueKind` names a new problem's kind and
  `decision` an answer's, for their pictures; `answer` holds a driver's answer's short form, who answered and the full
  sentence, for the glanceable card. A dispatcher's read takes `?depot=` as every dispatcher read does (spec 021), and on
  Both the screen reads each depot and marks each row with its depot. `id` is stable (for example `delivered:<stopId>`),
  so a tab can tell which updates it has shown. Admin belongs to no shop or depot, and is told nothing.
- A plan's sends and takings back come from its audit rows, which keep their app-clock time (`sentAt`, and now
  `unsentAt` too); a plan sent before the audit kept one was sent once, at its publication time.
- The shop hears its truck leave, its driver arrive and a closed visit on the existing `orders` topic, which the
  driver's start, arrival and closed writes now also announce to the shop.
- Read state is in `localStorage` under the account's id and the demo day: `{ seenUpTo }`. What a tab has shown as
  toasts is in its `sessionStorage`. No new table.
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
E-mail or SMS, notification settings per kind, and a push to a browser that has been killed. A warning for the
other depot's unsent plan, a sound while the app is open, and a push while it is in the background are spec 031.
