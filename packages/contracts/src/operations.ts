import { z } from 'zod';
import { Brand, Temp } from './basics';
import { DriverStop, DriverTrip, StopOutcome } from './driver';
import { IssueDecision, IssueKind } from './issues';
import { TripStatus } from './plans';

// Spec 016: one read supplies both dispatcher pages. Values are recorded facts, not presence or predictions.
const Count = z.number().int().min(0);
const Moment = z.iso.datetime();
const Day = z.iso.date();
const Shop = z.object({ id: z.string(), name: z.string() });
export const OperationsProgress = z.object({ numerator: Count.nullable(), denominator: Count, percent: z.number().nullable() });
export type OperationsProgress = z.infer<typeof OperationsProgress>;
export const OperationsQuantities = z.object({
  ordered: Count, loaded: Count.nullable(), delivered: Count, refused: Count, notDelivered: Count,
  short: Count.nullable(), onTruck: Count,
});
export type OperationsQuantities = z.infer<typeof OperationsQuantities>;
const ByTemp = z.object({ chilled: OperationsQuantities, dry: OperationsQuantities });
export const OperationsStopFigures = OperationsQuantities.extend({
  stopId: z.uuid(), seq: Count,
  byLine: z.array(OperationsQuantities.extend({ lineId: z.uuid(), temp: Temp })), byTemp: ByTemp,
});
export const OperationsFigures = OperationsQuantities.extend({
  stops: Count, stopsDone: Count, byStop: z.array(OperationsStopFigures), byTemp: ByTemp, next: DriverStop.nullable(),
});
export type OperationsFigures = z.infer<typeof OperationsFigures>;
export const TripAttention = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('departure_unreported'), plannedAt: Moment }),
  z.object({ kind: z.literal('arrival_unreported'), stopId: z.uuid(), plannedAt: Moment }),
  z.object({ kind: z.literal('retry_requested'), stopId: z.uuid(), requestedAt: Moment }),
]);
export type TripAttention = z.infer<typeof TripAttention>;
export const OperationsStatus = z.discriminatedUnion('kind', [
  TripAttention.options[1], TripAttention.options[2], TripAttention.options[3],
  z.object({ kind: z.literal('open_problem'), issueId: z.uuid(), issueKind: IssueKind, summary: z.string(), raisedAt: Moment }),
  z.object({ kind: z.literal('at_stop'), stopId: z.uuid(), shopName: z.string(), arrivedAt: Moment }),
  z.object({ kind: z.literal('returning') }), z.object({ kind: z.literal('back'), backAt: Moment }),
  z.object({ kind: z.enum(['planned', 'loading', 'ready', 'out', 'unrecorded']) }),
]);
export type OperationsStatus = z.infer<typeof OperationsStatus>;
export const OutTripRow = z.object({
  progress: OperationsProgress, nextStop: z.object({ id: z.uuid(), outletId: z.string(), shopName: z.string() }).nullable(),
  plannedArrival: Moment.nullable(), arrivalIsOriginal: z.boolean(), plannedReturn: Moment.nullable(), status: OperationsStatus,
});
export const TripSchedule = z.object({ leavesAt: Moment, backAt: Moment });
export const StopDetail = z.object({
  id: z.uuid(), seq: Count, outletId: z.string(), shopName: z.string(), plannedArrival: Moment, plannedDeparture: Moment,
  windowOpen: Moment, windowClose: Moment, loadedAt: Moment.nullable(), arrivedAt: Moment.nullable(), doneAt: Moment.nullable(),
  outcome: StopOutcome.nullable(), arrivedAfterWindow: z.boolean().nullable(), figures: OperationsStopFigures, issueIds: z.array(z.uuid()),
});
export type StopDetail = z.infer<typeof StopDetail>;
const TripBase = z.object({
  tripId: z.uuid(), planId: z.uuid(), date: Day, vehicleId: z.string(), vehicleType: z.enum(['truck', 'van']), vehicleTemp: z.enum(['reefer', 'ambient']),
  tripNo: Count, driver: z.object({ id: z.uuid(), name: z.string() }).nullable(), brand: Brand.nullable(), district: z.string(), status: TripStatus,
  openIssueIds: z.array(z.uuid()), stopsTotal: Count, action: z.enum(['decide', 'decided', 'open']), outRow: OutTripRow.nullable(),
});
export const OperationsTrip = z.discriminatedUnion('detailRecorded', [
  TripBase.extend({ detailRecorded: z.literal(true), trip: DriverTrip, figures: OperationsFigures,
    onSoFar: z.object({ units: Count, kg: z.number(), m3: z.number() }).nullable(), lastReportAt: Moment.nullable(),
    attention: TripAttention, schedule: TripSchedule, stopDetails: z.array(StopDetail) }),
  TripBase.extend({ detailRecorded: z.literal(false), reason: z.literal('legacy_plan'),
    stops: z.array(z.object({ id: z.uuid(), seq: Count, outletId: z.string(), shopName: z.string() })) }),
]);
export type OperationsTrip = z.infer<typeof OperationsTrip>;
export const OperationsBrandTotal = z.object({
  brand: Brand.nullable(), tripsTotal: Count, vehiclesTotal: Count, stopsTotal: Count, stopsDone: Count.nullable(), progress: OperationsProgress,
});
export type OperationsBrandTotal = z.infer<typeof OperationsBrandTotal>;
export const OperationsGroup = OperationsBrandTotal.omit({ progress: true }).extend({ district: z.string(), trips: z.array(OperationsTrip) });
export type OperationsGroup = z.infer<typeof OperationsGroup>;
export const OperationsCounts = z.object({
  stopsTotal: Count, stopsDelivered: Count.nullable(), stopsDone: Count.nullable(), partialStops: Count.nullable(), noGoodsStops: Count.nullable(), closedStops: Count.nullable(),
  tripsTotal: Count, vehiclesOut: Count, vehiclesTotal: Count, deferredOrders: Count, deliveryProgress: OperationsProgress, truckProgress: OperationsProgress,
});
export type OperationsCounts = z.infer<typeof OperationsCounts>;
export const OperationsTimeline = z.object({ start: Moment, end: Moment, ticks: z.array(Moment), now: Moment.nullable() });
export type OperationsTimeline = z.infer<typeof OperationsTimeline>;
export const NextRun = z.object({ date: Day, cutoffAt: Moment, orders: Count });
export const OperationsFuel = z.object({ isoYear: Count, isoWeek: Count, litres: z.number(), quotaLitres: z.number(), percent: z.number().nullable() });
export const OPERATIONS_EVENT_KINDS = ['plan_sent', 'stop_loaded', 'truck_ready', 'left', 'arrived', 'back', 'delivered', 'problem_raised', 'answer_sent'] as const;
export const OperationsEvent = z.object({
  key: z.string(), kind: z.enum(OPERATIONS_EVENT_KINDS), at: Moment, planId: z.uuid(), planRevision: Count,
  tripId: z.uuid().nullable(), stopId: z.uuid().nullable(), issueId: z.uuid().nullable(),
  vehicleId: z.string().nullable(), shop: Shop.nullable(), actor: z.string().nullable(),
  issueKind: IssueKind.nullable(), decision: IssueDecision.nullable(), hasPhoto: z.boolean(),
  lines: z.array(z.object({ lineId: z.uuid(), orderId: z.uuid(), productId: z.string(), name: z.string(), unit: z.string(), temp: Temp,
    quantity: Count, loaded: Count.nullable(), delivered: Count.nullable(), counted: Count.nullable() })),
});
export type OperationsEvent = z.infer<typeof OperationsEvent>;
const Section = z.object({ date: Day, brandTotals: z.array(OperationsBrandTotal), groups: z.array(OperationsGroup), timeline: OperationsTimeline });
export const OperationsDay = z.object({
  depot: z.object({ id: z.string(), name: z.string() }), demoDay: z.number().int().min(1), day: Day.nullable(), dayChangesAt: Moment.nullable(), readAt: Moment,
  plan: z.object({ id: z.uuid(), revision: Count, publishedAt: Moment, detailRecorded: z.boolean() }).nullable(), counts: OperationsCounts,
  nextRun: NextRun.nullable(), fuel: OperationsFuel.nullable(), brandTotals: z.array(OperationsBrandTotal), groups: z.array(OperationsGroup),
  timeline: OperationsTimeline.nullable(), earlierOut: z.array(Section), outTripIds: z.array(z.uuid()), events: z.array(OperationsEvent), eventsTruncated: z.boolean(),
});
export type OperationsDay = z.infer<typeof OperationsDay>;
