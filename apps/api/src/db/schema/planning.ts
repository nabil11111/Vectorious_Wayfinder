import { sql } from 'drizzle-orm';
import { boolean, check, date, integer, jsonb, pgTable, primaryKey, smallint, text, time, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { planStatusEnum, tripStatusEnum, stopOutcomeEnum } from './enums';
import { users } from './identity';
import { orders } from './orders';
import { depots, outlets, vehicles } from './reference';

// A plan is one depot's delivery day. Trips hang off it, stops off trips, and each order is either on a stop
// or deferred with a reason. The tables hold the two-trip limit themselves. That an order is on exactly one
// stop or deferred, never both, is checked by the rule checker before a plan is sent (spec 007). A split
// order is two orders, so the rule holds for each part. Talk to the team before reshaping these tables.

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  depotId: text('depot_id').notNull().references(() => depots.id),
  date: date('date').notNull(),
  status: planStatusEnum('status').notNull().default('draft'),
  revision: integer('revision').notNull().default(0),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  // "Draft saved 16:12" is a time people see, so it comes from the app clock (D-18).
  savedAt: timestamp('saved_at', { withTimezone: true }),
  // The checker's setting for this plan (D-09): may one trip carry more than one brand.
  mixBrands: boolean('mix_brands').notNull().default(false),
  // The checker's result when the plan was sent, which the sent plan shows. Empty for a draft, and for plans sent
  // before this column existed, such as the seed's earlier days (spec 010).
  sentCheck: jsonb('sent_check'),
  // The planner's suggestion (spec 014, D-53), read and written whole: when it was built, the draft the build saved,
  // the planner's reason for every order and its decisions. Empty until the plan's first build, and the next build
  // replaces it. Hand edits leave it as built.
  suggestion: jsonb('suggestion'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('plans_depot_date').on(t.depotId, t.date)]);

export const trips = pgTable('trips', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  vehicleId: text('vehicle_id').notNull().references(() => vehicles.id),
  driverId: uuid('driver_id').references(() => users.id),
  // The booklet allows at most two trips per vehicle per day.
  tripNo: smallint('trip_no').notNull(),
  // The leaving time the dispatcher set, or empty for the usual time (D-19).
  departAt: time('depart_at'),
  // Where the trip is in its day. The loader moves it on (A3); once it is loading, its plan can no longer go back
  // to edit (D-33).
  status: tripStatusEnum('status').notNull().default('planned'),
  // Two loaders can work on one truck, so every loader write names the revision it saw (spec 012).
  revision: integer('revision').notNull().default(0),
  // The id, made on the phone, of the last loader write applied to this trip. The same id again is a retry and is
  // answered as done. An older write's retry already fails on the revision, so one id is enough.
  lastWriteId: uuid('last_write_id'),
  // "ready 02:36" is a time people see, so it comes from the app clock (D-18).
  readyAt: timestamp('ready_at', { withTimezone: true }),
  leftAt: timestamp('left_at', { withTimezone: true }),
  backAt: timestamp('back_at', { withTimezone: true }),
  lastEventAt: timestamp('last_event_at', { withTimezone: true }),
}, (t) => [unique('trips_vehicle_trip').on(t.planId, t.vehicleId, t.tripNo), check('trips_trip_no', sql`${t.tripNo} in (1, 2)`)]);

export const stops = pgTable('stops', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  seq: smallint('seq').notNull(),
  outletId: text('outlet_id').notNull().references(() => outlets.id),
  plannedArrival: time('planned_arrival'),
  plannedDepart: time('planned_depart'),
  // When the loader marked the stop loaded, from the app clock. A stop is loaded whole, last stop first (D-35).
  loadedAt: timestamp('loaded_at', { withTimezone: true }),
  revision: integer('revision').notNull().default(0),
  retriedAt: timestamp('retried_at', { withTimezone: true }),
  arrivedAt: timestamp('arrived_at', { withTimezone: true }),
  doneAt: timestamp('done_at', { withTimezone: true }),
  outcome: stopOutcomeEnum('outcome'),
}, (t) => [unique('stops_trip_seq').on(t.tripId, t.seq),
  check('stops_done', sql`(${t.outcome} is null and ${t.doneAt} is null) or (${t.outcome} is not null and ${t.doneAt} is not null and ${t.arrivedAt} is not null)`)]);

export const stopOrders = pgTable('stop_orders', {
  stopId: uuid('stop_id').notNull().references(() => stops.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id').notNull().references(() => orders.id),
}, (t) => [primaryKey({ columns: [t.stopId, t.orderId] })]);

export const deferrals = pgTable('deferrals', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id').notNull().references(() => orders.id),
  // A short machine code for filtering (no_reefer, over_capacity, window) and the plain-words reason people read.
  code: text('code').notNull(),
  reason: text('reason').notNull(),
}, (t) => [unique('deferrals_plan_order').on(t.planId, t.orderId)]);
