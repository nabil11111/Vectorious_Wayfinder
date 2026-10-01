import { z } from 'zod';

// What the plan checker (spec 007) sends to a screen. Screens show these numbers as they are and never work
// out a time, a load or a litre themselves.

// A block stops a plan from being sent. A warning is shown and the dispatcher can still send.
export const BLOCK_CODES = [
  'over_weight', 'over_volume', 'needs_reefer', 'van_only', 'wrong_depot',
  'order_not_planned', 'order_twice', 'deferral_incomplete', 'order_wrong_outlet', 'empty_trip', 'stop_repeated',
  'cross_district', 'no_travel_data', 'too_many_trips', 'trips_overlap', 'window_missed', 'mall_slot_missed',
  'fuel_over_quota', 'not_operating_day', 'vehicle_off',
] as const;
export const WARN_CODES = ['no_tail_lift', 'mixed_brands', 'over_time_budget', 'leaves_early', 'long_wait'] as const;
export const PROBLEM_CODES = [...BLOCK_CODES, ...WARN_CODES] as const;
export const ProblemCode = z.enum(PROBLEM_CODES);
export type ProblemCode = z.infer<typeof ProblemCode>;

export const ProblemLevel = z.enum(['block', 'warn']);
export type ProblemLevel = z.infer<typeof ProblemLevel>;

// The level of a code never changes, so both sides read it from here.
export const levelOf = (code: ProblemCode): ProblemLevel =>
  (BLOCK_CODES as readonly string[]).includes(code) ? 'block' : 'warn';

// Why an order waits. The planner (B4) may add to this list.
export const DEFERRAL_CODES = ['no_reefer', 'over_capacity', 'no_van', 'window', 'fuel', 'dispatcher_choice'] as const;
export const DeferralCode = z.enum(DEFERRAL_CODES);
export type DeferralCode = z.infer<typeof DeferralCode>;

export const Problem = z.object({
  code: ProblemCode,
  level: ProblemLevel,
  // One plain sentence with the numbers in it.
  message: z.string(),
  // What would clear it, for the codes where that is obvious (spec 007, plan.md, "Messages").
  fix: z.string().optional(),
  // For a fix that is a leaving time, that time in minutes after midnight, so a screen can apply it in one click
  // (spec 010).
  leaveAt: z.number().int().min(0).max(1439).optional(),
  vehicleId: z.string().optional(),
  tripNo: z.number().int().optional(),
  // 1 is the first stop.
  stopSeq: z.number().int().optional(),
  outletId: z.string().optional(),
  orderId: z.string().optional(),
});
export type Problem = z.infer<typeof Problem>;

// Every time is minutes after midnight on the plan date, in depot time. It can pass 1440 on a late trip.
export const StopTime = z.object({
  seq: z.number().int(),
  outletId: z.string(),
  arriveAt: z.number().int(),
  waitMin: z.number().int(),
  startAt: z.number().int(),
  leaveAt: z.number().int(),
  windowOpen: z.number().int(),
  windowClose: z.number().int(),
  late: z.boolean(),
  // The minutes it arrives after its window closes, as the checker's window sentences count them (spec 022). 0 when it
  // is on time, and when it is late for another reason: a Fresh shop reached at 08:00, or a window that never opens.
  // A check stored before spec 022 has no lateMin; it reads as on time, as its own `late` says otherwise.
  lateMin: z.number().int().min(0).default(0),
});
export type StopTime = z.infer<typeof StopTime>;

export const TripTimes = z.object({
  district: z.string(),
  leaveAt: z.number().int(),
  stops: z.array(StopTime),
  lastDoneAt: z.number().int(),
  backAt: z.number().int(),
  readyAgainAt: z.number().int(),
  // The booklet's trip minutes: drive out, between stops and unloading. No waiting and no drive back.
  tripMin: z.number().int(),
  km: z.number(),
  litres: z.number(),
});
export type TripTimes = z.infer<typeof TripTimes>;

export const Load = z.object({
  kg: z.number(),
  m3: z.number(),
  units: z.number().int(),
  needsReefer: z.boolean(),
  needsTailLift: z.boolean(),
  keepUpright: z.boolean(),
});
export type Load = z.infer<typeof Load>;

export const TripCheck = z.object({
  vehicleId: z.string(),
  tripNo: z.number().int(),
  load: Load,
  // null when the trip cannot be timed: no stops, stops in two districts, or no travel figures. Such a trip
  // always carries a block, so its plan is never ok.
  times: TripTimes.nullable(),
});
export type TripCheck = z.infer<typeof TripCheck>;

export const VehicleDay = z.object({
  vehicleId: z.string(),
  // The booklet's trip minutes of this vehicle's Fresh trips, and of its Style and Tech trips.
  freshMin: z.number().int(),
  styleTechMin: z.number().int(),
  litresBefore: z.number(),
  litresPlan: z.number(),
  litresLeft: z.number(),
  quotaL: z.number(),
});
export type VehicleDay = z.infer<typeof VehicleDay>;

export const PlanCheck = z.object({
  ok: z.boolean(),
  problems: z.array(Problem),
  trips: z.array(TripCheck),
  vehicles: z.array(VehicleDay),
});
export type PlanCheck = z.infer<typeof PlanCheck>;
