import { z } from 'zod';
import { Brand, ClosedReason, IssueDecision, Temp } from './basics';
import { DriverLine } from './driver';
import { Issue, IssueLine } from './issues';
import { Load, DeferralCode } from './planning';
import { TripStatus } from './plans';
import { ReceiptReport } from './receipt';
import { OrderStatus } from './store';

// Spec 017: complete, depot-scoped reads. The browser filters these rows and opens their inline detail.
// All dates are calendar dates, including leap-day validation. Unknown/repeated query keys are refused.
const Day = z.iso.date(), Moment = z.iso.datetime(), Count = z.number().int().min(0);
export const LookupOrdersQuery = z.strictObject({ date: Day.optional(), range: z.enum(['day', 'four_weeks']).default('day') });
export type LookupOrdersQuery = z.infer<typeof LookupOrdersQuery>;
export const LookupHistoryQuery = z.strictObject({ date: Day.optional() });
export type LookupHistoryQuery = z.infer<typeof LookupHistoryQuery>;
export const LookupFleetQuery = z.strictObject({});
export const LookupProofParams = z.strictObject({ stopId: z.uuid() });
export const LookupScope = z.object({ depot: z.object({ id: z.string(), name: z.string() }), readAt: Moment, demoDay: Count.nullable() });
export type LookupScope = z.infer<typeof LookupScope>;
export const LookupShop = z.object({ id: z.string(), name: z.string(), brand: Brand, district: z.string(),
  windowOpen: z.string(), windowClose: z.string(), mallWindow: z.string().nullable() });
export const LookupPublication = z.object({ id: z.uuid(), date: Day, revision: Count, publishedAt: Moment });
export type LookupPublication = z.infer<typeof LookupPublication>;
const Reason = z.object({ code: DeferralCode, reason: z.string() });
export const LookupDeferral = Reason.extend({ planId: z.uuid(), date: Day, orderId: z.uuid(), outlet: LookupShop, temp: Temp, units: Count });
export type LookupDeferral = z.infer<typeof LookupDeferral>;
const OrderedLine = z.object({ lineId: z.uuid(), productId: z.string(), name: z.string(), unit: z.string(), quantity: Count });
export const LookupOrderDetail = z.object({ id: z.uuid(), wantedDate: Day, placedAt: Moment.nullable(), temp: Temp, status: OrderStatus,
  lines: z.array(OrderedLine), note: z.string().nullable(), load: Load });
export const LookupOrderDay = z.object({ date: Day, carriedOver: z.boolean(), publication: LookupPublication.nullable(),
  assignment: z.object({ tripId: z.uuid(), vehicleId: z.string(), tripNo: Count, stopId: z.uuid(), seq: Count, plannedArrival: Moment }).nullable(),
  deferral: Reason.nullable() });
export const LookupOrderRow = LookupOrderDetail.extend({ outlet: LookupShop, splitFrom: z.uuid().nullable(),
  original: LookupOrderDetail.nullable(), parts: z.array(LookupOrderDetail), days: z.array(LookupOrderDay),
  deferralHistory: z.array(Reason.extend({ planId: z.uuid(), date: Day })), timesDeferred: Count });
export type LookupOrderRow = z.infer<typeof LookupOrderRow>;
export const LookupOrders = LookupScope.extend({ date: Day.nullable(), from: Day.nullable(), range: LookupOrdersQuery.shape.range,
  summary: z.object({ orders: Count, planned: Count, deferred: Count, carriedOver: Count, split: Count }).nullable(),
  rows: z.array(LookupOrderRow), skippedLately: z.object({ from: Day, to: Day, rows: z.array(z.object({
    outlet: LookupShop.pick({ id: true, name: true, brand: true }), count: Count, latestDate: Day, reasons: z.array(Reason),
  })) }).nullable() });
export type LookupOrders = z.infer<typeof LookupOrders>;

// Photo metadata resolves only these fixed authorized GETs: proof -> /lookup/stops/:stopId/photo;
// issue -> /issues/:issueId/photo. No image bytes or public URL rides with a page read.
export const LookupPhoto = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('proof'), stopId: z.uuid(), takenAt: Moment }),
  z.object({ kind: z.literal('issue'), issueId: z.uuid(), takenAt: Moment }),
]);
export type LookupPhoto = z.infer<typeof LookupPhoto>;
// Coverage is in lines: an incomplete measure is null; a genuinely empty set is zero with 0/0 coverage.
export const HistoryMeasure = z.object({ units: Count.nullable(), known: Count, total: Count });
export type HistoryMeasure = z.infer<typeof HistoryMeasure>;
export const HistoryStages = z.object({ ordered: Count, loaded: HistoryMeasure, handedOver: HistoryMeasure, received: HistoryMeasure,
  depotShort: HistoryMeasure, refused: HistoryMeasure, receiptShort: HistoryMeasure, notDelivered: HistoryMeasure });
export type HistoryStages = z.infer<typeof HistoryStages>;
export const HistoryLine = DriverLine.extend({ received: Count.nullable(), depotShort: Count.nullable(), refused: Count.nullable(),
  receiptShort: Count.nullable(), notDelivered: Count.nullable() });
export type HistoryLine = z.infer<typeof HistoryLine>;
// Dropping Issue.trip/stop prevents an earlier closed issue acquiring the stop's newer mutable times.
export const HistoryProblem = Issue.omit({ trip: true, stop: true }).extend({ stopId: z.uuid(), photo: LookupPhoto.nullable() });
export type HistoryProblem = z.infer<typeof HistoryProblem>;
export const HistoryClosedAttempt = z.object({ issueId: z.uuid(), raisedAt: Moment, raisedBy: z.string(), reason: ClosedReason,
  note: z.string().nullable(), lines: z.array(IssueLine.pick({ lineId: true, orderId: true, temp: true, productId: true, name: true, unit: true, counted: true })),
  notDelivered: Count, photo: LookupPhoto.nullable(), decision: IssueDecision.nullable(), decidedBy: z.string().nullable(), decidedAt: Moment.nullable() });
export type HistoryClosedAttempt = z.infer<typeof HistoryClosedAttempt>;
// Spec 015 keeps one receipt on all of a stop's orders; stopId is its identity, not a new receipt record.
export const HistoryReceipt = z.object({ stopId: z.uuid(), confirmedAt: Moment, sentAt: Moment.nullable(), cold: z.boolean().nullable(),
  orderCount: Count, lines: z.array(z.object({ lineId: z.uuid(), orderId: z.uuid(), received: Count })), received: Count, short: Count,
  report: ReceiptReport.extend({ photo: LookupPhoto.nullable() }).nullable() });
export type HistoryReceipt = z.infer<typeof HistoryReceipt>;
export const HistoryFlags = z.object({ late: z.boolean().nullable(), short: z.boolean(), returned: z.boolean() });
export const HistoryStop = z.object({ id: z.uuid(), seq: Count, outlet: LookupShop, orderIds: z.array(z.uuid()),
  plannedArrival: Moment, plannedDeparture: Moment, windowOpen: Moment, windowClose: Moment,
  loadedAt: Moment.nullable(), arrivedAt: Moment.nullable(), doneAt: Moment.nullable(), outcome: z.enum(['delivered', 'refused', 'closed']).nullable(),
  lines: z.array(HistoryLine), stages: HistoryStages, flags: HistoryFlags, receipt: HistoryReceipt.nullable(),
  proof: LookupPhoto.nullable(), problems: z.array(HistoryProblem), attempts: z.array(HistoryClosedAttempt) });
export type HistoryStop = z.infer<typeof HistoryStop>;
export const HistoryCounts = z.object({ trips: Count, stops: Count, orders: Count, delivered: Count, finished: Count, partial: Count,
  late: Count, short: Count, returned: Count, deferred: Count, confirmations: Count, receivedOrders: Count, stages: HistoryStages });
export type HistoryCounts = z.infer<typeof HistoryCounts>;
export const HistoryTrip = z.object({ tripId: z.uuid(), planId: z.uuid(), date: Day, vehicleId: z.string(), vehicleType: z.enum(['truck', 'van']),
  vehicleTemp: z.enum(['reefer', 'ambient']), archived: z.boolean(), tripNo: Count, driver: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  brand: Brand.nullable(), brands: z.array(Brand), district: z.string(), status: TripStatus,
  schedule: z.object({ leavesAt: Moment, backAt: Moment, load: Load, km: z.number() }),
  readyAt: Moment.nullable(), leftAt: Moment.nullable(), backAt: Moment.nullable(), stops: z.array(HistoryStop),
  flags: HistoryFlags, stages: HistoryStages });
export type HistoryTrip = z.infer<typeof HistoryTrip>;
export const LookupHistory = LookupScope.extend({ date: Day.nullable(), publishedDates: z.array(Day), publication: LookupPublication.nullable(),
  counts: HistoryCounts.nullable(), groups: z.array(z.object({ brand: Brand.nullable(), district: z.string(), tripIds: z.array(z.uuid()) })),
  trips: z.array(HistoryTrip), deferrals: z.array(LookupDeferral) });
export type LookupHistory = z.infer<typeof LookupHistory>;

export const LookupTripRef = z.object({ tripId: z.uuid(), planId: z.uuid(), date: Day, vehicleId: z.string(), tripNo: Count, status: TripStatus,
  driver: z.object({ id: z.uuid(), name: z.string() }).nullable(), leavesAt: Moment, plannedReturn: Moment, km: z.number(),
  readyAt: Moment.nullable(), leftAt: Moment.nullable(), backAt: Moment.nullable() });
export type LookupTripRef = z.infer<typeof LookupTripRef>;
export const LookupFuel = z.object({ isoYear: Count, isoWeek: Count, recordedCommitted: z.number(), quota: z.number(), remaining: z.number(),
  recordedCommittedPct: z.number().nullable(), remainingPct: z.number().nullable(), sentTrips: Count, plannedKm: z.number(),
  days: z.array(z.object({ date: Day, dow: z.number().int().min(0).max(5), litres: z.number() })) });
export type LookupFuel = z.infer<typeof LookupFuel>;
export const LookupVehicle = z.object({ id: z.string(), type: z.enum(['truck', 'van']), temp: z.enum(['reefer', 'ambient']),
  group: z.enum(['reefer_trucks', 'dry_trucks', 'vans']), weightCapKg: z.number(), volumeCapM3: z.number(), fuelType: z.string(),
  kmPerL: z.number(), weeklyFuelQuotaL: z.number(), archivedAt: Moment.nullable(), offReason: z.string().nullable(), recordedOut: z.boolean(),
  selectedTrip: LookupTripRef.nullable(), outTrips: z.array(LookupTripRef), todayTrips: z.array(LookupTripRef), recentTrips: z.array(LookupTripRef),
  fuel: LookupFuel.nullable() });
export type LookupVehicle = z.infer<typeof LookupVehicle>;
export const LookupFleet = LookupScope.extend({ today: Day, summary: z.object({ active: Count, reefers: Count, vans: Count,
  recordedOut: Count, notRecordedOut: Count, activeOffToday: Count, activeWithoutOffToday: Count, fuel: LookupFuel.nullable() }),
  vehicles: z.array(LookupVehicle) });
export type LookupFleet = z.infer<typeof LookupFleet>;
