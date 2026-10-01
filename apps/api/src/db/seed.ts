import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { sql } from 'drizzle-orm';
import { logger } from '../lib/logger';
import { db, pool } from './client';
import { seedDemoAccounts } from './demo-accounts';
import { seedDemoDay } from './demo-day';
import { DEMO_USERS, PRODUCTS } from './fixtures';
import * as s from './schema';

// Loads the booklet's shared CSVs and our fixtures. Idempotent: running it twice changes nothing, and it never
// touches orders or plans people have made, so it is safe on every start.
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ?? path.resolve(here, '../../../../data/shared');
// Our own CSVs sit beside the booklet's and ship with the code, so they are found from here whatever DATA_DIR says.
const fixtureDir = path.resolve(here, '../../../../data/fixtures');
type Row = Record<string, string>;
const read = (file: string, dir = dataDir): Row[] => parse(readFileSync(path.join(dir, file)), { columns: true, skip_empty_lines: true });
const bool = (v: string | undefined) => v === '1';

const outletRows = read('outlets.csv');
const vehicleRows = read('vehicles.csv');

const depotIds = [...new Set([...outletRows, ...vehicleRows].map((r) => r.depot!))];
await db.insert(s.depots).values(depotIds.map((id) => ({ id, name: id }))).onConflictDoNothing();

// outlets.csv has no names. Ours are in outlet-names.csv: the brand, then a real town or mall in the district.
// An outlet that file leaves out is numbered per brand and district, like "Fresh Colombo 3". One that is already
// in the database only gets its name brought up to date, and a row that is already right is not written again.
const nameOf = new Map(read('outlet-names.csv', fixtureDir).map((r) => [r.outlet_id!, r.name!]));
const counter = new Map<string, number>();
await db.insert(s.outlets).values(outletRows.map((r) => {
  const key = `${r.brand} ${r.district}`;
  counter.set(key, (counter.get(key) ?? 0) + 1);
  return {
    id: r.outlet_id!,
    name: nameOf.get(r.outlet_id!) || `${key} ${counter.get(key)}`,
    brand: r.brand as (typeof s.brandEnum.enumValues)[number],
    district: r.district!,
    depotId: r.depot!,
    dockType: r.dock_type as (typeof s.dockTypeEnum.enumValues)[number],
    parking: r.parking_constraint as (typeof s.parkingEnum.enumValues)[number],
    mallWindow: r.mall_window || null,
    windowOpen: r.window_open_time!,
    windowClose: r.window_close_time!,
  };
})).onConflictDoUpdate({ target: s.outlets.id, set: { name: sql`excluded.name` }, setWhere: sql`${s.outlets.name} <> excluded.name` });

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

// Each demo account with its staff ID and PIN, and admin with a PIN of its own because it can do everything. A
// database seeded before staff IDs gets them here once (spec 018).
const accounts = await seedDemoAccounts();
if (accounts.added || accounts.filled) logger.info(accounts, 'demo accounts given their staff IDs and PINs');

// In demo mode: the app's clock, and the delivery day the walkthrough runs on. Written once (spec 008).
if (await seedDemoDay()) logger.info('demo day written');

logger.info({ outlets: outletRows.length, vehicles: vehicleRows.length, users: DEMO_USERS.length }, 'seed done');
await pool.end();
