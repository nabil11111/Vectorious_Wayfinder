import { Router } from 'express';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { AdminOutlet, AdminProduct, AdminVehicle } from '@wayfinder/contracts';
import { db } from '../db/client';
import { auditLog, outlets, products, vehicles } from '../db/schema';
import { HttpError } from '../lib/errors';
import { announce } from '../lib/live';
import { requireRole } from '../middleware/auth';
import { adminRecordRoutes } from './admin-records';

export const adminRouter = Router();

const vehicleColumns = {
  id: vehicles.id,
  type: vehicles.type,
  temp: vehicles.temp,
  weightCapKg: vehicles.weightCapKg,
  volumeCapM3: vehicles.volumeCapM3,
  fuelType: vehicles.fuelType,
  kmPerL: vehicles.kmPerL,
  weeklyFuelQuotaL: vehicles.weeklyFuelQuotaL,
  depotId: vehicles.depotId,
  archivedAt: vehicles.archivedAt,
};

// Volume is a numeric column, so the driver returns it as text. The clock time comes from the database.
function toAdminVehicle(row: {
  id: string;
  type: AdminVehicle['type'];
  temp: AdminVehicle['temp'];
  weightCapKg: number;
  volumeCapM3: string;
  fuelType: string;
  kmPerL: string;
  weeklyFuelQuotaL: number;
  depotId: string;
  archivedAt: Date | null;
}): AdminVehicle {
  return {
    id: row.id,
    type: row.type,
    temp: row.temp,
    weightCapKg: row.weightCapKg,
    volumeCapM3: Number(row.volumeCapM3),
    fuelType: row.fuelType,
    kmPerL: Number(row.kmPerL),
    weeklyFuelQuotaL: row.weeklyFuelQuotaL,
    depotId: row.depotId,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

// Every admin route asks for this role. A signed-out caller gets 401; any other role gets 403.
adminRouter.use(requireRole('admin'));

adminRouter.get('/vehicles', async (_req, res) => {
  // Archived rows stay in the table for old plans, so they come after the live ones. Id order within each group.
  const rows = await db.select(vehicleColumns).from(vehicles).orderBy(asc(sql`(${vehicles.archivedAt} is not null)`), asc(vehicles.id));
  res.json(rows.map(toAdminVehicle));
});

adminRouter.post('/vehicles/:id/archive', async (req, res) => {
  const id = req.params.id;
  const actorId = req.user?.id;
  if (!id || !actorId) throw new HttpError(401, 'signed_out', 'Please sign in.');

  const archived = await db.transaction(async (tx) => {
    // One statement: a second archive, even at the same moment, changes no row and does not write a second audit.
    const [row] = await tx
      .update(vehicles)
      .set({ archivedAt: sql`now()` })
      .where(and(eq(vehicles.id, id), isNull(vehicles.archivedAt)))
      .returning(vehicleColumns);
    if (!row) {
      const [existing] = await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, id));
      if (!existing) throw new HttpError(404, 'not_found', 'No vehicle with that id.');
      throw new HttpError(409, 'already_archived', 'That vehicle is already archived.');
    }
    const after = toAdminVehicle(row);
    const before: AdminVehicle = { ...after, archivedAt: null };
    await tx.insert(auditLog).values({
      actorId,
      action: 'vehicle.archived',
      entity: 'vehicle',
      entityId: id,
      before,
      after,
    });
    return after;
  });
  // Once it is committed, every open admin screen fetches its lists again (D-21).
  announce({ topic: 'admin' });
  res.json(archived);
});

const outletColumns = {
  id: outlets.id,
  name: outlets.name,
  brand: outlets.brand,
  district: outlets.district,
  depotId: outlets.depotId,
  dockType: outlets.dockType,
  parking: outlets.parking,
  windowOpen: outlets.windowOpen,
  windowClose: outlets.windowClose,
  archivedAt: outlets.archivedAt,
};

function clock(value: string) {
  return value.slice(0, 5);
}

function toAdminOutlet(row: {
  id: string;
  name: string;
  brand: AdminOutlet['brand'];
  district: string;
  depotId: string;
  dockType: AdminOutlet['dockType'];
  parking: AdminOutlet['parking'];
  windowOpen: string;
  windowClose: string;
  archivedAt: Date | null;
}): AdminOutlet {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    district: row.district,
    depotId: row.depotId,
    dockType: row.dockType,
    parking: row.parking,
    windowOpen: clock(row.windowOpen),
    windowClose: clock(row.windowClose),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

adminRouter.get('/outlets', async (_req, res) => {
  const rows = await db.select(outletColumns).from(outlets).orderBy(asc(sql`(${outlets.archivedAt} is not null)`), asc(outlets.id));
  res.json(rows.map(toAdminOutlet));
});

adminRouter.post('/outlets/:id/archive', async (req, res) => {
  const id = req.params.id;
  const actorId = req.user?.id;
  if (!id || !actorId) throw new HttpError(401, 'signed_out', 'Please sign in.');

  const archived = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(outlets)
      .set({ archivedAt: sql`now()` })
      .where(and(eq(outlets.id, id), isNull(outlets.archivedAt)))
      .returning(outletColumns);
    if (!row) {
      const [existing] = await tx.select({ id: outlets.id }).from(outlets).where(eq(outlets.id, id));
      if (!existing) throw new HttpError(404, 'not_found', 'No outlet with that id.');
      throw new HttpError(409, 'already_archived', 'That outlet is already archived.');
    }
    const after = toAdminOutlet(row);
    const before: AdminOutlet = { ...after, archivedAt: null };
    await tx.insert(auditLog).values({
      actorId,
      action: 'outlet.archived',
      entity: 'outlet',
      entityId: id,
      before,
      after,
    });
    return after;
  });
  announce({ topic: 'admin' });
  res.json(archived);
});

const productColumns = {
  id: products.id,
  name: products.name,
  brand: products.brand,
  unit: products.unit,
  kgPerUnit: products.kgPerUnit,
  m3PerUnit: products.m3PerUnit,
  temp: products.temp,
  needsTailLift: products.needsTailLift,
  archivedAt: products.archivedAt,
};

function toAdminProduct(row: {
  id: string;
  name: string;
  brand: AdminProduct['brand'];
  unit: string;
  kgPerUnit: string;
  m3PerUnit: string;
  temp: AdminProduct['temp'];
  needsTailLift: boolean;
  archivedAt: Date | null;
}): AdminProduct {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    unit: row.unit,
    kgPerUnit: Number(row.kgPerUnit),
    m3PerUnit: Number(row.m3PerUnit),
    temp: row.temp,
    needsTailLift: row.needsTailLift,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

adminRouter.get('/products', async (_req, res) => {
  const rows = await db.select(productColumns).from(products).orderBy(asc(sql`(${products.archivedAt} is not null)`), asc(products.id));
  res.json(rows.map(toAdminProduct));
});

adminRouter.post('/products/:id/archive', async (req, res) => {
  const id = req.params.id;
  const actorId = req.user?.id;
  if (!id || !actorId) throw new HttpError(401, 'signed_out', 'Please sign in.');

  const archived = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(products)
      .set({ archivedAt: sql`now()` })
      .where(and(eq(products.id, id), isNull(products.archivedAt)))
      .returning(productColumns);
    if (!row) {
      const [existing] = await tx.select({ id: products.id }).from(products).where(eq(products.id, id));
      if (!existing) throw new HttpError(404, 'not_found', 'No product with that id.');
      throw new HttpError(409, 'already_archived', 'That product is already archived.');
    }
    const after = toAdminProduct(row);
    const before: AdminProduct = { ...after, archivedAt: null };
    await tx.insert(auditLog).values({
      actorId,
      action: 'product.archived',
      entity: 'product',
      entityId: id,
      before,
      after,
    });
    return after;
  });
  announce({ topic: 'admin' });
  res.json(archived);
});

adminRecordRoutes(adminRouter);
