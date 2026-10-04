# 031 · The other depot, a sound, and a background alert

**Status:** Done  ·  **Owner:** lead  ·  **Design:** no frame. The bell's pop-up is already ours (D-99).

## Why

Nabil, 4 Oct. After Peliyagoda's plan is sent, Ruwan can leave Kandy unplanned and nothing tells him. He also asked for a different sound for each kind of alert, generated once and kept in the app. On a phone, allowing background alerts and then leaving Wayfinder did not show the driver's update, because the page had stopped listening.

## What it does

- **The other depot.** When the depot on show has a sent plan for a day, and the other depot has orders for that day and no sent plan, Ruwan's bell has one warning: "Kandy has no plan yet for Thu 25 Jun." Pressing it switches to that depot and opens its plan board. The same line names Peliyagoda when Kandy was sent first. It goes away once that plan is sent. No orders on the other depot means no line. Loaders, drivers and shops are not told, and Send is not blocked.
- **Sounds.** Four short clips, one for each tone the bell already uses. A new update plays its clip while Wayfinder is open, once, including the driver's glance card. The first open of a tab stays silent, and a reload does not play it again. The pop-up can turn sounds off. The app does not call out to make a sound.
- **Background.** Allowing alerts also subscribes the phone. When a new update exists for that person, the server asks the browser to show it, so it can appear after the app has been sent to the home screen. A browser that has been swiped away and killed is still not reached. With no push keys configured, the button still asks the browser's permission and the rest of the bell works.

## Data in and out

- One new notification kind, `depot_unplanned`, on the list the bell already reads. No new table for it.
- `GET /api/v1/notifications/push-key` answers `{ publicKey }` or null when push is not configured.
- `PUT /api/v1/notifications/push` stores this browser's subscription for the signed-in person. The same browser signing in as someone else replaces the owner. Existing updates are marked already pushed, so turning alerts on does not repeat the day.
- `DELETE /api/v1/notifications/push` removes that subscription.
- Table `push_subscriptions`: the person, the browser endpoint, its keys, and the update ids already pushed.
- Push keys are `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` in the environment. They are never written into the repo.

## Acceptance criteria

- [ ] When one depot's plan for a day is sent and the other depot has orders for that day and no sent plan, the dispatcher's read of the sent depot shall include one warning naming the other depot and the day, linking to that depot's plan board.
- [ ] When the other depot then has a sent plan, or it has no orders, or the person is not the dispatcher, that warning shall be absent.
- [ ] When the same is true in the other direction, the warning shall name the depot that was not sent.
- [ ] When sounds are on, a new update shall play the clip for its tone. When sounds are off, it shall not.
- [ ] When a signed-in person stores a push subscription, a later update of theirs shall be handed to the push sender once, and an endpoint the browser has dropped shall be forgotten.
- [x] A dispatcher shall receive updates from either depot. Subscribing shall mark existing updates in both depots as seen, and a pushed link shall open the correct depot while preserving its issue or trip target.

## Out of scope

A sound for each of the 22 update kinds, sounds while the app is in the background, a push to a browser that was killed, e-mail or SMS, and blocking Send until both depots are planned.
