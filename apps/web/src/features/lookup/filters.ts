import type { Brand, HistoryTrip, LookupOrderRow, LookupOrders, LookupVehicle } from '@wayfinder/contracts';

// What the look-up pages do in the browser (spec 017, rules 3, 6 and 9): order, search and filter the complete rows a
// read returned, by the fields and flags it returned. Nothing here asks the server again or works a business figure
// out; the counts a page shows beside a filter are the lengths of the arrays it draws.

const BRANDS: readonly Brand[] = ['Fresh', 'Style', 'Tech'];
const TEMPS = ['chilled', 'dry'] as const;

// ── Orders ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type OrderFilter = 'all' | 'carried_over' | 'deferred' | 'split';
export interface OrderFilters { search: string; filter: OrderFilter }
export const NO_ORDER_FILTERS: OrderFilters = { search: '', filter: 'all' };

// Fresh, Style, Tech; then district, shop, wanted date, chilled before dry and the order's id.
export const compareOrders = (a: LookupOrderRow, b: LookupOrderRow) =>
  BRANDS.indexOf(a.outlet.brand) - BRANDS.indexOf(b.outlet.brand)
  || a.outlet.district.localeCompare(b.outlet.district)
  || a.outlet.name.localeCompare(b.outlet.name)
  || a.wantedDate.localeCompare(b.wantedDate)
  || TEMPS.indexOf(a.temp) - TEMPS.indexOf(b.temp)
  || a.id.localeCompare(b.id);

// A case-insensitive part of the shop's name or its outlet id.
export function matchesSearch(row: LookupOrderRow, search: string) {
  const needle = search.trim().toLowerCase();
  return needle === '' || row.outlet.name.toLowerCase().includes(needle) || row.outlet.id.toLowerCase().includes(needle);
}

// Carried over on any listed day; deferred by a listed day's own sent plan, or before a day is sent still deferred from
// an earlier one (Q-48), the rows the header counts; a part of a split order.
export function matchesFilter(row: LookupOrderRow, filter: OrderFilter) {
  switch (filter) {
    case 'all': return true;
    case 'carried_over': return row.days.some((day) => day.carriedOver);
    case 'deferred': return row.deferredEarlier || row.days.some((day) => day.deferral !== null);
    case 'split': return row.splitFrom !== null;
  }
}

export const shownOrders = (rows: readonly LookupOrderRow[], filters: OrderFilters) =>
  [...rows].sort(compareOrders).filter((row) => matchesSearch(row, filters.search) && matchesFilter(row, filters.filter));

export interface OrderGroup { brand: Brand; rows: LookupOrderRow[]; districts: { district: string; rows: LookupOrderRow[] }[] }

// Ordered rows into brand cards and their districts, in the order they come.
export function groupOrders(rows: readonly LookupOrderRow[]): OrderGroup[] {
  const groups: OrderGroup[] = [];
  for (const row of rows) {
    let group = groups.at(-1);
    if (group?.brand !== row.outlet.brand) {
      group = { brand: row.outlet.brand, rows: [], districts: [] };
      groups.push(group);
    }
    group.rows.push(row);
    let district = group.districts.at(-1);
    if (district?.district !== row.outlet.district) {
      district = { district: row.outlet.district, rows: [] };
      group.districts.push(district);
    }
    district.rows.push(row);
  }
  return groups;
}

// Everything the Orders page draws from one read: the server's own summary, the shown groups, "Showing N of M" and the
// selected row's detail, which is the row itself.
export function ordersPage(read: LookupOrders, filters: OrderFilters, selectedId: string | null) {
  const rows = shownOrders(read.rows, filters);
  return {
    summary: read.summary,
    groups: groupOrders(rows),
    shown: rows.length,
    total: read.rows.length,
    selected: read.rows.find((row) => row.id === selectedId) ?? null,
  };
}

// ── History ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type TripFilter = 'all' | 'late' | 'short' | 'returned' | 'deferred';
export interface TripFilters { attention: TripFilter; brand: Brand | 'all' }
export const NO_TRIP_FILTERS: TripFilters = { attention: 'all', brand: 'all' };

// Late, Short and Returned keep the trips the server flagged; a brand keeps the trips carrying that brand's shops, a
// mixed trip whole. Deferred lists the plan's deferrals in place of trips, so it keeps no trip rows.
export function matchesTrip(trip: Pick<HistoryTrip, 'brands' | 'flags'>, filters: TripFilters) {
  if (filters.brand !== 'all' && !trip.brands.includes(filters.brand)) return false;
  switch (filters.attention) {
    case 'all': return true;
    case 'late': return trip.flags.late === true;
    case 'short': return trip.flags.short;
    case 'returned': return trip.flags.returned;
    case 'deferred': return false;
  }
}

// ── Fleet ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type VehicleState = 'all' | 'out' | 'not_out' | 'workshop';
export type VehicleType = 'all' | 'reefer' | 'dry' | 'van';
export type VehicleSort = 'fuel' | 'id';
export interface VehicleFilters { state: VehicleState; type: VehicleType; sort: VehicleSort }
export const NO_VEHICLE_FILTERS: VehicleFilters = { state: 'all', type: 'all', sort: 'fuel' };

// Out now and Not recorded out are the server's flags (Q-42): Not recorded out is a vehicle on today's plan past its
// leave time that never left, never one that went out and came back. Reefer is every fridge vehicle, vans included,
// and Dry every other; Van is every van of either kind. So Reefer and Van overlap, and their totals are never added.
type VehicleFacts = Pick<LookupVehicle, 'id' | 'type' | 'temp' | 'group' | 'archivedAt' | 'offReason' | 'recordedOut' | 'notRecordedOut'> & { fuel: Pick<NonNullable<LookupVehicle['fuel']>, 'remaining'> | null };

export function matchesVehicle(vehicle: VehicleFacts, filters: Pick<VehicleFilters, 'state' | 'type'>) {
  const state = filters.state === 'all'
    || (filters.state === 'out' && vehicle.recordedOut)
    || (filters.state === 'not_out' && vehicle.notRecordedOut)
    || (filters.state === 'workshop' && vehicle.offReason !== null);
  const type = filters.type === 'all'
    || (filters.type === 'reefer' && vehicle.temp === 'reefer')
    || (filters.type === 'dry' && vehicle.temp === 'ambient')
    || (filters.type === 'van' && vehicle.type === 'van');
  return state && type;
}

const GROUPS: readonly LookupVehicle['group'][] = ['reefer_trucks', 'dry_trucks', 'vans'];

// Reefer trucks, dry trucks, then vans; active before archived; then the chosen sort, fuel left lowest first with an
// unknown week last, or the vehicle id; then the vehicle id.
export function compareVehicles(sort: VehicleSort) {
  return (a: VehicleFacts, b: VehicleFacts) => {
    const fuel = (vehicle: VehicleFacts) => vehicle.fuel?.remaining ?? Number.POSITIVE_INFINITY;
    const bySort = sort === 'fuel' ? (fuel(a) === fuel(b) ? 0 : fuel(a) < fuel(b) ? -1 : 1) : 0;
    return GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group)
      || Number(a.archivedAt !== null) - Number(b.archivedAt !== null)
      || bySort
      || a.id.localeCompare(b.id);
  };
}

export interface VehicleGroup<T extends VehicleFacts = LookupVehicle> { group: LookupVehicle['group']; vehicles: T[] }

export function shownVehicles<T extends VehicleFacts>(vehicles: readonly T[], filters: VehicleFilters): VehicleGroup<T>[] {
  const shown = vehicles.filter((vehicle) => matchesVehicle(vehicle, filters)).sort(compareVehicles(filters.sort));
  return GROUPS.map((group) => ({ group, vehicles: shown.filter((vehicle) => vehicle.group === group) })).filter((group) => group.vehicles.length > 0);
}
