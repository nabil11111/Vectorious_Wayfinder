import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/client';
import { orderLines, orders } from '../src/db/schema';

// A shop and a date no seeded day or other test uses, so this never collides with either.
const outletId = 'OUT120';
const deliveryDate = '2099-01-03';
const draft = (temp: 'chilled' | 'dry') => db.insert(orders).values({ outletId, deliveryDate, temp }).returning();

afterAll(async () => {
  await db.delete(orders).where(and(eq(orders.outletId, outletId), eq(orders.deliveryDate, deliveryDate)));
  await pool.end();
});

describe('order tables', () => {
  it('hold one draft per shop and temperature, and free the place once it is placed', async () => {
    const [chilled] = await draft('chilled');
    await draft('dry');
    await expect(draft('chilled')).rejects.toThrow();

    await db.update(orders).set({ status: 'placed' }).where(eq(orders.id, chilled!.id));
    await draft('chilled');
  });

  it('keep one line per item in an order', async () => {
    const [order] = await db.select().from(orders).where(and(eq(orders.outletId, outletId), eq(orders.temp, 'dry')));
    const line = () => db.insert(orderLines).values({ orderId: order!.id, productId: 'style-shoes', quantity: 4 });
    await line();
    await expect(line()).rejects.toThrow();
  });
});
