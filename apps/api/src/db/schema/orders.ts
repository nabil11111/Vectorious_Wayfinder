import { sql } from 'drizzle-orm';
import { check, date, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { orderStatusEnum, tempEnum } from './enums';
import { users } from './identity';
import { outlets, products } from './reference';

// One order per temperature: chilled and dry travel on different trucks, which is why the shop's button says
// "Place 2 orders".
export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  outletId: text('outlet_id').notNull().references(() => outlets.id),
  deliveryDate: date('delivery_date').notNull(),
  temp: tempEnum('temp').notNull(),
  status: orderStatusEnum('status').notNull().default('draft'),
  driverNote: text('driver_note'),
  createdBy: uuid('created_by').references(() => users.id),
  placedAt: timestamp('placed_at', { withTimezone: true }),
  revision: integer('revision').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orderLines = pgTable('order_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => products.id),
  quantity: integer('quantity').notNull(),
}, (t) => [check('order_lines_quantity_positive', sql`${t.quantity} > 0`)]);
