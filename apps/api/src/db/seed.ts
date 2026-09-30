import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '@node-rs/argon2';
import { parse } from 'csv-parse/sync';
import { and, eq } from 'drizzle-orm';
import { config } from '../lib/config';
import { logger } from '../lib/logger';
import { db, pool } from './client';
import { DEMO_USERS, PRODUCTS } from './fixtures';
import * as s from './schema';

// Loads the booklet's shared CSVs and our fixtures. Idempotent: running it twice changes nothing, and it never
// touches orders or plans people have made, so it is safe on every start.
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ?? path.resolve(here, '../../../../data/shared');
type Row = Record<string, string>;
const read = (file: string): Row[] => parse(readFileSync(path.join(dataDir, file)), { columns: true, skip_empty_lines: true });
const bool = (v: string | undefined) => v === '1';

const outletRows = read('outlets.csv');
const vehicleRows = read('vehicles.csv');

const depotIds = [...new Set([...outletRows, ...vehicleRows].map((r) => r.depot!))];
await db.insert(s.depots).values(depotIds.map((id) => ({ id, name: id }))).onConflictDoNothing();

// outlets.csv has no names. Number them per brand and district so screens can say "Fresh Colombo 3".
const counter = new Map<string, number>();
await db.insert(s.outlets).values(outletRows.map((r) => {
  const key = `${r.brand} ${r.district}`;
  counter.set(key, (counter.get(key) ?? 0) + 1);
  return {
    id: r.outlet_id!,
    name: `${key} ${counter.get(key)}`,
    brand: r.brand as (typeof s.brandEnum.enumValues)[number],
    district: r.district!,
    depotId: r.depot!,
    dockType: r.dock_type as (typeof s.dockTypeEnum.enumValues)[number],
    parking: r.parking_constraint as (typeof s.parkingEnum.enumValues)[number],
    mallWindow: r.mall_window || null,
    windowOpen: r.window_open_time!,
    windowClose: r.window_close_time!,
  };
})).onConflictDoNothing();

await db.insert(s.vehicles).values(vehicleRows.map((r) => ({
  id: r.vehicle_id!,
  type: r.type as 'truck' | 'van',
  temp: r.temp as 'reefer' | 'ambient',
  weightCapKg: Number(r.weight_cap_kg),
  volumeCapM3: r.volume_cap_m3!,
  fuelType: r.fuel_type!,
  kmPerL: r.km_per_l!,
  weeklyFuelQuotaL: Number(r.weekly_fuel_quota_l),
  depotId: r.depot!,
}))).onConflictDoNothing();

await db.insert(s.calendarDays).values(read('calendar.csv').map((r) => ({
  date: r.date!,
  dow: Number(r.dow),
  isWeekend: bool(r.is_weekend),
  isoYear: Number(r.iso_year),
  isoWeek: Number(r.iso_week),
  isPayday: bool(r.is_payday),
  festival: r.festival || null,
  festivalRamp: r.festival_ramp || '0',
  isHoliday: bool(r.is_holiday),
  monsoon: bool(r.monsoon),
  isOperating: bool(r.is_operating),
}))).onConflictDoNothing();

await db.insert(s.districtTravel).values(read('district_travel.csv').map((r) => ({
  district: r.district!,
  depotId: r.depot!,
  roadClass: r.road_class!,
  freeFlowKmh: r.free_flow_kmh!,
  depotToDistrictKm: Number(r.depot_to_district_km),
  depotToDistrictMin: Number(r.depot_to_district_freeflow_min),
  interStopKm: r.inter_stop_km!,
  interStopMin: Number(r.inter_stop_freeflow_min),
}))).onConflictDoNothing();

await db.insert(s.serviceAllowance).values(read('service_allowance.csv').map((r) => ({
  brand: r.brand as (typeof s.brandEnum.enumValues)[number],
  dockType: r.dock_type as (typeof s.dockTypeEnum.enumValues)[number],
  minutes: Number(r.service_allowance_min),
}))).onConflictDoNothing();

await db.insert(s.products).values(PRODUCTS.map((p) => ({ ...p }))).onConflictDoNothing();

// The store manager gets the first Fresh outlet in Colombo, which matches Nadeesha's shop in the design.
const [shop] = await db.select().from(s.outlets).where(and(eq(s.outlets.brand, 'Fresh'), eq(s.outlets.district, 'Colombo'))).orderBy(s.outlets.id).limit(1);
// Admin can do everything, so it does not share the password the demo accounts are handed out with.
const passwordHash = await hash(config.SEED_PASSWORD);
const adminPasswordHash = await hash(config.SEED_ADMIN_PASSWORD);
await db.insert(s.users).values(DEMO_USERS.map((u) => ({
  username: u.username,
  displayName: u.displayName,
  role: u.role,
  passwordHash: u.role === 'admin' ? adminPasswordHash : passwordHash,
  depotId: u.depot,
  outletId: u.role === 'store_manager' ? shop!.id : null,
}))).onConflictDoNothing();

logger.info({ outlets: outletRows.length, vehicles: vehicleRows.length, users: DEMO_USERS.length }, 'seed done');
await pool.end();
