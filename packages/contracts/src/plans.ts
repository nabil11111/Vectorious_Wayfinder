import { z } from 'zod';
import { Brand, MAX_STOP_ORDERS, Temp } from './basics';
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

// A stop takes every order of its shop that the plan puts there, so its cap is the plan's own order bound (the 300
// of deferrals below): a guard against absurd input that no real day reaches, and never lower than what Find a slot
// may offer.
export const DraftStop = z.object({ outletId: z.string().min(1).max(16), orderIds: z.array(z.uuid()).min(1).max(MAX_STOP_ORDERS) });
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

// A board answers with its draft in one fixed order: trips by vehicle and trip number, a vehicle's only trip as trip
// 1, each stop's orders and the deferrals by order id, and reasons trimmed. A screen that compares a draft it sent
// with the board's (the save queue after a stale answer) compares them in that order.
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

// Building the suggested plan (spec 014) names the plan on screen as the send does. The first build of a day, with
// no plan yet, names the demo day.
export const SuggestPlanRequest = PlanRef;
export type SuggestPlanRequest = z.infer<typeof SuggestPlanRequest>;

// A decision's key: early_leave:VEH002:1, waited_again:<order id> or late_order:<order id>.
const DecisionKey = z.string().min(1).max(64);

// Accepting the planner's decisions, each named once. 700 is above what a day of 300 orders and 76 trips can give.
export const AcceptDecisionsRequest = withRef({
  keys: z.array(DecisionKey).min(1).max(700).refine((keys) => new Set(keys).size === keys.length, 'Name each decision once.'),
});
export type AcceptDecisionsRequest = z.infer<typeof AcceptDecisionsRequest>;

// ── The suggested plan (spec 014) ────────────────────────────────────────────────────────────────────────────────

// The choices the planner leaves to the dispatcher (spec 011's PlannerDecision kinds): a trip set to leave before its
// usual time to meet a window (D-19), an order that waited before waiting again (D-10), and an order deferred because
// no truck can reach the shop in its window or mall slot (D-11).
export const DECISION_KINDS = ['early_leave', 'waited_again', 'late_order'] as const;
export const DecisionKind = z.enum(DECISION_KINDS);
export type DecisionKind = z.infer<typeof DecisionKind>;

// One order as the planner got it: its rank from 1, the orders it became (itself, or its two parts with the first
// part first) and the planner's reason in its own words.
export const SuggestionChoice = z.object({
  orderId: z.uuid(),
  rank: z.number().int().min(1),
  resultOrderIds: z.array(z.uuid()).min(1).max(2),
  reason: z.string().min(1).max(1000),
});
export type SuggestionChoice = z.infer<typeof SuggestionChoice>;

// One of the planner's decisions, with the planner's reason. orderId is set for waited_again and late_order, and
// vehicleId, tripNo and leaveAt for early_leave; the others are null. acceptedAt is when the dispatcher accepted it.
export const SuggestionDecision = z.object({
  key: DecisionKey,
  kind: DecisionKind,
  reason: z.string().min(1).max(1000),
  orderId: z.uuid().nullable(),
  vehicleId: z.string().min(1).max(16).nullable(),
  tripNo: z.union([z.literal(1), z.literal(2)]).nullable(),
  leaveAt: Minutes.nullable(),
  acceptedAt: Moment.nullable(),
});
export type SuggestionDecision = z.infer<typeof SuggestionDecision>;

// What a plan keeps of its last build (D-53): when it was built, the draft the build saved as the board reads it
// back, which decisions are judged against, the choices in rank order and the decisions in the planner's order.
export const Suggestion = z.object({
  builtAt: Moment,
  plan: DraftPlan,
  choices: z.array(SuggestionChoice).max(300),
  decisions: z.array(SuggestionDecision).max(700),
});
export type Suggestion = z.infer<typeof Suggestion>;

// The suggestion as the board answers it. A decision is open while it is not accepted and the saved draft still holds
// the planner's own choice (spec 014, rule 6). inDraft says whether the draft still holds anything of the suggestion: an
// order on the truck and trip it gave it, or an order it deferred. Once Start over or Undo has taken it all away, the
// board says nothing of the suggestion's decisions (L-18). The saved draft stays on the server.
export const BoardSuggestion = z.object({
  builtAt: Moment,
  choices: z.array(SuggestionChoice).max(300),
  inDraft: z.boolean(),
  // suggested: the draft is still that build. edited: some of it remains. manual: none of it remains.
  provenance: z.enum(['suggested', 'edited', 'manual']).default('manual'),
  decisions: z.array(SuggestionDecision.extend({ open: z.boolean() })).max(700),
});
export type BoardSuggestion = z.infer<typeof BoardSuggestion>;

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
  // The fullest trip of each refrigerated vehicle, added up. fridgeM3Used adds every trip, so a second trip
  // counts the same space again.
  fridgePeakM3: z.number().default(0),
  stops: z.number().int(),
  stopsOnTime: z.number().int(),
  km: z.number(),
  hoursOnRoad: z.number(),
  drivers: z.number().int(),
  // Original orders, so a split does not change how many shops' orders were covered.
  originalDue: z.number().int().default(0),
  originalFull: z.number().int().default(0),
  originalPart: z.number().int().default(0),
  originalDeferred: z.number().int().default(0),
  originalWaiting: z.number().int().default(0),
  // Estimated litres for the trips that were timed. null when a trip cannot be timed.
  planFuelL: z.number().nullable().default(null),
  vehicleHours: z.number().nullable().default(null),
  waitHours: z.number().nullable().default(null),
});
export type BoardCounts = z.infer<typeof BoardCounts>;

export const PlanBoard = z.object({
  depot: z.string(),
  // The clock's `day`, which the first save sends back.
  demoDay: z.number().int().min(1),
  // The day on the board and when its orders close. open is true once they have closed, so the board can be planned
  // (spec 010, rule 1). null when no day can be planned.
  day: z.object({ date: Day, cutoffAt: Moment, open: z.boolean() }).nullable(),
  plan: DraftPlan.extend({
    id: z.uuid().nullable(),
    revision: z.number().int().min(0),
    status: z.enum(['draft', 'published']),
    savedAt: Moment.nullable(),
    sentAt: Moment.nullable(),
    // The plan is sent, every trip is still planned and its day is still the board's, so it can go back to edit
    // (D-33). The server works it out; the screen shows "Back to edit" only then.
    canUnsend: z.boolean(),
    // Why a sent plan cannot go back to edit, in the server's words, which View plan shows where Back to edit was
    // (Q-19): "Loading has started, so this plan cannot go back to edit." null for a draft or while it can.
    lockedReason: z.string().nullable(),
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
  // The plan's suggested plan, or null when it was never built (spec 014).
  suggestion: BoardSuggestion.nullable(),
});
export type PlanBoard = z.infer<typeof PlanBoard>;

// ── Find a slot ─────────────────────────────────────────────────────────────────────────────────────────────────

export const SlotSearch = z.object({
  orderId: z.uuid(),
  revision: z.number().int().min(0),
  slots: z.array(z.object({
    vehicleId: z.string(), tripNo: z.number().int(), stopSeq: z.number().int().min(1), newStop: z.boolean(), arriveAt: Minutes,
    // How this place was chosen, and the extra litres and minutes against the trip as it stands.
    basis: z.string().default(''),
    fuelL: z.number().nullable().default(null),
    addedMin: z.number().int().nullable().default(null),
  })),
  refused: z.array(z.object({ vehicleId: z.string(), tripNo: z.number().int(), problem: Problem })),
});
export type SlotSearch = z.infer<typeof SlotSearch>;

// ── Crews (spec 026) ────────────────────────────────────────────────────────────────────────────────────────────────

// The crew picker's read names the orders a trip is started or moved with, by id with commas between, and "" for none:
// at most the 300 orders a day can have.
export const CrewQuery = z.object({
  orders: z.string().max(300 * 37).transform((list) => (list === '' ? [] : list.split(','))).pipe(z.array(z.uuid()).max(300)),
});
export type CrewQuery = z.infer<typeof CrewQuery>;

// Why a truck may not take the orders, by the checker's cargo rules (spec 007): more weight or volume than it takes, a
// chilled order and no fridge, or a shop that takes vans only; or, for a truck on its first trip already, that it is
// ready again only after every window of the orders closes (L-04); or that its trip would reach a shop of the orders
// after the shop's window closes, by the checker's timeline (L-17). The order or shop it is about, as the checker's
// problem names it, or null; and for arrives_late, the minutes after the window it arrives, as the checker counts them.
export const CREW_MISFITS = ['over_weight', 'over_volume', 'needs_reefer', 'van_only', 'ready_late', 'arrives_late', 'fuel_over_quota'] as const;
const HARD_MISFITS = new Set<string>(['over_weight', 'over_volume', 'needs_reefer', 'van_only', 'ready_late', 'fuel_over_quota']);

// What a crew can do with the orders it was read for. A fixable late arrival is attention, not a ban.
export function readinessOf(crew: {
  misfits: { code: string }[];
  advisories?: string[];
  driverId: string | null;
  unavailable: unknown;
  leaveAt?: number | null;
}, allocating: boolean): 'ready' | 'attention' | 'cannot' {
  if (crew.unavailable) return 'cannot';
  const late = crew.misfits.some((misfit) => misfit.code === 'arrives_late');
  const hard = crew.misfits.some((misfit) => HARD_MISFITS.has(misfit.code));
  if (hard || (late && crew.leaveAt == null)) return 'cannot';
  if (allocating && (crew.driverId === null || (crew.advisories?.length ?? 0) > 0 || late)) return 'attention';
  return 'ready';
}
export const CrewMisfit = z.object({ code: z.enum(CREW_MISFITS), orderId: z.uuid().nullable(), outletId: z.string().nullable(), lateMin: z.number().int().min(0).optional() });
export type CrewMisfit = z.infer<typeof CrewMisfit>;

// A truck of the depot with its driver (D-100): the one the draft gives it, or else its usual driver, who drove it on the
// depot's latest sent plan or, with none there, the one a fixed pairing of the drivers in staff ID order with the
// trucks in id order gives it, while he drives no other truck on the draft. A driver is on one crew only, and a truck in
// the workshop names none (L-05). null when it has none.
export const Crew = z.object({
  vehicleId: z.string(),
  driverId: z.uuid().nullable(),
  type: z.enum(['truck', 'van']),
  temp: z.enum(['reefer', 'ambient']),
  weightCapKg: z.number(),
  volumeCapM3: z.number(),
  fuelLeftPct: z.number(),
  // When a truck on its first trip already is ready again for a second, by the checker's times; null for a truck with no
  // trip yet, which leaves at the usual time.
  readyAt: Minutes.nullable(),
  // The districts it ran on the depot's latest sent plan, and whether one of them is a district of the orders.
  lastDistricts: z.array(z.string()),
  ranHere: z.boolean(),
  // It takes the orders by weight, volume, fridge, access and fuel, and can reach every shop on time. A time that a
  // checked departure would fix stays selectable. The checker still judges the saved trip.
  fits: z.boolean(),
  misfits: z.array(CrewMisfit),
  readiness: z.enum(['ready', 'attention', 'cannot']).default('ready'),
  // One sentence for the card, then the checker's own warnings. leaveAt is a departure that would meet the windows.
  why: z.string().default(''),
  advisories: z.array(z.string()).default([]),
  leaveAt: Minutes.nullable().default(null),
  tripFuelL: z.number().nullable().default(null),
  quotaLeftL: z.number().nullable().default(null),
  // Why it cannot be picked: in the workshop on the day, for the workshop's reason, or on two trips already. null when it can.
  unavailable: z.discriminatedUnion('kind', [z.object({ kind: z.literal('workshop'), reason: z.string() }), z.object({ kind: z.literal('two_trips') })]).nullable(),
});
export type Crew = z.infer<typeof Crew>;

// Every crew of the depot for the orders, in the picker's order: those that fit first, then those that ran the orders'
// district on the latest sent plan, then the most fuel left, and the ones that cannot be picked last. load is what the
// orders weigh and take up, by the checker's load maths, and revision the draft's the crews were read from.
export const CrewList = z.object({
  orderIds: z.array(z.uuid()),
  revision: z.number().int().min(0),
  load: z.object({ kg: z.number(), m3: z.number() }),
  // The date of the published plan the districts come from, or null when this depot has none.
  historyDate: z.string().nullable().default(null),
  crews: z.array(Crew),
});
export type CrewList = z.infer<typeof CrewList>;

// ── A checked arrangement for the orders the dispatcher selected ───────────────────────────────────────────────

const KeepLine = z.object({ productId: z.string(), quantity: z.number().int().min(0) });
export const ArrangeRequest = withRef({ orderIds: z.array(z.uuid()).min(1).max(300) });
export type ArrangeRequest = z.infer<typeof ArrangeRequest>;
export const ApplyArrangeRequest = withRef({ orderIds: z.array(z.uuid()).min(1).max(300), fingerprint: z.string().min(1).max(20000) });
export type ApplyArrangeRequest = z.infer<typeof ApplyArrangeRequest>;

export const ArrangementCrew = z.object({
  vehicleId: z.string(),
  driverId: z.uuid().nullable(),
  tripNo: z.number().int().min(1).max(2),
  newTrip: z.boolean(),
  orderIds: z.array(z.uuid()),
  shops: z.array(z.string()),
  kg: z.number(),
  m3: z.number(),
  weightCapKg: z.number(),
  volumeCapM3: z.number(),
  refrigerated: z.boolean(),
  leaveAt: z.number().int().nullable(),
  backAt: z.number().int().nullable(),
  fuelL: z.number().nullable(),
  quotaLeftL: z.number().nullable(),
  why: z.string(),
});
export type ArrangementCrew = z.infer<typeof ArrangementCrew>;

export const Arrangement = z.object({
  revision: z.number().int().min(0),
  orderIds: z.array(z.uuid()),
  fingerprint: z.string(),
  summary: z.string(),
  singleVehicle: z.boolean(),
  crews: z.array(ArrangementCrew),
  waiting: z.array(z.object({ orderId: z.uuid(), shop: z.string(), reason: z.string() })),
  splits: z.array(z.object({
    orderId: z.uuid(),
    keep: z.array(KeepLine),
    keptOrderId: z.string(),
    remainderOrderId: z.string(),
    remainderWaiting: z.boolean(),
  })),
});
export type Arrangement = z.infer<typeof Arrangement>;

// ── Your plan beside a suggestion for the same demand ──────────────────────────────────────────────────────────

export const PlanOutcome = z.object({
  originalDue: z.number().int(),
  originalFull: z.number().int(),
  originalPart: z.number().int(),
  originalDeferred: z.number().int(),
  originalWaiting: z.number().int(),
  vehicles: z.number().int(),
  trips: z.number().int(),
  stops: z.number().int(),
  stopsOnTime: z.number().int(),
  fuelL: z.number().nullable(),
  km: z.number().nullable(),
  vehicleHours: z.number().nullable(),
  blockers: z.number().int(),
  warnings: z.number().int(),
  driversMissing: z.number().int(),
});
export type PlanOutcome = z.infer<typeof PlanOutcome>;

export const PlanComparison = z.object({
  revision: z.number().int().min(0),
  demandKey: z.string(),
  fingerprint: z.string(),
  summary: z.string(),
  fuelDeltaL: z.number().nullable(),
  current: PlanOutcome,
  suggested: PlanOutcome.nullable(),
  changes: z.array(z.object({ shop: z.string(), detail: z.string() })).max(40),
  canApply: z.boolean(),
  unavailable: z.string().nullable(),
});
export type PlanComparison = z.infer<typeof PlanComparison>;
export const ApplyCompareRequest = withRef({ demandKey: z.string().min(1).max(200000), fingerprint: z.string().min(1).max(200000) });
export type ApplyCompareRequest = z.infer<typeof ApplyCompareRequest>;

// ── Refusals ────────────────────────────────────────────────────────────────────────────────────────────────────

export const PLAN_ERROR_CODES = [
  'no_depot', 'orders_open', 'no_plan_day', 'day_moved', 'plan_sent', 'stale', 'invalid_input', 'unknown_record',
  'driver_taken', 'cannot_split', 'cannot_join', 'not_ready', 'split_mismatch', 'departed_already', 'loading_started',
  'planner_unavailable', 'decisions_open', 'driver_required',
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
// planner_unavailable: the planner's blocks, empty when the day has more orders than the planner plans (spec 014).
export const PlannerUnavailableDetails = z.object({ blocks: z.array(Problem) });
export type PlannerUnavailableDetails = z.infer<typeof PlannerUnavailableDetails>;
// decisions_open: the keys of the planner's decisions still open.
export const DecisionsOpenDetails = z.object({ keys: z.array(DecisionKey) });
export type DecisionsOpenDetails = z.infer<typeof DecisionsOpenDetails>;
