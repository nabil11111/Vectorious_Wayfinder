# 018 · Sign-in as designed

**Status:** Done  ·  **Owner:** lead (T0), Claude builders (T1, T2)  ·  **Design:** Login page · desktop
(`53:6373`), Login page · phone (`53:6276`), and the states beside them in "Login · interaction states and design
notes" (Empty, PIN entry, Loading, Error, Remember staff ID)

## Why
The sign-in page is the first screen every judge sees, and judges score how faithfully we build the design. The
design signs a person in with a **staff ID and a four-digit PIN**, on a page with the Sri Lanka district artwork
and a language choice. We built a username and password on a plain card and listed it as a departure. Nabil asked
for the page as designed, in English only for now (1 Oct, D-90, D-91).

## What it does
A person types their staff ID, enters their four-digit PIN and presses **Sign in**. On a phone the PIN comes from
a number pad; on a desktop from the keyboard. "Remember my staff ID" keeps the staff ID on this device for next
time, never the PIN. "Contact your depot" says who can help. The Sinhala and Tamil buttons show as designed and say
that those languages come later; English is the only one that works.

Every demo account gets a staff ID: a role letter and three digits. The README hands them out with one demo PIN.

| Role | Letter | Accounts (fixture order) |
| --- | --- | --- |
| Store manager | S | S-001 Nadeesha, S-002 Ishara, S-003 Tharindu |
| Dispatcher (plans the day) | P | P-001 Ruwan |
| Loader | L | L-001 Kasun |
| Driver | D | D-001 Dilshan, D-002 Prasanna, then D-003 to D-036 for Chaminda to Wasantha in fixture order |
| Admin | A | A-001 Admin |

The design's example "D-014" (a driver on a phone) is the field's placeholder.

## Screen states

| State | Frame | What shows |
| --- | --- | --- |
| Desktop, from 1024 wide | `53:6373` | Left panel 760 of 1440 wide in `#1F2933`: the white wordmark, "Delivery operations", and the district artwork 600 wide (districts `#34434F`, the 12 served districts `#138A7B`, borders in the panel colour). Right: the language buttons top right (සිං, த, EN; EN filled dark), then "Sign in", "Enter your staff ID and PIN.", **Staff ID** (monospace, placeholder `D-014`), **PIN** (a masked field of four digits), "Remember my staff ID" with "You'll still enter your PIN.", the orange **Sign in** button, and "Can't sign in? **Contact your depot**". |
| Phone, below 1024 wide | `53:6276` | A `#1F2933` header with the wordmark, the artwork small and the language buttons; a white sheet with rounded top corners holding the form. The PIN shows as four dots (filled as digits are entered), "Enter your four-digit PIN.", and a pad 1 to 9, 0 and a delete key ("Delete last PIN digit"). Between 600 and 1023 wide the phone layout is centred at most 480 wide. |
| PIN entry | PIN0 to PIN4 | One dot fills per digit; a fifth digit is ignored; delete empties the last dot. |
| Loading | Loading | "Checking your details…" where the hint was, the pad dimmed and disabled, the button "Signing in…". |
| Wrong staff ID or PIN | Error | "Staff ID or PIN isn't correct. Try again." in `#AB3F2E` where the hint was (desktop: under the PIN field). The PIN empties, the staff ID stays, focus goes to the PIN. |
| Remember my staff ID | Remember staff ID | Ticked, the staff ID is kept on this device after a successful sign-in and filled in next time; unticked, it is forgotten. |
| Too many tries | No frame | After 5 wrong PINs for one staff ID: "Too many tries. Wait 15 minutes, or contact your depot." |
| No signal | No frame | The request cannot reach the server: "No signal. Signing in needs the network." The PIN stays. |
| Server error | No frame | Any other failure: "Could not sign in. Try again." The PIN stays. |
| Sinhala or Tamil pressed | No frame | A line under the buttons: "Sinhala is coming. Wayfinder is in English for now." (or Tamil). EN stays selected. |
| Contact your depot pressed | No frame | A line under it: "Ask your depot's dispatcher for your staff ID and PIN." |
| Signed in | | The role's home page, as today. |

## Rules, with worked examples
1. **A staff ID is a letter, a dash and three digits.** It is matched without regard to case or spaces around it:
   " p-001 " signs in Ruwan.
2. **A PIN is exactly four digits.** "123" or "12a4" never reaches the server: Sign in stays disabled until there
   are four digits and a staff ID.
3. **One answer for any wrong pair.** An unknown staff ID, a wrong PIN, or an account that is switched off all get
   "Staff ID or PIN isn't correct. Try again.", and an unknown staff ID takes as long to answer as a wrong PIN.
4. **Five wrong PINs in a row lock the staff ID for 15 minutes.** Ruwan's PIN typed wrong five times at 10:00
   locks P-001 until 10:15: the fifth try already says "Too many tries…", and so does the right PIN at 10:05. A
   correct sign-in sets the count back to 0. The lock runs on real time, as sessions do, so moving the demo clock
   does not lift it. The address limit stays as it is (10 failed tries per address in 15 minutes).
5. **The demo PIN** comes from `SEED_PIN` (default `1234`) for every demo account, and admin's from
   `SEED_ADMIN_PIN` (default `9024`), so a hosted admin PIN can differ from the printed one.
6. **Remember my staff ID** stores only the staff ID, only on this device, and only after a successful sign-in.
   Storage that throws or is empty never stops sign-in.

## Permissions
Anyone may open the page and try to sign in. Nothing else changes: every role's pages check the session as today.

## Failure paths
- No network: the No signal state; nothing is stored.
- An install seeded before this change: the seed gives each demo account its staff ID and PIN once, on the next
  start, so the README's staff IDs and PIN work without a reset.
- Two tabs: signing in in one tab behaves as today (the other tab follows the session).

## Data in and out
- `POST /api/v1/auth/login` takes `{ staffId, pin }` (`LoginRequest`) and answers `Me`, which gains `staffId`.
  401 `bad_credentials` for rule 3, 429 `locked` for rule 4, 400 for a body of the wrong shape.
- `users` gains `staff_id` (unique), `pin_hash`, `failed_pins` and `locked_until`; `password_hash` goes (plan.md).

## Acceptance criteria
- [x] AC-1 When a person signs in with a demo staff ID and the demo PIN, the system shall answer their `Me` with
  their `staffId` and set the session, whatever the case and surrounding spaces of the staff ID.
- [x] AC-2 When the staff ID is unknown, the PIN is wrong or the account is switched off, the system shall answer
  401 `bad_credentials` with "Staff ID or PIN isn't correct. Try again." and no session.
- [x] AC-3 When a PIN is not exactly four digits, the system shall refuse the body with 400 and check nothing.
- [x] AC-4 When a staff ID gets its fifth wrong PIN in a row, the system shall answer that try and every sign-in
  for that staff ID, right PIN included, with 429 `locked` and "Too many tries. Wait 15 minutes, or contact your
  depot." until 15 minutes have passed; a correct sign-in before the fifth try sets the count back to 0.
- [x] AC-5 When the seed runs on a fresh database, the system shall give every demo account its staff ID from the
  table above and the demo PIN (admin: the admin PIN); when it runs on a database seeded before this spec, it
  shall do the same once for accounts without a staff ID or PIN and leave every account that has them alone.
- [x] AC-6 When the page is wider than 1023 px, the system shall show the desktop frame's split layout with the
  district artwork; below that, the phone frame's layout with the number pad.
- [x] AC-7 When digits are entered on the pad, the system shall fill one dot per digit up to four, ignore a fifth,
  and empty the last dot on delete.
- [x] AC-8 When the sign-in is answered `bad_credentials`, the system shall show the Error state, empty the PIN and
  keep the staff ID; when answered `locked`, the Too many tries line; with no network, the No signal line.
- [x] AC-9 When Remember my staff ID is ticked and the sign-in succeeds, the system shall fill that staff ID in on
  the next visit on this device; when unticked, it shall forget it; it shall never store the PIN.
- [x] AC-10 When Sinhala or Tamil is pressed, the system shall say that language comes later and keep English.
- [x] AC-11 When Contact your depot is pressed, the system shall show who can help.
- [x] AC-12 The README's seeded accounts, every walkthrough sign-in and the `.env` settings shall name staff IDs
  and the PIN, and the sign-in departure shall go.

## Out of scope
Sinhala and Tamil text, changing or resetting a PIN, and any account admin page.
