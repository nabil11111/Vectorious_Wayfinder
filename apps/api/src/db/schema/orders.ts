import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { orderStatusEnum, tempEnum } from './enums';
import { users } from './identity';
import { outlets, products } from './reference';

// One order per temperature: chilled and dry travel on different trucks, which is why the shop's button says
// "Place 2 orders". An order starts as a draft the shop is still filling in, and the depot never sees a draft.
export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  outletId: text('outlet_id').notNull().references(() => outlets.id),
  deliveryDate: date('delivery_date').notNull(),
  temp: tempEnum('temp').notNull(),
  status: orderStatusEnum('status').notNull().default('draft'),
  driverNote: text('driver_note'),
  // created_by started the draft. Someone else at the shop may be the one who places it.
  createdBy: uuid('created_by').references(() => users.id),
  placedBy: uuid('placed_by').references(() => users.id),
  // The two times a person sees, "draft saved 15:02" and when the order was placed, come from the app clock
  // (D-18). created_at and updated_at stay on the real clock.
  savedAt: timestamp('saved_at', { withTimezone: true }),
  placedAt: timestamp('placed_at', { withTimezone: true }),
  revision: integer('revision').notNull().default(0),
  // A part of a split order points at its original, whose status is then split (D-17, spec 010).
  splitFrom: uuid('split_from').references((): AnyPgColumn => orders.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // A shop has one draft per temperature at most, whatever two devices do at the same moment.
  uniqueIndex('orders_one_draft').on(t.outletId, t.temp).where(sql`${t.status} = 'draft'`),
  // Every list a shop sees reads its own orders by day.
  index('orders_outlet_date').on(t.outletId, t.deliveryDate),
  // An original's parts are found by it.
  index('orders_split_from').on(t.splitFrom),
]);

export const orderLines = pgTable('order_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => products.id),
  quantity: integer('quantity').notNull(),
}, (t) => [
  check('order_lines_quantity_positive', sql`${t.quantity} > 0`),
  // One line per item in an order.
  unique('order_lines_order_product').on(t.orderId, t.productId),
]);
