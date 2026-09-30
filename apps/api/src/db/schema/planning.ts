import { sql } from 'drizzle-orm';
import { check, date, integer, pgTable, primaryKey, smallint, text, time, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { planStatusEnum } from './enums';
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
  departAt: time('depart_at'),
}, (t) => [unique('trips_vehicle_trip').on(t.planId, t.vehicleId, t.tripNo), check('trips_trip_no', sql`${t.tripNo} in (1, 2)`)]);

export const stops = pgTable('stops', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  seq: smallint('seq').notNull(),
  outletId: text('outlet_id').notNull().references(() => outlets.id),
  plannedArrival: time('planned_arrival'),
  plannedDepart: time('planned_depart'),
}, (t) => [unique('stops_trip_seq').on(t.tripId, t.seq)]);

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
