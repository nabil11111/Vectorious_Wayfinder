import type { Brand, Load, PlanCheck, Problem, Temp, TripTimes, VehicleDay } from '@wayfinder/contracts';

// The plan checker's own input (spec 007). Plain data in, plain data out: nothing here touches the database,
// the config or the clock. Every time is minutes after midnight on the plan date, in depot time.
export type Minutes = number;

export type DockType = 'street' | 'rear_dock' | 'mall_bay';

export interface PlanSettings {
  reloadMin: number;
  // The earliest a trip leaves by itself, by the brand of its stops. A trip with a Fresh stop uses Fresh.
  earliestLeave: { Fresh: Minutes; Style: Minutes; Tech: Minutes };
  waitWarnMin: number;
  // The booklet's trip-minute budgets for a vehicle's day.
  budgetMin: { fresh: number; styleTech: number };
  mixBrands: boolean;
}

export interface EngineProduct { id: string; kgPerUnit: number; m3PerUnit: number; temp: Temp; needsTailLift: boolean; keepUpright: boolean }
export interface OrderLineQty { productId: string; quantity: number }
export interface EngineOrder { id: string; outletId: string; lines: OrderLineQty[] }
export interface EngineOutlet {
  // The name is what the checker's messages call the shop, so a dispatcher reads "Fresh Nugegoda", not OUT001.
  id: string; name: string; brand: Brand; district: string; depotId: string; dockType: DockType;
  parking: 'normal' | 'van_only' | 'mall_dock';
  windowOpen: Minutes; windowClose: Minutes;
  // Only mall shops have a slot. The window used is the later opening and the earlier closing of the two.
  mallOpen?: Minutes; mallClose?: Minutes;
}
export interface EngineVehicle {
  id: string; type: 'truck' | 'van'; temp: 'reefer' | 'ambient';
  weightCapKg: number; volumeCapM3: number; kmPerL: number; weeklyFuelQuotaL: number; depotId: string;
  // From vehicle_days_off and fuel_log (spec 008). The caller works them out for the plan date.
  available: boolean; litresUsedThisWeek: number;
}
export interface TravelRow { district: string; depotId: string; outMin: number; outKm: number; betweenMin: number; betweenKm: number }
export interface AllowanceRow { brand: Brand; dockType: DockType; minutes: number }

export interface PlanStop { outletId: string; orderIds: string[] }
export interface PlanTrip { vehicleId: string; tripNo: number; leaveAt?: Minutes; stops: PlanStop[] }
export interface PlanDeferral { orderId: string; code: string; reason: string }

export interface PlanInput {
  depotId: string;
  operatingDay: boolean;
  settings: PlanSettings;
  products: EngineProduct[];
  // The day's orders: the placed orders for the plan date plus the ones carried over.
  orders: EngineOrder[];
  outlets: EngineOutlet[];
  vehicles: EngineVehicle[];
  travel: TravelRow[];
  allowances: AllowanceRow[];
  plan: { trips: PlanTrip[]; deferrals: PlanDeferral[] };
}

// What the pieces hand each other inside the checker.
export interface TripLoad { vehicleId: string; tripNo: number; load: Load }
export interface VehicleTimes { vehicleId: string; trips: { tripNo: number; times: TripTimes | null }[] }
// kmPlan is the plan's kilometres for the vehicle. The quota rule compares on it, so rounding the litres for
// display can never hide a plan that is over (spec 007, AC-34).
export type VehicleFuel = Pick<VehicleDay, 'vehicleId' | 'litresBefore' | 'litresPlan' | 'litresLeft' | 'quotaL'> & { kmPlan: number };

// The functions each file exports. They are fixed here so the files can be written apart and still fit.
//   load.ts            computeLoad
//   timeline.ts        defaultLeaveAt, timeTrip, timeVehicleDay, budgetMinutes
//   fuel.ts            tripKm, tripLitres, vehicleFuel
//   rules/cargo.ts     cargoProblems        rules/coverage.ts   coverageProblems
//   rules/time.ts      timeProblems         rules/day.ts        dayProblems
//   check.ts           checkPlan
export type ComputeLoad = (lines: OrderLineQty[], products: EngineProduct[]) => Load;
// readyAt is when the vehicle is ready again after its earlier trip, or null for its first trip.
export type DefaultLeaveAt = (input: PlanInput, trip: PlanTrip, readyAt: Minutes | null) => Minutes;
// null when the trip cannot be timed: no stops, stops in two districts, or no travel figures for the district.
export type TimeTrip = (input: PlanInput, trip: PlanTrip, leaveAt: Minutes) => TripTimes | null;
// Times every trip of one vehicle in trip-number order, chaining the second onto the first.
export type TimeVehicleDay = (input: PlanInput, vehicleId: string) => VehicleTimes;
export type BudgetMinutes = (input: PlanInput, times: VehicleTimes) => { freshMin: number; styleTechMin: number };
export type TripKm = (travel: TravelRow, stops: number) => number;
export type TripLitres = (km: number, kmPerL: number) => number;
export type VehicleFuelOf = (input: PlanInput, times: VehicleTimes) => VehicleFuel;
export type CargoProblems = (input: PlanInput, tripLoads: TripLoad[]) => Problem[];
export type CoverageProblems = (input: PlanInput) => Problem[];
export type TimeProblems = (input: PlanInput, vehicleTimes: VehicleTimes[]) => Problem[];
export type DayProblems = (input: PlanInput, vehicleFuel: VehicleFuel[]) => Problem[];

// The pure suggested-plan engine (spec 011). History comes from the caller, never from a clock or database.
export interface PlannerOrder extends EngineOrder { deliveryDate: string; timesDeferred: number; splitFrom: string | null }
export type PlannerInput = Omit<PlanInput, 'orders' | 'plan'> & { date: string; orders: PlannerOrder[] };
export interface PlannerSplit { orderId: string; keep: OrderLineQty[]; keptOrderId: string; remainderOrderId: string }
export interface PlannerChoice { orderId: string; rank: number; resultOrderIds: string[]; reason: string }
export type PlannerDecision =
  | { kind: 'early_leave'; vehicleId: string; tripNo: number; leaveAt: number; reason: string }
  | { kind: 'waited_again' | 'late_order'; orderId: string; reason: string };
export type PlannerResult =
  | { status: 'suggested' | 'needs_decision'; input: PlanInput; check: PlanCheck; splits: PlannerSplit[]; choices: PlannerChoice[]; decisions: PlannerDecision[] }
  | { status: 'unavailable'; check: PlanCheck };
export type BuildSuggestedPlan = (input: PlannerInput) => PlannerResult;
