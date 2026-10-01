import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { orderStatusEnum, tempEnum } from './enums';
import { users } from './identity';
import { issues } from './issues';
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
  // The shop's receipt, kept on every order it covers (D-61), all three empty until it: when the shop confirmed, as
  // the time rule keeps it, and when the receipt reached the server, both from the app clock (D-18); and for a chilled
  // order whether it arrived cold, empty for a dry one. The seeded history has no time sent: it never travelled.
  receivedAt: timestamp('received_at', { withTimezone: true }),
  receiptSentAt: timestamp('receipt_sent_at', { withTimezone: true }),
  arrivedCold: boolean('arrived_cold'),
  // A replacement points at the problem whose answer placed it (D-59). A part of a split replacement does not: it
  // reaches the problem through its original.
  replacesIssueId: uuid('replaces_issue_id').references((): AnyPgColumn => issues.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // A shop has one draft per temperature at most, whatever two devices do at the same moment.
  uniqueIndex('orders_one_draft').on(t.outletId, t.temp).where(sql`${t.status} = 'draft'`),
  // Every list a shop sees reads its own orders by day.
  index('orders_outlet_date').on(t.outletId, t.deliveryDate),
  // An original's parts are found by it.
  index('orders_split_from').on(t.splitFrom),
  // A problem's replacements are found by it.
  index('orders_replaces').on(t.replacesIssueId),
]);

export const orderLines = pgTable('order_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => products.id),
  quantity: integer('quantity').notNull(),
  // What went on the truck, written when the loader marks it ready (spec 012). Counts follow the goods: the driver
  // and the shop add theirs beside it (A4, A5).
  loadedQty: integer('loaded_qty'),
  deliveredQty: integer('delivered_qty'),
  // What the shop counted on its receipt (spec 015), empty until then.
  receivedQty: integer('received_qty'),
}, (t) => [
  check('order_lines_quantity_positive', sql`${t.quantity} > 0`),
  check('order_lines_delivered_qty', sql`${t.deliveredQty} between 0 and ${t.loadedQty}`),
  check('order_lines_received_qty', sql`${t.receivedQty} between 0 and ${t.deliveredQty}`),
  check('order_lines_loaded_qty', sql`${t.loadedQty} between 0 and ${t.quantity}`),
  // One line per item in an order.
  unique('order_lines_order_product').on(t.orderId, t.productId),
]);
