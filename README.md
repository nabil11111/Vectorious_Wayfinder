<img src="apps/web/public/icon.svg" alt="Wayfinder logo" width="72" height="72">

# Wayfinder

One delivery day, from the shop's order to its confirmed receipt. Wayfinder connects store managers,
dispatchers, loaders and drivers across Waypoint Group's two depots.

Built by **Team Vectorious** for the **Tech-Triathlon 2026 Hackathon**.

The dispatcher can plan by hand or build a checked suggestion, see why orders are deferred, and compare
what happens when a vehicle is unavailable. Loaders report shortages, drivers record deliveries offline,
and shops confirm what arrived. Each role sees the next person's updates.

## Run it

You need Docker. From the repository root:

```bash
docker compose up
```

Open [localhost:3000](http://localhost:3000). The first start builds the app, migrates the database and seeds
120 outlets, 60 vehicles, demo accounts and a delivery day for both depots. Later starts check the build
against the current source and keep your data.

No `.env` file is needed for the defaults. Copy [.env.example](.env.example) to `.env` to change the demo PINs,
database settings or proxy configuration. `DEMO_MODE=true` enables the seeded day and shared clock.
Optional background push requires VAPID keys and browser support.

[Local development and full configuration](docs/development.md).

## Demo accounts

Default local PIN: **1234**. Use separate browsers or a private window to keep different roles signed in.

| Role | Staff ID | Person |
| --- | --- | --- |
| Store manager | `S-001` | Nadeesha · Fresh Nugegoda |
| Dispatcher | `P-001` | Ruwan · Peliyagoda |
| Loader | `L-001` | Kasun · Peliyagoda |
| Driver | `D-036` | Wasantha · reefer van VEH035 |

[All seeded accounts](docs/accounts.md), including every shop and Kandy's staff. Admin is `A-001`, with its
own default PIN **9024**. Hosted PINs can differ from the local defaults.

## Judge walkthrough

Start from the fresh seed or **Reset the demo day** in the top-bar clock. It starts at **Wed 24 Jun, 15:00**,
with orders open for Thursday. The clock advances the whole app; a hosted reset affects everyone using it.
Use a phone-sized window for the loader and driver.

1. **Place an order — `S-001`.** Open the draft for Fresh Nugegoda and place its 8 chilled and 4 dry cartons.
2. **Plan — `P-001`.** Move the clock to **Orders closed, 16:00** and open the Plan board. Drag Nugegoda into
   the empty middle, review the checked preview and choose **Use this arrangement** for Wasantha's reefer van.
   Add Nugegoda's 12 carried-over chilled cartons and
   both Wellawatte orders. Keep Nugegoda first and Wellawatte second.
3. **Explain what waits.** Defer the remaining orders with a reason. Choose **Finish editing**, open **View plan**
   and send it. This small walkthrough serves 5 orders and defers 99; the suggested planner below handles the full day.
4. **Load — `L-001`.** Move the clock to **Loading, Thu 02:30**. Start VEH035 and load Wellawatte first
   (94 cartons). On Nugegoda, flag its dry line as short: 3 of 4 cartons available.
5. **Answer the shortage — `P-001`, then `L-001`.** In **Live day**, answer **Go short**. As the loader,
   finish Nugegoda and **Mark ready**: 117 of 118 cartons loaded.
6. **Deliver — `D-036`.** Move the clock to **Trucks leave, Thu 03:30**. Start the trip, arrive at Nugegoda,
   count 12 and 8 chilled plus 3 dry cartons, add a proof photo and save the delivery.
7. **Keep working offline.** Turn networking off for the driver's browser. At Wellawatte, record arrival,
   then **Something's wrong → Shop refused some**: 2 of the 48 chilled cartons are damaged. Save the partial
   delivery and continue. Reload while offline, then reconnect and check the records sync.
8. **Close the trip.** As `P-001`, answer the refusal with **Bring them back**. As `D-036`, confirm
   **I'm back at the depot**.
9. **Confirm receipt — `S-001`.** Advance the clock to **Morning deliveries done, Thu 08:30**. Open
   **Deliveries**, reduce the first chilled line from 12 to 11, choose **Missing**, and confirm.
10. **Resolve and review — `P-001`.** Send one replacement for Friday from **Live day**. Check that the shop
    sees it, then open **History** for the trip's quantities, proof and receipt.

To try **suggested planning**, reset the demo, close orders, then choose **Build the suggested plan** as
`P-001`. Inspect the allocation and deferral reasons, accept the decisions and send. Resetting starts a new
walkthrough. Offline reload requires the built app over HTTPS or localhost, not the Vite development server.

[Detailed walkthrough, expected counts and extra scenarios](docs/walkthrough.md).

## How it works

**React + Vite · Express · PostgreSQL · Drizzle · shared Zod contracts.** One Node process serves the web app,
API and live updates. Driver actions and shop receipts queue on the device and sync with retry-safe IDs.

The planner checks weight, volume, temperature, outlet access, windows and fuel. Its estimates use supplied
district averages, clear-road travel times and fixed unloading allowances. The dispatcher makes the final call.

[Architecture](docs/architecture.md) · [Data model](docs/data-model.md) ·
[Spec-driven build process](docs/specs/README.md) · [AI disclosure](docs/ai-disclosure.md)

## Departures from the design

- English only. The map is schematic; there is no GPS tracking, live traffic ETA, six-week forecast or vehicle hiring.
- Added demo controls, crew selection, drag and drop, Undo/Redo, notifications and optional browser push.
- Added read-only vehicle-unavailable comparisons and dated shop readiness declarations.
- Every sent trip needs a driver; second trips wait for return and reloading. A placed order cannot be edited.
- Driver handover and shop receipt are separate records. No signatures, call buttons or automatic credits.
- The planner explains its decisions. Manual edits have no reason log; a saved draft can be compared with a new suggestion.

[Full design departures and reasons](docs/design-departures.md).
