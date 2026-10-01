import { z } from 'zod';
import { Brand, IssueDecision, MAX_LINE_UNITS, MAX_ORDER_LINES, RefusalReason, StopOutcome, Temp } from './basics';
import { Load } from './planning';

// The store manager's screens (spec 009): the next order with its draft, placing it, and the lists of orders.

// A day is 'YYYY-MM-DD' and a time of day is 'HH:MM', both in depot time. A moment is an ISO instant ending in
// Z, which the screen shows in depot time.
const Day = z.iso.date();
const TimeOfDay = z.string().regex(/^\d{2}:\d{2}$/);
const Moment = z.iso.datetime();

// split is the original of an order split in two (spec 010): its two parts carry on in its place.
export const ORDER_STATUSES = ['draft', 'placed', 'planned', 'deferred', 'loaded', 'delivered', 'received', 'cancelled', 'split'] as const;
export const OrderStatus = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const DOCK_TYPES = ['street', 'rear_dock', 'mall_bay'] as const;
export const DockType = z.enum(DOCK_TYPES);
export type DockType = z.infer<typeof DockType>;

// The shop as its own screens show it. The window and the entrance come from the shop's record, never from
// the demo data in the design's frames.
export const StoreOutlet = z.object({
  id: z.string(),
  name: z.string(),
  brand: Brand,
  windowOpen: TimeOfDay,
  windowClose: TimeOfDay,
  dockType: DockType,
});
export type StoreOutlet = z.infer<typeof StoreOutlet>;

// An item the shop can order, with the per-unit figures the Style and Tech forms print.
export const StoreProduct = z.object({
  id: z.string(),
  name: z.string(),
  unit: z.string(),
  kgPerUnit: z.number(),
  m3PerUnit: z.number(),
  temp: Temp,
  needsTailLift: z.boolean(),
});
export type StoreProduct = z.infer<typeof StoreProduct>;

// A line to save. A quantity of 0 takes the item out of the draft.
export const OrderLineInput = z.object({ productId: z.string().min(1).max(64), quantity: z.number().int().min(0).max(MAX_LINE_UNITS) });
export type OrderLineInput = z.infer<typeof OrderLineInput>;

// A line as a screen shows it.
export const OrderLine = z.object({ productId: z.string(), name: z.string(), unit: z.string(), quantity: z.number().int() });
export type OrderLine = z.infer<typeof OrderLine>;

// A draft is named by its id and its revision. A draft that was removed and made again has a new id, so an
// old request can never match it.
export const DraftRef = z.object({ id: z.uuid(), revision: z.number().int().min(0) });
export type DraftRef = z.infer<typeof DraftRef>;

// The drafts the screen last saw. A temperature is left out when the screen saw no draft for it.
export const DraftRefs = z.object({ chilled: DraftRef.optional(), dry: DraftRef.optional() });
export type DraftRefs = z.infer<typeof DraftRefs>;

// PUT /store/next-order/draft. It carries the whole draft, so a save replaces what was there.
export const SaveDraftRequest = z.object({
  // The day the screen is showing. The server refuses when that day has closed in the meantime.
  deliveryDate: Day,
  lines: z.array(OrderLineInput).max(MAX_ORDER_LINES),
  driverNote: z.string().trim().max(200),
  refs: DraftRefs,
});
export type SaveDraftRequest = z.infer<typeof SaveDraftRequest>;

// POST /store/next-order/place. It places the drafts it names. Naming drafts that are already placed is the
// safe retry: the answer is those orders and nothing new is made.
export const PlaceOrdersRequest = z.object({ deliveryDate: Day, refs: DraftRefs });
export type PlaceOrdersRequest = z.infer<typeof PlaceOrdersRequest>;

const Count = z.number().int().min(0);

// What happened at an order's latest stop on a sent plan (spec 015, rule 11), once the driver saved it.
export const OrderDelivery = z.object({
  stopId: z.uuid(),
  vehicleId: z.string(),
  // The driver's name, or null when the trip had none.
  driver: z.string().nullable(),
  arrivedAt: Moment,
  doneAt: Moment,
  outcome: StopOutcome,
  // The truck arrived after the shop's window closed, its mall slot as spec 007 times it.
  late: z.boolean(),
  // This order's units handed over, null when nobody was at the shop.
  delivered: Count.nullable(),
  // This order's units the depot sent short (ordered less loaded) and the shop refused at the door (loaded less
  // handed over). A closed stop's are its attempt's, as the driver's day reads them.
  shortFromDepot: Count,
  refused: Count,
  // The driver's reason for a refusal, else null.
  refusalReason: RefusalReason.nullable(),
});
export type OrderDelivery = z.infer<typeof OrderDelivery>;

// The shop's receipt on an order (D-61): when the shop confirmed, when the receipt reached the depot (null for the
// seeded history, which never travelled), the units received and the units short of what was ordered.
export const OrderReceipt = z.object({ at: Moment, sentAt: Moment.nullable(), units: Count, short: Count });
export type OrderReceipt = z.infer<typeof OrderReceipt>;

// A problem at the order's latest stop that counts it: a refusal, a closed shop or the shop's own report, the units it
// counts on this order, the answer (null while open), the day of the replacements an answer placed, and the card's line
// for it, which the server words: the cartons it is about and what happens to them, "3 expired chilled cartons:
// replacements come on Fri 26 Jun" (Q-36).
export const OrderProblem = z.object({
  id: z.uuid(),
  kind: z.enum(['refused', 'closed', 'receipt']),
  units: Count,
  decision: IssueDecision.nullable(),
  replacementDay: Day.nullable(),
  line: z.string(),
});
export type OrderProblem = z.infer<typeof OrderProblem>;

export const StoreOrder = z.object({
  id: z.string(),
  // The day the shop wanted. It never changes, also when the order has to wait.
  deliveryDate: Day,
  // The day of the sent plan the order is on. null until it is planned.
  scheduledDate: Day.nullable(),
  temp: Temp,
  status: OrderStatus,
  lines: z.array(OrderLine),
  units: z.number().int(),
  placedAt: Moment.nullable(),
  // The reason of the latest deferral. Set only on a deferred order.
  deferralReason: z.string().nullable(),
  // What happened at the order's latest stop on a sent plan: null until that stop is done.
  delivery: OrderDelivery.nullable(),
  // null unless the order is received with its counts.
  receipt: OrderReceipt.nullable(),
  // The problems of that stop that count the order, oldest first.
  problems: z.array(OrderProblem),
  // For a replacement, and for either part of one the plan split, the day of the delivery it replaces (D-59). null
  // for an order the shop placed.
  replacementFor: Day.nullable(),
});
export type StoreOrder = z.infer<typeof StoreOrder>;

// GET /store/next-order, and the answer to a save.
export const StoreNextOrder = z.object({
  outlet: StoreOutlet,
  // The active items of the shop's brand, in the product list's order.
  products: z.array(StoreProduct),
  // The day an order placed now is for, and the moment that day closes. Both null when no delivery day is open.
  deliveryDate: Day.nullable(),
  cutoffAt: Moment.nullable(),
  cutoffIsToday: z.boolean(),
  // The closed day the draft was first for. Set until the draft is saved or placed for the open day.
  movedFrom: Day.nullable(),
  draft: z.object({
    lines: z.array(OrderLine),
    driverNote: z.string(),
    refs: DraftRefs,
    savedAt: Moment,
    // From the load calculator (spec 007). The screen shows these numbers and never multiplies.
    summary: Load,
    // The names of the items in the draft that need a tail lift.
    tailLiftItems: z.array(z.string()),
  }).nullable(),
  // Everything already placed for deliveryDate.
  placed: z.object({
    orders: z.array(StoreOrder),
    lines: z.array(OrderLine),
    lastPlacedAt: Moment,
    summary: Load,
  }).nullable(),
});
export type StoreNextOrder = z.infer<typeof StoreNextOrder>;

// The answer to a place: the next order as it is now, and the orders this request placed, or had already
// placed when it is a retry.
export const PlaceOrdersResponse = StoreNextOrder.extend({ placedOrders: z.array(StoreOrder) });
export type PlaceOrdersResponse = z.infer<typeof PlaceOrdersResponse>;

// GET /store/orders?list=today|open|past&cursor=
export const ORDER_LISTS = ['today', 'open', 'past'] as const;
export const OrderListName = z.enum(ORDER_LISTS);
export type OrderListName = z.infer<typeof OrderListName>;

export const StoreOrdersQuery = z.object({ list: OrderListName, cursor: z.string().max(200).optional() });
export type StoreOrdersQuery = z.infer<typeof StoreOrdersQuery>;

export const StoreOrderList = z.object({
  outlet: StoreOutlet,
  // The clock's today at the depot.
  today: Day,
  orders: z.array(StoreOrder),
  // How many open orders the shop has, whichever list was asked for.
  openCount: z.number().int(),
  // Only the past list is paged. null when there is nothing more.
  nextCursor: z.string().nullable(),
});
export type StoreOrderList = z.infer<typeof StoreOrderList>;

// The codes the store endpoints add to the shared error shape, with the status each one travels with.
//   no_outlet         403  The signed-in person has no outlet, which is what an admin gets.
//   unknown_product   400  A line names an item that is not an active item of the shop's brand.
//   cutoff_passed     409  The request names a day that is no longer the open one. details: CutoffPassedDetails.
//   stale             409  A draft is named by an id or a revision that is not the current one, or left out.
//   nothing_to_place  409  The request names no draft and the shop has none.
//   no_delivery_day   409  No later operating day has an open cut-off.
export const STORE_ERROR_CODES = ['no_outlet', 'unknown_product', 'cutoff_passed', 'stale', 'nothing_to_place', 'no_delivery_day'] as const;
export type StoreErrorCode = (typeof STORE_ERROR_CODES)[number];

// What `details` holds on cutoff_passed: the day that is open now and the moment it closes.
export const CutoffPassedDetails = z.object({ deliveryDate: Day, cutoffAt: Moment });
export type CutoffPassedDetails = z.infer<typeof CutoffPassedDetails>;
