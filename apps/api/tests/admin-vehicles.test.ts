import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminVehicle } from '@wayfinder/contracts';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { auditLog, users, vehicles } from '../src/db/schema';
import { serve, stop } from './serve';

const app = await serve(createApp());
const password = process.env.SEED_PASSWORD ?? 'wayfinder-demo';
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'wayfinder-admin';

// Tests share one database, so VEH060 and the audit rows written here are put back.
async function resetVeh060() {
  await db.update(vehicles).set({ archivedAt: null }).where(eq(vehicles.id, 'VEH060'));
  await db.delete(auditLog).where(and(eq(auditLog.entity, 'vehicle'), eq(auditLog.entityId, 'VEH060')));
}

afterAll(async () => {
  await resetVeh060();
  await stop(app);
  await pool.end();
});

// One sign-in per account. The API allows ten sign-ins per 15 minutes.
const dispatcher = request.agent(app);
const admin = request.agent(app);

describe('GET /api/v1/admin/vehicles', () => {
  it('answers 401 when nobody is signed in', async () => {
    const res = await request(app).get('/api/v1/admin/vehicles');
    expect(res.status).toBe(401);
  });

  it('answers 403 for a dispatcher', async () => {
    const signedIn = await dispatcher.post('/api/v1/auth/login').send({ username: 'ruwan', password });
    expect(signedIn.status).toBe(200);
    const res = await dispatcher.get('/api/v1/admin/vehicles');
    expect(res.status).toBe(403);
  });

  it('lists every vehicle for the admin, ordered by id', async () => {
    const signedIn = await admin.post('/api/v1/auth/login').send({ username: 'admin', password: adminPassword });
    expect(signedIn.status).toBe(200);
    const res = await admin.get('/api/v1/admin/vehicles');
    expect(res.status).toBe(200);
    const parsed = AdminVehicle.array().safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toHaveLength(60);
    const ids = parsed.data.map((v) => v.id);
    expect(ids).toEqual([...ids].sort());
    expect(parsed.data.find((v) => v.id === 'VEH001')).toEqual({
      id: 'VEH001',
      type: 'truck',
      temp: 'reefer',
      weightCapKg: 5510,
      volumeCapM3: 26.4,
      weeklyFuelQuotaL: 340,
      depotId: 'Peliyagoda',
      archivedAt: null,
    });
  });
});

describe('POST /api/v1/admin/vehicles/:id/archive', () => {
  beforeAll(resetVeh060);

  it('answers 401 when nobody is signed in', async () => {
    const res = await request(app).post('/api/v1/admin/vehicles/VEH060/archive').send({});
    expect(res.status).toBe(401);
  });

  it('answers 403 for a dispatcher and leaves the vehicle alone', async () => {
    const res = await dispatcher.post('/api/v1/admin/vehicles/VEH060/archive').send({});
    expect(res.status).toBe(403);
    const [row] = await db.select({ archivedAt: vehicles.archivedAt }).from(vehicles).where(eq(vehicles.id, 'VEH060'));
    expect(row?.archivedAt).toBeNull();
  });

  it('archives VEH060 for the admin and lists it last', async () => {
    const res = await admin.post('/api/v1/admin/vehicles/VEH060/archive').send({});
    expect(res.status).toBe(200);
    const parsed = AdminVehicle.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.id).toBe('VEH060');
    expect(parsed.data.archivedAt).toEqual(expect.any(String));

    const list = await admin.get('/api/v1/admin/vehicles');
    expect(list.status).toBe(200);
    const rows = AdminVehicle.array().safeParse(list.body);
    expect(rows.success).toBe(true);
    if (!rows.success) return;
    expect(rows.data).toHaveLength(60);
    expect(rows.data.at(-1)).toMatchObject({ id: 'VEH060', archivedAt: expect.any(String) });
  });

  it('writes one audit row with the vehicle before and after', async () => {
    const [adminUser] = await db.select({ id: users.id }).from(users).where(eq(users.username, 'admin'));
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.entity, 'vehicle'), eq(auditLog.entityId, 'VEH060')));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: adminUser?.id,
      action: 'vehicle.archived',
      entity: 'vehicle',
      entityId: 'VEH060',
      before: { archivedAt: null },
      after: { archivedAt: expect.any(String) },
    });
  });

  it('refuses a second archive and an unknown vehicle', async () => {
    const again = await admin.post('/api/v1/admin/vehicles/VEH060/archive').send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_archived');
    const missing = await admin.post('/api/v1/admin/vehicles/VEH999/archive').send({});
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('not_found');
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.entity, 'vehicle'), eq(auditLog.entityId, 'VEH060')));
    expect(rows).toHaveLength(1);
  });
});
