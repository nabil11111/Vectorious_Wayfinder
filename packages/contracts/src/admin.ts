import { z } from 'zod';

// A vehicle as the admin list shows it. archivedAt is set when the row is kept for old plans but hidden from new ones.
export const AdminVehicle = z.object({
  id: z.string(),
  type: z.enum(['truck', 'van']),
  temp: z.enum(['reefer', 'ambient']),
  weightCapKg: z.number(),
  volumeCapM3: z.number(),
  weeklyFuelQuotaL: z.number(),
  depotId: z.string(),
  archivedAt: z.string().nullable(),
});
export type AdminVehicle = z.infer<typeof AdminVehicle>;
