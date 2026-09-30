import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Brand } from '@wayfinder/contracts';
import { parse } from 'csv-parse/sync';
import { PRODUCTS } from '../../db/fixtures';
import { DEFAULT_SETTINGS } from '../settings';
import type {
  AllowanceRow, DockType, EngineOrder, EngineOutlet, EngineProduct, EngineVehicle, PlanDeferral, PlanInput, PlanSettings, PlanTrip, TravelRow,
} from '../types';
import { toMinutes } from '../words';

// Test helper only. Reads the booklet's shared data and our product list into the checker's input shapes, so
// the worked examples in spec 007 run on the real rows. It is the one planning file allowed to import from
// outside the folder.
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ?? path.resolve(here, '../../../../../data/shared');
type Row = Record<string, string>;
const read = (file: string): Row[] => parse(readFileSync(path.join(dataDir, file)), { columns: true, skip_empty_lines: true });

export const products: EngineProduct[] = PRODUCTS.map((p) => ({
  id: p.id, kgPerUnit: Number(p.kgPerUnit), m3PerUnit: Number(p.m3PerUnit), temp: p.temp, needsTailLift: p.needsTailLift, keepUpright: p.keepUpright,
}));

export const outlets: EngineOutlet[] = read('outlets.csv').map((r) => {
  const slot = r.mall_window ? r.mall_window.split('-') : null;
  return {
    // outlets.csv has no names, so in tests a shop is called by its id.
    id: r.outlet_id!, name: r.outlet_id!, brand: r.brand as Brand, district: r.district!, depotId: r.depot!, dockType: r.dock_type as DockType,
    parking: r.parking_constraint as EngineOutlet['parking'],
    windowOpen: toMinutes(r.window_open_time!), windowClose: toMinutes(r.window_close_time!),
    ...(slot ? { mallOpen: toMinutes(slot[0]!), mallClose: toMinutes(slot[1]!) } : {}),
  };
});

// Every vehicle is available with no fuel used. A test that needs otherwise overrides those two.
export const vehicles: EngineVehicle[] = read('vehicles.csv').map((r) => ({
  id: r.vehicle_id!, type: r.type as EngineVehicle['type'], temp: r.temp as EngineVehicle['temp'],
  weightCapKg: Number(r.weight_cap_kg), volumeCapM3: Number(r.volume_cap_m3), kmPerL: Number(r.km_per_l),
  weeklyFuelQuotaL: Number(r.weekly_fuel_quota_l), depotId: r.depot!, available: true, litresUsedThisWeek: 0,
}));

export const travel: TravelRow[] = read('district_travel.csv').map((r) => ({
  district: r.district!, depotId: r.depot!, outMin: Number(r.depot_to_district_freeflow_min), outKm: Number(r.depot_to_district_km),
  betweenMin: Number(r.inter_stop_freeflow_min), betweenKm: Number(r.inter_stop_km),
}));

export const allowances: AllowanceRow[] = read('service_allowance.csv').map((r) => ({
  brand: r.brand as Brand, dockType: r.dock_type as DockType, minutes: Number(r.service_allowance_min),
}));

const find = <T extends { id: string }>(rows: T[], id: string, what: string): T => {
  const row = rows.find((x) => x.id === id);
  if (!row) throw new Error(`No ${what} ${id} in data/shared`);
  return row;
};
export const outlet = (id: string) => find(outlets, id, 'outlet');
export const vehicle = (id: string) => find(vehicles, id, 'vehicle');

// One order of one product, for a test that only cares that the shop has an order.
export const order = (id: string, outletId: string, productId: string, quantity: number): EngineOrder => ({ id, outletId, lines: [{ productId, quantity }] });

// A whole input for one depot on an operating day, with the default settings and the real shops, vehicles,
// travel and unloading figures. Pass the orders and the plan, and override whatever else the test is about.
export function inputFor(depotId: string, parts: {
  orders?: EngineOrder[]; trips?: PlanTrip[]; deferrals?: PlanDeferral[];
  operatingDay?: boolean; settings?: Partial<PlanSettings>; vehicles?: EngineVehicle[]; outlets?: EngineOutlet[];
} = {}): PlanInput {
  return {
    depotId,
    operatingDay: parts.operatingDay ?? true,
    settings: { ...DEFAULT_SETTINGS, ...parts.settings },
    products,
    orders: parts.orders ?? [],
    outlets: parts.outlets ?? outlets,
    vehicles: parts.vehicles ?? vehicles,
    travel,
    allowances,
    plan: { trips: parts.trips ?? [], deferrals: parts.deferrals ?? [] },
  };
}
