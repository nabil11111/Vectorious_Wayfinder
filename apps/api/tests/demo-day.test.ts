import { DEMO_DAY } from '@wayfinder/contracts';
import { and, eq, isNull, sql, TransactionRollbackError } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { db, pool, type Tx } from '../src/db/client';
import { clearDemoDay, demoId, seedDemoDay } from '../src/db/demo-day';
import { deferrals, demoDay, fuelLog, orderLines, orders, outlets, plans, products, stopOrders, stops, trips, users, vehicleDaysOff, vehicles } from '../src/db/schema';
import { depotDate, depotInstant, depotMinutes, realNow } from '../src/lib/clock';

afterAll(() => pool.end());

// The seeded day of spec 008. Every figure here is the spec's, worked out from data/shared and the product
// list, so a changed rule in the seed shows up as a changed total.
const MON = '2026-06-22';
const TUE = '2026-06-23';
const WED = '2026-06-24';
const THU = '2026-06-25';

// Why an order may wait, from spec 007. The list is not in the contracts on this branch yet.
const DEFERRAL_CODES = ['no_reefer', 'over_capacity', 'no_van', 'window', 'fuel', 'dispatcher_choice'];

// Other test files may have moved the clock or changed the day, and this one must leave both as it found
// them. So each test runs in one transaction: it removes the day and the clock row, which is what an empty
// database is to the seed, does its work and is rolled back.
async function onEmptyDatabase(work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await clearDemoDay(tx);
      await tx.delete(demoDay);
      await work(tx);
      tx.rollback();
    });
  } catch (err) {
    if (!(err instanceof TransactionRollbackError)) throw err;
  }
}

// The same, with the day written before the check starts.
const seeded = (check: (tx: Tx) => Promise<void>) => onEmptyDatabase(async (tx) => {
  expect(await seedDemoDay(tx)).toBe(true);
  await check(tx);
});

// Every order with its shop and its load, added up from the product list the database holds. The load is
// kept in whole units, hundredths of a kilo and litres of space, and divided once at the end, because
// 6.9 × 48 is 331.20000000000005 in JavaScript. `strays` counts the lines whose item is not of the shop's
// brand or not of the order's temperature.
function ordersWithLoads(tx: Tx) {
  return tx.select({
    id: orders.id, outletId: orders.outletId, date: orders.deliveryDate, temp: orders.temp, status: orders.status,
    placedAt: orders.placedAt, createdBy: orders.createdBy, revision: orders.revision,
    brand: outlets.brand, district: outlets.district, depotId: outlets.depotId, parking: outlets.parking,
    units: sql<number>`coalesce(sum(${orderLines.quantity}), 0)::int`,
    centikilos: sql<number>`coalesce(sum(${orderLines.quantity} * ${products.kgPerUnit} * 100), 0)::int`,
    litres: sql<number>`coalesce(sum(${orderLines.quantity} * ${products.m3PerUnit} * 1000), 0)::int`,
    tailLift: sql<boolean>`coalesce(bool_or(${products.needsTailLift}), false)`,
    strays: sql<number>`(count(*) filter (where ${products.brand} <> ${outlets.brand} or ${products.temp} <> ${orders.temp}))::int`,
  }).from(orders)
    .innerJoin(outlets, eq(outlets.id, orders.outletId))
    .leftJoin(orderLines, eq(orderLines.orderId, orders.id))
    .leftJoin(products, eq(products.id, orderLines.productId))
    .groupBy(orders.id, outlets.id)
    .orderBy(orders.outletId, orders.deliveryDate, orders.temp);
}
type Order = Awaited<ReturnType<typeof ordersWithLoads>>[number];

const sum = (numbers: number[]) => numbers.reduce((a, b) => a + b, 0);
const total = (list: Order[]) => ({
  orders: list.length,
  units: sum(list.map((o) => o.units)),
  kg: sum(list.map((o) => o.centikilos)) / 100,
  m3: sum(list.map((o) => o.litres)) / 1000,
});
const is = (brand: string, temp: string) => (o: Order) => o.brand === brand && o.temp === temp;
const shopNumber = (o: Order) => Number(o.outletId.slice(3));

// What one order holds, as { product: quantity }.
async function linesOf(tx: Tx, orderId: string) {
  const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, orderId));
  return Object.fromEntries(lines.map((line) => [line.productId, line.quantity]));
}

// Peliyagoda's fridge vehicles that are not in the workshop on a date.
function workingFridgeVehicles(tx: Tx, date: string) {
  return tx.select({ id: vehicles.id, type: vehicles.type, volumeCapM3: vehicles.volumeCapM3 }).from(vehicles)
    .leftJoin(vehicleDaysOff, and(eq(vehicleDaysOff.vehicleId, vehicles.id), eq(vehicleDaysOff.date, date)))
    .where(and(eq(vehicles.depotId, 'Peliyagoda'), eq(vehicles.temp, 'reefer'), isNull(vehicleDaysOff.vehicleId)))
    .orderBy(vehicles.id);
}

const userId = async (tx: Tx, username: string) => (await tx.select().from(users).where(eq(users.username, username)))[0]!.id;

// The tables the day lives in. Trips, stops and the orders on them are not seeded. People add them.
const DAY_TABLES = ['demo_day', 'orders', 'order_lines', 'plans', 'deferrals', 'trips', 'stops', 'stop_orders', 'vehicle_days_off', 'fuel_log'] as const;
const NOTHING = Object.fromEntries(DAY_TABLES.map((table) => [table, 0]));

// Every row of those tables as the database holds it, in a fixed order. The columns that say when the system
// really wrote a row differ from one run to the next, so a comparison between two runs leaves them out.
async function everyRow(tx: Tx, { realTime = true } = {}) {
  const row = realTime ? sql`to_jsonb(t)` : sql`to_jsonb(t) - '{created_at,updated_at,clock_set_at,seeded_at}'::text[]`;
  const held: Record<string, unknown[]> = {};
  for (const table of DAY_TABLES) {
    const found = await tx.execute<{ row: unknown }>(sql`select ${row} as row from ${sql.identifier(table)} t order by 1`);
    held[table] = found.rows.map((r) => r.row);
  }
  return held;
}
const rowCounts = async (tx: Tx) => Object.fromEntries(Object.entries(await everyRow(tx)).map(([table, rows]) => [table, rows.length]));

describe('the seeded day on an empty database', () => {
  it('AC-1 holds the clock at Wed 24 Jun 2026 15:00 depot time, in the part ordering, with revision 0 and day 1', async () => {
    const started = realNow();
    await seeded(async (tx) => {
      const rows = await tx.select().from(demoDay);
      expect(rows).toHaveLength(1);
      const clock = rows[0]!;
      expect([depotDate(clock.clockBase), depotMinutes(clock.clockBase)]).toEqual([WED, 15 * 60]);
      // The part of an instant is the last part that has started by then.
      const part = DEMO_DAY.parts.filter((p) => new Date(p.at).getTime() <= clock.clockBase.getTime()).at(-1);
      expect(part?.key).toBe('ordering');
      expect(clock).toMatchObject({ id: 1, revision: 0, day: 1 });
      // The real time at that moment, which the running clock counts on from, and the note that the day is written.
      expect(clock.seededAt).not.toBeNull();
      for (const real of [clock.clockSetAt, clock.seededAt!]) {
        expect(real.getTime()).toBeGreaterThanOrEqual(started.getTime());
        expect(real.getTime()).toBeLessThanOrEqual(realNow().getTime());
      }
    });
  });

  it('AC-28 writes 98 placed orders for Thursday, all for Peliyagoda shops: 48 Fresh dry, 34 Fresh chilled, 12 Style and 4 Tech', async () => {
    await seeded(async (tx) => {
      const placed = (await ordersWithLoads(tx)).filter((o) => o.status === 'placed');
      expect(placed).toHaveLength(98);
      expect([...new Set(placed.map((o) => o.date))]).toEqual([THU]);
      expect([...new Set(placed.map((o) => o.depotId))]).toEqual(['Peliyagoda']);
      // A shop has one order per temperature, never two, and an order holds only items of its shop's brand
      // and of its own temperature. So a Fresh chilled order is chilled cartons and nothing else.
      expect(new Set(placed.map((o) => `${o.outletId} ${o.temp}`)).size).toBe(98);
      expect(placed.filter((o) => o.strays > 0 || o.units === 0)).toEqual([]);

      const count = (brand: string, temp: string) => placed.filter(is(brand, temp)).length;
      expect({ freshDry: count('Fresh', 'dry'), freshChilled: count('Fresh', 'chilled'), style: count('Style', 'dry'), tech: count('Tech', 'dry') })
        .toEqual({ freshDry: 48, freshChilled: 34, style: 12, tech: 4 });

      // Every Fresh shop but OUT001, whose order is still a draft.
      const freshShops = await tx.select().from(outlets).where(and(eq(outlets.depotId, 'Peliyagoda'), eq(outlets.brand, 'Fresh')));
      expect(placed.filter(is('Fresh', 'dry')).map((o) => o.outletId).sort()).toEqual(freshShops.map((shop) => shop.id).filter((id) => id !== 'OUT001').sort());
      // Chilled for the Fresh shops whose number does not end in 0, 4 or 7. Style for the shops whose number is
      // not a multiple of 5. Tech for the four shops the spec names.
      expect(placed.filter(is('Fresh', 'chilled')).filter((o) => [0, 4, 7].includes(shopNumber(o) % 10))).toEqual([]);
      expect(placed.filter(is('Style', 'dry')).filter((o) => shopNumber(o) % 5 === 0)).toEqual([]);
      expect(placed.filter(is('Tech', 'dry')).map((o) => o.outletId)).toEqual(['OUT022', 'OUT039', 'OUT058', 'OUT072']);
    });
  });

  it('AC-29 adds up to 2,605 dry cartons, 1,669 chilled cartons, 501 Style units at 113.02 m³ and 11 Tech units at 2,290 kg', async () => {
    await seeded(async (tx) => {
      const placed = (await ordersWithLoads(tx)).filter((o) => o.status === 'placed');
      expect(total(placed.filter(is('Fresh', 'dry')))).toEqual({ orders: 48, units: 2605, kg: 17974.5, m3: 96.385 });
      expect(total(placed.filter(is('Fresh', 'chilled')))).toEqual({ orders: 34, units: 1669, kg: 11516.1, m3: 61.753 });
      expect(total(placed.filter(is('Style', 'dry')))).toEqual({ orders: 12, units: 501, kg: 6674, m3: 113.02 });
      expect(total(placed.filter(is('Tech', 'dry')))).toEqual({ orders: 4, units: 11, kg: 2290, m3: 7.71 });

      // 45 to 65 dry cartons and 38 to 60 chilled ones.
      const cartons = (temp: string) => placed.filter(is('Fresh', temp)).map((o) => o.units);
      expect([Math.min(...cartons('dry')), Math.max(...cartons('dry'))]).toEqual([45, 65]);
      expect([Math.min(...cartons('chilled')), Math.max(...cartons('chilled'))]).toEqual([38, 60]);

      // OUT026: 45 + (286 mod 21) = 58 dry cartons, and 38 + (130 mod 23) = 53 chilled ones.
      const order = (outletId: string, temp: string) => placed.filter((o) => o.outletId === outletId && o.temp === temp);
      expect(total(order('OUT026', 'dry'))).toMatchObject({ orders: 1, units: 58 });
      expect(total(order('OUT026', 'chilled'))).toEqual({ orders: 1, units: 53, kg: 365.7, m3: 1.961 });

      // OUT017 is the design's big Style order, the one View plan splits over two days.
      expect(total(order('OUT017', 'dry'))).toEqual({ orders: 1, units: 135, kg: 1815, m3: 31.1 });
      expect(await linesOf(tx, order('OUT017', 'dry')[0]!.id)).toEqual({ 'style-folded': 50, 'style-hanging': 45, 'style-shoes': 25, 'style-bags': 15 });
      // An ordinary Style shop. OUT016: folded 10 + (64 mod 9), hanging 6 + (80 mod 7), shoes 4 + (16 mod 6), bags 3 + (16 mod 4).
      expect(await linesOf(tx, order('OUT016', 'dry')[0]!.id)).toEqual({ 'style-folded': 11, 'style-hanging': 9, 'style-shoes': 8, 'style-bags': 3 });

      // The four Tech orders: what each holds, its kilos and cubic metres, and whether it needs a tail lift.
      const tech = [];
      for (const o of placed.filter(is('Tech', 'dry'))) tech.push([o.outletId, await linesOf(tx, o.id), o.centikilos / 100, o.litres / 1000, o.tailLift]);
      expect(tech).toEqual([
        ['OUT022', { 'tech-tv': 2, 'tech-small': 1 }, 530, 1.82, false],
        ['OUT039', { 'tech-fridge': 3 }, 750, 2.55, true],
        ['OUT058', { 'tech-washer': 2, 'tech-small': 2 }, 800, 2.64, true],
        ['OUT072', { 'tech-washer': 1 }, 210, 0.7, true],
      ]);
    });
  });

  it('AC-30 leaves OUT001 two draft orders for Thursday made by nadeesha, 8 chilled and 4 dry cartons, and no placed order', async () => {
    await seeded(async (tx) => {
      const nadeesha = await userId(tx, 'nadeesha');
      const all = await ordersWithLoads(tx);
      const thursday = all.filter((o) => o.outletId === 'OUT001' && o.date === THU);
      expect(thursday.map((o) => [o.temp, o.status, o.units, o.createdBy, o.placedAt])).toEqual([
        ['chilled', 'draft', 8, nadeesha, null],
        ['dry', 'draft', 4, nadeesha, null],
      ]);
      expect(await linesOf(tx, thursday[0]!.id)).toEqual({ 'fresh-chilled-carton': 8 });
      expect(await linesOf(tx, thursday[1]!.id)).toEqual({ 'fresh-dry-carton': 4 });
      // Hers are the only drafts of the day.
      expect(all.filter((o) => o.status === 'draft')).toHaveLength(2);
    });
  });

  it('AC-31 holds four chilled orders that waited, each with a deferral in the sent plan for Wednesday, and OUT060 with a second one in the plan for Tuesday', async () => {
    await seeded(async (tx) => {
      const all = await ordersWithLoads(tx);
      const waited = [];
      for (const o of all.filter((order) => order.status === 'deferred')) waited.push([o.outletId, o.temp, await linesOf(tx, o.id), o.date]);
      expect(waited).toEqual([
        ['OUT001', 'chilled', { 'fresh-chilled-carton': 12 }, WED],
        ['OUT030', 'chilled', { 'fresh-chilled-carton': 50 }, WED],
        ['OUT054', 'chilled', { 'fresh-chilled-carton': 55 }, WED],
        ['OUT060', 'chilled', { 'fresh-chilled-carton': 39 }, TUE],
      ]);

      // Peliyagoda's plans for Tuesday and Wednesday, which Ruwan sent at 17:00 on the day before. They hold
      // only what Thursday needs, so they have no trips.
      const ruwan = await userId(tx, 'ruwan');
      const sent = await tx.select().from(plans).orderBy(plans.date);
      expect(sent.map((p) => [p.depotId, p.date, p.status, p.createdBy, p.publishedAt])).toEqual([
        ['Peliyagoda', TUE, 'published', ruwan, depotInstant(MON, 17 * 60)],
        ['Peliyagoda', WED, 'published', ruwan, depotInstant(TUE, 17 * 60)],
      ]);
      expect(await tx.select().from(trips)).toEqual([]);

      const why = await tx.select({ plan: plans.date, outletId: orders.outletId, wanted: orders.deliveryDate, status: orders.status, code: deferrals.code, reason: deferrals.reason })
        .from(deferrals).innerJoin(plans, eq(plans.id, deferrals.planId)).innerJoin(orders, eq(orders.id, deferrals.orderId))
        .orderBy(plans.date, orders.outletId);
      expect(why).toEqual([
        { plan: TUE, outletId: 'OUT060', wanted: TUE, status: 'deferred', code: 'no_reefer', reason: 'No fridge truck was left for Matara.' },
        { plan: WED, outletId: 'OUT001', wanted: WED, status: 'deferred', code: 'over_capacity', reason: 'The fridge van was full.' },
        { plan: WED, outletId: 'OUT030', wanted: WED, status: 'deferred', code: 'no_reefer', reason: 'No fridge truck was left for Gampaha.' },
        { plan: WED, outletId: 'OUT054', wanted: WED, status: 'deferred', code: 'window', reason: 'The truck could not reach the shop before its window closed at 07:30.' },
        { plan: WED, outletId: 'OUT060', wanted: TUE, status: 'deferred', code: 'no_reefer', reason: 'No fridge truck was left for Matara. Two were in the workshop.' },
      ]);
      for (const { code } of why) expect(DEFERRAL_CODES).toContain(code);
    });
  });

  it('AC-32 has six workshop rows, which leave five fridge trucks and one fridge van working on Thursday', async () => {
    await seeded(async (tx) => {
      const off = await tx.select().from(vehicleDaysOff).orderBy(vehicleDaysOff.vehicleId, vehicleDaysOff.date);
      expect(off.map((row) => [row.vehicleId, row.date, row.reason])).toEqual([
        ['VEH003', TUE, 'Fridge unit repair'],
        ['VEH003', WED, 'Fridge unit repair'],
        ['VEH003', THU, 'Fridge unit repair'],
        ['VEH005', WED, 'Brake service'],
        ['VEH005', THU, 'Brake service'],
        ['VEH036', THU, 'Gearbox repair'],
      ]);
      const working = await workingFridgeVehicles(tx, THU);
      expect(working.map((v) => [v.id, v.type])).toEqual([
        ['VEH001', 'truck'], ['VEH002', 'truck'], ['VEH004', 'truck'], ['VEH006', 'truck'], ['VEH007', 'truck'], ['VEH035', 'van'],
      ]);
    });
  });

  it('AC-33 has 38 chilled orders and 1,825 cartons due on Thursday, in seven districts, with five fridge trucks working', async () => {
    await seeded(async (tx) => {
      // Due on Thursday: placed for that day, or still waiting from an earlier one.
      const due = (await ordersWithLoads(tx)).filter((o) => o.temp === 'chilled' && ((o.status === 'placed' && o.date === THU) || (o.status === 'deferred' && o.date < THU)));
      expect(total(due)).toEqual({ orders: 38, units: 1825, kg: 12592.5, m3: 67.525 });

      // The spec's table under "Why the day comes up short".
      const group = (o: Order) => (o.parking === 'van_only' ? `van only, ${o.district}` : o.district);
      const groups = Object.fromEntries([...new Set(due.map(group))].map((name) => {
        const inGroup = total(due.filter((o) => group(o) === name));
        return [name, [inGroup.orders, inGroup.units]];
      }));
      expect(groups).toEqual({
        'van only, Colombo': [3, 113],
        Colombo: [7, 356],
        Gampaha: [8, 393],
        Kalutara: [5, 240],
        Galle: [5, 250],
        Matara: [4, 189],
        Kurunegala: [4, 181],
        Puttalam: [2, 103],
      });
      expect(new Set(due.filter((o) => o.parking !== 'van_only').map((o) => o.district)).size).toBe(7);

      // Five fridge trucks for seven districts. Space is not what runs out: the working fridge vehicles hold
      // 140.7 m³ in one round.
      const working = await workingFridgeVehicles(tx, THU);
      expect(working.filter((v) => v.type === 'truck')).toHaveLength(5);
      expect(sum(working.map((v) => Math.round(Number(v.volumeCapM3) * 10))) / 10).toBe(140.7);
    });
  });

  it('AC-34 logs 111 fuel rows for Peliyagoda vehicles on 22, 23 and 24 Jun, 300 litres for VEH001 and 201 for VEH002', async () => {
    await seeded(async (tx) => {
      const fleet = await tx.select().from(vehicles).where(eq(vehicles.depotId, 'Peliyagoda')).orderBy(vehicles.id);
      const fuel = await tx.select({ vehicleId: fuelLog.vehicleId, date: fuelLog.date, litres: fuelLog.litres, tripId: fuelLog.tripId, note: fuelLog.note, depotId: vehicles.depotId, quota: vehicles.weeklyFuelQuotaL })
        .from(fuelLog).innerJoin(vehicles, eq(vehicles.id, fuelLog.vehicleId)).orderBy(fuelLog.vehicleId, fuelLog.date);
      expect(fuel).toHaveLength(111);
      expect([...new Set(fuel.map((row) => row.depotId))]).toEqual(['Peliyagoda']);
      expect([...new Set(fuel.map((row) => row.date))].sort()).toEqual([MON, TUE, WED]);

      const used = (vehicleId: string) => sum(fuel.filter((row) => row.vehicleId === vehicleId).map((row) => Number(row.litres)));
      // VEH001 has 40 of its 340 litres left. VEH002: 610 × 11 ÷ 100 = 67 litres a day, 201 by Wednesday night.
      expect(fleet.find((v) => v.id === 'VEH001')!.weeklyFuelQuotaL).toBe(340);
      expect(used('VEH001')).toBe(300);
      expect(used('VEH002')).toBe(201);
      // 6,945 of Peliyagoda's 18,600 litres.
      expect(sum(fuel.map((row) => Number(row.litres)))).toBe(6945);
      expect(sum(fleet.map((v) => v.weeklyFuelQuotaL))).toBe(18600);

      // One row for each day a vehicle was not in the workshop: whole litres, no trip, 9% to 16% of its quota.
      const days = (vehicleId: string) => fuel.filter((row) => row.vehicleId === vehicleId).map((row) => row.date);
      for (const v of fleet) {
        const working = v.id === 'VEH003' ? [MON] : v.id === 'VEH005' ? [MON, TUE] : [MON, TUE, WED];
        expect([v.id, days(v.id)]).toEqual([v.id, working]);
      }
      for (const row of fuel) {
        const litres = Number(row.litres);
        expect([row.vehicleId, Number.isInteger(litres), row.tripId, row.note]).toEqual([row.vehicleId, true, null, 'Seeded history']);
        if (row.vehicleId === 'VEH001') continue;
        expect((litres + 1) * 100).toBeGreaterThan(row.quota * 9);
        expect(litres * 100).toBeLessThanOrEqual(row.quota * 16);
      }
    });
  });

  it('AC-35 adds nothing and changes nothing when it runs again, whatever people have done since', async () => {
    await seeded(async (tx) => {
      // Since the seed: Nadeesha changed her chilled draft to 9 cartons and placed it, took the dry cartons
      // out, which removes that draft, and the clock was moved on to the next part.
      const chilled = demoId('order', `${THU}:OUT001:chilled`);
      await tx.update(orderLines).set({ quantity: 9 }).where(eq(orderLines.orderId, chilled));
      await tx.update(orders).set({ status: 'placed', placedAt: depotInstant(WED, 15 * 60 + 5), revision: 2 }).where(eq(orders.id, chilled));
      await tx.delete(orders).where(eq(orders.id, demoId('order', `${THU}:OUT001:dry`)));
      await tx.update(demoDay).set({ clockBase: new Date(DEMO_DAY.parts[1].at), revision: 1 });
      const before = await everyRow(tx);

      expect(await seedDemoDay(tx)).toBe(false);

      expect(await everyRow(tx)).toEqual(before);
      expect(await linesOf(tx, chilled)).toEqual({ 'fresh-chilled-carton': 9 });
      expect((await ordersWithLoads(tx)).filter((o) => o.status === 'draft')).toEqual([]);
    });
  });

  it('AC-36 gives every row the same id and content each time it writes the day', async () => {
    await seeded(async (tx) => {
      const first = await everyRow(tx, { realTime: false });
      expect(await rowCounts(tx)).toEqual({ ...NOTHING, demo_day: 1, orders: 104, order_lines: 142, plans: 2, deferrals: 5, vehicle_days_off: 6, fuel_log: 111 });

      // What a reset does: the day is removed and written again.
      await clearDemoDay(tx);
      expect(await seedDemoDay(tx)).toBe(true);
      expect(await everyRow(tx, { realTime: false })).toEqual(first);

      // An order's id is worked out from its wanted date, its shop and its temperature, so it is the same on
      // every machine. OUT002's chilled order for Thursday is the one pinned beside demoId.
      const written = await tx.select().from(orders);
      for (const o of written) expect([o.outletId, o.id]).toEqual([o.outletId, demoId('order', `${o.deliveryDate}:${o.outletId}:${o.temp}`)]);
      const out002 = written.find((o) => o.outletId === 'OUT002' && o.temp === 'chilled' && o.deliveryDate === THU);
      expect(out002?.id).toBe('99ad1370-c157-54a8-a55e-ad41ae176e68');
    });
  });

  it('AC-37 writes none of the day when it fails partway', async () => {
    await onEmptyDatabase(async (tx) => {
      // A history row for a vehicle and a day the seed writes too. Fuel comes after the orders, the plans and
      // the workshop rows, so the seed is most of the way through when it clashes.
      await tx.insert(fuelLog).values({ vehicleId: 'VEH002', date: TUE, litres: '5' });

      await expect(seedDemoDay(tx)).rejects.toMatchObject({ cause: { constraint: 'fuel_log_history_day' } });

      expect(await rowCounts(tx)).toEqual({ ...NOTHING, fuel_log: 1 });
    });
  });

  it('stops and writes none of the day when an account it needs is not there', async () => {
    await onEmptyDatabase(async (tx) => {
      // Ruwan sent the two plans. The orders are already in when the seed gets to them.
      await tx.update(users).set({ username: 'someone-else' }).where(eq(users.username, 'ruwan'));

      await expect(seedDemoDay(tx)).rejects.toThrow(/ruwan/);

      expect(await rowCounts(tx)).toEqual(NOTHING);
    });
  });

  it('places every order at 08:00 plus 5 minutes for each shop number, on the day before it is wanted, with nobody named as its maker', async () => {
    await seeded(async (tx) => {
      const all = await ordersWithLoads(tx);
      const when = (o: Order) => (o.placedAt ? [depotDate(o.placedAt), depotMinutes(o.placedAt)] : null);
      const placed = all.filter((o) => o.status === 'placed');
      for (const o of placed) expect([o.outletId, when(o)]).toEqual([o.outletId, [WED, 8 * 60 + 5 * shopNumber(o)]]);
      // OUT002's at 08:10 and OUT075's at 14:15. All of them are in before the clock starts at 15:00.
      expect(when(placed.find((o) => o.outletId === 'OUT002')!)).toEqual([WED, 8 * 60 + 10]);
      expect(when(placed.find((o) => o.outletId === 'OUT075')!)).toEqual([WED, 14 * 60 + 15]);
      expect(placed.filter((o) => o.placedAt!.getTime() >= new Date(DEMO_DAY.parts[0].at).getTime())).toEqual([]);

      const waited = all.filter((o) => o.status === 'deferred');
      expect(waited.map((o) => [o.outletId, when(o)])).toEqual([
        ['OUT001', [TUE, 8 * 60 + 5]],
        ['OUT030', [TUE, 10 * 60 + 30]],
        ['OUT054', [TUE, 12 * 60 + 30]],
        ['OUT060', [MON, 13 * 60]],
      ]);

      // Those shops have no account, so nobody is named. Nothing has been changed yet, so every revision is 0.
      expect([...placed, ...waited].filter((o) => o.createdBy !== null)).toEqual([]);
      expect(all.filter((o) => o.revision !== 0)).toEqual([]);
    });
  });

  it('clearDemoDay removes every order and plan with all that hangs off them, the fuel and workshop rows and the note that the day is written, and leaves the clock alone', async () => {
    await seeded(async (tx) => {
      // What a day of work adds: a plan with a trip, a stop with an order on it and the litres the trip used.
      // And the clock has been moved and the day reset twice.
      const [plan] = await tx.insert(plans).values({ depotId: 'Peliyagoda', date: THU }).returning();
      const [trip] = await tx.insert(trips).values({ planId: plan!.id, vehicleId: 'VEH010', tripNo: 1 }).returning();
      const [stop] = await tx.insert(stops).values({ tripId: trip!.id, seq: 1, outletId: 'OUT004' }).returning();
      await tx.insert(stopOrders).values({ stopId: stop!.id, orderId: demoId('order', `${THU}:OUT004:dry`) });
      await tx.insert(fuelLog).values({ vehicleId: 'VEH010', date: THU, litres: '12.5', tripId: trip!.id });
      await tx.update(demoDay).set({ clockBase: new Date(DEMO_DAY.parts[2].at), revision: 5, day: 3 });
      const [clock] = await tx.select().from(demoDay);
      const people = await tx.select().from(users);

      await clearDemoDay(tx);

      expect(await rowCounts(tx)).toEqual({ ...NOTHING, demo_day: 1 });
      expect(await tx.select().from(demoDay)).toEqual([{ ...clock!, seededAt: null }]);
      expect(await tx.select().from(users)).toEqual(people);
    });
  });
});

describe('the seed with demo mode off', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('AC-38 writes no clock row and no record of the day', async () => {
    // The setting is read once when the modules load, so they are loaded again with it off.
    vi.stubEnv('DEMO_MODE', 'false');
    vi.resetModules();
    const off = await import('../src/db/demo-day');
    const { config } = await import('../src/lib/config');
    const { pool: unused } = await import('../src/db/client');
    try {
      expect(config.DEMO_MODE).toBe(false);
      // Handed the empty database's transaction, so anything it wrote would show here.
      await onEmptyDatabase(async (tx) => {
        expect(await off.seedDemoDay(tx)).toBe(false);
        expect(await rowCounts(tx)).toEqual(NOTHING);
      });
    } finally {
      await unused.end();
    }
  });
});
