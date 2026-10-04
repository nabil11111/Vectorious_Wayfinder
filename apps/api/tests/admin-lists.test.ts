import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AdminOutlet, AdminProduct } from '@wayfinder/contracts';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { auditLog, outlets, products, users } from '../src/db/schema';
import * as live from '../src/lib/live';
import { serve, stop } from './serve';
import { signInAs } from './sign-in';

const app = await serve(createApp());

// Tests share one database, so the rows archived here are put back.
async function resetRows() {
  await db.update(outlets).set({ archivedAt: null }).where(eq(outlets.id, 'OUT050'));
  await db.update(products).set({ archivedAt: null }).where(eq(products.id, 'fresh-dry-carton'));
  await db.delete(auditLog).where(and(eq(auditLog.entity, 'outlet'), eq(auditLog.entityId, 'OUT050')));
  await db.delete(auditLog).where(and(eq(auditLog.entity, 'product'), eq(auditLog.entityId, 'fresh-dry-carton')));
}

beforeAll(resetRows);

afterAll(async () => {
  await resetRows();
  await stop(app);
  await pool.end();
});

const dispatcher = request.agent(app);
const admin = request.agent(app);

describe('GET /api/v1/admin/outlets', () => {
  it('answers 401 when nobody is signed in and 403 for a dispatcher', async () => {
    expect((await request(app).get('/api/v1/admin/outlets')).status).toBe(401);
    expect((await signInAs(dispatcher, 'ruwan')).status).toBe(200);
    expect((await dispatcher.get('/api/v1/admin/outlets')).status).toBe(403);
  });

  it('lists every outlet for the admin, live rows first', async () => {
    expect((await signInAs(admin, 'admin')).status).toBe(200);
    const res = await admin.get('/api/v1/admin/outlets');
    expect(res.status).toBe(200);
    const parsed = AdminOutlet.array().safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toHaveLength(120);
    expect(parsed.data.map((row) => row.id)).toEqual([...parsed.data.map((row) => row.id)].sort());
    expect(parsed.data.find((row) => row.id === 'OUT001')).toEqual({
      id: 'OUT001', name: 'Fresh Nugegoda', brand: 'Fresh', district: 'Colombo', depotId: 'Peliyagoda',
      dockType: 'street', parking: 'van_only', windowOpen: '05:00', windowClose: '07:30', archivedAt: null,
    });
  });
});

describe('POST /api/v1/admin/outlets/:id/archive', () => {
  beforeAll(resetRows);

  it('answers 401 and 403 and leaves the outlet alone', async () => {
    expect((await request(app).post('/api/v1/admin/outlets/OUT050/archive').send({})).status).toBe(401);
    expect((await dispatcher.post('/api/v1/admin/outlets/OUT050/archive').send({})).status).toBe(403);
    const [row] = await db.select({ archivedAt: outlets.archivedAt }).from(outlets).where(eq(outlets.id, 'OUT050'));
    expect(row?.archivedAt).toBeNull();
  });

  it('archives OUT050, lists it last, writes one audit row and tells every open admin screen', async () => {
    const announce = vi.spyOn(live, 'announce');
    const res = await admin.post('/api/v1/admin/outlets/OUT050/archive').send({});
    expect(res.status).toBe(200);
    expect(announce).toHaveBeenCalledWith({ topic: 'admin' });
    announce.mockRestore();
    const parsed = AdminOutlet.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toMatchObject({ id: 'OUT050', archivedAt: expect.any(String) });

    const list = AdminOutlet.array().safeParse((await admin.get('/api/v1/admin/outlets')).body);
    expect(list.success).toBe(true);
    if (!list.success) return;
    expect(list.data.at(-1)).toMatchObject({ id: 'OUT050', archivedAt: expect.any(String) });

    const [adminUser] = await db.select({ id: users.id }).from(users).where(eq(users.username, 'admin'));
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.entity, 'outlet'), eq(auditLog.entityId, 'OUT050')));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: adminUser?.id, action: 'outlet.archived', entity: 'outlet', entityId: 'OUT050',
      before: { archivedAt: null }, after: { archivedAt: expect.any(String) },
    });
  });

  it('refuses a second archive and an unknown outlet', async () => {
    const again = await admin.post('/api/v1/admin/outlets/OUT050/archive').send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_archived');
    const missing = await admin.post('/api/v1/admin/outlets/OUT999/archive').send({});
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('not_found');
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.entity, 'outlet'), eq(auditLog.entityId, 'OUT050')));
    expect(rows).toHaveLength(1);
  });
});

describe('GET /api/v1/admin/products', () => {
  it('answers 401 when nobody is signed in and 403 for a dispatcher', async () => {
    expect((await request(app).get('/api/v1/admin/products')).status).toBe(401);
    expect((await dispatcher.get('/api/v1/admin/products')).status).toBe(403);
  });

  it('lists every product for the admin', async () => {
    const res = await admin.get('/api/v1/admin/products');
    expect(res.status).toBe(200);
    const parsed = AdminProduct.array().safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toHaveLength(10);
    expect(parsed.data.map((row) => row.id)).toEqual([...parsed.data.map((row) => row.id)].sort());
    expect(parsed.data.find((row) => row.id === 'fresh-chilled-carton')).toEqual({
      id: 'fresh-chilled-carton', name: 'Chilled carton', brand: 'Fresh', unit: 'carton',
      kgPerUnit: 6.9, m3PerUnit: 0.037, temp: 'chilled', needsTailLift: false, archivedAt: null,
    });
  });
});

describe('POST /api/v1/admin/products/:id/archive', () => {
  beforeAll(resetRows);

  it('answers 401 and 403 and leaves the product alone', async () => {
    expect((await request(app).post('/api/v1/admin/products/fresh-dry-carton/archive').send({})).status).toBe(401);
    expect((await dispatcher.post('/api/v1/admin/products/fresh-dry-carton/archive').send({})).status).toBe(403);
    const [row] = await db.select({ archivedAt: products.archivedAt }).from(products).where(eq(products.id, 'fresh-dry-carton'));
    expect(row?.archivedAt).toBeNull();
  });

  it('archives the dry carton, lists it last, writes one audit row and tells every open admin screen', async () => {
    const announce = vi.spyOn(live, 'announce');
    const res = await admin.post('/api/v1/admin/products/fresh-dry-carton/archive').send({});
    expect(res.status).toBe(200);
    expect(announce).toHaveBeenCalledWith({ topic: 'admin' });
    announce.mockRestore();
    const parsed = AdminProduct.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toMatchObject({ id: 'fresh-dry-carton', archivedAt: expect.any(String) });

    const list = AdminProduct.array().safeParse((await admin.get('/api/v1/admin/products')).body);
    expect(list.success).toBe(true);
    if (!list.success) return;
    expect(list.data.at(-1)).toMatchObject({ id: 'fresh-dry-carton', archivedAt: expect.any(String) });

    const [adminUser] = await db.select({ id: users.id }).from(users).where(eq(users.username, 'admin'));
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.entity, 'product'), eq(auditLog.entityId, 'fresh-dry-carton')));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: adminUser?.id, action: 'product.archived', entity: 'product', entityId: 'fresh-dry-carton',
      before: { archivedAt: null }, after: { archivedAt: expect.any(String) },
    });
  });

  it('refuses a second archive and an unknown product', async () => {
    const again = await admin.post('/api/v1/admin/products/fresh-dry-carton/archive').send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_archived');
    const missing = await admin.post('/api/v1/admin/products/no-such-product/archive').send({});
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('not_found');
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.entity, 'product'), eq(auditLog.entityId, 'fresh-dry-carton')));
    expect(rows).toHaveLength(1);
  });
});
