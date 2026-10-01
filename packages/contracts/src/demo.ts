import { z } from 'zod';

// The app's clock, the demo day and the live stream (spec 008).

// People always see depot time, whatever the device or the server is set to.
export const DEPOT_TIME_ZONE = 'Asia/Colombo';

// The demo day (D-18): orders close on Wed 24 Jun 2026 for delivery on Thu 25 Jun 2026. The clock starts at
// the first part and waits at the end of each one until someone moves it on (D-25).
export const DEMO_PARTS = ['ordering', 'planning', 'loading', 'on_the_road', 'delivered'] as const;
export const DemoPart = z.enum(DEMO_PARTS);
export type DemoPart = z.infer<typeof DemoPart>;

export const DEMO_DAY = {
  depotId: 'Peliyagoda',
  orderDay: '2026-06-24',
  deliveryDay: '2026-06-25',
  parts: [
    { key: 'ordering', label: 'Orders open', at: '2026-06-24T15:00:00+05:30' },
    { key: 'planning', label: 'Orders closed', at: '2026-06-24T16:00:00+05:30' },
    { key: 'loading', label: 'Loading', at: '2026-06-25T02:30:00+05:30' },
    { key: 'on_the_road', label: 'Trucks leave', at: '2026-06-25T03:30:00+05:30' },
    { key: 'delivered', label: 'Morning deliveries done', at: '2026-06-25T08:30:00+05:30' },
  ],
  // The clock stops here in the last part.
  endsAt: '2026-06-25T23:59:59+05:30',
} as const;

export const ClockState = z.object({
  demo: z.boolean(),
  // An instant, ISO 8601 ending in Z. Screens show it in depot time.
  now: z.string(),
  // null with demo mode off.
  part: DemoPart.nullable(),
  // The instant the clock waits at until someone moves it on.
  holdsAt: z.string().nullable(),
  // null in the last part.
  next: z.object({ part: DemoPart, at: z.string() }).nullable(),
  // Goes up by one on every move and every reset. A move must carry the one it saw.
  revision: z.number().int(),
  // Goes up by one on every reset.
  day: z.number().int(),
});
export type ClockState = z.infer<typeof ClockState>;

export const MoveClockRequest = z.object({ revision: z.number().int().min(0) });
export type MoveClockRequest = z.infer<typeof MoveClockRequest>;

// What the live stream sends: a topic and sometimes one id. Never a record, so the stream can never show a
// person something their role may not read.
export const LiveEvent = z.strictObject({ topic: z.string().min(1).max(40), id: z.string().max(80).optional() });
export type LiveEvent = z.infer<typeof LiveEvent>;

// Sample shop orders from the demo control (spec 028): while orders are open, the dispatcher has 10, 25 or every shop
// of the depot on show that has not ordered place its own order for the open day. When those run out, 10 and 25 go on
// with small top-ups from shops that already ordered.
export const SAMPLE_SHOP_CHOICES = [10, 25, 'all'] as const;
export const SampleOrdersRequest = z.strictObject({ shops: z.union([z.literal(10), z.literal(25), z.literal('all')]) });
export type SampleOrdersRequest = z.infer<typeof SampleOrdersRequest>;

// Before the press: for each depot of the session, its shops and how many may still order.
export const SampleOrdersPreview = z.object({
  // The day the orders would be for, such as '2026-06-25'. null when no delivery day is open.
  deliveryDate: z.string().nullable(),
  depots: z.array(z.object({ depotId: z.string(), shops: z.number().int(), canOrder: z.number().int() })),
});
export type SampleOrdersPreview = z.infer<typeof SampleOrdersPreview>;

// After the press, for each depot: every order placed, those from shops that had not ordered and those shops, the shops
// that added a top-up to an order they had (one order each), the shops that already had an order or a draft, and the
// shops with no store manager or nothing on their list to order.
export const SampleOrdersDepot = z.object({
  depotId: z.string(),
  orders: z.number().int(),
  newOrders: z.number().int(),
  outletIds: z.array(z.string()),
  topUpIds: z.array(z.string()),
  alreadyHad: z.number().int(),
  cannotOrder: z.number().int(),
});
export type SampleOrdersDepot = z.infer<typeof SampleOrdersDepot>;
export const SampleOrdersResult = z.object({ deliveryDate: z.string(), depots: z.array(SampleOrdersDepot) });
export type SampleOrdersResult = z.infer<typeof SampleOrdersResult>;
