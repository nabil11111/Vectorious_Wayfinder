import { Router } from 'express';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { AdminVehicle } from '@wayfinder/contracts';
import { db } from '../db/client';
import { auditLog, vehicles } from '../db/schema';
import { HttpError } from '../lib/errors';
import { announce } from '../lib/live';
import { requireRole } from '../middleware/auth';

export const adminRouter = Router();

const vehicleColumns = {
  id: vehicles.id,
  type: vehicles.type,
  temp: vehicles.temp,
  weightCapKg: vehicles.weightCapKg,
  volumeCapM3: vehicles.volumeCapM3,
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
