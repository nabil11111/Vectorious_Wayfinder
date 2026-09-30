import { PlanInputError } from '../errors';
import { computeLoad } from '../load';
import { FRESH_DEADLINE } from '../timeline';
import type { EngineOutlet, PlannerInput, PlannerOrder } from '../types';

// Unicode scalar order, independent of locale (including characters outside the BMP).
export function compare(a: string, b: string): number {
  const left = Array.from(a, (char) => char.codePointAt(0)!);
  const right = Array.from(b, (char) => char.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    if (left[i] !== right[i]) return left[i]! - right[i]!;
  }
  return left.length - right.length;
}

export const effectiveWindow = (shop: EngineOutlet): { open: number; close: number } => ({
  open: Math.max(shop.windowOpen, shop.mallOpen ?? shop.windowOpen),
  close: Math.min(shop.windowClose, shop.mallClose ?? shop.windowClose, shop.brand === 'Fresh' ? FRESH_DEADLINE - 1 : Infinity),
});

export const isWaiting = (order: PlannerOrder, date: string): boolean => order.deliveryDate < date || order.timesDeferred > 0;

const fail = (fault: string): never => { throw new PlanInputError(fault); };
const object = (value: unknown, at: string): void => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${at} must be an object`);
};
const text = (value: unknown, at: string): void => {
  if (typeof value !== 'string' || value.trim() === '') fail(`${at} must be a nonempty string`);
};
const flag = (value: unknown, at: string): void => {
  if (typeof value !== 'boolean') fail(`${at} must be a boolean`);
};
const choice = (value: unknown, values: readonly string[], at: string): void => {
  if (typeof value !== 'string' || !values.includes(value)) fail(`${at} must be one of ${values.join(', ')}`);
};
const number = (value: unknown, at: string, positive = false, integer = false, max = Number.MAX_SAFE_INTEGER): void => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (positive && value === 0)
    || value > max || (integer && !Number.isSafeInteger(value))) fail(`${at} must be a finite ${positive ? 'positive' : 'nonnegative'}${integer ? ' integer' : ' number'} no greater than ${max}`);
};
const minute = (value: unknown, at: string): void => number(value, at, false, true, 1439);
const date = (value: unknown, at: string): void => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${at} must be a YYYY-MM-DD date`);
  const [year, month, day] = (value as string).split('-').map(Number) as [number, number, number];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year === 0 || month < 1 || month > 12 || day < 1 || day > days[month - 1]!) fail(`${at} is not a valid calendar date`);
};
const rows = (value: unknown, at: string): void => {
  if (!Array.isArray(value)) fail(`${at} must be an array`);
  for (const [index, row] of (value as unknown[]).entries()) object(row, `${at}[${index}]`);
};
const unique = <T>(values: T[], what: string, key: (value: T) => string): void => {
  const seen = new Set<string>();
  for (const value of values) {
    const id = key(value);
    if (seen.has(id)) fail(`Duplicate ${what} ${id}`);
    seen.add(id);
  }
};
const brands = ['Fresh', 'Style', 'Tech'] as const;
const docks = ['street', 'rear_dock', 'mall_bay'] as const;

// Validate before a lookup or any trial: a missing snapshot value is never a reason to silently defer goods.
export function prepareInput(input: PlannerInput): PlannerInput {
  object(input, 'Planner input');
  text(input.depotId, 'depotId');
  date(input.date, 'date');
  flag(input.operatingDay, 'operatingDay');
  object(input.settings, 'settings');
  const { settings } = input;
  flag(settings.mixBrands, 'settings.mixBrands');
  number(settings.reloadMin, 'settings.reloadMin', false, true);
  number(settings.waitWarnMin, 'settings.waitWarnMin', false, true);
  object(settings.earliestLeave, 'settings.earliestLeave');
  for (const brand of brands) minute(settings.earliestLeave[brand], `settings.earliestLeave.${brand}`);
  object(settings.budgetMin, 'settings.budgetMin');
  number(settings.budgetMin.fresh, 'settings.budgetMin.fresh', false, true);
  number(settings.budgetMin.styleTech, 'settings.budgetMin.styleTech', false, true);

  for (const name of ['orders', 'products', 'outlets', 'vehicles', 'travel', 'allowances'] as const) rows(input[name], name);
  for (const [name, list] of [['order', input.orders], ['product', input.products], ['outlet', input.outlets], ['vehicle', input.vehicles]] as const) {
    for (const row of list) text(row.id, `${name} id`);
    unique(list as { id: string }[], name, (row) => row.id);
  }
  if (input.orders.length > 300) fail('At most 300 input orders can be planned');

  for (const product of input.products) {
    number(product.kgPerUnit, `product ${product.id} kgPerUnit`, true);
    number(product.m3PerUnit, `product ${product.id} m3PerUnit`, true);
    choice(product.temp, ['chilled', 'dry'], `product ${product.id} temp`);
    flag(product.needsTailLift, `product ${product.id} needsTailLift`);
    flag(product.keepUpright, `product ${product.id} keepUpright`);
  }
  for (const shop of input.outlets) {
    const at = `outlet ${shop.id}`;
    text(shop.name, `${at} name`);
    text(shop.district, `${at} district`);
    text(shop.depotId, `${at} depotId`);
    choice(shop.brand, brands, `${at} brand`);
    choice(shop.dockType, docks, `${at} dockType`);
    choice(shop.parking, ['normal', 'van_only', 'mall_dock'], `${at} parking`);
    minute(shop.windowOpen, `${at} windowOpen`);
    minute(shop.windowClose, `${at} windowClose`);
    if (shop.windowOpen > shop.windowClose) fail(`${at} window opens after it closes`);
    if (shop.mallOpen !== undefined || shop.mallClose !== undefined) {
      minute(shop.mallOpen, `${at} mallOpen`);
      minute(shop.mallClose, `${at} mallClose`);
      if (shop.mallOpen! > shop.mallClose!) fail(`${at} mall window opens after it closes`);
    }
  }
  for (const vehicle of input.vehicles) {
    const at = `vehicle ${vehicle.id}`;
    text(vehicle.depotId, `${at} depotId`);
    choice(vehicle.type, ['truck', 'van'], `${at} type`);
    choice(vehicle.temp, ['reefer', 'ambient'], `${at} temp`);
    flag(vehicle.available, `${at} available`);
    for (const field of ['weightCapKg', 'volumeCapM3', 'kmPerL'] as const) number(vehicle[field], `${at} ${field}`, true);
    for (const field of ['weeklyFuelQuotaL', 'litresUsedThisWeek'] as const) number(vehicle[field], `${at} ${field}`);
  }
  for (const row of input.travel) {
    text(row.depotId, 'travel depotId');
    text(row.district, 'travel district');
    for (const field of ['outMin', 'betweenMin'] as const) number(row[field], `travel ${row.district} ${field}`, false, true);
    for (const field of ['outKm', 'betweenKm'] as const) number(row[field], `travel ${row.district} ${field}`);
  }
  unique(input.travel, 'travel key', (row) => JSON.stringify([row.depotId, row.district]));
  for (const row of input.allowances) {
    choice(row.brand, brands, 'allowance brand');
    choice(row.dockType, docks, 'allowance dockType');
    number(row.minutes, `allowance ${row.brand}/${row.dockType} minutes`, false, true);
  }
  unique(input.allowances, 'allowance key', (row) => JSON.stringify([row.brand, row.dockType]));

  const shops = new Map(input.outlets.map((shop) => [shop.id, shop]));
  const chilled = new Map<string, boolean>();
  for (const order of input.orders) {
    const at = `order ${order.id}`;
    if (order.id.startsWith('split:')) fail(`${at} uses the reserved split: prefix`);
    date(order.deliveryDate, `${at} deliveryDate`);
    number(order.timesDeferred, `${at} timesDeferred`, false, true);
    if (order.splitFrom !== null) {
      text(order.splitFrom, `${at} splitFrom`);
      if (order.splitFrom === order.id || order.splitFrom.startsWith('split:')) fail(`${at} has an invalid splitFrom parent`);
    }
    text(order.outletId, `${at} outletId`);
    const shop = shops.get(order.outletId);
    if (!shop) fail(`${at} has no outlet ${order.outletId} in the input`);
    if (shop!.depotId !== input.depotId) fail(`${at} belongs to depot ${shop!.depotId}, not ${input.depotId}`);
    if (!input.travel.some((row) => row.depotId === input.depotId && row.district === shop!.district)) fail(`${at} has no travel figures for ${input.depotId}/${shop!.district}`);
    if (!input.allowances.some((row) => row.brand === shop!.brand && row.dockType === shop!.dockType)) fail(`${at} has no allowance for ${shop!.brand}/${shop!.dockType}`);
    rows(order.lines, `${at} lines`);
    if (order.lines.length === 0) fail(`${at} lines must contain goods`);
    for (const line of order.lines) {
      text(line.productId, `${at} line productId`);
      number(line.quantity, `${at} ${line.productId} quantity`, true, true);
    }
    unique(order.lines, `${at} line product`, (line) => line.productId);
    const load = computeLoad(order.lines, input.products);
    if (!Number.isSafeInteger(load.units) || !Number.isFinite(load.kg) || !Number.isFinite(load.m3)) fail(`${at} load exceeds safe numeric limits`);
    chilled.set(order.id, load.needsReefer);
  }

  const byId = <T extends { id: string }>(a: T, b: T) => compare(a.id, b.id);
  const result: PlannerInput = {
    date: input.date, depotId: input.depotId, operatingDay: input.operatingDay,
    settings: { ...settings, earliestLeave: { ...settings.earliestLeave }, budgetMin: { ...settings.budgetMin } },
    products: input.products.map((row) => ({ ...row })).sort(byId),
    outlets: input.outlets.map((row) => ({ ...row })).sort(byId),
    vehicles: input.vehicles.map((row) => ({ ...row })).sort(byId),
    travel: input.travel.map((row) => ({ ...row })).sort((a, b) => compare(a.depotId, b.depotId) || compare(a.district, b.district)),
    allowances: input.allowances.map((row) => ({ ...row })).sort((a, b) => compare(a.brand, b.brand) || compare(a.dockType, b.dockType)),
    orders: input.orders.map((row) => ({ ...row, lines: row.lines.map((line) => ({ ...line })).sort((a, b) => compare(a.productId, b.productId)) })),
  };
  result.orders.sort((a, b) => {
    const aw = isWaiting(a, input.date), bw = isWaiting(b, input.date);
    const as = shops.get(a.outletId)!, bs = shops.get(b.outletId)!;
    return Number(bw) - Number(aw)
      || (aw && bw ? compare(a.deliveryDate, b.deliveryDate) : 0)
      || Number(chilled.get(b.id)) - Number(chilled.get(a.id))
      || effectiveWindow(as).close - effectiveWindow(bs).close
      || Number(bs.brand === 'Fresh') - Number(as.brand === 'Fresh')
      || Number(bs.mallOpen !== undefined) - Number(as.mallOpen !== undefined)
      || Number(bs.parking === 'van_only') - Number(as.parking === 'van_only')
      || compare(as.district, bs.district) || compare(as.id, bs.id) || compare(a.id, b.id);
  });
  return result;
}
