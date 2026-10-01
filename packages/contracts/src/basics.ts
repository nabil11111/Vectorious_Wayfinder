import { z } from 'zod';

// The words every piece shares. They sit in their own file so the other contract files can use them: a file
// that index.ts passes on cannot import from index.ts, which has not run yet when that file loads.

export const ROLES = ['store_manager', 'dispatcher', 'loader', 'driver', 'admin'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const BRANDS = ['Fresh', 'Style', 'Tech'] as const;
export const Brand = z.enum(BRANDS);
export type Brand = z.infer<typeof Brand>;

export const TEMPS = ['chilled', 'dry'] as const;
export const Temp = z.enum(TEMPS);
export type Temp = z.infer<typeof Temp>;

// The most orders a stop can hold and lines an order can hold: the bounds of a plan's stop (spec 010) and of a
// shop's draft (spec 009), named once so a receipt for a whole stop (spec 015) cannot drift from them.
export const MAX_STOP_ORDERS = 300;
export const MAX_ORDER_LINES = 20;
// The most units one line can hold: what a shop orders on a line (spec 009) and what a receipt counts on one (spec
// 015). A replacement never makes a line beyond it, so the shop can always confirm what it is sent (D-59).
export const MAX_LINE_UNITS = 999;

// How a stop ended (spec 013): the driver handed it over, the shop refused some, or nobody was at the shop.
export const STOP_OUTCOMES = ['delivered', 'refused', 'closed'] as const;
export const StopOutcome = z.enum(STOP_OUTCOMES);
export type StopOutcome = z.infer<typeof StopOutcome>;

// A write a phone saved first (D-45, D-57) is sent with the id of the account that saved it, in this header. The server
// refuses it under any other session with other_account, and the phone then keeps it waiting for that account to sign
// in again, as after a 401, so one account's saved write never goes out as another's.
export const PHONE_ACCOUNT_HEADER = 'X-Wayfinder-Account';
export const PHONE_WRITE_ERROR_CODES = ['other_account'] as const;
export type PhoneWriteErrorCode = (typeof PHONE_WRITE_ERROR_CODES)[number];

// A photo a phone took, as it rides inside a write (D-47): a data URL of a JPEG, at most 700,000 characters, which a
// 500 KB picture fits. The server checks the JPEG itself.
export const PhotoDataUrl = z.string().max(700_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/);

// ── Problems (spec 012, D-36) ──────────────────────────────────────────────────────────────────────────────────
// A problem is one record whoever raises it: a loader's flag, a driver's refused delivery or closed shop (spec 013),
// and a shop's report on its receipt (spec 015), each a kind with its own reasons and answers. The dispatcher decides
// every one in one place. The shop's cards read them too, so the words sit here.

export const ISSUE_KINDS = ['loading', 'refused', 'closed', 'receipt'] as const;
export const IssueKind = z.enum(ISSUE_KINDS);
export type IssueKind = z.infer<typeof IssueKind>;

export const ISSUE_STATUSES = ['open', 'decided'] as const;
export const IssueStatus = z.enum(ISSUE_STATUSES);
export type IssueStatus = z.infer<typeof IssueStatus>;

// What the loader found wrong at the dock. wont_fit is a truck that cannot take all of a line (Q-20): its count is what
// fits, and it gets the same two answers as a short line.
export const FLAG_REASONS = ['short', 'damaged', 'wrong_item', 'wont_fit'] as const;
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
// A shop's report (D-58, D-60): what the shop said was wrong with the cartons that are short, or not_cold when nothing
// is short and the chilled goods arrived warm.
export const RECEIPT_REASONS = ['missing', 'damaged', 'not_cold'] as const;
export const ReceiptReason = z.enum(RECEIPT_REASONS);
export type ReceiptReason = z.infer<typeof ReceiptReason>;
// The two the shop picks from on its receipt, "What's wrong?".
export const SHORT_REASONS = ['missing', 'damaged'] as const;
export const ShortReason = z.enum(SHORT_REASONS);
export type ShortReason = z.infer<typeof ShortReason>;
export const IssueReason = z.enum([...FLAG_REASONS, ...REFUSAL_REASONS, ...CLOSED_REASONS, ...RECEIPT_REASONS]);
export type IssueReason = z.infer<typeof IssueReason>;

// A refusal's answers (D-48, D-59): the driver brings the cartons back, and beside that the shop may get replacements
// on the next run.
export const REFUSAL_DECISIONS = ['bring_back', 'send_replacements'] as const;
export const RefusalDecision = z.enum(REFUSAL_DECISIONS);
export type RefusalDecision = z.infer<typeof RefusalDecision>;
export const CLOSED_DECISIONS = ['try_again', 'bring_back'] as const;
export const ClosedDecision = z.enum(CLOSED_DECISIONS);
export type ClosedDecision = z.infer<typeof ClosedDecision>;
// A shop's report is answered once (D-58): replacements on the next run, or none.
export const RECEIPT_DECISIONS = ['send_replacements', 'no_replacement'] as const;
export const ReceiptDecision = z.enum(RECEIPT_DECISIONS);
export type ReceiptDecision = z.infer<typeof ReceiptDecision>;
export const IssueDecision = z.enum([...LOADING_DECISIONS, 'bring_back', 'try_again', 'send_replacements', 'no_replacement']);
export type IssueDecision = z.infer<typeof IssueDecision>;
export const DECISIONS_BY_KIND: Record<IssueKind, readonly IssueDecision[]> = {
  loading: LOADING_DECISIONS, refused: REFUSAL_DECISIONS, closed: CLOSED_DECISIONS, receipt: RECEIPT_DECISIONS,
};
