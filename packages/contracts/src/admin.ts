import { z } from 'zod';
import { Brand, Role, Temp } from './basics';
import { Parking } from './plans';
import { DockType } from './store';

// A vehicle as the admin list shows it. archivedAt is set when the row is kept for old plans but hidden from new ones.
export const AdminVehicle = z.object({
  id: z.string(),
  type: z.enum(['truck', 'van']),
  temp: z.enum(['reefer', 'ambient']),
  weightCapKg: z.number(),
  volumeCapM3: z.number(),
  fuelType: z.string(),
  kmPerL: z.number(),
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

// An account as the admin list shows it. The PIN is never sent back.
export const AdminUser = z.object({
  id: z.string(),
  staffId: z.string(),
  displayName: z.string(),
  role: Role,
  depotId: z.string().nullable(),
  outletId: z.string().nullable(),
  active: z.boolean(),
});
export type AdminUser = z.infer<typeof AdminUser>;

const RecordId = z.string().trim().min(1).max(40);
const StaffId = z.string().trim().regex(/^[A-Za-z]-\d{3,4}$/).transform((value) => value[0]!.toUpperCase() + value.slice(1));
const Pin = z.string().regex(/^\d{4}$/);
const Name = z.string().trim().min(1).max(80);
const Clock = z.string().regex(/^\d{2}:\d{2}$/);

export const AdminUserCreate = z.object({
  staffId: StaffId,
  displayName: Name,
  role: Role,
  depotId: z.string().trim().min(1).max(40).nullable(),
  outletId: z.string().trim().min(1).max(40).nullable(),
  pin: Pin,
});
export type AdminUserCreate = z.infer<typeof AdminUserCreate>;

export const AdminUserUpdate = AdminUserCreate.omit({ pin: true }).extend({
  pin: Pin.optional(),
  active: z.boolean(),
});
export type AdminUserUpdate = z.infer<typeof AdminUserUpdate>;

const OutletFields = z.object({
  id: RecordId.regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  name: Name,
  brand: Brand,
  district: z.string().trim().min(1).max(40),
  depotId: z.string().trim().min(1).max(40),
  dockType: DockType,
  parking: Parking,
  windowOpen: Clock,
  windowClose: Clock,
});
const windowOrder = (row: { windowOpen: string; windowClose: string }) => row.windowOpen < row.windowClose;

export const AdminOutletWrite = OutletFields.refine(windowOrder, { message: 'The window must close after it opens.' });
export type AdminOutletWrite = z.infer<typeof AdminOutletWrite>;

export const AdminOutletUpdate = OutletFields.omit({ id: true }).refine(windowOrder, { message: 'The window must close after it opens.' });
export type AdminOutletUpdate = z.infer<typeof AdminOutletUpdate>;

export const AdminProductWrite = z.object({
  id: RecordId.regex(/^[a-z0-9][a-z0-9-]*$/),
  name: Name,
  brand: Brand,
  unit: z.string().trim().min(1).max(40),
  kgPerUnit: z.number().positive().max(10_000),
  m3PerUnit: z.number().positive().max(100),
  temp: Temp,
  needsTailLift: z.boolean(),
});
export type AdminProductWrite = z.infer<typeof AdminProductWrite>;

export const AdminProductUpdate = AdminProductWrite.omit({ id: true });
export type AdminProductUpdate = z.infer<typeof AdminProductUpdate>;

export const AdminVehicleWrite = z.object({
  id: RecordId.regex(/^VEH\d{3,4}$/i).transform((value) => value.toUpperCase()),
  type: z.enum(['truck', 'van']),
  temp: z.enum(['reefer', 'ambient']),
  weightCapKg: z.number().int().positive().max(100_000),
  volumeCapM3: z.number().positive().max(1000),
  fuelType: z.string().trim().min(1).max(20),
  kmPerL: z.number().positive().max(100),
  weeklyFuelQuotaL: z.number().int().positive().max(10_000),
  depotId: z.string().trim().min(1).max(40),
});
export type AdminVehicleWrite = z.infer<typeof AdminVehicleWrite>;

export const AdminVehicleUpdate = AdminVehicleWrite.omit({ id: true });
export type AdminVehicleUpdate = z.infer<typeof AdminVehicleUpdate>;
