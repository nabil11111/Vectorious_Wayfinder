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
