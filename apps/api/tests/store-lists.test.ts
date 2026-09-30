import { hash } from '@node-rs/argon2';
import { StoreOrderList, type OrderStatus, type Temp } from '@wayfinder/contracts';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { deferrals, orderLines, orders, outlets, plans, stopOrders, stops, trips, users } from '../src/db/schema';
import { depotInstant, setClockForTests } from '../src/lib/clock';
import { toMinutes } from '../src/planning/words';

// Spec 009: the lists of a shop's orders. Every test runs against the real database with the app's clock
// frozen, and puts the orders and plans it needs straight into the tables.
//
// The two shops are Kandy's. No account belongs to them and the seeded day has no order or plan for their
// depot, so the seeded day and whatever a judge ordered can never break a test. The two managers are made
// here. They, every order of the two shops and every plan made here are removed at the end.
const MINE = 'OUT085';
const THEIRS = 'OUT086';
const DEPOT = 'Kandy';
const VEHICLE = 'VEH039';

const MON = '2026-06-01';
const TUE = '2026-06-02';
const WED = '2026-06-03';
const THU = '2026-06-04';
const FRI = '2026-06-05';
const at = (date: string, time: string) => depotInstant(date, toMinutes(time));

const app = createApp();
type Asker = ReturnType<typeof request.agent>;

// One address gets ten sign-ins in 15 minutes, so each account signs in once and its cookie is reused.
const signIn = async (username: string, password: string) => {
  const as = request.agent(app);
  const res = await as.post('/api/v1/auth/login').send({ username, password });
  if (res.status !== 200) throw new Error(`Could not sign in as ${username}: ${res.status}`);
  return as;
};

const PASSWORD = 'a password for the test managers';
const MANAGERS = [{ username: 'lists-test-mine', outletId: MINE }, { username: 'lists-test-theirs', outletId: THEIRS }];
let mine: Asker;
let theirs: Asker;
// The plans made here name this person as their maker, which is how they are found again to be removed.
let planner: string;

async function removeEverything() {
  const made = await db.select({ id: users.id }).from(users).where(inArray(users.username, MANAGERS.map((m) => m.username)));
  // Plans first: what hangs off them points at the orders.
  if (made.length) await db.delete(plans).where(inArray(plans.createdBy, made.map((user) => user.id)));
  await db.delete(orders).where(inArray(orders.outletId, [MINE, THEIRS]));
}
const removeManagers = () => db.delete(users).where(inArray(users.username, MANAGERS.map((m) => m.username)));

beforeAll(async () => {
  // What a run that was stopped halfway left behind.
  await removeEverything();
  await removeManagers();
  const passwordHash = await hash(PASSWORD);
  const made = await db.insert(users)
    .values(MANAGERS.map((m) => ({ ...m, displayName: m.username, role: 'store_manager' as const, passwordHash })))
    .returning({ id: users.id });
  planner = made[0]!.id;
  mine = await signIn('lists-test-mine', PASSWORD);
  theirs = await signIn('lists-test-theirs', PASSWORD);
});

// Every test starts on Wed 3 Jun 2026 at 09:00.
beforeEach(() => setClockForTests(at(WED, '09:00')));
afterEach(removeEverything);

afterAll(async () => {
  setClockForTests(null);
  await removeManagers();
  await pool.end();
});

// An order as it sits in the tables at some point of its journey: some cartons of its temperature. Each is
// placed a minute after the one made before it, so the order they were made in is the order they were placed in.
let minutes = 0;
async function order(temp: Temp, status: OrderStatus, deliveryDate: string, { outletId = MINE, cartons = 10, id }: { outletId?: string; cartons?: number; id?: string } = {}) {
  minutes += 1;
  const placedAt = status === 'draft' ? null : new Date(at('2026-04-01', '08:00').getTime() + minutes * 60_000);
  const [row] = await db.insert(orders).values({ id, outletId, temp, status, deliveryDate, placedAt }).returning();
  await db.insert(orderLines).values({ orderId: row!.id, productId: `fresh-${temp}-carton`, quantity: cartons });
  return row!.id;
}

// Kandy's plan for a day with one trip: the orders on its stop at each shop, and the orders it leaves out with
// the reason for each. It is a sent plan unless it is made as a draft.
async function plan(date: string, parts: { carries?: Record<string, string[]>; leavesOut?: Record<string, string>; status?: 'published' | 'draft' }) {
  const status = parts.status ?? 'published';
  const [row] = await db.insert(plans).values({ depotId: DEPOT, date, status, publishedAt: status === 'published' ? at(date, '00:00') : null, createdBy: planner }).returning();
  const carried = Object.entries(parts.carries ?? {});
  if (carried.length) {
    const [trip] = await db.insert(trips).values({ planId: row!.id, vehicleId: VEHICLE, tripNo: 1 }).returning();
    for (const [seq, [outletId, orderIds]] of carried.entries()) {
      const [stop] = await db.insert(stops).values({ tripId: trip!.id, seq: seq + 1, outletId }).returning();
      await db.insert(stopOrders).values(orderIds.map((orderId) => ({ stopId: stop!.id, orderId })));
    }
  }
  const leftOut = Object.entries(parts.leavesOut ?? {});
  if (leftOut.length) await db.insert(deferrals).values(leftOut.map(([orderId, reason]) => ({ planId: row!.id, orderId, code: 'no_reefer', reason })));
}

const ORDERS = '/api/v1/store/orders';
// A list as the screens get it, checked against the shape they are built on.
async function list(as: Asker, name: string, cursor?: string) {
  const res = await as.get(ORDERS).query(cursor ? { list: name, cursor } : { list: name });
  expect(res.status).toBe(200);
  return StoreOrderList.parse(res.body);
}
const ids = (answer: StoreOrderList) => answer.orders.map((o) => o.id);

describe('the lists of a shop\'s orders', () => {
  it('AC-9 returns only the orders of the manager\'s own outlet', async () => {
    // Each shop has an order for today, one that is on its way and one that was received, on the same plans.
    const of = async (outletId: string) => ({
      today: await order('dry', 'planned', WED, { outletId }),
      open: await order('chilled', 'placed', THU, { outletId }),
      past: await order('dry', 'received', TUE, { outletId }),
    });
    const own = await of(MINE);
    const other = await of(THEIRS);
    await plan(TUE, { carries: { [MINE]: [own.past], [THEIRS]: [other.past] } });
    await plan(WED, { carries: { [MINE]: [own.today], [THEIRS]: [other.today] } });

    for (const [as, shop, has] of [[mine, MINE, own], [theirs, THEIRS, other]] as const) {
      const [shopRow] = await db.select().from(outlets).where(eq(outlets.id, shop));
      const today = await list(as, 'today');
      expect(ids(today)).toEqual([has.today]);
      expect(ids(await list(as, 'open'))).toEqual([has.today, has.open]);
      expect(ids(await list(as, 'past'))).toEqual([has.past]);
      // The count is the shop's own too, and so are the shop and the day on top of the list.
      expect(today.openCount).toBe(2);
      expect(today.outlet).toMatchObject({ id: shop, name: shopRow!.name, brand: 'Fresh', dockType: 'rear_dock' });
      expect(today.today).toBe(WED);
    }
    expect((await list(mine, 'today')).outlet).toMatchObject({ windowOpen: '05:00', windowClose: '07:30' });
  });

  it('AC-24 lists for today the orders scheduled for today and the ones not yet on a sent plan whose wanted day is today', async () => {
    const onTheTruck = await order('chilled', 'planned', WED);
    const arrived = await order('chilled', 'delivered', WED);
    const notPlannedYet = await order('chilled', 'placed', WED);
    const waiting = await order('dry', 'placed', WED);
    const loaded = await order('dry', 'loaded', WED);
    const confirmed = await order('dry', 'received', WED);

    // Not coming today: an order that has to wait, a draft, a cancelled order, tomorrow's and yesterday's
    // orders, and an order wanted today that the sent plan for Thursday carries.
    const deferred = await order('chilled', 'deferred', WED);
    await order('dry', 'draft', WED);
    await order('dry', 'cancelled', WED);
    await order('dry', 'placed', THU);
    const yesterday = await order('chilled', 'delivered', TUE);
    const pushedOn = await order('dry', 'planned', WED);

    await plan(TUE, { carries: { [MINE]: [yesterday] } });
    await plan(WED, { carries: { [MINE]: [onTheTruck, arrived, loaded, confirmed] }, leavesOut: { [deferred]: 'No fridge truck was left for Kandy.' } });
    await plan(THU, { carries: { [MINE]: [pushedOn] } });
    // A plan that is not sent yet schedules nothing: its order still counts for the day the shop wanted.
    await plan(FRI, { status: 'draft', carries: { [MINE]: [notPlannedYet] } });

    const today = await list(mine, 'today');
    // Chilled before dry, and then in the order they were placed.
    expect(ids(today)).toEqual([onTheTruck, arrived, notPlannedYet, waiting, loaded, confirmed]);
    expect(today.orders.map((o) => [o.temp, o.status, o.deliveryDate, o.scheduledDate])).toEqual([
      ['chilled', 'planned', WED, WED],
      ['chilled', 'delivered', WED, WED],
      ['chilled', 'placed', WED, null],
      ['dry', 'placed', WED, null],
      ['dry', 'loaded', WED, WED],
      ['dry', 'received', WED, WED],
    ]);
    expect(today.orders[0]).toEqual({
      id: onTheTruck, deliveryDate: WED, scheduledDate: WED, temp: 'chilled', status: 'planned',
      lines: [{ productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', quantity: 10 }], units: 10,
      placedAt: expect.stringMatching(/^2026-04-01T.*Z$/), deferralReason: null,
    });
    expect(today).toMatchObject({ today: WED, nextCursor: null });

    // Today is the clock's day at the depot. At 23:59 it is still Wednesday, and a minute later it is Thursday.
    setClockForTests(at(WED, '23:59'));
    expect(ids(await list(mine, 'today'))).toEqual(ids(today));
    setClockForTests(at(THU, '00:00'));
    const thursday = await list(mine, 'today');
    expect(thursday.today).toBe(THU);
    expect(thursday.orders.map((o) => [o.temp, o.status, o.deliveryDate, o.scheduledDate])).toEqual([['dry', 'placed', THU, null], ['dry', 'planned', WED, THU]]);
  });

  it('AC-39 lists an order wanted for an earlier day that is on a sent plan for today, with its scheduled day', async () => {
    // Wanted Tue 2 Jun. Tuesday's plan left it out, and Wednesday's carries it.
    const carriedOver = await order('chilled', 'planned', TUE);
    // This one went out on Tuesday, came back and is on Wednesday's plan again. It counts for the later plan.
    const secondTry = await order('dry', 'planned', TUE);
    await plan(TUE, { carries: { [MINE]: [secondTry] }, leavesOut: { [carriedOver]: 'The fridge van was full.' } });
    await plan(WED, { carries: { [MINE]: [carriedOver, secondTry] } });

    const today = await list(mine, 'today');
    expect(today.orders.map((o) => [o.id, o.deliveryDate, o.scheduledDate, o.status, o.deferralReason])).toEqual([
      [carriedOver, TUE, WED, 'planned', null],
      [secondTry, TUE, WED, 'planned', null],
    ]);

    // On the day it was wanted it is not coming, and on the day after it has been.
    setClockForTests(at(TUE, '09:00'));
    expect(ids(await list(mine, 'today'))).toEqual([]);
    setClockForTests(at(THU, '09:00'));
    expect(ids(await list(mine, 'today'))).toEqual([]);
  });

  it('AC-25 lists the placed, planned, deferred, loaded and delivered orders, earliest day first and chilled before dry, with how many there are', async () => {
    const friday = await order('dry', 'placed', FRI);
    const thursdayDry = await order('dry', 'planned', TUE);
    const thursdayChilled = await order('chilled', 'placed', THU);
    const todayDry = await order('dry', 'delivered', WED);
    const todayChilled = await order('chilled', 'loaded', WED);
    const stillWaiting = await order('chilled', 'deferred', TUE);
    // Not open: a received order, a draft and a cancelled order.
    const done = await order('dry', 'received', WED);
    await order('chilled', 'draft', THU);
    await order('dry', 'cancelled', WED);

    await plan(TUE, { leavesOut: { [stillWaiting]: 'No fridge truck was left for Kandy.', [thursdayDry]: 'The truck was full.' } });
    await plan(WED, { carries: { [MINE]: [todayDry, todayChilled, done] }, leavesOut: { [stillWaiting]: 'The fridge van broke down.', [thursdayDry]: 'The truck was full again.' } });
    await plan(THU, { carries: { [MINE]: [thursdayDry] } });

    const open = await list(mine, 'open');
    // An order counts for the day of the sent plan it is on, and until then for the day the shop wanted. So the
    // one wanted on Tuesday that Thursday's plan carries comes with Thursday's, after the chilled one.
    expect(ids(open)).toEqual([stillWaiting, todayChilled, todayDry, thursdayChilled, thursdayDry, friday]);
    expect(open.orders.map((o) => [o.temp, o.status, o.deliveryDate, o.scheduledDate])).toEqual([
      ['chilled', 'deferred', TUE, null],
      ['chilled', 'loaded', WED, WED],
      ['dry', 'delivered', WED, WED],
      ['chilled', 'placed', THU, null],
      ['dry', 'planned', TUE, THU],
      ['dry', 'placed', FRI, null],
    ]);
    expect(open).toMatchObject({ openCount: 6, nextCursor: null, today: WED });

    // The count of open orders comes with every list.
    expect((await list(mine, 'today')).openCount).toBe(6);
    expect((await list(mine, 'past')).openCount).toBe(6);
    expect((await list(theirs, 'open'))).toMatchObject({ orders: [], openCount: 0 });
  });

  it('AC-26 lists received orders newest day first, 20 at a time, and the next page continues with no order repeated or missed', async () => {
    // 45 received orders: a chilled and a dry one on each of 22 days, and one more chilled on the newest day.
    const days = ['2026-06-02', '2026-06-01', '2026-05-30', '2026-05-29', '2026-05-28', '2026-05-27', '2026-05-26', '2026-05-25', '2026-05-23',
      '2026-05-22', '2026-05-21', '2026-05-20', '2026-05-19', '2026-05-18', '2026-05-16', '2026-05-15', '2026-05-14', '2026-05-13', '2026-05-12',
      '2026-05-11', '2026-05-09', '2026-05-08'];
    const received: { id: string; day: string; temp: Temp }[] = [];
    const receive = async (temp: Temp, day: string, id?: string) => received.push({ id: await order(temp, 'received', day, { id }), day, temp });
    // Two of them get an id of their own, so that each page ends where going on takes more than the next id.
    // One was wanted on Thu 21 May and came on Fri 22 May, so it is listed under the day it came. The lowest
    // id there is puts it first among that Friday's chilled orders, which makes it the twentieth order.
    const late = { id: '00000000-0000-4000-8000-000000000000', wanted: '2026-05-21', came: '2026-05-22' };
    // The fortieth is Mon 11 May's chilled order. It has the highest id there is, and that day's dry order
    // still comes after it.
    const highest = { id: 'ffffffff-ffff-4fff-bfff-ffffffffffff', day: '2026-05-11' };
    const ownId: Record<string, string> = { [late.wanted]: late.id, [highest.day]: highest.id };
    // Made oldest first and dry before chilled, so the order they come back in is not the order they went in.
    for (const day of [...days].reverse()) {
      await receive('dry', day);
      await receive('chilled', day, ownId[day]);
    }
    await receive('chilled', days[0]!);
    await plan(late.came, { carries: { [MINE]: [late.id] } });
    received.find((o) => o.id === late.id)!.day = late.came;
    // Orders that are not received are in no page, and neither are another shop's.
    await order('dry', 'delivered', TUE);
    await order('chilled', 'placed', THU);
    await order('dry', 'draft', THU);
    await order('dry', 'received', TUE, { outletId: THEIRS });

    // Newest day first, chilled before dry, and two of one day and temperature by their id.
    const expected = [...received]
      .sort((a, b) => (a.day === b.day ? (a.temp === b.temp ? (a.id < b.id ? -1 : 1) : a.temp === 'chilled' ? -1 : 1) : a.day > b.day ? -1 : 1))
      .map((o) => o.id);
    expect(expected).toHaveLength(45);

    const first = await list(mine, 'past');
    expect(first.orders).toHaveLength(20);
    expect(first.orders.at(-1)).toMatchObject({ id: late.id, deliveryDate: late.wanted, scheduledDate: late.came });
    expect(first.nextCursor).toEqual(expect.any(String));
    // An order that is received after the first page was read does not move the pages that follow.
    await order('dry', 'received', WED);
    const second = await list(mine, 'past', first.nextCursor!);
    expect(second.orders).toHaveLength(20);
    expect(second.orders.at(-1)).toMatchObject({ id: highest.id, deliveryDate: highest.day, temp: 'chilled' });
    const third = await list(mine, 'past', second.nextCursor!);
    expect(third.orders).toHaveLength(5);
    expect(third.nextCursor).toBeNull();

    expect([...ids(first), ...ids(second), ...ids(third)]).toEqual(expected);
    expect(first.orders.slice(0, 4).map((o) => [o.deliveryDate, o.temp, o.status])).toEqual([
      [days[0], 'chilled', 'received'], [days[0], 'chilled', 'received'], [days[0], 'dry', 'received'], [days[1], 'chilled', 'received'],
    ]);

    // A list that ends exactly on a full page has no next page.
    for (let n = 0; n < 19; n++) await order('dry', 'received', MON, { outletId: THEIRS });
    const theirPast = await list(theirs, 'past');
    expect(theirPast.orders).toHaveLength(20);
    expect(theirPast.nextCursor).toBeNull();
  });

  it('AC-27 returns the reason of the latest deferral with a deferred order', async () => {
    const waitedTwice = await order('chilled', 'deferred', MON);
    const waitedOnce = await order('chilled', 'deferred', TUE);
    const goingOut = await order('dry', 'planned', MON);
    await plan(MON, { leavesOut: { [waitedTwice]: 'No fridge truck was left for Kandy.', [goingOut]: 'The truck was full.' } });
    await plan(TUE, { leavesOut: { [waitedTwice]: 'No fridge truck was left for Kandy. Two were in the workshop.', [waitedOnce]: 'The fridge van was full.' } });
    await plan(WED, { carries: { [MINE]: [goingOut] } });
    // A plan that is not sent yet has told the shop nothing.
    await plan(THU, { status: 'draft', leavesOut: { [waitedTwice]: 'Still being planned.' } });

    const open = await list(mine, 'open');
    expect(open.orders.map((o) => [o.id, o.status, o.deliveryDate, o.deferralReason])).toEqual([
      [waitedTwice, 'deferred', MON, 'No fridge truck was left for Kandy. Two were in the workshop.'],
      [waitedOnce, 'deferred', TUE, 'The fridge van was full.'],
      // The reason is only set on an order that is waiting now. This one waited on Monday and is planned.
      [goingOut, 'planned', MON, null],
    ]);
  });

  it('answers 400 invalid_input to a list that is not today, open or past, and to a cursor that is not one', async () => {
    const answer = async (query: Record<string, string>) => {
      const res = await mine.get(ORDERS).query(query);
      return [res.status, res.body.error?.code];
    };
    expect(await answer({})).toEqual([400, 'invalid_input']);
    expect(await answer({ list: 'all' })).toEqual([400, 'invalid_input']);
    expect(await answer({ list: 'past', cursor: 'the second page' })).toEqual([400, 'invalid_input']);
    expect(await answer({ list: 'past', cursor: `2026-06-02,dry,${'0'.repeat(200)}` })).toEqual([400, 'invalid_input']);
    expect(await answer({ list: 'past', cursor: '2026-06-02,frozen,5f0f6d5e-6d4f-4b56-8a0e-0d8f3c7e9a11' })).toEqual([400, 'invalid_input']);
  });
});
