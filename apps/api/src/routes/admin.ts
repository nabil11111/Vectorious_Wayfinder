import { Router } from 'express';
import { asc, sql } from 'drizzle-orm';
import type { AdminVehicle } from '@wayfinder/contracts';
import { db } from '../db/client';
import { vehicles } from '../db/schema';
import { requireRole } from '../middleware/auth';

export const adminRouter = Router();

// Every admin route asks for this role. A signed-out caller gets 401; any other role gets 403.
adminRouter.use(requireRole('admin'));

adminRouter.get('/vehicles', async (_req, res) => {
  // Archived rows stay in the table for old plans, so they come after the live ones. Id order within each group.
  const rows = await db
    .select({
      id: vehicles.id,
      type: vehicles.type,
      temp: vehicles.temp,
      weightCapKg: vehicles.weightCapKg,
      volumeCapM3: vehicles.volumeCapM3,
      weeklyFuelQuotaL: vehicles.weeklyFuelQuotaL,
      depotId: vehicles.depotId,
      archivedAt: vehicles.archivedAt,
    })
    .from(vehicles)
    .orderBy(asc(sql`(${vehicles.archivedAt} is not null)`), asc(vehicles.id));

  const body: AdminVehicle[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    temp: row.temp,
    weightCapKg: row.weightCapKg,
    volumeCapM3: Number(row.volumeCapM3),
    weeklyFuelQuotaL: row.weeklyFuelQuotaL,
    depotId: row.depotId,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  }));
  res.json(body);
});
