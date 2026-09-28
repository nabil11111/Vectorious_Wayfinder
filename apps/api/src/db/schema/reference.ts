import { boolean, date, integer, numeric, pgTable, primaryKey, smallint, text, time, timestamp } from 'drizzle-orm/pg-core';
import { brandEnum, dockTypeEnum, parkingEnum, tempEnum, vehicleTempEnum, vehicleTypeEnum } from './enums';

// Reference data comes from the booklet's shared CSVs (data/shared). Supplied ids are kept as primary keys so
// every phase of the competition talks about the same OUT001 and VEH001.

export const depots = pgTable('depots', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
});

export const outlets = pgTable('outlets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  brand: brandEnum('brand').notNull(),
  district: text('district').notNull(),
  depotId: text('depot_id').notNull().references(() => depots.id),
  dockType: dockTypeEnum('dock_type').notNull(),
  // van_only outlets cannot take a truck; mall_dock outlets can only be served inside mallWindow.
  parking: parkingEnum('parking').notNull(),
  mallWindow: text('mall_window'),
  windowOpen: time('window_open').notNull(),
  windowClose: time('window_close').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

export const vehicles = pgTable('vehicles', {
  id: text('id').primaryKey(),
  type: vehicleTypeEnum('type').notNull(),
  temp: vehicleTempEnum('temp').notNull(),
  weightCapKg: integer('weight_cap_kg').notNull(),
  volumeCapM3: numeric('volume_cap_m3', { precision: 6, scale: 2 }).notNull(),
  fuelType: text('fuel_type').notNull(),
  kmPerL: numeric('km_per_l', { precision: 5, scale: 2 }).notNull(),
  weeklyFuelQuotaL: integer('weekly_fuel_quota_l').notNull(),
  depotId: text('depot_id').notNull().references(() => depots.id),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

export const calendarDays = pgTable('calendar_days', {
  date: date('date').primaryKey(),
  dow: smallint('dow').notNull(),
  isWeekend: boolean('is_weekend').notNull(),
  isoYear: smallint('iso_year').notNull(),
  isoWeek: smallint('iso_week').notNull(),
  isPayday: boolean('is_payday').notNull(),
  festival: text('festival'),
  festivalRamp: numeric('festival_ramp', { precision: 4, scale: 2 }).notNull(),
  isHoliday: boolean('is_holiday').notNull(),
  monsoon: boolean('monsoon').notNull(),
  isOperating: boolean('is_operating').notNull(),
});

export const districtTravel = pgTable('district_travel', {
  district: text('district').notNull(),
  depotId: text('depot_id').notNull().references(() => depots.id),
  roadClass: text('road_class').notNull(),
  freeFlowKmh: numeric('free_flow_kmh', { precision: 5, scale: 1 }).notNull(),
  depotToDistrictKm: integer('depot_to_district_km').notNull(),
  depotToDistrictMin: integer('depot_to_district_min').notNull(),
  interStopKm: numeric('inter_stop_km', { precision: 5, scale: 1 }).notNull(),
  interStopMin: integer('inter_stop_min').notNull(),
}, (t) => [primaryKey({ columns: [t.district, t.depotId] })]);

export const serviceAllowance = pgTable('service_allowance', {
  brand: brandEnum('brand').notNull(),
  dockType: dockTypeEnum('dock_type').notNull(),
  minutes: integer('minutes').notNull(),
}, (t) => [primaryKey({ columns: [t.brand, t.dockType] })]);

// The fixed product list from docs/product-list.md. Weight and volume are per unit, so an order line only
// stores a quantity and the load is always quantity times these numbers.
export const products = pgTable('products', {
  id: text('id').primaryKey(),
  brand: brandEnum('brand').notNull(),
  name: text('name').notNull(),
  unit: text('unit').notNull(),
  kgPerUnit: numeric('kg_per_unit', { precision: 7, scale: 2 }).notNull(),
  m3PerUnit: numeric('m3_per_unit', { precision: 6, scale: 3 }).notNull(),
  temp: tempEnum('temp').notNull(),
  needsTailLift: boolean('needs_tail_lift').notNull().default(false),
  keepUpright: boolean('keep_upright').notNull().default(false),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});
