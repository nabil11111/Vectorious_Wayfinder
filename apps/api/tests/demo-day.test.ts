import { DEMO_DAY } from '@wayfinder/contracts';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { db, pool, type Tx } from '../src/db/client';
import { addKandysDay, clearDemoDay, demoId, seedDemoDay } from '../src/db/demo-day';
import {
  auditLog, calendarDays, deferrals, demoDay, districtTravel, fuelLog, orderLines, orders, outlets, plans, products, sessions, stopOrders, stops, trips,
  users, vehicleDaysOff, vehicles,
} from '../src/db/schema';
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
// database is to the seed, does its work and is rolled back. The rollback is an error of our own, thrown
// after the work is done, so nothing the seed throws can be mistaken for it and end a test early.
class RolledBack extends Error {}
async function onEmptyDatabase(work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await clearDemoDay(tx);
      await tx.delete(demoDay);
      await work(tx);
      throw new RolledBack();
    });
  } catch (err) {
    if (!(err instanceof RolledBack)) throw err;
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
const at = (depotId: string) => (o: Order) => o.depotId === depotId;
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
const DAY_TABLES = ['demo_day', 'orders', 'order_lines', 'plans', 'deferrals', 'trips', 'stops', 'stop_orders', 'vehicle_days_off', 'fuel_log'];
const NOTHING = Object.fromEntries(DAY_TABLES.map((table) => [table, 0]));
// What clearing the day must never touch: the people, their sign-ins, the audit log and the booklet's data.
const KEPT_TABLES = ['users', 'sessions', 'audit_log', 'depots', 'outlets', 'vehicles', 'products', 'calendar_days', 'district_travel', 'service_allowance'];

// Every row of some tables as the database holds it, in a fixed order. The columns that say when the system
// really wrote a row differ from one run to the next, so a comparison between two runs leaves them out.
async function rowsIn(tx: Tx, tables: string[], { realTime = true } = {}) {
  const row = realTime ? sql`to_jsonb(t)` : sql`to_jsonb(t) - '{created_at,updated_at,clock_set_at,seeded_at}'::text[]`;
  const held: Record<string, unknown[]> = {};
  for (const table of tables) {
    const found = await tx.execute<{ row: unknown }>(sql`select ${row} as row from ${sql.identifier(table)} t order by 1`);
    held[table] = found.rows.map((r) => r.row);
  }
  return held;
}
const everyRow = (tx: Tx, options?: { realTime?: boolean }) => rowsIn(tx, DAY_TABLES, options);
const rowCounts = async (tx: Tx, tables = DAY_TABLES) => Object.fromEntries(Object.entries(await rowsIn(tx, tables)).map(([table, rows]) => [table, rows.length]));
// How many orders and order lines each depot's shops have.
async function rowsByDepot(tx: Tx) {
  const found = await tx.select({ depotId: outlets.depotId, orders: sql<number>`count(distinct ${orders.id})::int`, lines: sql<number>`count(${orderLines.id})::int` })
    .from(orders).innerJoin(outlets, eq(outlets.id, orders.outletId)).leftJoin(orderLines, eq(orderLines.orderId, orders.id)).groupBy(outlets.depotId);
  return Object.fromEntries(found.map(({ depotId, ...counts }) => [depotId, counts]));
}

describe('the seeded day on an empty database', () => {
  it('AC-1 holds the clock at Wed 24 Jun 2026 15:00 depot time, in the part ordering, with revision 0 and day 1', async () => {
    const started = realNow();
    await seeded(async (tx) => {
      const rows = await tx.select().from(demoDay);
      expect(rows).toHaveLength(1);
      const clock = rows[0]!;
      // 15:00 to the second, which is 09:30 UTC.
      expect(clock.clockBase).toEqual(depotInstant(WED, 15 * 60));
      expect(clock.clockBase.toISOString()).toBe('2026-06-24T09:30:00.000Z');
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

  it('AC-28 writes 98 placed orders for Thursday for Peliyagoda shops: 48 Fresh dry, 34 Fresh chilled, 12 Style and 4 Tech', async () => {
    await seeded(async (tx) => {
      const every = (await ordersWithLoads(tx)).filter((o) => o.status === 'placed');
      // Every placed order is for Thursday, Peliyagoda's and, since spec 020, Kandy's (below).
      expect([...new Set(every.map((o) => o.date))]).toEqual([THU]);
      expect([...new Set(every.map((o) => o.depotId))].sort()).toEqual(['Kandy', 'Peliyagoda']);
      const placed = every.filter(at('Peliyagoda'));
      expect(placed).toHaveLength(98);
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
      const placed = (await ordersWithLoads(tx)).filter((o) => o.status === 'placed').filter(at('Peliyagoda'));
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

  it('AC-31 holds four chilled orders that waited, each deferred in the sent plan for Wednesday, and OUT060 in the plan for Tuesday too', async () => {
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

      // Each deferral with the plan it is in and the order it is about: the shop, the date it wanted and its status.
      const why = await tx.select({
        plan: plans.date, outletId: orders.outletId, wanted: orders.deliveryDate, status: orders.status, code: deferrals.code, reason: deferrals.reason,
      }).from(deferrals).innerJoin(plans, eq(plans.id, deferrals.planId)).innerJoin(orders, eq(orders.id, deferrals.orderId))
        .orderBy(plans.date, orders.outletId);
      expect(why.map((d) => [d.plan, d.outletId, d.wanted, d.status, d.code, d.reason])).toEqual([
        [TUE, 'OUT060', TUE, 'deferred', 'no_reefer', 'No fridge truck was left for Matara.'],
        [WED, 'OUT001', WED, 'deferred', 'over_capacity', 'The fridge van was full.'],
        [WED, 'OUT030', WED, 'deferred', 'no_reefer', 'No fridge truck was left for Gampaha.'],
        [WED, 'OUT054', WED, 'deferred', 'window', 'The truck could not reach the shop before its window closed at 07:30.'],
        [WED, 'OUT060', TUE, 'deferred', 'no_reefer', 'No fridge truck was left for Matara. Two were in the workshop.'],
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
      const dueOnThursday = (o: Order) => (o.status === 'placed' && o.date === THU) || (o.status === 'deferred' && o.date < THU);
      const due = (await ordersWithLoads(tx)).filter(at('Peliyagoda')).filter((o) => o.temp === 'chilled' && dueOnThursday(o));
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
      const fuel = await tx.select({
        vehicleId: fuelLog.vehicleId, date: fuelLog.date, litres: fuelLog.litres, tripId: fuelLog.tripId, note: fuelLog.note,
        depotId: vehicles.depotId, quota: vehicles.weeklyFuelQuotaL,
      }).from(fuelLog).innerJoin(vehicles, eq(vehicles.id, fuelLog.vehicleId)).orderBy(fuelLog.vehicleId, fuelLog.date);
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
      // Peliyagoda's 104 orders and 142 lines from spec 008 and the 25 orders of one line each that spec 009 adds for
      // OUT001, and Kandy's 64 orders and 87 lines from spec 020.
      expect(await rowCounts(tx)).toEqual({
        ...NOTHING, demo_day: 1, orders: 129 + 64, order_lines: 167 + 87, plans: 2, deferrals: 5, vehicle_days_off: 6, fuel_log: 111,
      });
      expect(await rowsByDepot(tx)).toEqual({ Peliyagoda: { orders: 129, lines: 167 }, Kandy: { orders: 64, lines: 87 } });

      // What a reset does: the day is removed and written again.
      await clearDemoDay(tx);
      expect(await seedDemoDay(tx)).toBe(true);
      expect(await everyRow(tx, { realTime: false })).toEqual(first);

      // An id is worked out from what the row is, so it is the same on every machine. An order's comes from
      // its wanted date, its shop and its temperature. OUT002's chilled order for Thursday is the one pinned
      // beside demoId.
      const orderKey = new Map<string, string>();
      for (const o of await tx.select().from(orders)) {
        orderKey.set(o.id, `${o.deliveryDate}:${o.outletId}:${o.temp}`);
        expect(o.id).toBe(demoId('order', orderKey.get(o.id)!));
      }
      expect(orderKey.get('99ad1370-c157-54a8-a55e-ad41ae176e68')).toBe(`${THU}:OUT002:chilled`);

      // The other kinds are keyed as the list in demo-day.ts says: a line by its order and its product, a plan
      // by its date and depot, a deferral by its plan's date and its order, a fuel row by its date and vehicle.
      const planDate = new Map<string, string>();
      for (const p of await tx.select().from(plans)) {
        planDate.set(p.id, p.date);
        expect(p.id).toBe(demoId('plan', `${p.date}:${p.depotId}`));
      }
      for (const line of await tx.select().from(orderLines)) expect(line.id).toBe(demoId('line', `${orderKey.get(line.orderId)}:${line.productId}`));
      for (const d of await tx.select().from(deferrals)) expect(d.id).toBe(demoId('deferral', `${planDate.get(d.planId)}:${orderKey.get(d.orderId)}`));
      for (const row of await tx.select().from(fuelLog)) expect(row.id).toBe(demoId('fuel', `${row.date}:${row.vehicleId}`));
    });
  });

  it('AC-37 writes none of the day when it fails partway', async () => {
    // A row that is already there clashes with one the seed writes. One for each table it writes, in the
    // order it writes them, so the seed stops at its first insert, in the middle and at its last. A row that
    // needs an order or a plan to hang off gets one of its own, dated far from the seeded day.
    const elsewhere = '2099-01-03';
    const placed = { temp: 'chilled', status: 'placed' } as const;
    const anOrder = async (tx: Tx) => (await tx.insert(orders).values({ outletId: 'OUT060', deliveryDate: elsewhere, ...placed }).returning())[0]!.id;
    const clashes: [table: string, plant: (tx: Tx) => Promise<unknown>][] = [
      ['orders', (tx) => tx.insert(orders).values({ id: demoId('order', `${THU}:OUT002:chilled`), outletId: 'OUT002', deliveryDate: THU, ...placed })],
      ['order_lines', async (tx) => tx.insert(orderLines).values({
        id: demoId('line', `${THU}:OUT002:chilled:fresh-chilled-carton`), orderId: await anOrder(tx), productId: 'fresh-chilled-carton', quantity: 1,
      })],
      ['plans', (tx) => tx.insert(plans).values({ depotId: 'Peliyagoda', date: WED })],
      ['deferrals', async (tx) => {
        const [plan] = await tx.insert(plans).values({ depotId: 'Peliyagoda', date: elsewhere }).returning();
        await tx.insert(deferrals).values({
          id: demoId('deferral', `${WED}:${TUE}:OUT060:chilled`), planId: plan!.id, orderId: await anOrder(tx), code: 'no_reefer', reason: 'Already there.',
        });
      }],
      ['vehicle_days_off', (tx) => tx.insert(vehicleDaysOff).values({ vehicleId: 'VEH003', date: TUE, reason: 'Already there' })],
      ['fuel_log', (tx) => tx.insert(fuelLog).values({ vehicleId: 'VEH002', date: TUE, litres: '5' })],
      // Spec 009's block comes after all of those: OUT001's dry order for Wednesday is one of its rows.
      ['orders', (tx) => tx.insert(orders).values({ id: demoId('order', `${WED}:OUT001:dry`), outletId: 'OUT001', deliveryDate: WED, ...placed, temp: 'dry' })],
      // Kandy's block (spec 020) is the last: OUT076's dry order for Thursday is one of its rows.
      ['orders', (tx) => tx.insert(orders).values({ id: demoId('order', `${THU}:OUT076:dry`), outletId: 'OUT076', deliveryDate: THU, ...placed, temp: 'dry' })],
    ];
    for (const [table, plant] of clashes) {
      await onEmptyDatabase(async (tx) => {
        await plant(tx);
        const before = await everyRow(tx);

        // 23505 is what Postgres answers when a row is already there.
        await expect(seedDemoDay(tx)).rejects.toMatchObject({ cause: { code: '23505', table } });

        // The rows put in first are as they were, and there is nothing of the day: no order, and no clock row.
        expect([table, await everyRow(tx)]).toEqual([table, before]);
        expect([table, (await rowCounts(tx)).demo_day]).toEqual([table, 0]);
      });
    }
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
      const all = (await ordersWithLoads(tx)).filter(at('Peliyagoda'));
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

      // They came in before the day the app runs, so nobody is named, though every shop has an account since spec 020.
      // Nothing has been changed yet, so every revision is 0.
      expect([...placed, ...waited].filter((o) => o.createdBy !== null)).toEqual([]);
      expect(all.filter((o) => o.revision !== 0)).toEqual([]);
    });
  });

  it('clearDemoDay removes the day with all that hangs off its orders and plans, and leaves the clock alone', async () => {
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
      // A sign-in and an audit row, so every table that must stay holds something the cascade could take.
      await tx.insert(sessions).values({ id: 'a-sign-in', userId: await userId(tx, 'ruwan'), expiresAt: depotInstant(THU, 24 * 60) });
      await tx.insert(auditLog).values({ action: 'demo.clock_moved', entity: 'demo_day', entityId: '1' });
      const kept = await rowCounts(tx, KEPT_TABLES);
      expect(KEPT_TABLES.filter((table) => kept[table] === 0)).toEqual([]);

      await clearDemoDay(tx);

      expect(await rowCounts(tx)).toEqual({ ...NOTHING, demo_day: 1 });
      expect(await tx.select().from(demoDay)).toEqual([{ ...clock!, seededAt: null }]);
      // The cascade follows whatever points at an order or a plan. It must never reach these.
      expect(await rowCounts(tx, KEPT_TABLES)).toEqual(kept);
    });
  });

  it('leaves VEH001 the fuel for the three near districts and for none of the four far ones', async () => {
    await seeded(async (tx) => {
      const [truck] = await tx.select().from(vehicles).where(eq(vehicles.id, 'VEH001'));
      const [used] = await tx.select({ litres: sql<number>`sum(${fuelLog.litres})::int` }).from(fuelLog).where(eq(fuelLog.vehicleId, 'VEH001'));
      const left = truck!.weeklyFuelQuotaL - used!.litres;
      expect(left).toBe(40);

      // There and back, with no stops counted. Kurunegala is the nearest of the far four: 95 km out and 95 km
      // back is 190 km, and 190 ÷ 4.7 km per litre is 40.4 litres.
      const districts = await tx.select().from(districtTravel).where(eq(districtTravel.depotId, 'Peliyagoda'));
      const litresFor = (district: string) => (2 * districts.find((d) => d.district === district)!.depotToDistrictKm) / Number(truck!.kmPerL);
      expect(litresFor('Kurunegala').toFixed(1)).toBe('40.4');
      expect(districts.map((d) => d.district).filter((district) => litresFor(district) <= left).sort()).toEqual(['Colombo', 'Gampaha', 'Kalutara']);
    });
  });
});

// What spec 009 adds for the shop's own screens: a history for OUT001, and what the draft's form shows. Spec 015's
// block makes that history received, with its counts and times (D-62).
describe('the seeded day of a shop with an account', () => {
  it('AC-33 (spec 015) gives OUT001 a dry order for Wednesday received at 07:42: 6 cartons, all 6 received, placed by nadeesha and on no plan', async () => {
    await seeded(async (tx) => {
      const nadeesha = await userId(tx, 'nadeesha');
      // Beside the chilled order that waited, which is the one from spec 008.
      const wednesday = (await ordersWithLoads(tx)).filter((o) => o.outletId === 'OUT001' && o.date === WED);
      expect(wednesday.map((o) => [o.temp, o.status, o.units])).toEqual([['chilled', 'deferred', 12], ['dry', 'received', 6]]);

      const [dry] = await tx.select().from(orders).where(eq(orders.id, demoId('order', `${WED}:OUT001:dry`)));
      expect(dry).toMatchObject({
        outletId: 'OUT001', deliveryDate: WED, temp: 'dry', status: 'received', revision: 0, savedAt: null,
        createdBy: nadeesha, placedBy: nadeesha, placedAt: depotInstant(TUE, 8 * 60 + 5),
        // The design's Today: "6 dry cartons · Received 07:42 · All 6 received". It never travelled, so it has no time sent.
        receivedAt: depotInstant(WED, 7 * 60 + 42), receiptSentAt: null, arrivedCold: null, replacesIssueId: null,
      });
      expect(await linesOf(tx, dry!.id)).toEqual({ 'fresh-dry-carton': 6 });
      expect((await tx.select().from(orderLines).where(eq(orderLines.orderId, dry!.id))).map((l) => [l.loadedQty, l.deliveredQty, l.receivedQty])).toEqual([[null, null, 6]]);
      // No plan of the seed has a trip, so the order has no delivery and counts for the day the shop wanted.
      expect(await tx.select().from(stopOrders)).toEqual([]);
    });
  });

  it('AC-33 (spec 015) gives OUT001 25 received orders, the 24 of the twelve operating days before Wednesday received in full with a time on their day', async () => {
    await seeded(async (tx) => {
      const nadeesha = await userId(tx, 'nadeesha');
      const received = (await ordersWithLoads(tx)).filter((o) => o.status === 'received');
      expect([...new Set(received.map((o) => o.outletId))]).toEqual(['OUT001']);
      // A page of the Past list is 20, so there is a second one to load.
      expect(total(received)).toEqual({ orders: 25, units: 205, kg: 1414.5, m3: 7.585 });
      expect(received.filter((o) => o.strays > 0 || o.createdBy !== nadeesha || o.revision !== 0)).toEqual([]);

      // Each day with its chilled and its dry cartons: 8 + (d mod 6) and 4 + (d mod 5), d being the day of the
      // month. Tue 23 Jun: 8 + 5 = 13 chilled and 4 + 3 = 7 dry. No Sunday is among them. Wednesday has its dry order.
      const cartons = (date: string, temp: string) => received.filter((o) => o.date === date && o.temp === temp).map((o) => o.units);
      const days = [...new Set(received.map((o) => o.date))].sort().reverse();
      expect(days.map((date) => [date, cartons(date, 'chilled'), cartons(date, 'dry')])).toEqual([
        ['2026-06-24', [], [6]],
        ['2026-06-23', [13], [7]], ['2026-06-22', [12], [6]], ['2026-06-20', [10], [4]], ['2026-06-19', [9], [8]],
        ['2026-06-18', [8], [7]], ['2026-06-17', [13], [6]], ['2026-06-16', [12], [5]], ['2026-06-15', [11], [4]],
        ['2026-06-13', [9], [7]], ['2026-06-12', [8], [6]], ['2026-06-11', [13], [5]], ['2026-06-10', [12], [4]],
      ]);

      // Received in full, at 07:00 plus 3 minutes for each day of the month mod 10 on the day it was for, cold when
      // chilled, and never sent through the app. Tue 23 Jun: 07:09.
      const rows = await tx.select().from(orders).where(eq(orders.status, 'received'));
      const lines = await tx.select().from(orderLines);
      for (const o of rows.filter((row) => row.deliveryDate !== WED)) {
        const d = Number(o.deliveryDate.slice(8));
        expect([o.deliveryDate, o.temp, o.receivedAt, o.receiptSentAt, o.arrivedCold]).toEqual([o.deliveryDate, o.temp, depotInstant(o.deliveryDate, 7 * 60 + 3 * (d % 10)), null, o.temp === 'chilled' ? true : null]);
        expect(lines.filter((l) => l.orderId === o.id).map((l) => [l.receivedQty, l.quantity, l.deliveredQty])).toEqual(lines.filter((l) => l.orderId === o.id).map((l) => [l.quantity, l.quantity, null]));
      }
      expect(rows.find((o) => o.deliveryDate === '2026-06-23' && o.temp === 'dry')!.receivedAt).toEqual(depotInstant('2026-06-23', 7 * 60 + 9));
      // Nothing else of the day is received or counted.
      expect(lines.filter((l) => l.receivedQty !== null && !rows.some((o) => o.id === l.orderId))).toEqual([]);

      // Every one was placed by nadeesha at 08:05 on the operating day before it was wanted, which is the last
      // day its orders were open. So Monday's were placed on Saturday, not on the Sunday in between.
      const operating = (await tx.select().from(calendarDays).where(eq(calendarDays.isOperating, true)).orderBy(calendarDays.date)).map((day) => day.date);
      for (const o of received) {
        expect([o.date, depotDate(o.placedAt!), depotMinutes(o.placedAt!)]).toEqual([o.date, operating[operating.indexOf(o.date) - 1], 8 * 60 + 5]);
      }
      expect(depotDate(received.find((o) => o.date === MON)!.placedAt!)).toBe('2026-06-20');
      const placedBy = await tx.select({ placedBy: orders.placedBy }).from(orders).where(eq(orders.status, 'received'));
      expect([...new Set(placedBy.map((o) => o.placedBy))]).toEqual([nadeesha]);
    });
  });

  it('leaves nadeesha\'s draft saved on Wednesday at 14:40, before the clock starts, with a note for the driver', async () => {
    await seeded(async (tx) => {
      const drafts = await tx.select().from(orders).where(eq(orders.status, 'draft')).orderBy(orders.temp);
      expect(drafts.map((o) => [o.outletId, o.temp, o.savedAt, o.driverNote])).toEqual([
        ['OUT001', 'chilled', depotInstant(WED, 14 * 60 + 40), 'Ring the bell at the side door.'],
        ['OUT001', 'dry', depotInstant(WED, 14 * 60 + 40), 'Ring the bell at the side door.'],
      ]);
      expect(drafts[0]!.savedAt!.getTime()).toBeLessThan(new Date(DEMO_DAY.parts[0].at).getTime());
    });
  });
});

// Spec 020: Kandy's Thursday, by spec 008's rules for Peliyagoda's shops applied to Kandy's 45, so a dispatcher who
// switches to Kandy has a day to plan (D-94). Every figure is worked out from data/shared and the product list.
const KANDY_TECH = ['OUT093', 'OUT094', 'OUT095', 'OUT103', 'OUT115'];

describe('Kandy\'s day (spec 020)', () => {
  it('AC-2 writes 64 placed orders for Thursday from Kandy\'s shops by Peliyagoda\'s rules: 31 Fresh dry, 21 Fresh chilled, 7 Style and 5 Tech', async () => {
    await seeded(async (tx) => {
      const kandy = (await ordersWithLoads(tx)).filter(at('Kandy'));
      expect(kandy).toHaveLength(64);
      expect(kandy.filter((o) => o.status !== 'placed' || o.date !== THU)).toEqual([]);
      // One order per shop and temperature, each holding only items of its shop's brand and its own temperature.
      expect(new Set(kandy.map((o) => `${o.outletId} ${o.temp}`)).size).toBe(64);
      expect(kandy.filter((o) => o.strays > 0 || o.units === 0)).toEqual([]);
      const count = (brand: string, temp: string) => kandy.filter(is(brand, temp)).length;
      expect({ freshDry: count('Fresh', 'dry'), freshChilled: count('Fresh', 'chilled'), style: count('Style', 'dry'), tech: count('Tech', 'dry') })
        .toEqual({ freshDry: 31, freshChilled: 21, style: 7, tech: 5 });

      // By the number in the shop's id: every Fresh shop orders dry cartons, and chilled ones too unless its number ends
      // in 0, 4 or 7. Every Style shop whose number is not a multiple of 5 orders. Each Tech shop has its written-out
      // order. So the only shops with nothing are OUT090 and OUT120, Style shops numbered by a multiple of 5.
      const shops = await tx.select().from(outlets).where(eq(outlets.depotId, 'Kandy')).orderBy(outlets.id);
      expect(shops).toHaveLength(45);
      const numbered = (brand: string, rule: (n: number) => boolean) => shops.filter((s) => s.brand === brand && rule(Number(s.id.slice(3)))).map((s) => s.id);
      const shopsOf = (brand: string, temp: string) => kandy.filter(is(brand, temp)).map((o) => o.outletId);
      expect(shopsOf('Fresh', 'dry')).toEqual(numbered('Fresh', () => true));
      expect(shopsOf('Fresh', 'chilled')).toEqual(numbered('Fresh', (n) => ![0, 4, 7].includes(n % 10)));
      expect(shopsOf('Style', 'dry')).toEqual(numbered('Style', (n) => n % 5 !== 0));
      expect([shopsOf('Tech', 'dry'), numbered('Tech', () => true)]).toEqual([KANDY_TECH, KANDY_TECH]);
      expect(shops.filter((s) => !kandy.some((o) => o.outletId === s.id)).map((s) => s.id)).toEqual(['OUT090', 'OUT120']);
    });
  });

  it('AC-2 adds up to 1,716 dry cartons, 1,053 chilled cartons, 244 Style units at 55.02 m³ and 12 Tech units at 2,360 kg', async () => {
    await seeded(async (tx) => {
      const kandy = (await ordersWithLoads(tx)).filter(at('Kandy'));
      expect(total(kandy.filter(is('Fresh', 'dry')))).toEqual({ orders: 31, units: 1716, kg: 11840.4, m3: 63.492 });
      expect(total(kandy.filter(is('Fresh', 'chilled')))).toEqual({ orders: 21, units: 1053, kg: 7265.7, m3: 38.961 });
      expect(total(kandy.filter(is('Style', 'dry')))).toEqual({ orders: 7, units: 244, kg: 3228, m3: 55.02 });
      expect(total(kandy.filter(is('Tech', 'dry')))).toEqual({ orders: 5, units: 12, kg: 2360, m3: 8.04 });
      expect(total(kandy)).toEqual({ orders: 64, units: 3025, kg: 24694.1, m3: 165.513 });

      // 45 to 65 dry cartons and 39 to 60 chilled ones, inside Peliyagoda's ranges.
      const cartons = (temp: string) => kandy.filter(is('Fresh', temp)).map((o) => o.units);
      expect([Math.min(...cartons('dry')), Math.max(...cartons('dry'))]).toEqual([45, 65]);
      expect([Math.min(...cartons('chilled')), Math.max(...cartons('chilled'))]).toEqual([39, 60]);

      // OUT076: 45 + (836 mod 21) = 62 dry cartons, and 38 + (380 mod 23) = 50 chilled ones.
      const order = (outletId: string, temp: string) => kandy.filter((o) => o.outletId === outletId && o.temp === temp);
      expect(total(order('OUT076', 'dry'))).toMatchObject({ orders: 1, units: 62 });
      expect(total(order('OUT076', 'chilled'))).toEqual({ orders: 1, units: 50, kg: 345, m3: 1.85 });
      // A Style shop. OUT088: folded 10 + (352 mod 9), hanging 6 + (440 mod 7), shoes 4 + (88 mod 6), bags 3 + (88 mod 4).
      expect(await linesOf(tx, order('OUT088', 'dry')[0]!.id)).toEqual({ 'style-folded': 11, 'style-hanging': 12, 'style-shoes': 8, 'style-bags': 3 });

      // The five Tech orders, sized like Peliyagoda's four. OUT093 is the one Tech shop only a van can reach, and a van
      // has no tail lift (D-24), so nothing in its order needs one.
      const tech = [];
      for (const o of kandy.filter(is('Tech', 'dry'))) tech.push([o.outletId, o.parking, await linesOf(tx, o.id), o.centikilos / 100, o.litres / 1000, o.tailLift]);
      expect(tech).toEqual([
        ['OUT093', 'van_only', { 'tech-tv': 2, 'tech-small': 1 }, 530, 1.82, false],
        ['OUT094', 'mall_dock', { 'tech-fridge': 2 }, 500, 1.7, true],
        ['OUT095', 'normal', { 'tech-washer': 2, 'tech-small': 1 }, 610, 2.02, true],
        ['OUT103', 'normal', { 'tech-tv': 3 }, 510, 1.8, false],
        ['OUT115', 'normal', { 'tech-washer': 1 }, 210, 0.7, true],
      ]);
    });
  });

  it('AC-2 places Kandy\'s orders on Wednesday from 08:05, five minutes apart in shop order, before the clock starts, naming nobody', async () => {
    await seeded(async (tx) => {
      const kandy = (await ordersWithLoads(tx)).filter(at('Kandy'));
      // Kandy's shops follow Peliyagoda's 75 in the booklet's list, so its five-minute steps count from OUT076.
      for (const o of kandy) expect([o.outletId, depotDate(o.placedAt!), depotMinutes(o.placedAt!)]).toEqual([o.outletId, WED, 8 * 60 + 5 * (shopNumber(o) - 75)]);
      // OUT076's at 08:05 and the last shop to order, OUT119, at 11:40. All of them are in before 15:00.
      expect(depotMinutes(kandy.find((o) => o.outletId === 'OUT076')!.placedAt!)).toBe(8 * 60 + 5);
      expect([kandy.at(-1)!.outletId, depotMinutes(kandy.at(-1)!.placedAt!)]).toEqual(['OUT119', 11 * 60 + 40]);
      expect(kandy.filter((o) => o.placedAt!.getTime() >= new Date(DEMO_DAY.parts[0].at).getTime())).toEqual([]);
      // Like Peliyagoda's, they came in before the day the app runs: nobody is named, and nothing has changed them.
      const rows = await tx.select().from(orders).where(inArray(orders.id, kandy.map((o) => o.id)));
      expect(rows.filter((o) => o.createdBy !== null || o.placedBy !== null || o.revision !== 0 || o.savedAt !== null || o.driverNote !== null)).toEqual([]);
    });
  });

  it('AC-2 gives Kandy no earlier plan, no order that waited, no draft, nothing in the workshop and no fuel used this week', async () => {
    await seeded(async (tx) => {
      expect(await tx.select().from(plans).where(eq(plans.depotId, 'Kandy'))).toEqual([]);
      expect((await ordersWithLoads(tx)).filter(at('Kandy')).filter((o) => o.status !== 'placed')).toEqual([]);
      const fleet = (await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.depotId, 'Kandy'))).map((v) => v.id);
      expect(fleet).toHaveLength(22);
      expect(await tx.select().from(vehicleDaysOff).where(inArray(vehicleDaysOff.vehicleId, fleet))).toEqual([]);
      expect(await tx.select().from(fuelLog).where(inArray(fuelLog.vehicleId, fleet))).toEqual([]);
    });
  });
});

// An install whose day was written before spec 020 has all of it but Kandy's orders, and the day is written once. The
// seed adds Kandy's orders on its next start, once, and touches nothing that is there (spec 020's failure paths).
describe('Kandy\'s day on an install seeded before spec 020', () => {
  // The day as such an install has it: the seeded day without Kandy's orders, whose lines go with them.
  const withoutKandy = (tx: Tx) => tx.delete(orders).where(inArray(orders.outletId, tx.select({ id: outlets.id }).from(outlets).where(eq(outlets.depotId, 'Kandy'))));

  it('AC-2 writes Kandy\'s orders as a fresh seed writes them, leaves every row that was there as it was, and does nothing on a later start', async () => {
    await seeded(async (tx) => {
      const fresh = await everyRow(tx, { realTime: false });
      await withoutKandy(tx);
      const before = await everyRow(tx);
      expect(await rowsByDepot(tx)).toEqual({ Peliyagoda: { orders: 129, lines: 167 } });

      expect(await addKandysDay(tx)).toBe(true);

      // Every row that was there is as it was, Peliyagoda's above all, and the rows added are Kandy's 64 orders and 87
      // lines, the same as a fresh seed's.
      const after = await everyRow(tx);
      for (const table of DAY_TABLES) expect([table, after[table]]).toEqual([table, expect.arrayContaining(before[table]!)]);
      expect(await rowsByDepot(tx)).toEqual({ Peliyagoda: { orders: 129, lines: 167 }, Kandy: { orders: 64, lines: 87 } });
      expect(await everyRow(tx, { realTime: false })).toEqual(fresh);

      // Every later start finds them there and writes nothing.
      expect(await addKandysDay(tx)).toBe(false);
      expect(await everyRow(tx)).toEqual(after);
    });
  });

  it('writes nothing when any of Kandy\'s orders is there, so a day people have worked on is never added to', async () => {
    await seeded(async (tx) => {
      // All of Kandy's orders but OUT076's dry one are gone, and that one was planned since.
      const kept = demoId('order', `${THU}:OUT076:dry`);
      await tx.delete(orders).where(and(inArray(orders.outletId, tx.select({ id: outlets.id }).from(outlets).where(eq(outlets.depotId, 'Kandy'))), ne(orders.id, kept)));
      await tx.update(orders).set({ status: 'planned', revision: 1 }).where(eq(orders.id, kept));
      const before = await everyRow(tx);

      expect(await addKandysDay(tx)).toBe(false);
      expect(await everyRow(tx)).toEqual(before);
    });
  });

  it('writes nothing when a Kandy shop already has an order for Thursday that the seed did not write', async () => {
    await seeded(async (tx) => {
      await withoutKandy(tx);
      // OUT076's manager placed it on the screen, on an install that had the new accounts before Kandy's orders.
      await tx.insert(orders).values({ outletId: 'OUT076', deliveryDate: THU, temp: 'dry', status: 'placed', placedAt: new Date(DEMO_DAY.parts[0].at) });
      const before = await everyRow(tx);

      expect(await addKandysDay(tx)).toBe(false);
      expect(await everyRow(tx)).toEqual(before);
    });
  });

  it('writes nothing before the day is written: the seed writes Kandy\'s orders with the rest of it', async () => {
    await onEmptyDatabase(async (tx) => {
      expect(await addKandysDay(tx)).toBe(false);
      expect(await rowCounts(tx)).toEqual(NOTHING);
      // A clock row with no day written yet.
      await tx.insert(demoDay).values({ clockBase: new Date(DEMO_DAY.parts[0].at), clockSetAt: realNow() });
      expect(await addKandysDay(tx)).toBe(false);
      expect(await rowCounts(tx)).toEqual({ ...NOTHING, demo_day: 1 });
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
        expect(await off.addKandysDay(tx)).toBe(false);
        expect(await rowCounts(tx)).toEqual(NOTHING);
      });
    } finally {
      await unused.end();
    }
  });
});
