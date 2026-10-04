import { hash } from '@node-rs/argon2';
import type { Router } from 'express';
import { asc, eq, sql } from 'drizzle-orm';
import {
  AdminOutletUpdate, AdminOutletWrite, AdminProductUpdate, AdminProductWrite, AdminUserCreate, AdminUserUpdate,
  AdminVehicleUpdate, AdminVehicleWrite,
  type AdminOutlet, type AdminProduct, type AdminUser, type AdminVehicle, type Role,
} from '@wayfinder/contracts';
import { db } from '../db/client';
import { auditLog, depots, outlets, products, users, vehicles } from '../db/schema';
import { HttpError } from '../lib/errors';
import { announce } from '../lib/live';

const clock = (value: string) => value.slice(0, 5);
const hhmmss = (value: string) => (value.length === 5 ? `${value}:00` : value);

function dbCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  if ('code' in error && typeof error.code === 'string') return error.code;
  if ('cause' in error) return dbCode((error as { cause: unknown }).cause);
  return null;
}

function parse<T>(result: { success: true; data: T } | { success: false }): T {
  if (!result.success) throw new HttpError(400, 'invalid_input', 'Check the form and try again.');
  return result.data;
}

function actorId(req: { user?: { id: string } }): string {
  const id = req.user?.id;
  if (!id) throw new HttpError(401, 'signed_out', 'Please sign in.');
  return id;
}

async function recorded(action: string, entity: string, entityId: string, by: string, before: unknown, after: unknown) {
  await db.insert(auditLog).values({ actorId: by, action, entity, entityId, before, after });
  announce({ topic: 'admin' });
}

function saved(error: unknown, taken: string): never {
  const code = dbCode(error);
  if (code === '23505') throw new HttpError(409, 'already_exists', taken);
  if (code === '23503') throw new HttpError(400, 'invalid_input', 'That depot or outlet is not in the list.');
  throw error;
}

async function requireDepot(id: string) {
  const [row] = await db.select({ id: depots.id }).from(depots).where(eq(depots.id, id));
  if (!row) throw new HttpError(400, 'invalid_input', 'No depot with that id.');
}

async function place(role: Role, depotId: string | null, outletId: string | null) {
  if (role === 'admin') {
    if (depotId || outletId) throw new HttpError(400, 'invalid_input', 'An admin account has no depot or outlet.');
    return { depotId: null, outletId: null };
  }
  if (role === 'store_manager') {
    if (!outletId) throw new HttpError(400, 'invalid_input', 'A shop account needs an outlet.');
    const [shop] = await db.select({ id: outlets.id, depotId: outlets.depotId }).from(outlets).where(eq(outlets.id, outletId));
    if (!shop) throw new HttpError(400, 'invalid_input', 'No outlet with that id.');
    return { depotId: shop.depotId, outletId: shop.id };
  }
  if (!depotId) throw new HttpError(400, 'invalid_input', 'That account needs a depot.');
  if (outletId) throw new HttpError(400, 'invalid_input', 'Only a shop account has an outlet.');
  await requireDepot(depotId);
  return { depotId, outletId: null };
}

const userColumns = {
  id: users.id, staffId: users.staffId, displayName: users.displayName, role: users.role,
  depotId: users.depotId, outletId: users.outletId, active: users.active,
};

type UserRow = { id: string; staffId: string | null; displayName: string; role: Role; depotId: string | null; outletId: string | null; active: boolean };

function toUser(row: UserRow): AdminUser {
  return { id: row.id, staffId: row.staffId ?? '', displayName: row.displayName, role: row.role, depotId: row.depotId, outletId: row.outletId, active: row.active };
}

function usernameOf(name: string, staffId: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'user';
  return `${base}-${staffId.toLowerCase()}`;
}

const outletColumns = {
  id: outlets.id, name: outlets.name, brand: outlets.brand, district: outlets.district, depotId: outlets.depotId,
  dockType: outlets.dockType, parking: outlets.parking, windowOpen: outlets.windowOpen, windowClose: outlets.windowClose, archivedAt: outlets.archivedAt,
};

function toOutlet(row: {
  id: string; name: string; brand: AdminOutlet['brand']; district: string; depotId: string;
  dockType: AdminOutlet['dockType']; parking: AdminOutlet['parking']; windowOpen: string; windowClose: string; archivedAt: Date | null;
}): AdminOutlet {
  return { ...row, windowOpen: clock(row.windowOpen), windowClose: clock(row.windowClose), archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null };
}

const productColumns = {
  id: products.id, name: products.name, brand: products.brand, unit: products.unit, kgPerUnit: products.kgPerUnit,
  m3PerUnit: products.m3PerUnit, temp: products.temp, needsTailLift: products.needsTailLift, archivedAt: products.archivedAt,
};

function toProduct(row: {
  id: string; name: string; brand: AdminProduct['brand']; unit: string; kgPerUnit: string; m3PerUnit: string;
  temp: AdminProduct['temp']; needsTailLift: boolean; archivedAt: Date | null;
}): AdminProduct {
  return { ...row, kgPerUnit: Number(row.kgPerUnit), m3PerUnit: Number(row.m3PerUnit), archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null };
}

const vehicleColumns = {
  id: vehicles.id, type: vehicles.type, temp: vehicles.temp, weightCapKg: vehicles.weightCapKg,
  volumeCapM3: vehicles.volumeCapM3, fuelType: vehicles.fuelType, kmPerL: vehicles.kmPerL,
  weeklyFuelQuotaL: vehicles.weeklyFuelQuotaL, depotId: vehicles.depotId, archivedAt: vehicles.archivedAt,
};

function toVehicle(row: {
  id: string; type: AdminVehicle['type']; temp: AdminVehicle['temp']; weightCapKg: number; volumeCapM3: string;
  fuelType: string; kmPerL: string; weeklyFuelQuotaL: number; depotId: string; archivedAt: Date | null;
}): AdminVehicle {
  return { ...row, volumeCapM3: Number(row.volumeCapM3), kmPerL: Number(row.kmPerL), archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null };
}

export function adminRecordRoutes(router: Router) {
  router.get('/users', async (_req, res) => {
    const rows = await db.select(userColumns).from(users).orderBy(asc(sql`(${users.active} = false)`), asc(users.staffId));
    res.json(rows.map(toUser));
  });

  router.post('/users', async (req, res) => {
    const by = actorId(req);
    const body = parse(AdminUserCreate.safeParse(req.body));
    const home = await place(body.role, body.depotId, body.outletId);
    let row: UserRow | undefined;
    try {
      [row] = await db.insert(users).values({
        username: usernameOf(body.displayName, body.staffId),
        displayName: body.displayName,
        role: body.role,
        staffId: body.staffId,
        pinHash: await hash(body.pin),
        ...home,
      }).returning(userColumns);
    } catch (error) { saved(error, 'That staff ID is already in use.'); }
    if (!row) throw new HttpError(500, 'failed', 'The account was not saved.');
    const after = toUser(row);
    await recorded('user.created', 'user', after.id, by, null, after);
    res.status(201).json(after);
  });

  router.patch('/users/:id', async (req, res) => {
    const by = actorId(req);
    const id = req.params.id;
    if (!id) throw new HttpError(401, 'signed_out', 'Please sign in.');
    const body = parse(AdminUserUpdate.safeParse(req.body));
    const [existing] = await db.select(userColumns).from(users).where(eq(users.id, id));
    if (!existing) throw new HttpError(404, 'not_found', 'No account with that id.');
    if (id === by && (!body.active || body.role !== 'admin')) {
      throw new HttpError(409, 'own_account', 'You cannot take admin off your own account.');
    }
    const home = await place(body.role, body.depotId, body.outletId);
    let row: UserRow | undefined;
    try {
      const pin = body.pin ? { pinHash: await hash(body.pin), failedPins: 0, lockedUntil: null } : {};
      [row] = await db.update(users).set({
        displayName: body.displayName, role: body.role, staffId: body.staffId, active: body.active, ...pin, ...home,
      }).where(eq(users.id, id)).returning(userColumns);
    } catch (error) { saved(error, 'That staff ID is already in use.'); }
    if (!row) throw new HttpError(404, 'not_found', 'No account with that id.');
    const before = toUser(existing);
    const after = toUser(row);
    await recorded('user.updated', 'user', id, by, before, after);
    res.json(after);
  });

  router.post('/outlets', async (req, res) => {
    const by = actorId(req);
    const body = parse(AdminOutletWrite.safeParse(req.body));
    await requireDepot(body.depotId);
    try {
      const [row] = await db.insert(outlets).values({ ...body, windowOpen: hhmmss(body.windowOpen), windowClose: hhmmss(body.windowClose) }).returning(outletColumns);
      if (!row) throw new HttpError(500, 'failed', 'The outlet was not saved.');
      const after = toOutlet(row);
      await recorded('outlet.created', 'outlet', after.id, by, null, after);
      res.status(201).json(after);
    } catch (error) { saved(error, 'That outlet id is already in use.'); }
  });

  router.patch('/outlets/:id', async (req, res) => {
    const by = actorId(req);
    const id = req.params.id;
    if (!id) throw new HttpError(401, 'signed_out', 'Please sign in.');
    const body = parse(AdminOutletUpdate.safeParse(req.body));
    const [existing] = await db.select(outletColumns).from(outlets).where(eq(outlets.id, id));
    if (!existing) throw new HttpError(404, 'not_found', 'No outlet with that id.');
    await requireDepot(body.depotId);
    const [row] = await db.update(outlets).set({ ...body, windowOpen: hhmmss(body.windowOpen), windowClose: hhmmss(body.windowClose) }).where(eq(outlets.id, id)).returning(outletColumns);
    if (!row) throw new HttpError(404, 'not_found', 'No outlet with that id.');
    const before = toOutlet(existing);
    const after = toOutlet(row);
    await recorded('outlet.updated', 'outlet', id, by, before, after);
    res.json(after);
  });

  router.post('/products', async (req, res) => {
    const by = actorId(req);
    const body = parse(AdminProductWrite.safeParse(req.body));
    try {
      const [row] = await db.insert(products).values({
        ...body, kgPerUnit: String(body.kgPerUnit), m3PerUnit: String(body.m3PerUnit),
      }).returning(productColumns);
      if (!row) throw new HttpError(500, 'failed', 'The product was not saved.');
      const after = toProduct(row);
      await recorded('product.created', 'product', after.id, by, null, after);
      res.status(201).json(after);
    } catch (error) { saved(error, 'That product id is already in use.'); }
  });

  router.patch('/products/:id', async (req, res) => {
    const by = actorId(req);
    const id = req.params.id;
    if (!id) throw new HttpError(401, 'signed_out', 'Please sign in.');
    const body = parse(AdminProductUpdate.safeParse(req.body));
    const [existing] = await db.select(productColumns).from(products).where(eq(products.id, id));
    if (!existing) throw new HttpError(404, 'not_found', 'No product with that id.');
    const [row] = await db.update(products).set({
      ...body, kgPerUnit: String(body.kgPerUnit), m3PerUnit: String(body.m3PerUnit),
    }).where(eq(products.id, id)).returning(productColumns);
    if (!row) throw new HttpError(404, 'not_found', 'No product with that id.');
    const before = toProduct(existing);
    const after = toProduct(row);
    await recorded('product.updated', 'product', id, by, before, after);
    res.json(after);
  });

  router.post('/vehicles', async (req, res) => {
    const by = actorId(req);
    const body = parse(AdminVehicleWrite.safeParse(req.body));
    await requireDepot(body.depotId);
    try {
      const [row] = await db.insert(vehicles).values({
        ...body, volumeCapM3: String(body.volumeCapM3), kmPerL: String(body.kmPerL),
      }).returning(vehicleColumns);
      if (!row) throw new HttpError(500, 'failed', 'The vehicle was not saved.');
      const after = toVehicle(row);
      await recorded('vehicle.created', 'vehicle', after.id, by, null, after);
      res.status(201).json(after);
    } catch (error) { saved(error, 'That vehicle id is already in use.'); }
  });

  router.patch('/vehicles/:id', async (req, res) => {
    const by = actorId(req);
    const id = req.params.id;
    if (!id) throw new HttpError(401, 'signed_out', 'Please sign in.');
    const body = parse(AdminVehicleUpdate.safeParse(req.body));
    const [existing] = await db.select(vehicleColumns).from(vehicles).where(eq(vehicles.id, id));
    if (!existing) throw new HttpError(404, 'not_found', 'No vehicle with that id.');
    await requireDepot(body.depotId);
    const [row] = await db.update(vehicles).set({ ...body, volumeCapM3: String(body.volumeCapM3), kmPerL: String(body.kmPerL) }).where(eq(vehicles.id, id)).returning(vehicleColumns);
    if (!row) throw new HttpError(404, 'not_found', 'No vehicle with that id.');
    const before = toVehicle(existing);
    const after = toVehicle(row);
    await recorded('vehicle.updated', 'vehicle', id, by, before, after);
    res.json(after);
  });
}
