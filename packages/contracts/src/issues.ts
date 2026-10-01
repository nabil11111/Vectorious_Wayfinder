import { z } from 'zod';
import { IssueDecision, IssueKind, IssueReason, IssueStatus, ShortReason, Temp } from './basics';
import { TripStatus } from './plans';

// A problem, whoever raises it (spec 012, D-36): a loader's flag, a driver's refused delivery or closed shop (A4) and a
// shop's report on its receipt (A5), each a kind with its own reasons and answers, whose words are in basics.ts. The
// dispatcher decides every one in one place. Times are ISO strings from the app clock, and a day is YYYY-MM-DD.

const Day = z.iso.date();
const Moment = z.iso.datetime();

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
  // What the shop counted on its receipt (spec 015), null until the shop confirms.
  received: z.number().int().min(0).nullable(),
  // On a shop's report, what the shop said is wrong with this line (Q-40): lineReason reads it, also for a report kept
  // before lines had reasons. null or left out on every other kind.
  reason: ShortReason.nullable().optional(),
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
  // For a shop's report, whether its chilled goods arrived cold, null when no chilled line came; null for every other
  // kind (spec 015).
  cold: z.boolean().nullable(),
  // The orders an answer of "Send N replacements" placed (D-59): the day they are for and their units. null otherwise.
  replacement: z.object({ day: Day, units: z.number().int().min(1) }).nullable(),
  trip: z.object({ id: z.uuid(), vehicleId: z.string(), tripNo: z.number().int(), leavesAt: Moment, status: TripStatus, driver: z.string().nullable(), stopsLeft: z.number().int().min(0) }),
  stop: z.object({ id: z.uuid(), seq: z.number().int().min(1), outletId: z.string(), shopName: z.string(), arrivedAt: Moment.nullable(), doneAt: Moment.nullable(), loadedAt: Moment.nullable(), flaggedAtDock: z.boolean() }),
  lines: z.array(IssueLine),
});
export type Issue = z.infer<typeof Issue>;

// What needs the dispatcher: the depot's open problems, oldest first, the loader's day for the title, and the day a
// replacement placed now would be for (spec 009, rule 2), or null when no delivery day is open.
export const IssueList = z.object({ day: Day.nullable(), replaceOn: Day.nullable(), issues: z.array(Issue) });
export type IssueList = z.infer<typeof IssueList>;

// An answer names the revision of the problem the screen showed.
export const DecideIssueRequest = z.object({ revision: z.number().int().min(0), decision: IssueDecision });
export type DecideIssueRequest = z.infer<typeof DecideIssueRequest>;

// The open list after the answer, and the problem just answered for the screen's green line.
export const DecideIssueResponse = IssueList.extend({ decided: Issue });
export type DecideIssueResponse = z.infer<typeof DecideIssueResponse>;
