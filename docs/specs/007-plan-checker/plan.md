# 007 · Plan

## Data changes
None. The engine reads and writes no tables and needs no migration.

Two tables from spec 008 feed it through plain values: `vehicle_days_off (vehicle_id, date, reason)` becomes
`available` on each vehicle, and `fuel_log (vehicle_id, date, litres, trip_id, note)` becomes
`litresUsedThisWeek`. The code that reads them and calls the engine is written in A2.

## Contracts
New in `packages/contracts`, written by the lead before the builders start. These are the shapes a screen
receives, so both sides agree on them.

```ts
// A rule that stops a plan, or one that only warns. The level of each code is fixed by the engine.
export const PROBLEM_CODES = [
  // blocks
  'over_weight', 'over_volume', 'needs_reefer', 'van_only', 'wrong_depot', 'order_not_planned', 'order_twice',
  'deferral_incomplete', 'order_wrong_outlet', 'empty_trip', 'stop_repeated', 'cross_district', 'too_many_trips', 'trips_overlap',
  'window_missed', 'mall_slot_missed', 'fuel_over_quota', 'not_operating_day', 'vehicle_off',
  // warnings
  'no_tail_lift', 'mixed_brands', 'over_time_budget', 'leaves_early', 'long_wait',
] as const;

// Why an order waits. B4 may add to this list.
export const DEFERRAL_CODES = ['no_reefer', 'over_capacity', 'no_van', 'window', 'fuel', 'dispatcher_choice'] as const;

export const Problem = z.object({
  code: z.enum(PROBLEM_CODES),
  level: z.enum(['block', 'warn']),
  message: z.string(),              // one plain sentence with the numbers in it
  fix: z.string().optional(),       // only for the codes listed under "Messages"
  vehicleId: z.string().optional(),
  tripNo: z.number().int().optional(),
  stopSeq: z.number().int().optional(),   // 1 is the first stop
  outletId: z.string().optional(),
  orderId: z.string().optional(),
});

// Every time is minutes after midnight on the plan date, in depot time. It can pass 1440 on a late trip.
export const StopTime = z.object({
  seq: z.number().int(), outletId: z.string(),
  arriveAt: z.number().int(), waitMin: z.number().int(), startAt: z.number().int(), leaveAt: z.number().int(),
  windowOpen: z.number().int(), windowClose: z.number().int(), late: z.boolean(),
});

export const TripTimes = z.object({
  district: z.string(), leaveAt: z.number().int(), stops: z.array(StopTime),
  lastDoneAt: z.number().int(), backAt: z.number().int(), readyAgainAt: z.number().int(),
  tripMin: z.number().int(),        // the booklet's trip minutes
  km: z.number(), litres: z.number(),
});

export const Load = z.object({
  kg: z.number(), m3: z.number(), units: z.number().int(),
  needsReefer: z.boolean(), needsTailLift: z.boolean(), keepUpright: z.boolean(),
});

export const TripCheck = z.object({
  vehicleId: z.string(), tripNo: z.number().int(), load: Load,
  times: TripTimes.nullable(),      // null when the trip cannot be timed
});

export const VehicleDay = z.object({
  vehicleId: z.string(), freshMin: z.number().int(), styleTechMin: z.number().int(),
  litresBefore: z.number(), litresPlan: z.number(), litresLeft: z.number(), quotaL: z.number(),
});

export const PlanCheck = z.object({
  ok: z.boolean(), problems: z.array(Problem), trips: z.array(TripCheck), vehicles: z.array(VehicleDay),
});
```

The engine's own input types do not cross the wire, so they live in `apps/api/src/planning/types.ts`:

```ts
export type Minutes = number;

export interface PlanSettings {
  reloadMin: number;                                         // 30
  earliestLeave: { Fresh: Minutes; Style: Minutes; Tech: Minutes };   // 210, 450, 450
  waitWarnMin: number;                                       // 30
  budgetMin: { fresh: number; styleTech: number };           // 270, 480
  mixBrands: boolean;                                        // false
}

export interface PlanInput {
  depotId: string;
  operatingDay: boolean;
  settings: PlanSettings;
  products: { id: string; kgPerUnit: number; m3PerUnit: number; temp: Temp; needsTailLift: boolean; keepUpright: boolean }[];
  orders: { id: string; outletId: string; lines: { productId: string; quantity: number }[] }[];
  outlets: { id: string; brand: Brand; district: string; depotId: string; dockType: 'street' | 'rear_dock' | 'mall_bay';
    parking: 'normal' | 'van_only' | 'mall_dock'; windowOpen: Minutes; windowClose: Minutes; mallOpen?: Minutes; mallClose?: Minutes }[];
  vehicles: { id: string; type: 'truck' | 'van'; temp: 'reefer' | 'ambient'; weightCapKg: number; volumeCapM3: number;
    kmPerL: number; weeklyFuelQuotaL: number; depotId: string; available: boolean; litresUsedThisWeek: number }[];
  travel: { district: string; depotId: string; outMin: number; outKm: number; betweenMin: number; betweenKm: number }[];
  allowances: { brand: Brand; dockType: 'street' | 'rear_dock' | 'mall_bay'; minutes: number }[];
  plan: {
    trips: { vehicleId: string; tripNo: number; leaveAt?: Minutes; stops: { outletId: string; orderIds: string[] }[] }[];
    deferrals: { orderId: string; code: string; reason: string }[];
  };
}
```

Bad input is not a plan problem. The engine throws `PlanInputError` with a message that names what is wrong
(AC-5, AC-45). Error codes for the API belong to the endpoints in A2.

## How it works

Everything is in `apps/api/src/planning`. An engine file imports only from that folder and from
`@wayfinder/contracts`, so it cannot reach the database, the config or the clock. The one exception is the
test helper in `testing/`, which reads the data files and the product list.

| File | What it holds |
| --- | --- |
| `types.ts`, `settings.ts` | The input types above and `DEFAULT_SETTINGS`. |
| `load.ts` | `computeLoad(lines, products)`. |
| `timeline.ts` | `defaultLeaveAt`, `timeTrip` and `timeVehicleDay`, which times a vehicle's trips in order. |
| `fuel.ts` | `tripKm`, `tripLitres` and `vehicleFuel`. |
| `rules/cargo.ts` | Weight, volume, fridge, van only, depot, tail lift, mixed brands. |
| `rules/coverage.ts` | Every order on one stop or deferred, deferrals complete, order at its own shop, empty trips, a shop twice on a trip. |
| `rules/time.ts` | District, trip count, overlap, windows, mall slots, budgets, leaving early, waiting. |
| `rules/day.ts` | Fuel quota, operating day, vehicle available. |
| `check.ts` | `checkPlan(input)`, which runs everything and builds the result. |
| `testing/shared.ts` | Test helper that reads `data/shared/*.csv` and the product list into engine input. |

**`checkPlan` in four steps.**
1. Index the input by id. Anything the plan names that is missing throws.
2. For each vehicle in the plan, sort its trips by number, work out each trip's load, then time them in order
   and work out the fuel. A trip that cannot be timed gets `times: null`.
3. Run the four rule files. Each exports one function that takes the input plus only what it needs, and
   returns a list of problems: `cargoProblems(input, tripLoads)`, `coverageProblems(input)`,
   `timeProblems(input, vehicleTimes)` and `dayProblems(input, vehicleFuel)`. Their signatures are fixed in
   `types.ts`, so the rule files can be written and tested apart and still fit together.
4. Sort the problems (AC-43) and set `ok`.

**Whole numbers inside.** 6.9 × 48 is 331.20000000000005 in JavaScript. So the load is added up in hundredths
of a kilo and in litres of volume, litres of fuel are kept in tenths, and each is divided once at the end.
Minutes are whole numbers already. Limits are compared in the same whole units, so a load exactly at the limit
passes.

**Leaving time.** `defaultLeaveAt` is the latest of three times: the first stop's opening time minus the
drive out, the earliest leaving time for the trip (03:30 with a Fresh stop, 07:30 without), and the time the
vehicle is ready again after its earlier trip. The plan board uses the same function when the dispatcher has
not typed a time.

**Messages.** Each rule writes its own sentence. It names the vehicle and the shop, gives both numbers and
uses no code words: "VEH035 trip 1 carries 1,242 kg. Its limit is 1,040 kg." Times read as 07:54. Some codes
also carry a `fix`: `over_weight` and `over_volume` (how much to take off), `fuel_over_quota` (litres over),
`trips_overlap` (the earliest leaving time), `long_wait` (the leaving time that removes a wait at the first
stop), and `window_missed` and `mall_slot_missed` (the latest leaving time that reaches every stop in time,
when there is one, AC-47).

**The earlier leaving time (AC-47).** Leaving earlier never makes a stop later, so the rule steps the leaving
time back one minute at a time from the trip's own, re-times the trip, and stops at the first time with no
late stop. It never goes before midnight or before the vehicle is ready from its earlier trip. A truck that
would only wait at its first shop gains nothing, and then there is no fix.

**Settings.** `DEFAULT_SETTINGS` holds 30 minutes to reload, 03:30 and 07:30, the 30 minute waiting warning,
the 270 and 480 minute budgets and "mix brands" off. The caller passes settings in, so a later admin screen
only has to store them.

## Risks
- **A rule in the engine and a different one on a screen.** Screens show `PlanCheck` as it is and never work
  out a time, a load or a litre themselves. A reviewer checks for this on every screen that shows a plan.
- **The booklet counts trip minutes per order and we count per stop.** They differ only when one stop carries
  two orders. The spec says so, and the Gampaha and Colombo tests pin our numbers to the booklet's.
- **Our own rules are wrong for Waypoint.** One district per trip (D-23) and the tail-lift rule (D-24) are
  ours, not the booklet's. Each is one small rule function, easy to change.
- **Tests pass on made-up rows and fail on the real ones.** The worked examples run on the real rows in
  `data/shared`, read by `testing/shared.ts`.
- **A trip that runs past midnight.** Times are plain minutes and may pass 1440. Nothing wraps round.

## Test plan
Every criterion is a unit test in the file beside its code, with the criterion's number in the test name, for
example `AC-13 gives the booklet's 101 minutes for the Gampaha trip`. No database is needed, and `npm test`
runs them with the rest in CI.

| Criteria | Test file |
| --- | --- |
| AC-1 to AC-5 | `load.test.ts` |
| AC-6 to AC-14 | `timeline.test.ts` |
| AC-15, AC-16 | `fuel.test.ts` |
| AC-17 to AC-23 | `rules/cargo.test.ts` |
| AC-24 to AC-28, AC-48 | `rules/coverage.test.ts` |
| AC-29 to AC-33, AC-37 to AC-39, AC-47 | `rules/time.test.ts` |
| AC-34 to AC-36 | `rules/day.test.ts` |
| AC-40 to AC-46 | `check.test.ts` |

Tests are written from the criteria first and seen to fail, then the code is written (D-07). The worked
examples in the spec are tests with the same shop and vehicle ids. AC-46 also reads the engine files and fails
if one imports anything from outside the folder other than `@wayfinder/contracts`.
