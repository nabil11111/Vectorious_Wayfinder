import { describe, expect, it } from 'vitest';
import { PlanInputError } from '../errors';
import { checkPlan } from '../check';
import { computeLoad } from '../load';
import { outlet } from '../testing/shared';
import type { EngineOutlet, PlannerInput, PlannerOrder } from '../types';
import { compare, effectiveWindow, isWaiting, prepareInput } from './priority';
import { plannerInput, plannerOrder } from './testing/input';

// Each pair uses shared rows, with deliberate equal windows/access/brand so only the named key wins.
const pair = (preferred: Partial<PlannerOrder> = {}, other: Partial<PlannerOrder> = {},
  preferredShop: Partial<EngineOutlet> = {}, otherShop: Partial<EngineOutlet> = {}) => {
  const base = { ...outlet('OUT005'), brand: 'Style' as const, parking: 'normal' as const, windowOpen: 240, windowClose: 479 };
  const shops = [{ ...base, id: 'OUT005', ...preferredShop }, { ...base, id: 'OUT004', ...otherShop }];
  return plannerInput([
    plannerOrder('z-preferred', shops[0]!.id, 'fresh-dry-carton', 1, preferred),
    plannerOrder('a-other', shops[1]!.id, 'fresh-dry-carton', 1, other),
  ], { outlets: shops });
};

const ids = (input: PlannerInput) => prepareInput(input).orders.map((order) => order.id);
const freeze = (value: unknown): void => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
};

describe('AC-2: every priority key has a pair that defeats the later ties', () => {
  const cases: [string, PlannerInput][] = [
    ['old dry before new chilled', pair({ deliveryDate: '2026-06-24' }, { lines: [{ productId: 'fresh-chilled-carton', quantity: 1 }] })],
    ['history marks a same-day dry order as waiting', pair({ timesDeferred: 1 }, { lines: [{ productId: 'fresh-chilled-carton', quantity: 1 }] })],
    ['oldest waiting wanted date before recent chilled', pair({ deliveryDate: '2026-06-23' }, { deliveryDate: '2026-06-24', lines: [{ productId: 'fresh-chilled-carton', quantity: 1 }] })],
    ['older district before a newer district', pair({ deliveryDate: '2026-06-23' }, { deliveryDate: '2026-06-24' }, { district: 'Gampaha' }, { district: 'Colombo' })],
    ['chilled before dry in one age tier', pair({ lines: [{ productId: 'fresh-chilled-carton', quantity: 1 }] }, {}, { windowClose: 600 }, { windowClose: 400 })],
    ['earlier shop closing', pair({}, {}, { windowClose: 450 }, { windowClose: 460 })],
    ['earlier mall closing', pair({}, {}, { windowClose: 900, mallOpen: 250, mallClose: 450 }, { windowClose: 460 })],
    ['Fresh closing capped at 07:59', pair({}, {}, { brand: 'Fresh', windowClose: 900 }, { windowClose: 480 })],
    ['Fresh brand when closing ties', pair({}, {}, { brand: 'Fresh' }, { mallOpen: 240, mallClose: 479, parking: 'van_only' })],
    ['mall slot when brand and closing tie', pair({}, {}, { mallOpen: 240, mallClose: 479 }, { parking: 'van_only' })],
    ['van-only access when earlier keys tie', pair({}, {}, { parking: 'van_only' }, {})],
    ['district before outlet and order IDs', pair({}, {}, { district: 'Colombo' }, { district: 'Gampaha' })],
    ['outlet ID before order ID', pair({}, {}, { id: 'OUT004' }, { id: 'OUT005' })],
    ['order ID after equal shop', pair({ id: 'a-preferred', outletId: 'OUT005' }, { id: 'z-other', outletId: 'OUT005' })],
  ];
  it.each(cases)('%s', (_name, input) => {
    expect(ids(input)).toEqual(input.orders.map((order) => order.id));
    expect(ids({ ...input, orders: [...input.orders].reverse(), outlets: [...input.outlets].reverse() })).toEqual(input.orders.map((order) => order.id));
  });

  it('same-date waiting count and quantity give no extra priority', () => {
    const input = pair({ deliveryDate: '2026-06-24', timesDeferred: 99, lines: [{ productId: 'fresh-dry-carton', quantity: 900 }] }, { deliveryDate: '2026-06-24', timesDeferred: 1 });
    expect(ids(input)).toEqual(['a-other', 'z-preferred']);
  });

  it('all orders that have not waited share one date tier', () => {
    expect(ids(pair({}, { deliveryDate: '2026-06-26' }))).toEqual(['a-other', 'z-preferred']);
  });

  it('compares strings by Unicode code point, including case and supplementary characters', () => {
    expect(compare('Z', 'a')).toBeLessThan(0);
    expect(compare('z', 'é')).toBeLessThan(0);
    expect(compare('\uE000', '\u{10000}')).toBeLessThan(0);
    expect(compare('same', 'same')).toBe(0);
    expect(compare('a', 'aa')).toBeLessThan(0);
  });

  it('waiting is an earlier wanted date or a nonzero deferral history', () => {
    expect(isWaiting(plannerOrder('old', 'OUT001', undefined, 1, { deliveryDate: '2026-06-24' }), '2026-06-25')).toBe(true);
    expect(isWaiting(plannerOrder('deferred', 'OUT001', undefined, 1, { timesDeferred: 1 }), '2026-06-25')).toBe(true);
    expect(isWaiting(plannerOrder('new', 'OUT001'), '2026-06-25')).toBe(false);
  });

  it('intersects windows and applies the Fresh deadline without rejecting an empty intersection', () => {
    expect(effectiveWindow({ ...outlet('OUT001'), windowClose: 600, mallOpen: 330, mallClose: 550 })).toEqual({ open: 330, close: 479 });
    const input = plannerInput([plannerOrder('o', 'OUT017')]);
    Object.assign(input.outlets.find((shop) => shop.id === 'OUT017')!, { windowOpen: 600, windowClose: 700, mallOpen: 800, mallClose: 900 });
    expect(() => prepareInput(input)).not.toThrow();
    expect(effectiveWindow(input.outlets.find((shop) => shop.id === 'OUT017')!)).toEqual({ open: 800, close: 700 });
  });

  it('canonicalizes every array and order line without changing frozen input', () => {
    const input = plannerInput([plannerOrder('b', 'OUT005', undefined, 1, { lines: [{ productId: 'fresh-dry-carton', quantity: 2 }, { productId: 'fresh-chilled-carton', quantity: 1 }] }), plannerOrder('a', 'OUT001')]);
    const before = structuredClone(input);
    const shuffled = structuredClone(input);
    for (const field of ['orders', 'products', 'outlets', 'vehicles', 'travel', 'allowances'] as const) shuffled[field].reverse();
    shuffled.orders.forEach((order) => order.lines.reverse());
    freeze(input);
    const result = prepareInput(input);
    expect(result).toEqual(prepareInput(shuffled));
    expect(input).toEqual(before);
    result.orders[0]!.lines[0]!.quantity = 20;
    result.settings.earliestLeave.Fresh = 0;
    result.outlets[0]!.name = 'Changed';
    expect(input).toEqual(before);
  });
});

describe('AC-19: malformed or incomplete snapshots name their input fault', () => {
  type BadCase = [string, (input: PlannerInput) => void, RegExp];
  const cases: BadCase[] = [
    ['invalid plan day', (x) => { x.date = '2026-02-29'; }, /date/i],
    ['noncanonical plan day', (x) => { x.date = '2026-6-25'; }, /date/i],
    ['invalid wanted date', (x) => { x.orders[0]!.deliveryDate = '2026-04-31'; }, /deliveryDate|wanted|date/i],
    ['missing wanted date', (x) => { delete (x.orders[0] as Partial<PlannerOrder>).deliveryDate; }, /deliveryDate|wanted|date/i],
    ['missing deferral history', (x) => { delete (x.orders[0] as Partial<PlannerOrder>).timesDeferred; }, /timesDeferred|history/i],
    ['negative history', (x) => { x.orders[0]!.timesDeferred = -1; }, /timesDeferred|history/i],
    ['fractional history', (x) => { x.orders[0]!.timesDeferred = 1.5; }, /timesDeferred|history/i],
    ['missing parent history', (x) => { delete (x.orders[0] as Partial<PlannerOrder>).splitFrom; }, /splitFrom|parent|history/i],
    ['empty parent ID', (x) => { x.orders[0]!.splitFrom = ''; }, /splitFrom|parent/i],
    ['self parent ID', (x) => { x.orders[0]!.splitFrom = 'order-1'; }, /splitFrom|parent/i],
    ['reserved ID', (x) => { x.orders[0]!.id = 'split:original:keep'; }, /reserved|split:/i],
    ['duplicate orders', (x) => { x.orders.push(structuredClone(x.orders[0]!)); }, /duplicate.*order/i],
    ['duplicate products', (x) => { x.products.push(structuredClone(x.products[0]!)); }, /duplicate.*product/i],
    ['duplicate outlets', (x) => { x.outlets.push(structuredClone(x.outlets[0]!)); }, /duplicate.*outlet|duplicate.*shop/i],
    ['duplicate vehicles', (x) => { x.vehicles.push(structuredClone(x.vehicles[0]!)); }, /duplicate.*vehicle/i],
    ['duplicate travel keys', (x) => { x.travel.push(structuredClone(x.travel[0]!)); }, /duplicate.*travel/i],
    ['duplicate allowance keys', (x) => { x.allowances.push(structuredClone(x.allowances[0]!)); }, /duplicate.*allowance/i],
    ['empty order ID', (x) => { x.orders[0]!.id = ''; }, /order.*id/i],
    ['unknown shop', (x) => { x.orders[0]!.outletId = 'missing'; }, /missing|outlet|shop/i],
    ['foreign order depot', (x) => { x.outlets.find((shop) => shop.id === 'OUT001')!.depotId = 'Kandy'; }, /depot/i],
    ['empty lines', (x) => { x.orders[0]!.lines = []; }, /lines|goods/i],
    ['duplicate line products', (x) => { x.orders[0]!.lines.push({ ...x.orders[0]!.lines[0]! }); }, /duplicate.*product|duplicate.*line/i],
    ['unknown product', (x) => { x.orders[0]!.lines[0]!.productId = 'missing'; }, /product/i],
    ['zero quantity', (x) => { x.orders[0]!.lines[0]!.quantity = 0; }, /quantity/i],
    ['fractional quantity', (x) => { x.orders[0]!.lines[0]!.quantity = 1.5; }, /quantity/i],
    ['infinite quantity', (x) => { x.orders[0]!.lines[0]!.quantity = Infinity; }, /quantity/i],
    ['unsafe quantity', (x) => { x.orders[0]!.lines[0]!.quantity = Number.MAX_SAFE_INTEGER + 1; }, /quantity/i],
    ['more than 300 originals', (x) => { x.orders = Array.from({ length: 301 }, (_, i) => plannerOrder(`o${i}`, 'OUT001')); }, /300|orders/i],
    ['missing travel', (x) => { x.travel = x.travel.filter((row) => row.district !== 'Colombo' || row.depotId !== x.depotId); }, /travel/i],
    ['missing allowance', (x) => { x.allowances = x.allowances.filter((row) => row.brand !== 'Fresh' || row.dockType !== 'street'); }, /allowance/i],
    ['negative reload', (x) => { x.settings.reloadMin = -1; }, /reload/i],
    ['fractional reload', (x) => { x.settings.reloadMin = 0.5; }, /reload/i],
    ['infinite wait warning', (x) => { x.settings.waitWarnMin = Infinity; }, /waitWarn/i],
    ['negative budget', (x) => { x.settings.budgetMin.fresh = -1; }, /budget/i],
    ['departure after day', (x) => { x.settings.earliestLeave.Tech = 1440; }, /earliestLeave|departure/i],
    ['fractional window', (x) => { x.outlets[0]!.windowOpen = 0.5; }, /window/i],
    ['reversed shop window', (x) => { x.outlets[0]!.windowOpen = x.outlets[0]!.windowClose + 1; }, /window/i],
    ['window outside day', (x) => { x.outlets[0]!.windowClose = 1440; }, /window/i],
    ['incomplete mall window', (x) => { x.outlets[0]!.mallOpen = 600; }, /mall/i],
    ['reversed mall window', (x) => { x.outlets[0]!.mallOpen = 700; x.outlets[0]!.mallClose = 600; }, /mall/i],
    ['empty shop name', (x) => { x.outlets[0]!.name = ' '; }, /name/i],
    ['nonfinite product weight', (x) => { x.products[0]!.kgPerUnit = NaN; }, /kgPerUnit|weight/i],
    ['zero product volume', (x) => { x.products[0]!.m3PerUnit = 0; }, /m3PerUnit|volume/i],
    ['zero vehicle efficiency', (x) => { x.vehicles[0]!.kmPerL = 0; }, /kmPerL/i],
    ['negative vehicle capacity', (x) => { x.vehicles[0]!.weightCapKg = -1; }, /weightCapKg|capacity/i],
    ['infinite vehicle volume', (x) => { x.vehicles[0]!.volumeCapM3 = Infinity; }, /volumeCapM3|capacity/i],
    ['negative fuel quota', (x) => { x.vehicles[0]!.weeklyFuelQuotaL = -1; }, /weeklyFuelQuotaL|quota/i],
    ['negative fuel history', (x) => { x.vehicles[0]!.litresUsedThisWeek = -1; }, /litresUsedThisWeek|fuel/i],
    // A vehicle's driver is optional (spec 026), but one that is given has a name to call the truck by.
    ['empty driver name', (x) => { x.vehicles[0]!.driverName = ' '; }, /driverName/i],
    ['negative travel distance', (x) => { x.travel[0]!.outKm = -1; }, /outKm|travel/i],
    ['fractional travel minute', (x) => { x.travel[0]!.betweenMin = 1.5; }, /betweenMin|travel/i],
    ['negative allowance', (x) => { x.allowances[0]!.minutes = -1; }, /allowance|minutes/i],
    ['wrong operating flag', (x) => { (x as unknown as Record<string, unknown>).operatingDay = 'yes'; }, /operatingDay/i],
    ['wrong mix flag', (x) => { (x.settings as unknown as Record<string, unknown>).mixBrands = 'yes'; }, /mixBrands/i],
    ['wrong product temperature', (x) => { (x.products[0] as unknown as Record<string, unknown>).temp = 'warm'; }, /temp/i],
    ['wrong product flag', (x) => { (x.products[0] as unknown as Record<string, unknown>).needsTailLift = 'yes'; }, /needsTailLift/i],
    ['wrong vehicle type', (x) => { (x.vehicles[0] as unknown as Record<string, unknown>).type = 'bike'; }, /type/i],
    ['wrong vehicle temperature', (x) => { (x.vehicles[0] as unknown as Record<string, unknown>).temp = 'dry'; }, /temp/i],
    ['wrong vehicle availability', (x) => { (x.vehicles[0] as unknown as Record<string, unknown>).available = 1; }, /available/i],
    ['wrong shop brand', (x) => { (x.outlets[0] as unknown as Record<string, unknown>).brand = 'Other'; }, /brand/i],
    ['wrong dock type', (x) => { (x.outlets[0] as unknown as Record<string, unknown>).dockType = 'side'; }, /dockType/i],
    ['wrong parking', (x) => { (x.outlets[0] as unknown as Record<string, unknown>).parking = 'any'; }, /parking/i],
    ['missing settings', (x) => { delete (x as Partial<PlannerInput>).settings; }, /settings/i],
    ['missing order array', (x) => { delete (x as Partial<PlannerInput>).orders; }, /orders/i],
    ['null product row', (x) => { x.products[0] = null as never; }, /product/i],
  ];
  it.each(cases)('%s', (_name, change, fault) => {
    const input = plannerInput([plannerOrder('order-1', 'OUT001')]);
    change(input);
    expect(() => prepareInput(input)).toThrow(PlanInputError);
    expect(() => prepareInput(input)).toThrow(fault);
  });

  it('accepts empty orders, leap day, 300 originals, existing children, large whole orders, and unusable vehicles', () => {
    expect(prepareInput(plannerInput()).orders).toEqual([]);
    expect(prepareInput(plannerInput([], { date: '2024-02-29' })).date).toBe('2024-02-29');
    const input = plannerInput(Array.from({ length: 300 }, (_, i) => plannerOrder(`o${i}`, 'OUT001', undefined, 1000, { splitFrom: 'parent' })));
    input.vehicles.forEach((vehicle) => { vehicle.available = false; vehicle.litresUsedThisWeek = vehicle.weeklyFuelQuotaL + 1; });
    expect(prepareInput(input).orders).toHaveLength(300);
  });
});

describe('AC-19: figures must survive the checker fixed-point arithmetic', () => {
  const cases: [string, (input: PlannerInput) => void, RegExp][] = [
    ['reload that makes the second trip unsafe', (x) => { x.settings.reloadMin = Number.MAX_SAFE_INTEGER; }, /timing|reload/i],
    ['travel that overflows two bounded trips', (x) => { x.travel[0]!.outMin = Math.floor(Number.MAX_SAFE_INTEGER / 3); }, /timing|travel/i],
    ['unloading that overflows 40 stops', (x) => { x.allowances[0]!.minutes = Math.floor(Number.MAX_SAFE_INTEGER / 40); }, /timing|allowance/i],
    ['efficiency rounded to zero', (x) => { x.vehicles[0]!.kmPerL = 0.001; }, /kmPerL/i],
    ['efficiency with unsupported precision', (x) => { x.vehicles[0]!.kmPerL = 4.701; }, /kmPerL/i],
    ['product weight rounded to zero', (x) => { x.products[0]!.kgPerUnit = 0.001; }, /kgPerUnit/i],
    ['product volume rounded to zero', (x) => { x.products[0]!.m3PerUnit = 0.0001; }, /m3PerUnit/i],
    ['product weight silently rounded', (x) => { x.products[0]!.kgPerUnit = 6.901; }, /kgPerUnit/i],
    ['product volume silently rounded', (x) => { x.products[0]!.m3PerUnit = 0.0371; }, /m3PerUnit/i],
    ['vehicle weight silently rounded', (x) => { x.vehicles[0]!.weightCapKg = 100.001; }, /weightCapKg/i],
    ['vehicle volume silently rounded', (x) => { x.vehicles[0]!.volumeCapM3 = 5.0001; }, /volumeCapM3/i],
    ['fuel quota silently rounded', (x) => { x.vehicles[0]!.weeklyFuelQuotaL = 100.01; }, /weeklyFuelQuotaL/i],
    ['fuel used silently rounded', (x) => { x.vehicles[0]!.litresUsedThisWeek = 0.01; }, /litresUsedThisWeek/i],
    ['outbound distance silently rounded', (x) => { x.travel[0]!.outKm = 10.01; }, /outKm/i],
    ['between distance silently rounded', (x) => { x.travel[0]!.betweenKm = 1.01; }, /betweenKm/i],
    ['unsafe scaled product', (x) => { x.products[0]!.kgPerUnit = Number.MAX_SAFE_INTEGER; }, /kgPerUnit/i],
    ['unsafe scaled vehicle capacity', (x) => { x.vehicles[0]!.volumeCapM3 = Number.MAX_SAFE_INTEGER; }, /volumeCapM3/i],
    ['unsafe line load', (x) => { x.orders[0]!.lines[0]!.quantity = Math.floor(Number.MAX_SAFE_INTEGER / 690) + 1; }, /load|quantity/i],
    ['safe individual orders with unsafe combined load', (x) => {
      const quantity = Math.floor(Number.MAX_SAFE_INTEGER / 690 * 0.75);
      x.orders = [plannerOrder('a', 'OUT001', undefined, quantity), plannerOrder('b', 'OUT001', undefined, quantity)];
    }, /load|aggregate/i],
    ['safe product and quantity with unsafe volume total', (x) => {
      x.products.find((p) => p.id === 'fresh-dry-carton')!.m3PerUnit = 1000;
      x.orders[0]!.lines[0]!.quantity = 10_000_000_000;
    }, /load|aggregate/i],
    ['distance numerator overflows the fuel calculation', (x) => { x.travel[0]!.outKm = 10_000_000_000_000; }, /fuel|distance/i],
    ['fuel quota times efficiency overflows', (x) => { x.vehicles[0]!.kmPerL = 100_000_000_000; }, /fuel/i],
    ['used plus proposed fuel overflows', (x) => {
      x.vehicles[0]!.kmPerL = 0.01;
      x.vehicles[0]!.weeklyFuelQuotaL = 0;
      x.vehicles[0]!.litresUsedThisWeek = 900_719_925_474_099;
    }, /fuel/i],
  ];
  it.each(cases)('%s', (_name, change, fault) => {
    const input = plannerInput([plannerOrder('order-1', 'OUT001', undefined, 1000)]);
    change(input);
    expect(() => prepareInput(input)).toThrow(PlanInputError);
    expect(() => prepareInput(input)).toThrow(fault);
  });

  it('preserves the smallest supported product and efficiency figures', () => {
    const input = plannerInput([plannerOrder('o', 'OUT001', undefined, 1000)]);
    const product = input.products.find((p) => p.id === 'fresh-dry-carton')!;
    product.kgPerUnit = 0.01;
    product.m3PerUnit = 0.001;
    input.vehicles[0]!.kmPerL = 0.01;
    input.vehicles[0]!.litresUsedThisWeek = 0.1;
    const prepared = prepareInput(input);
    expect(computeLoad(prepared.orders[0]!.lines, prepared.products)).toMatchObject({ kg: 10, m3: 1, units: 1000 });
    const checked = checkPlan({ ...prepared, orders: [], plan: { trips: [], deferrals: [] } });
    expect(checked.ok).toBe(true);
    expect(checked.vehicles.every((vehicle) => Object.values(vehicle).every((value) => typeof value !== 'number' || Number.isFinite(value)))).toBe(true);
  });

  it('bounds derived timing without adding an arbitrary maximum duration', () => {
    const input = plannerInput();
    input.travel.forEach((row) => { row.outMin = 0; row.betweenMin = 0; });
    input.allowances.forEach((row) => { row.minutes = 0; });
    input.settings.reloadMin = Math.floor((Number.MAX_SAFE_INTEGER - 1439) / 2);
    expect(() => prepareInput(input)).not.toThrow();
    input.settings.reloadMin += 1;
    expect(() => prepareInput(input)).toThrow(/timing|reload/i);
  });
});
