import { z } from 'zod';
import { Brand, FlagReason, LoadingDecision, Temp } from './basics';
import { Issue } from './issues';

// The loader's day (spec 012): the day's sent trucks, each loaded last stop first, its flags, and the truck marked
// ready. Every count, kilo and cubic metre is worked out by the API; the screen formats them. Times are ISO
// strings from the app clock, and a day is YYYY-MM-DD.

const Day = z.iso.date();
const Moment = z.iso.datetime();

// A line of an order on the truck, and how many of it go out (rule 5): its quantity, the flag's count while the
// flag is open or after "Go short", and its quantity again after "Load it all".
export const LoadingLine = z.object({
  lineId: z.uuid(),
  orderId: z.uuid(),
  temp: Temp,
  productId: z.string(),
  name: z.string(),
  unit: z.string(),
  quantity: z.number().int().min(1),
  going: z.number().int().min(0),
  short: z.number().int().min(0),
});
export type LoadingLine = z.infer<typeof LoadingLine>;

// A stop and its lines: chilled before dry, then the order placed first, then the product list's order.
export const LoadingStop = z.object({
  id: z.uuid(),
  seq: z.number().int().min(1),
  outletId: z.string(),
  shopName: z.string(),
  loaded: z.boolean(),
  units: z.number().int().min(0),
  going: z.number().int().min(0),
  short: z.number().int().min(0),
  lines: z.array(LoadingLine),
});
export type LoadingStop = z.infer<typeof LoadingStop>;

export const LoadingIssue = Issue.extend({ kind: z.literal('loading'), reason: FlagReason, decision: LoadingDecision.nullable() });
export type LoadingIssue = z.infer<typeof LoadingIssue>;

export const LoadingTruck = z.object({
  tripId: z.uuid(),
  // Every loader write names the revision it saw (rule 10).
  revision: z.number().int().min(0),
  vehicleId: z.string(),
  vehicleType: z.enum(['truck', 'van']),
  vehicleTemp: z.enum(['reefer', 'ambient']),
  tripNo: z.number().int(),
  // null when the trip mixes brands.
  brand: Brand.nullable(),
  district: z.string(),
  status: z.enum(['planned', 'loading', 'ready']),
  leavesAt: Moment,
  readyAt: Moment.nullable(),
  driver: z.string().nullable(),
  weightCapKg: z.number(),
  volumeCapM3: z.number(),
  units: z.number().int().min(0),
  // What is on the truck so far: the loaded stops' lines at their counts going out.
  on: z.object({ units: z.number().int().min(0), kg: z.number(), m3: z.number() }),
  short: z.number().int().min(0),
  // Last stop first, the order the loader loads them.
  stops: z.array(LoadingStop),
  // The open ones first, then the answered ones, latest first.
  issues: z.array(LoadingIssue),
  // The vehicle's earlier trip it is still out on, and when that trip is due back, or null while the vehicle is at the
  // depot (Q-26). Its goods are put ready on the dock meanwhile (rule 2).
  outOn: z.object({ tripNo: z.number().int().min(1), backBy: Moment }).nullable(),
});
export type LoadingTruck = z.infer<typeof LoadingTruck>;

// A truck of the day's sent plan that has left the dock: its driver started the trip, so it is off the list of trucks
// to load, on the road or back (Q-34). A page open on it says so, where a truck the plan took away is not on the day.
export const LeftTruck = z.object({
  tripId: z.uuid(),
  vehicleId: z.string(),
  tripNo: z.number().int().min(1),
  // The driver's name, or null for a trip with none.
  driver: z.string().nullable(),
  // When the driver started the trip, or null for a trip that left before the app kept the time.
  leftAt: Moment.nullable(),
});
export type LeftTruck = z.infer<typeof LeftTruck>;

export const LoadingDay = z.object({
  depot: z.string(),
  demoDay: z.number().int().min(1),
  // The loader's day (D-34), or null when no operating day is left.
  day: Day.nullable(),
  // The day's sent plan, which a start names. null when the day has none, or while it is back in edit.
  plan: z.object({ id: z.uuid(), revision: z.number().int().min(0), publishedAt: Moment, publishedBy: z.string().nullable() }).nullable(),
  // In leaving order, then by vehicle and trip number (rule 2).
  trucks: z.array(LoadingTruck),
  // The sent plan's trucks that have left, in the order they left, then by vehicle and trip number (Q-34).
  left: z.array(LeftTruck),
});
export type LoadingDay = z.infer<typeof LoadingDay>;

// ── Writes: each carries an id made on the phone and the trip's revision ───────────────────────────────────────

// The same writeId again is a retry, answered with the day as it is (rule 10).
const LoaderWrite = z.object({ writeId: z.uuid(), revision: z.number().int().min(0) });

export const StartLoadingRequest = LoaderWrite.extend({ plan: z.object({ id: z.uuid(), revision: z.number().int().min(0) }) });
export type StartLoadingRequest = z.infer<typeof StartLoadingRequest>;

export const StopLoadedRequest = LoaderWrite.extend({ stopId: z.uuid() });
export type StopLoadedRequest = z.infer<typeof StopLoadedRequest>;

export const RaiseFlagRequest = LoaderWrite.extend({
  stopId: z.uuid(),
  reason: FlagReason,
  lines: z.array(z.object({ lineId: z.uuid(), counted: z.number().int().min(0).max(999) })).min(1).max(20)
    .refine((lines) => new Set(lines.map((line) => line.lineId)).size === lines.length, 'Name each line once.'),
  note: z.string().trim().max(200),
});
export type RaiseFlagRequest = z.infer<typeof RaiseFlagRequest>;

export const MarkReadyRequest = LoaderWrite;
export type MarkReadyRequest = z.infer<typeof MarkReadyRequest>;

// ── Refusals, beside spec 010's codes used again (no_depot, unknown_record, day_moved, no_plan_day, stale) ────────

export const LOADING_ERROR_CODES = ['plan_changed', 'not_loading', 'load_order', 'already_flagged', 'stops_left', 'flag_open'] as const;
export type LoadingErrorCode = (typeof LOADING_ERROR_CODES)[number];

// not_loading names the trip with spec 010's TripDetails.
export const LoadOrderDetails = z.object({ stopSeq: z.number().int().min(1) });
export type LoadOrderDetails = z.infer<typeof LoadOrderDetails>;
export const AlreadyFlaggedDetails = z.object({ lineId: z.uuid() });
export type AlreadyFlaggedDetails = z.infer<typeof AlreadyFlaggedDetails>;
export const StopsLeftDetails = z.object({ stopSeqs: z.array(z.number().int().min(1)) });
export type StopsLeftDetails = z.infer<typeof StopsLeftDetails>;
export const FlagOpenDetails = z.object({ issueIds: z.array(z.uuid()) });
export type FlagOpenDetails = z.infer<typeof FlagOpenDetails>;
