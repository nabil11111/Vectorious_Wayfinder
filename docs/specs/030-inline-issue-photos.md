# 030 · View issue photos in place

Status: Ready. Baseline: c7b6651. Design: existing live problem cards and History photo viewer.

The user confirmed photos load but asks to view them inside the app instead of a separate browser tab. History already has an in-app viewer; driver/shop issue cards currently call window.open. Keep the planner what-if and why explanations unchanged: the user asked what they mean, not to remove them.

## Acceptance criteria
- P1: Clicking View photo on a driver or shop issue opens an in-app viewer with labelled image, loading state, clear failure/retry and Close. No new tab/window or route navigation. Prefer existing viewer primitives rather than another photo transport/state implementation.
- P2: Close or Escape closes the photo and restores focus to its trigger. Photo fits desktop and narrow screens without concealing the close action. Closing retains the issue decision/form and surrounding page position.
- P3: Reuse existing authenticated depot-aware byte retrieval. Abort and discard late reads on close, replacement, unmount, account/depot/reset changes. Revoke created object URLs when obsolete; never show an old photo in a new issue/session. Preserve Both-depot scoping. No auth/CSP loosening.
- P4: Existing History proof viewing and issue decision actions keep working. Remove obsolete popup-only code/tests honestly; add meaningful focused regression checks for asynchronous ownership/cleanup and in-app rendering. No API/schema/contracts/dependencies or AI disclosure changes.

One frontend batch, independent review and focused local desktop/phone browser proof. Full web tests, typecheck and production build. Backend is unchanged and covered by prior release verification; do not repeat the whole API suite absent a relevant change/failure. README must reflect the departure. Branch/PR may be pushed; no merge/deploy until Nabil authorizes this new change.
