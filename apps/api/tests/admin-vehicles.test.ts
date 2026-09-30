import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { AdminVehicle } from '@wayfinder/contracts';
import { createApp } from '../src/app';
import { pool } from '../src/db/client';
import { serve, stop } from './serve';

const app = await serve(createApp());
const password = process.env.SEED_PASSWORD ?? 'wayfinder-demo';
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'wayfinder-admin';
afterAll(async () => {
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
