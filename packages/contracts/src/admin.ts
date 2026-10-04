import { z } from 'zod';
import { Brand, Temp } from './basics';
import { Parking } from './plans';
import { DockType } from './store';

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

// An outlet as the admin list shows it. The window is the shop's own delivery window, HH:MM.
export const AdminOutlet = z.object({
  id: z.string(),
  name: z.string(),
  brand: Brand,
  district: z.string(),
  depotId: z.string(),
  dockType: DockType,
  parking: Parking,
  windowOpen: z.string().regex(/^\d{2}:\d{2}$/),
  windowClose: z.string().regex(/^\d{2}:\d{2}$/),
  archivedAt: z.string().nullable(),
});
export type AdminOutlet = z.infer<typeof AdminOutlet>;

// A product as the admin list shows it. Weight and volume are per unit.
export const AdminProduct = z.object({
  id: z.string(),
  name: z.string(),
  brand: Brand,
  unit: z.string(),
  kgPerUnit: z.number(),
  m3PerUnit: z.number(),
  temp: Temp,
  needsTailLift: z.boolean(),
  archivedAt: z.string().nullable(),
});
export type AdminProduct = z.infer<typeof AdminProduct>;
