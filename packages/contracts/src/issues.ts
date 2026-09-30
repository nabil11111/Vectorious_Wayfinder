import { z } from 'zod';
import { Temp } from './basics';
import { TripStatus } from './plans';

// A problem, whoever raises it (spec 012, D-36): a loader's flag now, a driver's refused delivery (A4) and a shop's
// short receipt (A5) later, each a new kind with its own reasons and answers. The dispatcher decides every one in
// one place. Times are ISO strings from the app clock, and a day is YYYY-MM-DD.

const Day = z.iso.date();
const Moment = z.iso.datetime();

export const ISSUE_KINDS = ['loading', 'refused', 'closed'] as const;
export const IssueKind = z.enum(ISSUE_KINDS);
export type IssueKind = z.infer<typeof IssueKind>;

export const ISSUE_STATUSES = ['open', 'decided'] as const;
export const IssueStatus = z.enum(ISSUE_STATUSES);
export type IssueStatus = z.infer<typeof IssueStatus>;

// What the loader found wrong at the dock.
export const FLAG_REASONS = ['short', 'damaged', 'wrong_item'] as const;
export const FlagReason = z.enum(FLAG_REASONS);
export type FlagReason = z.infer<typeof FlagReason>;

// The dispatcher's two answers to a loader's flag (D-37): the truck leaves with what is at the dock, or the rest
// comes from stock and goes on.
export const LOADING_DECISIONS = ['go_short', 'load_all'] as const;
export const LoadingDecision = z.enum(LOADING_DECISIONS);
export type LoadingDecision = z.infer<typeof LoadingDecision>;

export const REFUSAL_REASONS = ['damaged', 'expired', 'not_ordered'] as const;
export const RefusalReason = z.enum(REFUSAL_REASONS);
export type RefusalReason = z.infer<typeof RefusalReason>;
export const CLOSED_REASONS = ['nobody_there'] as const;
export const ClosedReason = z.enum(CLOSED_REASONS);
export type ClosedReason = z.infer<typeof ClosedReason>;
export const IssueReason = z.enum([...FLAG_REASONS, ...REFUSAL_REASONS, ...CLOSED_REASONS]);
export type IssueReason = z.infer<typeof IssueReason>;
export const REFUSAL_DECISIONS = ['bring_back'] as const;
export const RefusalDecision = z.enum(REFUSAL_DECISIONS);
export const CLOSED_DECISIONS = ['try_again', 'bring_back'] as const;
export const ClosedDecision = z.enum(CLOSED_DECISIONS);
export const IssueDecision = z.enum([...LOADING_DECISIONS, 'bring_back', 'try_again']);
export type IssueDecision = z.infer<typeof IssueDecision>;
export const DECISIONS_BY_KIND: Record<IssueKind, readonly IssueDecision[]> = { loading: LOADING_DECISIONS, refused: REFUSAL_DECISIONS, closed: CLOSED_DECISIONS };

// A line the problem counts. For a loader's flag, counted is the good units at the dock.
export const IssueLine = z.object({
  lineId: z.uuid(),
  orderId: z.uuid(),
  temp: Temp,
  productId: z.string(),
  name: z.string(),
  unit: z.string(),
  quantity: z.number().int().min(1),
  counted: z.number().int().min(0),
  loaded: z.number().int().min(0).nullable(),
  delivered: z.number().int().min(0).nullable(),
});
export type IssueLine = z.infer<typeof IssueLine>;

export const Issue = z.object({
  id: z.uuid(),
  revision: z.number().int().min(0),
  kind: IssueKind,
  reason: IssueReason,
  status: IssueStatus,
  // People are named as the screens show them.
  raisedBy: z.string(),
  raisedAt: Moment,
  note: z.string().nullable(),
  // All three are null while the problem is open.
  decision: IssueDecision.nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: Moment.nullable(),
  // The units the lines are short, worked out by the API.
  hasPhoto: z.boolean(),
  short: z.number().int().min(0),
  trip: z.object({ id: z.uuid(), vehicleId: z.string(), tripNo: z.number().int(), leavesAt: Moment, status: TripStatus, driver: z.string().nullable(), stopsLeft: z.number().int().min(0) }),
  stop: z.object({ id: z.uuid(), seq: z.number().int().min(1), outletId: z.string(), shopName: z.string(), arrivedAt: Moment.nullable(), doneAt: Moment.nullable(), loadedAt: Moment.nullable(), flaggedAtDock: z.boolean() }),
  lines: z.array(IssueLine),
});
export type Issue = z.infer<typeof Issue>;

// What needs the dispatcher: the depot's open problems, oldest first, and the loader's day for the title.
export const IssueList = z.object({ day: Day.nullable(), issues: z.array(Issue) });
export type IssueList = z.infer<typeof IssueList>;

// An answer names the revision of the problem the screen showed.
export const DecideIssueRequest = z.object({ revision: z.number().int().min(0), decision: IssueDecision });
export type DecideIssueRequest = z.infer<typeof DecideIssueRequest>;

// The open list after the answer, and the problem just answered for the screen's green line.
export const DecideIssueResponse = IssueList.extend({ decided: Issue });
export type DecideIssueResponse = z.infer<typeof DecideIssueResponse>;
