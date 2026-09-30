import { z } from 'zod';
import { Brand, Temp } from './basics';
import { DeferralCode, Load, PlanCheck, Problem } from './planning';
import { DockType, OrderLine } from './store';

// The dispatcher's plan board (spec 010): reading a day's board, saving the draft, splitting and joining an order,
// sending the plan and taking it back to edit, and finding a slot. A time of day is minutes after midnight on the
// plan's day, as in PlanCheck. Days are YYYY-MM-DD and moments ISO strings.

const Day = z.iso.date();
const Moment = z.iso.datetime();
const Minutes = z.number().int().min(0).max(1439);

// Where a trip is in its day. The loader moves it on (A3). Once a trip is loading, its plan cannot go back to edit
// (D-33).
export const TRIP_STATUSES = ['planned', 'loading', 'ready', 'out', 'done'] as const;
export const TripStatus = z.enum(TRIP_STATUSES);
export type TripStatus = z.infer<typeof TripStatus>;

export const PARKINGS = ['normal', 'van_only', 'mall_dock'] as const;
export const Parking = z.enum(PARKINGS);
export type Parking = z.infer<typeof Parking>;

// ── The draft, as the screen edits it and a save sends it ──────────────────────────────────────────────────────

export const DraftStop = z.object({ outletId: z.string().min(1).max(16), orderIds: z.array(z.uuid()).min(1).max(10) });
export type DraftStop = z.infer<typeof DraftStop>;

export const DraftTrip = z.object({
  vehicleId: z.string().min(1).max(16),
  tripNo: z.union([z.literal(1), z.literal(2)]),
  // null leaves at the usual time (D-19).
  leaveAt: Minutes.nullable(),
  // The driver account that sees this vehicle's trips, the same on both of them (rule 6).
  driverId: z.uuid().nullable(),
  stops: z.array(DraftStop).max(40),
});
export type DraftTrip = z.infer<typeof DraftTrip>;

export const DraftDeferral = z.object({ orderId: z.uuid(), code: DeferralCode, reason: z.string().trim().min(1).max(200) });
export type DraftDeferral = z.infer<typeof DraftDeferral>;

export const DraftPlan = z.object({
  mixBrands: z.boolean(),
  trips: z.array(DraftTrip).max(76),
  deferrals: z.array(DraftDeferral).max(300),
});
export type DraftPlan = z.infer<typeof DraftPlan>;

// ── Writes: every one names its plan ───────────────────────────────────────────────────────────────────────────

// A saved plan is named by its id and the revision on screen. Before the first save there is no plan, so the write
// carries the demo day (the clock's `day`) the board was read under, and a request from before a reset is refused.
const SavedRef = z.object({ planId: z.uuid(), revision: z.number().int().min(0) });
const NewRef = z.object({ planId: z.null(), demoDay: z.number().int().min(1) });
export const PlanRef = z.union([SavedRef, NewRef]);
export type PlanRef = z.infer<typeof PlanRef>;
const withRef = <T extends z.ZodRawShape>(shape: T) => z.union([SavedRef.extend(shape), NewRef.extend(shape)]);

export const SavePlanRequest = withRef({ plan: DraftPlan });
export type SavePlanRequest = z.infer<typeof SavePlanRequest>;

// keep is the first part's lines. The second part takes the rest of the original (rule 8).
export const SplitOrderRequest = withRef({
  orderId: z.uuid(),
  keep: z.array(z.object({ productId: z.string().min(1).max(64), quantity: z.number().int().min(0).max(999) })).min(1).max(10),
});
export type SplitOrderRequest = z.infer<typeof SplitOrderRequest>;

// orderId is the original's.
export const JoinOrderRequest = withRef({ orderId: z.uuid() });
export type JoinOrderRequest = z.infer<typeof JoinOrderRequest>;

export const SendPlanRequest = PlanRef;
export type SendPlanRequest = z.infer<typeof SendPlanRequest>;
export const UnsendPlanRequest = PlanRef;
export type UnsendPlanRequest = z.infer<typeof UnsendPlanRequest>;

export const SlotQuery = z.object({ orderId: z.uuid() });
export type SlotQuery = z.infer<typeof SlotQuery>;

// ── The board, which every read and every write answers with ──────────────────────────────────────────────────

export const BoardOrder = z.object({
  id: z.uuid(),
  outletId: z.string(),
  temp: Temp,
  // The day the shop wanted.
  deliveryDate: Day,
  lines: z.array(OrderLine),
  load: Load,
  // Left out of an earlier sent plan, so it comes first (rule 7).
  carriedOver: z.boolean(),
  timesDeferred: z.number().int().min(0),
  lastDeferral: z.object({ code: DeferralCode, reason: z.string() }).nullable(),
  // A part of a split order: its original, and the original's units ("split · 60 of 135"). Both null otherwise.
  splitFrom: z.uuid().nullable(),
  originalUnits: z.number().int().min(1).nullable(),
});
export type BoardOrder = z.infer<typeof BoardOrder>;

export const BoardShop = z.object({
  id: z.string(),
  name: z.string(),
  brand: Brand,
  district: z.string(),
  dockType: DockType,
  parking: Parking,
  windowOpen: Minutes,
  windowClose: Minutes,
  mallOpen: Minutes.nullable(),
  mallClose: Minutes.nullable(),
  unloadMin: z.number().int().min(0),
});
export type BoardShop = z.infer<typeof BoardShop>;

export const BoardVehicle = z.object({
  id: z.string(),
  type: z.enum(['truck', 'van']),
  temp: z.enum(['reefer', 'ambient']),
  weightCapKg: z.number(),
  volumeCapM3: z.number(),
  // Not archived and not in the workshop on the plan's day.
  working: z.boolean(),
  offReason: z.string().nullable(),
  litresLeft: z.number(),
  fuelLeftPct: z.number(),
});
export type BoardVehicle = z.infer<typeof BoardVehicle>;

export const BoardDriver = z.object({ id: z.uuid(), name: z.string() });
export type BoardDriver = z.infer<typeof BoardDriver>;

// The chips on each trip: how full it is by weight and volume, and how much of its time budget it uses.
export const TripFigures = z.object({
  vehicleId: z.string(),
  tripNo: z.number().int(),
  kgPct: z.number(),
  m3Pct: z.number(),
  timePct: z.number(),
});
export type TripFigures = z.infer<typeof TripFigures>;

// The header's numbers (rule 12). All come from the server; the screen never adds them up.
export const BoardCounts = z.object({
  vehiclesUsed: z.number().int(),
  vehiclesWorking: z.number().int(),
  trips: z.number().int(),
  ordersDue: z.number().int(),
  ordersOnTrips: z.number().int(),
  ordersDeferred: z.number().int(),
  ordersUnplanned: z.number().int(),
  fuelWeekPct: z.number(),
  fridgeM3Used: z.number(),
  fridgeM3Working: z.number(),
  stops: z.number().int(),
  stopsOnTime: z.number().int(),
  km: z.number(),
  hoursOnRoad: z.number(),
  drivers: z.number().int(),
});
export type BoardCounts = z.infer<typeof BoardCounts>;

export const PlanBoard = z.object({
  depot: z.string(),
  // The clock's `day`, which the first save sends back.
  demoDay: z.number().int().min(1),
  // The day on the board, when its orders close, and whether they are still open. null when no day can be planned.
  day: z.object({ date: Day, cutoffAt: Moment, open: z.boolean() }).nullable(),
  plan: DraftPlan.extend({
    id: z.uuid().nullable(),
    revision: z.number().int().min(0),
    status: z.enum(['draft', 'published']),
    savedAt: Moment.nullable(),
    sentAt: Moment.nullable(),
    // Every trip still planned, so a sent plan can go back to edit (D-33).
    allTripsPlanned: z.boolean(),
  }),
  // Orders the draft named that are no longer the day's, taken out of it (rule 2).
  dropped: z.array(z.uuid()),
  // null for a sent plan whose check was not kept, such as the seed's earlier days.
  check: PlanCheck.nullable(),
  orders: z.array(BoardOrder),
  shops: z.array(BoardShop),
  vehicles: z.array(BoardVehicle),
  drivers: z.array(BoardDriver),
  figures: z.array(TripFigures).nullable(),
  counts: BoardCounts.nullable(),
});
export type PlanBoard = z.infer<typeof PlanBoard>;

// ── Find a slot ─────────────────────────────────────────────────────────────────────────────────────────────────

export const SlotSearch = z.object({
  orderId: z.uuid(),
  revision: z.number().int().min(0),
  slots: z.array(z.object({ vehicleId: z.string(), tripNo: z.number().int(), stopSeq: z.number().int().min(1), newStop: z.boolean(), arriveAt: Minutes })),
  refused: z.array(z.object({ vehicleId: z.string(), tripNo: z.number().int(), problem: Problem })),
});
export type SlotSearch = z.infer<typeof SlotSearch>;

// ── Refusals ────────────────────────────────────────────────────────────────────────────────────────────────────

export const PLAN_ERROR_CODES = [
  'no_depot', 'orders_open', 'no_plan_day', 'day_moved', 'plan_sent', 'stale', 'invalid_input', 'unknown_record',
  'driver_taken', 'cannot_split', 'cannot_join', 'not_ready', 'split_mismatch', 'departed_already', 'loading_started',
] as const;
export type PlanErrorCode = (typeof PLAN_ERROR_CODES)[number];

export const OrdersOpenDetails = z.object({ date: Day, cutoffAt: Moment });
export type OrdersOpenDetails = z.infer<typeof OrdersOpenDetails>;
export const DayMovedDetails = z.object({ date: Day });
export type DayMovedDetails = z.infer<typeof DayMovedDetails>;
export const UnknownRecordDetails = z.object({ id: z.string() });
export type UnknownRecordDetails = z.infer<typeof UnknownRecordDetails>;
export const NotReadyDetails = z.object({ blocks: z.array(Problem) });
export type NotReadyDetails = z.infer<typeof NotReadyDetails>;
export const SplitMismatchDetails = z.object({ orderId: z.uuid() });
export type SplitMismatchDetails = z.infer<typeof SplitMismatchDetails>;
// departed_already and loading_started name the trip.
export const TripDetails = z.object({ vehicleId: z.string(), tripNo: z.number().int() });
export type TripDetails = z.infer<typeof TripDetails>;
