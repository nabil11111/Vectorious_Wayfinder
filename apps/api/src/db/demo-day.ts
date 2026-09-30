import { createHash } from 'node:crypto';
import { DEMO_DAY, type Brand, type Temp } from '@wayfinder/contracts';
import { eq, inArray, sql } from 'drizzle-orm';
import { depotInstant, realNow } from '../lib/clock';
import { config } from '../lib/config';
import { db, type Db, type Tx } from './client';
import type { PRODUCTS } from './fixtures';
import { deferrals, demoDay, fuelLog, orderLines, orders, outlets, plans, users, vehicleDaysOff, vehicles } from './schema';

// The seeded delivery day (spec 008): Thu 25 Jun 2026 from Peliyagoda, written once in demo mode. Each later
// piece adds its own block of records to seedDemoDay, so a reset brings them back too.
//
// The whole day is in the rules and the fixed rows below. Nothing is random, so the same shops and vehicles
// give the same day every time. The totals they add up to are in the spec and are pinned by
// tests/demo-day.test.ts.

const MON = '2026-06-22';
const TUE = '2026-06-23';
const WED = DEMO_DAY.orderDay;
const THU = DEMO_DAY.deliveryDay;
const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 24 * 60 * 60_000).toISOString().slice(0, 10);

// The number in one of the booklet's ids: OUT026 is 26 and VEH002 is 2.
const numberOf = (id: string) => Number(id.slice(3));

type Line = [product: (typeof PRODUCTS)[number]['id'], quantity: number];

// Orders placed for Thursday, by Peliyagoda's shops. n is the number in the shop's id, so OUT026 is 26. The
// sizes are a little above an ordinary day, because the calendar marks Thu 25 Jun as a payday.

// Every Fresh shop orders dry cartons, 45 to 65 of them. OUT026: 45 + (286 mod 21) = 58.
const dryCartons = (n: number) => 45 + ((11 * n) % 21);
// A Fresh shop whose number does not end in 0, 4 or 7 orders chilled cartons as well, 38 to 60.
const ordersChilled = (n: number) => ![0, 4, 7].includes(n % 10);
const chilledCartons = (n: number) => 38 + ((5 * n) % 23);
// Thursday is Style's big day: every Style shop whose number is not a multiple of 5 orders.
const ordersStyle = (n: number) => n % 5 !== 0;
const styleLines = (n: number): Line[] => [
  ['style-folded', 10 + ((4 * n) % 9)],
  ['style-hanging', 6 + ((5 * n) % 7)],
  ['style-shoes', 4 + (n % 6)],
  ['style-bags', 3 + (n % 4)],
];
// The exception among the Style shops is the design's big Style order, the one View plan splits over two
// days: 1,815 kg and 31.1 m³.
const BIG_STYLE_ORDER: { outletId: string; lines: Line[] } = {
  outletId: 'OUT017',
  lines: [['style-folded', 50], ['style-hanging', 45], ['style-shoes', 25], ['style-bags', 15]],
};
// Tech orders by the pallet and the crate, so its four orders are written out. The last three need a tail lift.
const TECH_ORDERS: { outletId: string; lines: Line[] }[] = [
  { outletId: 'OUT022', lines: [['tech-tv', 2], ['tech-small', 1]] },
  { outletId: 'OUT039', lines: [['tech-fridge', 3]] },
  { outletId: 'OUT058', lines: [['tech-washer', 2], ['tech-small', 2]] },
  { outletId: 'OUT072', lines: [['tech-washer', 1]] },
];
// An order was placed on the day before it is wanted, at 08:00 plus 5 minutes × n: OUT002's at 08:10 and
// OUT075's at 14:15. So Thursday's are all in before the clock starts on Wednesday at 15:00.
const placedAt = (wantedFor: string, n: number) => depotInstant(dayBefore(wantedFor), 8 * 60 + 5 * n);

// Nadeesha's draft for Thursday, with the numbers on the design's Today screen. A judge taps "Continue
// draft" and places it. Her shop is in neither Fresh rule above, because its order is still this draft.
const DRAFT = { outletId: 'OUT001', by: 'nadeesha', chilledCartons: 8, dryCartons: 4 };

// Orders that already waited: four chilled orders that did not go out on the day the shop wanted, so they
// are due on Thursday. Each keeps its wanted date and has a deferral in every sent plan that left it out,
// the latest last. The codes are from the list in spec 007.
const WAITED_ORDERS = [
  { outletId: 'OUT001', cartons: 12, wantedFor: WED, leftOut: [
    { plan: WED, code: 'over_capacity', reason: 'The fridge van was full.' },
  ] },
  { outletId: 'OUT030', cartons: 50, wantedFor: WED, leftOut: [
    { plan: WED, code: 'no_reefer', reason: 'No fridge truck was left for Gampaha.' },
  ] },
  { outletId: 'OUT054', cartons: 55, wantedFor: WED, leftOut: [
    { plan: WED, code: 'window', reason: 'The truck could not reach the shop before its window closed at 07:30.' },
  ] },
  { outletId: 'OUT060', cartons: 39, wantedFor: TUE, leftOut: [
    { plan: TUE, code: 'no_reefer', reason: 'No fridge truck was left for Matara.' },
    { plan: WED, code: 'no_reefer', reason: 'No fridge truck was left for Matara. Two were in the workshop.' },
  ] },
];
// The sent plans those deferrals sit in. They hold only what Thursday needs, so they have no trips. Ruwan
// sent each one at 17:00 on the day before.
const SENT_PLANS = { dates: [TUE, WED], by: 'ruwan', sentAtMinutes: 17 * 60 };

// Vehicles in the workshop. On Thursday that leaves Peliyagoda 5 of its 7 fridge trucks and 1 of its 2
// fridge vans, so the day is short of trips and not of space (D-26).
const WORKSHOP = [
  { vehicleId: 'VEH003', dates: [TUE, WED, THU], reason: 'Fridge unit repair' },
  { vehicleId: 'VEH005', dates: [WED, THU], reason: 'Brake service' },
  { vehicleId: 'VEH036', dates: [THU], reason: 'Gearbox repair' },
];

// Fuel used this week. The quota week is Mon 22 to Sat 27 Jun (D-20), and every Peliyagoda vehicle has a row
// for each day so far on which it was not in the workshop. v is the number in the vehicle's id. A day takes
// 9% to 16% of the weekly quota, rounded down to whole litres. VEH002: 610 × 11 ÷ 100 = 67.
const FUEL_DAYS = [MON, TUE, WED];
const litresADay = (weeklyQuota: number, v: number) => Math.floor((weeklyQuota * (9 + ((5 * v) % 8))) / 100);
// The exception is VEH001, which has used 300 of its 340 litres. The 40 left do not reach Kurunegala and
// back (40.4), the nearest of the four far districts, so on Thursday it serves Colombo, Gampaha or Kalutara.
const FIXED_LITRES_A_DAY: Record<string, number> = { VEH001: 100 };
const FUEL_NOTE = 'Seeded history';

// The same id for the same seeded row on every machine and after every reset, so a test or a later seed can
// point at "OUT002's chilled order for Thursday": demoId('order', '2026-06-25:OUT002:chilled'). It is a
// SHA-1 of "kind:key" shaped as a UUID.
export function demoId(kind: string, key: string): string {
  const bytes = Buffer.from(createHash('sha1').update(`${kind}:${key}`).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface SeedOrder {
  outletId: string;
  wantedFor: string;
  temp: Temp;
  status: 'placed' | 'draft' | 'deferred';
  lines: Line[];
}

// What each kind of seeded row is keyed by:
//   order     its wanted date, shop and temperature   2026-06-25:OUT002:chilled
//   line      its order and its product               2026-06-25:OUT002:chilled:fresh-chilled-carton
//   plan      its date and depot                      2026-06-24:Peliyagoda
//   deferral  its plan's date and its order           2026-06-24:2026-06-23:OUT060:chilled
//   fuel      its date and vehicle                    2026-06-22:VEH001
const orderKey = (o: SeedOrder) => `${o.wantedFor}:${o.outletId}:${o.temp}`;
const orderId = (o: SeedOrder) => demoId('order', orderKey(o));
const planId = (date: string) => demoId('plan', `${date}:${DEMO_DAY.depotId}`);

// Thursday's placed orders, by the rules at the top.
function placedOrders(shops: { id: string; brand: Brand }[]): SeedOrder[] {
  const list: SeedOrder[] = [];
  const place = (outletId: string, temp: Temp, lines: Line[]) => list.push({ outletId, wantedFor: THU, temp, status: 'placed', lines });
  for (const { id, brand } of shops) {
    const n = numberOf(id);
    if (brand === 'Fresh' && id !== DRAFT.outletId) {
      place(id, 'dry', [['fresh-dry-carton', dryCartons(n)]]);
      if (ordersChilled(n)) place(id, 'chilled', [['fresh-chilled-carton', chilledCartons(n)]]);
    }
    if (brand === 'Style' && ordersStyle(n)) place(id, 'dry', id === BIG_STYLE_ORDER.outletId ? BIG_STYLE_ORDER.lines : styleLines(n));
  }
  for (const tech of TECH_ORDERS) place(tech.outletId, 'dry', tech.lines);
  return list;
}

// Nadeesha's draft is two orders, because chilled and dry cartons travel on different trucks.
const DRAFT_ORDERS: SeedOrder[] = [
  { outletId: DRAFT.outletId, wantedFor: THU, temp: 'chilled', status: 'draft', lines: [['fresh-chilled-carton', DRAFT.chilledCartons]] },
  { outletId: DRAFT.outletId, wantedFor: THU, temp: 'dry', status: 'draft', lines: [['fresh-dry-carton', DRAFT.dryCartons]] },
];

// An order that waited stays under the date its shop wanted, which is also what its id is worked out from.
const waitedOrder = (w: (typeof WAITED_ORDERS)[number]): SeedOrder => (
  { outletId: w.outletId, wantedFor: w.wantedFor, temp: 'chilled', status: 'deferred', lines: [['fresh-chilled-carton', w.cartons]] }
);

// Writes the seeded day and says whether it wrote it. It does nothing when demo mode is off or when the day
// is already written. It runs in one transaction, so it is all or nothing. Handed a transaction, as the
// reset does, that becomes a savepoint inside it.
export async function seedDemoDay(on: Db | Tx = db): Promise<boolean> {
  if (!config.DEMO_MODE) return false;
  return on.transaction(async (tx) => {
    // The clock, when there is none yet: the first part's start, set at this moment.
    await tx.insert(demoDay).values({ clockBase: new Date(DEMO_DAY.parts[0].at), clockSetAt: realNow() }).onConflictDoNothing();
    // The row stays locked until the day is in, so two seeds started at the same moment write it once.
    const [day] = await tx.select().from(demoDay).for('update');
    if (day!.seededAt) return false;

    const shops = await tx.select({ id: outlets.id, brand: outlets.brand }).from(outlets)
      .where(eq(outlets.depotId, DEMO_DAY.depotId)).orderBy(outlets.id);
    const fleet = await tx.select({ id: vehicles.id, weeklyFuelQuotaL: vehicles.weeklyFuelQuotaL }).from(vehicles)
      .where(eq(vehicles.depotId, DEMO_DAY.depotId)).orderBy(vehicles.id);
    const people = await tx.select({ id: users.id, username: users.username }).from(users)
      .where(inArray(users.username, [DRAFT.by, SENT_PLANS.by]));
    const userId = (username: string) => {
      const person = people.find((p) => p.username === username);
      if (!person) throw new Error(`The demo day needs the account "${username}", and it is not there.`);
      return person.id;
    };

    // Every insert below is a plain one with the row's own id. A row that is already there is a clash, which
    // stops the seed and leaves nothing of the day behind.

    // The orders and their lines: Thursday's placed ones, Nadeesha's two drafts and the four that waited.
    const dayOrders = [...placedOrders(shops), ...DRAFT_ORDERS, ...WAITED_ORDERS.map(waitedOrder)];
    await tx.insert(orders).values(dayOrders.map((o) => ({
      id: orderId(o),
      outletId: o.outletId,
      deliveryDate: o.wantedFor,
      temp: o.temp,
      status: o.status,
      // A draft is its maker's and has not been placed. The other shops have no account, so nobody is named.
      createdBy: o.status === 'draft' ? userId(DRAFT.by) : null,
      placedAt: o.status === 'draft' ? null : placedAt(o.wantedFor, numberOf(o.outletId)),
    })));
    await tx.insert(orderLines).values(dayOrders.flatMap((o) => o.lines.map(([productId, quantity]) => ({
      id: demoId('line', `${orderKey(o)}:${productId}`),
      orderId: orderId(o),
      productId,
      quantity,
    }))));

    // The sent plans for Tuesday and Wednesday, and in them the reason each order that waited was left out.
    await tx.insert(plans).values(SENT_PLANS.dates.map((date) => ({
      id: planId(date),
      depotId: DEMO_DAY.depotId,
      date,
      status: 'published' as const,
      publishedAt: depotInstant(dayBefore(date), SENT_PLANS.sentAtMinutes),
      createdBy: userId(SENT_PLANS.by),
    })));
    await tx.insert(deferrals).values(WAITED_ORDERS.flatMap((w) => w.leftOut.map((d) => ({
      id: demoId('deferral', `${d.plan}:${orderKey(waitedOrder(w))}`),
      planId: planId(d.plan),
      orderId: orderId(waitedOrder(w)),
      code: d.code,
      reason: d.reason,
    }))));

    // The workshop rows, and the fuel each vehicle used on the days it was out on the road.
    await tx.insert(vehicleDaysOff).values(WORKSHOP.flatMap((w) => w.dates.map((date) => ({ vehicleId: w.vehicleId, date, reason: w.reason }))));
    const inWorkshop = (vehicleId: string, date: string) => WORKSHOP.some((w) => w.vehicleId === vehicleId && w.dates.includes(date));
    await tx.insert(fuelLog).values(fleet.flatMap((v) => FUEL_DAYS.filter((date) => !inWorkshop(v.id, date)).map((date) => ({
      id: demoId('fuel', `${date}:${v.id}`),
      vehicleId: v.id,
      date,
      litres: String(FIXED_LITRES_A_DAY[v.id] ?? litresADay(v.weeklyFuelQuotaL, numberOf(v.id))),
      note: FUEL_NOTE,
    }))));

    await tx.update(demoDay).set({ seededAt: realNow() });
    return true;
  });
}

// Removes the day: every order and plan with all that hangs off them, the fuel rows, the workshop rows and
// the note that the day was written. It leaves the clock row alone. The reset calls it before it writes the
// day again, and the seed's tests call it inside a transaction they roll back.
export async function clearDemoDay(tx: Tx): Promise<void> {
  // The cascade empties every table that points at an order or a plan as well, including the ones later
  // pieces add, so none can be forgotten here.
  await tx.execute(sql`truncate table ${orders}, ${plans}, ${fuelLog}, ${vehicleDaysOff} cascade`);
  await tx.update(demoDay).set({ seededAt: null });
}
