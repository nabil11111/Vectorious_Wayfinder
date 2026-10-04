import { verify } from '@node-rs/argon2';
import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { AdminOutlet, AdminProduct, AdminUser, AdminVehicle } from '@wayfinder/contracts';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { auditLog, outlets, products, users, vehicles } from '../src/db/schema';
import { serve, stop } from './serve';
import { signInAs } from './sign-in';

const app = await serve(createApp());
const dispatcher = request.agent(app);
const admin = request.agent(app);

const USER = { staffId: 'T-901', displayName: 'Trial Admin', role: 'loader' as const, depotId: 'Peliyagoda', outletId: null, pin: '4321' };
const OUTLET = {
  id: 'OUT901', name: 'Fresh Trial', brand: 'Fresh' as const, district: 'Colombo', depotId: 'Peliyagoda',
  dockType: 'street' as const, parking: 'normal' as const, windowOpen: '06:00', windowClose: '08:00',
};
const PRODUCT = {
  id: 'trial-crate', name: 'Trial crate', brand: 'Tech' as const, unit: 'crate', kgPerUnit: 12, m3PerUnit: 0.2,
  temp: 'dry' as const, needsTailLift: true,
};
const VEHICLE = { id: 'VEH901', type: 'van' as const, temp: 'ambient' as const, weightCapKg: 1200, volumeCapM3: 6, fuelType: 'diesel', kmPerL: 10, weeklyFuelQuotaL: 80, depotId: 'Kandy' };

async function cleanup() {
  const made = await db.select({ id: users.id }).from(users).where(eq(users.staffId, USER.staffId));
  const ids = made.map((row) => row.id);
  if (ids.length) await db.delete(users).where(inArray(users.id, ids));
  await db.delete(outlets).where(eq(outlets.id, OUTLET.id));
  await db.delete(products).where(eq(products.id, PRODUCT.id));
  await db.delete(vehicles).where(eq(vehicles.id, VEHICLE.id));
  await db.delete(auditLog).where(inArray(auditLog.entityId, [OUTLET.id, PRODUCT.id, VEHICLE.id, ...ids]));
}

afterAll(async () => {
  await cleanup();
  await stop(app);
  await pool.end();
});

describe('admin create and edit', () => {
  it('answers 401 and 403', async () => {
    expect((await request(app).post('/api/v1/admin/users').send(USER)).status).toBe(401);
    expect((await signInAs(dispatcher, 'ruwan')).status).toBe(200);
    expect((await dispatcher.post('/api/v1/admin/outlets').send(OUTLET)).status).toBe(403);
  });

  it('creates an account, then edits it, and refuses a duplicate staff ID', async () => {
    expect((await signInAs(admin, 'admin')).status).toBe(200);
    const created = await admin.post('/api/v1/admin/users').send(USER);
    expect(created.status).toBe(201);
    const user = AdminUser.parse(created.body);
    expect(user).toMatchObject({ staffId: 'T-901', displayName: 'Trial Admin', role: 'loader', depotId: 'Peliyagoda', outletId: null, active: true });
    const [stored] = await db.select({ pinHash: users.pinHash }).from(users).where(eq(users.id, user.id));
    expect(stored?.pinHash).toEqual(expect.any(String));
    expect(await verify(stored!.pinHash!, USER.pin)).toBe(true);

    const edited = await admin.patch(`/api/v1/admin/users/${user.id}`).send({ ...USER, displayName: 'Trial Loader', active: false, pin: '9876' });
    expect(edited.status).toBe(200);
    expect(AdminUser.parse(edited.body)).toMatchObject({ displayName: 'Trial Loader', active: false });
    const [again] = await db.select({ pinHash: users.pinHash }).from(users).where(eq(users.id, user.id));
    expect(await verify(again!.pinHash!, '9876')).toBe(true);

    const list = AdminUser.array().parse((await admin.get('/api/v1/admin/users')).body);
    const index = list.findIndex((row) => row.id === user.id);
    expect(list[index]).toMatchObject({ active: false });
    expect(list.slice(0, index).every((row) => row.active)).toBe(true);
    expect((await admin.post('/api/v1/admin/users').send(USER)).status).toBe(409);

    const me = list.find((row) => row.staffId === 'A-001');
    const own = await admin.patch(`/api/v1/admin/users/${me!.id}`).send({ staffId: 'A-001', displayName: me!.displayName, role: 'loader', depotId: 'Peliyagoda', outletId: null, active: true });
    expect(own.status).toBe(409);
    expect(own.body.error.code).toBe('own_account');
  });

  it('creates and edits an outlet, a product and a vehicle', async () => {
    const outlet = await admin.post('/api/v1/admin/outlets').send(OUTLET);
    expect(outlet.status).toBe(201);
    expect(AdminOutlet.parse(outlet.body).name).toBe('Fresh Trial');
    const renamed = await admin.patch('/api/v1/admin/outlets/OUT901').send({ ...OUTLET, name: 'Fresh Trial Shop' });
    expect(renamed.status).toBe(200);
    expect(AdminOutlet.parse(renamed.body).name).toBe('Fresh Trial Shop');
    expect((await admin.post('/api/v1/admin/outlets').send({ ...OUTLET, windowClose: '05:00' })).status).toBe(400);

    const product = await admin.post('/api/v1/admin/products').send(PRODUCT);
    expect(product.status).toBe(201);
    expect(AdminProduct.parse(product.body)).toMatchObject({ id: 'trial-crate', needsTailLift: true, kgPerUnit: 12 });
    const heavier = await admin.patch('/api/v1/admin/products/trial-crate').send({ ...PRODUCT, kgPerUnit: 13 });
    expect(AdminProduct.parse(heavier.body).kgPerUnit).toBe(13);

    const vehicle = await admin.post('/api/v1/admin/vehicles').send(VEHICLE);
    expect(vehicle.status).toBe(201);
    expect(AdminVehicle.parse(vehicle.body)).toMatchObject({ id: 'VEH901', depotId: 'Kandy', volumeCapM3: 6 });
    const moved = await admin.patch('/api/v1/admin/vehicles/VEH901').send({ ...VEHICLE, depotId: 'Peliyagoda' });
    expect(AdminVehicle.parse(moved.body).depotId).toBe('Peliyagoda');
  });
});
