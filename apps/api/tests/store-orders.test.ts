import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { CutoffPassedDetails, PlaceOrdersResponse, StoreNextOrder, type DraftRefs } from '@wayfinder/contracts';
import { eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { orderLines, orders, outlets, products, users } from '../src/db/schema';
import { depotInstant, realNow, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { toMinutes } from '../src/planning/words';
import { serve, stop } from './serve';

// Spec 009: the next order, its draft and placing it. Every test runs against the real database with the
// app's clock frozen.
//
// The shops are three of Kandy's. No account belongs to them and the seeded day has no order for them, so
// the seeded draft and whatever a judge ordered can never break a test. The store managers are made here and
// removed at the end with every order of those shops. Nothing is written to a shop that has an account.
const FRESH = 'OUT084';
const STYLE = 'OUT089';
const TECH = 'OUT094';
const SHOPS = [FRESH, STYLE, TECH];
const DEPOT = 'Kandy';

const TUE = '2026-06-02';
const WED = '2026-06-03';
const THU = '2026-06-04';
const FRI = '2026-06-05';
const at = (date: string, time: string) => depotInstant(date, toMinutes(time));

// Placing announces the change. The stream is not built yet, so the announcement itself is what is checked.
vi.mock('../src/lib/live', async (original) => ({ ...(await original<typeof import('../src/lib/live')>()), announce: vi.fn() }));
// How many of the app's transactions are open at the moment of each announcement. An announcement is made
// after its change has committed, never inside the transaction.
let openTransactions = 0;
const openWhenAnnounced: number[] = [];
const transaction = db.transaction.bind(db);
vi.spyOn(db, 'transaction').mockImplementation(((work, config) => {
  openTransactions += 1;
  return transaction(work, config).finally(() => { openTransactions -= 1; });
}) as typeof db.transaction);
vi.mocked(announce).mockImplementation(() => { openWhenAnnounced.push(openTransactions); });

const server = await serve(createApp());
type Asker = ReturnType<typeof request.agent>;
const NEXT = '/api/v1/store/next-order';
const save = (as: Asker, body: object) => as.put(`${NEXT}/draft`).send(body);
const place = (as: Asker, body: object) => as.post(`${NEXT}/place`).send(body);
const answer = (res: request.Response) => [res.status, res.body.error?.code];

// One address gets ten sign-ins in 15 minutes, so each account signs in once and its cookie is reused.
const signIn = async (username: string, password: string) => {
  const as = request.agent(server);
  const res = await as.post('/api/v1/auth/login').send({ username, password });
  if (res.status !== 200) throw new Error(`Could not sign in as ${username}: ${res.status}`);
  return as;
};

// Two managers at the Fresh shop, because the one who places a draft need not be the one who started it.
const PASSWORD = 'a password for the test managers';
const MANAGERS = [
  { username: 'orders-test-fresh', outletId: FRESH },
  { username: 'orders-test-fresh-second', outletId: FRESH },
  { username: 'orders-test-style', outletId: STYLE },
  { username: 'orders-test-tech', outletId: TECH },
  { username: 'orders-test-no-shop', outletId: null },
];
const userIds: Record<string, string> = {};
let fresh: Asker;
let second: Asker;
let style: Asker;
let tech: Asker;
let noShop: Asker;
let ruwan: Asker;
let kasun: Asker;
let dilshan: Asker;
let admin: Asker;

const removeOrders = () => db.delete(orders).where(inArray(orders.outletId, SHOPS));
const removeManagers = () => db.delete(users).where(inArray(users.username, MANAGERS.map((m) => m.username)));

beforeAll(async () => {
  // What a run that was stopped halfway left behind.
  await removeOrders();
  await removeManagers();
  const passwordHash = await hash(PASSWORD);
  const made = await db.insert(users)
    .values(MANAGERS.map((m) => ({ ...m, displayName: m.username, role: 'store_manager' as const, passwordHash })))
    .returning({ id: users.id, username: users.username });
  for (const user of made) userIds[user.username] = user.id;

  fresh = await signIn('orders-test-fresh', PASSWORD);
  second = await signIn('orders-test-fresh-second', PASSWORD);
  style = await signIn('orders-test-style', PASSWORD);
  tech = await signIn('orders-test-tech', PASSWORD);
  noShop = await signIn('orders-test-no-shop', PASSWORD);
  const seedPassword = process.env.SEED_PASSWORD ?? 'wayfinder-demo';
  ruwan = await signIn('ruwan', seedPassword);
  kasun = await signIn('kasun', seedPassword);
  dilshan = await signIn('dilshan', seedPassword);
  admin = await signIn('admin', process.env.SEED_ADMIN_PASSWORD ?? 'wayfinder-admin');
});

// Every test starts on Tue 2 Jun 2026 at 15:00, when the open day is Wednesday and it closes today at 16:00.
beforeEach(() => {
  setClockForTests(at(TUE, '15:00'));
  vi.mocked(announce).mockClear();
  openWhenAnnounced.length = 0;
});

afterEach(async () => {
  await removeOrders();
  await db.update(products).set({ archivedAt: null }).where(eq(products.id, 'fresh-dry-carton'));
});

afterAll(async () => {
  setClockForTests(null);
  await removeManagers();
  await stop(server);
  await pool.end();
});

const CHILLED = { productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton' };
const DRY = { productId: 'fresh-dry-carton', name: 'Dry carton', unit: 'carton' };
const cartons = (chilled: number, dry: number) => [{ productId: CHILLED.productId, quantity: chilled }, { productId: DRY.productId, quantity: dry }];
const draftFor = (deliveryDate: string, lines: object[], refs: DraftRefs = {}, driverNote = '') => ({ deliveryDate, lines, driverNote, refs });

// A first save of 8 chilled and 4 dry cartons, the numbers on the design's Today screen, and the refs the
// answer names the two drafts by.
async function savedDraft(deliveryDate = WED): Promise<DraftRefs> {
  const res = await save(fresh, draftFor(deliveryDate, cartons(8, 4)));
  expect(res.status).toBe(200);
  return StoreNextOrder.parse(res.body).draft!.refs;
}

// Every order of a shop with its lines, as the database holds them. A refused request leaves this as it was.
async function held(outletId = FRESH) {
  const rows = await db.select().from(orders).where(eq(orders.outletId, outletId)).orderBy(orders.temp, orders.placedAt, orders.id);
  const lines = rows.length
    ? await db.select().from(orderLines).where(inArray(orderLines.orderId, rows.map((o) => o.id))).orderBy(orderLines.orderId, orderLines.productId)
    : [];
  return { orders: rows, lines };
}
// The same in short: each order's temperature, status, day and units.
async function ordersOf(outletId = FRESH) {
  const { orders: rows, lines } = await held(outletId);
  const units = (orderId: string) => lines.filter((l) => l.orderId === orderId).reduce((sum, l) => sum + l.quantity, 0);
  return rows.map((o) => [o.temp, o.status, o.deliveryDate, units(o.id)]);
}

const archive = (productId: string) => db.update(products).set({ archivedAt: at(TUE, '14:00') }).where(eq(products.id, productId));

// How many requests are waiting for a lock in this database.
async function waiting(): Promise<number> {
  const found = await db.execute<{ waiting: number }>(
    sql`select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
  );
  return found.rows[0]!.waiting;
}

// Sends the requests while the test holds the shop's row, each one once the one before it is waiting, so they
// queue behind the lock in this order as they would behind another save. `meanwhile` runs while they all
// wait. Then the lock is let go, and the answers come back in the order the requests were sent.
async function queuedOnTheShop(outletId: string, requests: request.Test[], meanwhile = () => {}) {
  const holder = await pool.connect();
  try {
    await holder.query('begin');
    await holder.query('select from outlets where id = $1 for update', [outletId]);
    const answers: Promise<request.Response>[] = [];
    try {
      for (const next of requests) {
        let answered = false;
        answers.push(next.then((res) => {
          answered = true;
          return res;
        }));
        for (let tries = 0; (await waiting()) < answers.length; tries++) {
          if (answered || tries === 200) throw new Error(`Request ${answers.length} did not wait for the shop's lock.`);
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      meanwhile();
    } finally {
      await holder.query('rollback');
    }
    return await Promise.all(answers);
  } finally {
    holder.release();
  }
}

describe('who may call the store endpoints', () => {
  const askAll = async (as: Asker) => [
    answer(await as.get(NEXT)),
    answer(await save(as, draftFor(WED, cartons(8, 4)))),
    answer(await place(as, { deliveryDate: WED, refs: {} })),
    answer(await as.get('/api/v1/store/orders?list=open')),
  ];

  it('AC-6 answers 401 signed_out on every endpoint when there is no session', async () => {
    expect(await askAll(request.agent(server))).toEqual(Array(4).fill([401, 'signed_out']));
  });

  it('AC-7 answers 403 forbidden to a dispatcher, a loader and a driver', async () => {
    for (const as of [ruwan, kasun, dilshan]) expect(await askAll(as)).toEqual(Array(4).fill([403, 'forbidden']));
  });

  it('AC-8 answers 403 no_outlet to a person with no shop: an admin, and a store manager whose account names none', async () => {
    for (const as of [admin, noShop]) expect(await askAll(as)).toEqual(Array(4).fill([403, 'no_outlet']));
    expect((await held()).orders).toEqual([]);
  });
});

describe('the next order', () => {
  it('AC-10 returns the shop\'s window and entrance, the active items of its brand, the delivery day and the cut-off', async () => {
    const [shop] = await db.select().from(outlets).where(eq(outlets.id, FRESH));
    const res = await fresh.get(NEXT);
    expect(res.status).toBe(200);
    // The window is the shop's own, 05:30 to 08:00 at a rear dock, in hours and minutes.
    expect(res.body).toEqual({
      outlet: { id: FRESH, name: shop!.name, brand: 'Fresh', windowOpen: '05:30', windowClose: '08:00', dockType: 'rear_dock' },
      products: [
        { id: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', kgPerUnit: 6.9, m3PerUnit: 0.037, temp: 'chilled', needsTailLift: false },
        { id: 'fresh-dry-carton', name: 'Dry carton', unit: 'carton', kgPerUnit: 6.9, m3PerUnit: 0.037, temp: 'dry', needsTailLift: false },
      ],
      deliveryDate: WED,
      cutoffAt: at(TUE, '16:00').toISOString(),
      cutoffIsToday: true,
      movedFrom: null,
      draft: null,
      placed: null,
    });
    expect(() => StoreNextOrder.parse(res.body)).not.toThrow();

    // Style and Tech get their own four items, in the product list's order, with the figures their forms print.
    const styleShop = StoreNextOrder.parse((await style.get(NEXT)).body);
    expect(styleShop.outlet).toMatchObject({ id: STYLE, brand: 'Style', windowOpen: '10:30', windowClose: '12:30', dockType: 'mall_bay' });
    expect(styleShop.products.map((p) => p.id)).toEqual(['style-folded', 'style-hanging', 'style-shoes', 'style-bags']);
    expect(styleShop.products[1]).toEqual({ id: 'style-hanging', name: 'Hanging garments', unit: 'rail box', kgPerUnit: 14, m3PerUnit: 0.3, temp: 'dry', needsTailLift: false });
    const techShop = StoreNextOrder.parse((await tech.get(NEXT)).body);
    expect(techShop.outlet).toMatchObject({ id: TECH, brand: 'Tech', windowOpen: '09:00', windowClose: '11:00', dockType: 'mall_bay' });
    expect(techShop.products.map((p) => [p.id, p.needsTailLift])).toEqual([['tech-tv', false], ['tech-washer', true], ['tech-fridge', true], ['tech-small', false]]);

    // An archived item is no longer offered.
    await archive('fresh-dry-carton');
    expect(StoreNextOrder.parse((await fresh.get(NEXT)).body).products.map((p) => p.id)).toEqual(['fresh-chilled-carton']);

    // From 16:00 the order is for Thursday, which closes tomorrow.
    setClockForTests(at(TUE, '16:00'));
    expect((await fresh.get(NEXT)).body).toMatchObject({ deliveryDate: THU, cutoffAt: at(WED, '16:00').toISOString(), cutoffIsToday: false });
  });

  it('AC-17 offers a draft whose day has closed for the open day and says which day it moved from, until it is saved or placed', async () => {
    const refs = await savedDraft();
    const before = await held();

    // At 16:05 Wednesday has closed. The draft is offered for Thursday.
    setClockForTests(at(TUE, '16:05'));
    const moved = await fresh.get(NEXT);
    expect(moved.body).toMatchObject({ deliveryDate: THU, cutoffAt: at(WED, '16:00').toISOString(), cutoffIsToday: false, movedFrom: WED });
    expect(moved.body.draft).toMatchObject({ refs, lines: [{ ...CHILLED, quantity: 8 }, { ...DRY, quantity: 4 }] });
    // Reading never writes: the drafts are still the ones saved for Wednesday.
    expect(await held()).toEqual(before);

    // Saved for the open day, it is Thursday's draft and has not moved.
    const saved = await save(fresh, draftFor(THU, cartons(8, 4), refs));
    expect(saved.body).toMatchObject({ deliveryDate: THU, movedFrom: null });
    expect(await ordersOf()).toEqual([['chilled', 'draft', THU, 8], ['dry', 'draft', THU, 4]]);
    expect((await fresh.get(NEXT)).body.movedFrom).toBeNull();

    // A day later Thursday has closed too. Placed as it is, the draft becomes Friday's orders.
    setClockForTests(at(WED, '16:05'));
    expect((await fresh.get(NEXT)).body).toMatchObject({ deliveryDate: FRI, movedFrom: THU });
    const placed = await place(fresh, { deliveryDate: FRI, refs: saved.body.draft.refs });
    expect(placed.body).toMatchObject({ deliveryDate: FRI, movedFrom: null, draft: null });
    expect(await ordersOf()).toEqual([['chilled', 'placed', FRI, 8], ['dry', 'placed', FRI, 4]]);
  });

  it('AC-18 returns no day when no delivery day is open, and answers a save or a place with 409 no_delivery_day', async () => {
    // Fri 26 Jun 2026: until 16:00 Saturday can be ordered for. After that nothing is left, because the
    // calendar ends on Sun 28 Jun, which is closed.
    setClockForTests(at('2026-06-26', '15:00'));
    const refs = await savedDraft('2026-06-27');
    const before = await held();
    setClockForTests(at('2026-06-26', '16:30'));

    const res = await fresh.get(NEXT);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outlet: { id: FRESH }, deliveryDate: null, cutoffAt: null, cutoffIsToday: false, movedFrom: null, placed: null });
    expect(res.body.products).toHaveLength(2);
    expect(() => StoreNextOrder.parse(res.body)).not.toThrow();

    expect(answer(await save(fresh, draftFor('2026-06-27', cartons(9, 4), refs)))).toEqual([409, 'no_delivery_day']);
    expect(answer(await place(fresh, { deliveryDate: '2026-06-27', refs }))).toEqual([409, 'no_delivery_day']);
    expect(await held()).toEqual(before);
    expect(announce).not.toHaveBeenCalled();
  });
});

describe('saving the draft', () => {
  it('AC-11 keeps one draft order per temperature and returns each draft\'s id and revision, its saved time and the summary', async () => {
    setClockForTests(at(TUE, '15:02'));
    const res = await save(fresh, draftFor(WED, cartons(8, 4), {}, 'Ring the bell at the side door.'));
    expect(res.status).toBe(200);

    // Chilled and dry cartons travel apart, so they are two orders. Both carry the note and the time saved.
    const { orders: rows, lines } = await held();
    expect(rows.map((o) => [o.temp, o.status, o.deliveryDate, o.driverNote, o.createdBy, o.savedAt, o.placedAt, o.placedBy, o.revision])).toEqual([
      ['chilled', 'draft', WED, 'Ring the bell at the side door.', userIds['orders-test-fresh'], at(TUE, '15:02'), null, null, 0],
      ['dry', 'draft', WED, 'Ring the bell at the side door.', userIds['orders-test-fresh'], at(TUE, '15:02'), null, null, 0],
    ]);
    const [chilled, dry] = rows;
    expect(lines.map((l) => [l.orderId, l.productId, l.quantity]).sort()).toEqual(
      [[chilled!.id, CHILLED.productId, 8], [dry!.id, DRY.productId, 4]].sort(),
    );
    // The two times nobody sees stay on the real clock.
    for (const real of [chilled!.createdAt, chilled!.updatedAt]) expect(Math.abs(real.getTime() - realNow().getTime())).toBeLessThan(5 * 60_000);

    // 12 cartons are 82.8 kg and 0.444 m³.
    expect(res.body.draft).toEqual({
      lines: [{ ...CHILLED, quantity: 8 }, { ...DRY, quantity: 4 }],
      driverNote: 'Ring the bell at the side door.',
      refs: { chilled: { id: chilled!.id, revision: 0 }, dry: { id: dry!.id, revision: 0 } },
      savedAt: at(TUE, '15:02').toISOString(),
      summary: { kg: 82.8, m3: 0.444, units: 12, needsReefer: true, needsTailLift: false, keepUpright: false },
      tailLiftItems: [],
    });
    expect(res.body).toMatchObject({ outlet: { id: FRESH }, deliveryDate: WED, cutoffAt: at(TUE, '16:00').toISOString(), movedFrom: null, placed: null });
    expect(() => StoreNextOrder.parse(res.body)).not.toThrow();

    // The answer is what the GET gives, so a reload or the other screen size shows the same draft.
    setClockForTests(at(TUE, '15:30'));
    expect((await fresh.get(NEXT)).body).toEqual(res.body);
  });

  it('AC-11 gives a Style and a Tech shop one draft order, with the summary and the tail lift items from the load calculator', async () => {
    // The numbers in the design's footers: 100 boxes, 1,350 kg and 22.8 m³, and 3 items, 630 kg and 2.15 m³.
    const styled = StoreNextOrder.parse((await save(style, draftFor(WED, [
      { productId: 'style-bags', quantity: 10 }, { productId: 'style-shoes', quantity: 20 },
      { productId: 'style-hanging', quantity: 30 }, { productId: 'style-folded', quantity: 40 },
    ]))).body);
    expect(await ordersOf(STYLE)).toEqual([['dry', 'draft', WED, 100]]);
    expect(styled.draft).toMatchObject({
      // In the product list's order, whatever order the request had them in.
      lines: [
        { productId: 'style-folded', name: 'Folded clothing', unit: 'box', quantity: 40 },
        { productId: 'style-hanging', name: 'Hanging garments', unit: 'rail box', quantity: 30 },
        { productId: 'style-shoes', name: 'Shoes', unit: 'carton', quantity: 20 },
        { productId: 'style-bags', name: 'Bags and accessories', unit: 'carton', quantity: 10 },
      ],
      refs: { dry: { revision: 0 } },
      summary: { kg: 1350, m3: 22.8, units: 100, needsReefer: false, needsTailLift: false, keepUpright: true },
      tailLiftItems: [],
    });
    expect(styled.draft!.refs.chilled).toBeUndefined();

    const teched = StoreNextOrder.parse((await save(tech, draftFor(WED, [
      { productId: 'tech-tv', quantity: 1 }, { productId: 'tech-washer', quantity: 1 },
      { productId: 'tech-fridge', quantity: 1 }, { productId: 'tech-small', quantity: 0 },
    ]))).body);
    expect(await ordersOf(TECH)).toEqual([['dry', 'draft', WED, 3]]);
    expect(teched.draft).toMatchObject({
      summary: { kg: 630, m3: 2.15, units: 3, needsReefer: false, needsTailLift: true, keepUpright: false },
      tailLiftItems: ['Washing machines', 'Refrigerators'],
    });

    // With the two crates taken out, nothing in the order needs a tail lift.
    const lighter = StoreNextOrder.parse((await save(tech, draftFor(WED, [{ productId: 'tech-tv', quantity: 1 }], teched.draft!.refs))).body);
    expect(lighter.draft).toMatchObject({ summary: { kg: 170, m3: 0.6, units: 1, needsTailLift: false }, tailLiftItems: [] });
  });

  it('AC-12 replaces the lines and the note when a draft is saved again and adds no order, and removes a draft left with no units', async () => {
    setClockForTests(at(TUE, '15:02'));
    const first = StoreNextOrder.parse((await save(fresh, draftFor(WED, cartons(8, 4), {}, 'Side door.'))).body).draft!;
    const { chilled, dry } = first.refs;

    // Saved again by someone else at the shop.
    setClockForTests(at(TUE, '15:04'));
    const again = await save(second, draftFor(WED, cartons(9, 4), first.refs, 'Front door, please.'));
    expect(again.status).toBe(200);
    // The same two orders, one revision on.
    expect(again.body.draft).toEqual({
      lines: [{ ...CHILLED, quantity: 9 }, { ...DRY, quantity: 4 }],
      driverNote: 'Front door, please.',
      refs: { chilled: { id: chilled!.id, revision: 1 }, dry: { id: dry!.id, revision: 1 } },
      savedAt: at(TUE, '15:04').toISOString(),
      summary: { kg: 89.7, m3: 0.481, units: 13, needsReefer: true, needsTailLift: false, keepUpright: false },
      tailLiftItems: [],
    });
    // They are still the drafts of the one who started them.
    const after = await held();
    expect(after.orders.map((o) => [o.id, o.status, o.driverNote, o.savedAt, o.revision, o.createdBy])).toEqual([
      [chilled!.id, 'draft', 'Front door, please.', at(TUE, '15:04'), 1, userIds['orders-test-fresh']],
      [dry!.id, 'draft', 'Front door, please.', at(TUE, '15:04'), 1, userIds['orders-test-fresh']],
    ]);
    expect(after.lines.map((l) => [l.productId, l.quantity]).sort()).toEqual([[CHILLED.productId, 9], [DRY.productId, 4]]);

    // A temperature left with no units loses its draft, and the other one stays. The note can be emptied.
    const chilledOnly = await save(fresh, draftFor(WED, cartons(9, 0), again.body.draft.refs));
    expect(chilledOnly.body.draft).toMatchObject({ lines: [{ ...CHILLED, quantity: 9 }], driverNote: '', refs: { chilled: { id: chilled!.id, revision: 2 } } });
    expect(chilledOnly.body.draft.refs.dry).toBeUndefined();
    expect((await held()).orders.map((o) => [o.id, o.driverNote])).toEqual([[chilled!.id, null]]);

    // Made again, it is a new draft with a new id, so a request that still names the old one can never match it.
    const back = await save(fresh, draftFor(WED, cartons(9, 3), chilledOnly.body.draft.refs));
    expect(back.body.draft.refs).toEqual({ chilled: { id: chilled!.id, revision: 3 }, dry: { id: expect.any(String), revision: 0 } });
    expect(back.body.draft.refs.dry.id).not.toBe(dry!.id);

    // With every quantity at 0 there is no draft left.
    const none = await save(fresh, draftFor(WED, cartons(0, 0), back.body.draft.refs));
    expect(none.status).toBe(200);
    expect(none.body.draft).toBeNull();
    expect(await held()).toEqual({ orders: [], lines: [] });
    // Saving nothing where there is nothing is no error either.
    expect((await save(fresh, draftFor(WED, []))).body.draft).toBeNull();
    expect(announce).not.toHaveBeenCalled();
  });

  it('AC-13 refuses an item that is not an active item of the shop\'s brand with 400 unknown_product and changes nothing', async () => {
    const refs = await savedDraft();
    const before = await held();
    const saving = async (lines: object[]) => answer(await save(fresh, draftFor(WED, lines, refs)));

    // Another brand's item, an item that does not exist, and the same at quantity 0: every line is checked.
    expect(await saving([...cartons(8, 4), { productId: 'style-shoes', quantity: 2 }])).toEqual([400, 'unknown_product']);
    expect(await saving([{ productId: 'fresh-frozen-carton', quantity: 1 }])).toEqual([400, 'unknown_product']);
    expect(await saving([...cartons(9, 4), { productId: 'style-shoes', quantity: 0 }])).toEqual([400, 'unknown_product']);

    // An item of the shop's own brand that has been archived.
    await archive('fresh-dry-carton');
    expect(await saving(cartons(9, 4))).toEqual([400, 'unknown_product']);

    expect(await held()).toEqual(before);
  });

  it('AC-14 refuses a quantity that is not a whole number from 0 to 999 and a note over 200 characters with 400 invalid_input', async () => {
    const refs = await savedDraft();
    const before = await held();

    for (const quantity of [-1, 1000, 2.5, '8', null]) {
      const res = await save(fresh, draftFor(WED, [{ productId: CHILLED.productId, quantity }], refs));
      expect([quantity, ...answer(res)]).toEqual([quantity, 400, 'invalid_input']);
    }
    expect(answer(await save(fresh, draftFor(WED, cartons(9, 4), refs, 'n'.repeat(201))))).toEqual([400, 'invalid_input']);
    // Two lines for one item, and requests with a part missing.
    expect(answer(await save(fresh, draftFor(WED, [...cartons(9, 4), { productId: DRY.productId, quantity: 1 }], refs)))).toEqual([400, 'invalid_input']);
    expect(answer(await save(fresh, { deliveryDate: WED, lines: cartons(9, 4), refs }))).toEqual([400, 'invalid_input']);
    expect(answer(await save(fresh, draftFor('3 June', cartons(9, 4), refs)))).toEqual([400, 'invalid_input']);
    expect(answer(await place(fresh, { deliveryDate: WED }))).toEqual([400, 'invalid_input']);
    expect(answer(await place(fresh, { deliveryDate: WED, refs: { chilled: { id: 'the-chilled-one', revision: 0 } } }))).toEqual([400, 'invalid_input']);
    expect(await held()).toEqual(before);

    // The edges are allowed: 999 cartons, and a note of 200 characters once the spaces around it are cut.
    const edge = await save(fresh, draftFor(WED, cartons(999, 0), refs, `  ${'n'.repeat(200)}  `));
    expect(edge.status).toBe(200);
    expect(edge.body.draft).toMatchObject({ driverNote: 'n'.repeat(200), lines: [{ ...CHILLED, quantity: 999 }] });
  });

  it('AC-15 refuses a save or a place that names a day that is no longer the open one with 409 cutoff_passed, and names the open day', async () => {
    // Opened at 15:58 for Wednesday, sent at 16:01.
    setClockForTests(at(TUE, '15:58'));
    const refs = await savedDraft();
    const before = await held();
    setClockForTests(at(TUE, '16:01'));
    const open = { deliveryDate: THU, cutoffAt: at(WED, '16:00').toISOString() };

    const lateSave = await save(fresh, draftFor(WED, cartons(9, 4), refs));
    expect([...answer(lateSave), lateSave.body.error.details]).toEqual([409, 'cutoff_passed', open]);
    const latePlace = await place(fresh, { deliveryDate: WED, refs });
    expect([...answer(latePlace), latePlace.body.error.details]).toEqual([409, 'cutoff_passed', open]);
    expect(() => CutoffPassedDetails.parse(latePlace.body.error.details)).not.toThrow();
    expect(await held()).toEqual(before);
    expect(announce).not.toHaveBeenCalled();

    // Nothing was placed until the manager tapped again, on a form that shows the open day.
    expect((await place(fresh, { deliveryDate: THU, refs })).status).toBe(200);
    expect(await ordersOf()).toEqual([['chilled', 'placed', THU, 8], ['dry', 'placed', THU, 4]]);
  });

  it('AC-15 reads the open day at the moment the server holds the shop\'s lock, not when the request arrived', async () => {
    // The save arrives at 15:59 and waits for the shop's lock, which it gets at 16:01.
    setClockForTests(at(TUE, '15:59'));
    const [res] = await queuedOnTheShop(FRESH, [save(fresh, draftFor(WED, cartons(8, 4)))], () => setClockForTests(at(TUE, '16:01')));
    expect([...answer(res!), res!.body.error?.details]).toEqual([409, 'cutoff_passed', { deliveryDate: THU, cutoffAt: at(WED, '16:00').toISOString() }]);
    expect(await held()).toEqual({ orders: [], lines: [] });

    // The same for a place: its draft was saved in time, and the lock came after the cut-off.
    setClockForTests(at(TUE, '15:59'));
    const refs = await savedDraft();
    const [placing] = await queuedOnTheShop(FRESH, [place(fresh, { deliveryDate: WED, refs })], () => setClockForTests(at(TUE, '16:01')));
    expect(answer(placing!)).toEqual([409, 'cutoff_passed']);
    expect(await ordersOf()).toEqual([['chilled', 'draft', WED, 8], ['dry', 'draft', WED, 4]]);
  });

  it('AC-16 refuses a draft named by an id or a revision that is not the current one, or left out, with 409 stale', async () => {
    const old = await savedDraft();
    const current = StoreNextOrder.parse((await save(fresh, draftFor(WED, cartons(8, 5), old))).body).draft!.refs;
    const theirs = StoreNextOrder.parse((await save(style, draftFor(WED, [{ productId: 'style-shoes', quantity: 2 }]))).body).draft!.refs;
    const before = await held();

    const notCurrent: [what: string, refs: DraftRefs][] = [
      ['an old revision', old],
      ['both drafts left out', {}],
      ['one draft left out', { chilled: current.chilled }],
      ['an id that is no draft', { ...current, chilled: { id: randomUUID(), revision: 1 } }],
      ['a revision that is still to come', { ...current, dry: { id: current.dry!.id, revision: 2 } }],
      ['each draft named as the other temperature', { chilled: current.dry, dry: current.chilled }],
      ['another shop\'s draft', { ...current, dry: theirs.dry }],
    ];
    for (const [what, refs] of notCurrent) {
      expect([what, ...answer(await save(fresh, draftFor(WED, cartons(1, 1), refs)))]).toEqual([what, 409, 'stale']);
      expect([what, ...answer(await place(fresh, { deliveryDate: WED, refs }))]).toEqual([what, 409, 'stale']);
    }
    expect(await held()).toEqual(before);
    expect(announce).not.toHaveBeenCalled();

    // A draft named where the shop has none: the dry draft was removed, and a screen still holds it.
    const chilledOnly = StoreNextOrder.parse((await save(fresh, draftFor(WED, cartons(8, 0), current))).body).draft!.refs;
    expect(answer(await save(fresh, draftFor(WED, cartons(8, 5), { ...chilledOnly, dry: current.dry })))).toEqual([409, 'stale']);

    // The same for a save after the order was placed, from a screen that still shows the draft.
    expect((await place(fresh, { deliveryDate: WED, refs: chilledOnly })).status).toBe(200);
    expect(answer(await save(fresh, draftFor(WED, cartons(9, 0), chilledOnly)))).toEqual([409, 'stale']);
    expect(await ordersOf()).toEqual([['chilled', 'placed', WED, 8]]);
  });

  it('AC-16 saves one of two first saves that arrive at the same moment and answers the other 409 stale, never a database error', async () => {
    const [first, later] = await queuedOnTheShop(FRESH, [
      save(fresh, draftFor(WED, cartons(8, 4))),
      save(second, draftFor(WED, cartons(2, 6))),
    ]);
    expect([first!.status, ...answer(later!)]).toEqual([200, 409, 'stale']);

    // One draft per temperature, and they are the first request's.
    expect(await ordersOf()).toEqual([['chilled', 'draft', WED, 8], ['dry', 'draft', WED, 4]]);
    const refs = StoreNextOrder.parse(first!.body).draft!.refs;
    expect((await held()).orders.map((o) => [o.id, o.createdBy])).toEqual([
      [refs.chilled!.id, userIds['orders-test-fresh']], [refs.dry!.id, userIds['orders-test-fresh']],
    ]);
  });

  it('AC-16 refuses the later of a save and a place that arrive at the same moment', async () => {
    // The save first: the place names the revision from before it.
    const refs = await savedDraft();
    const [saving, placing] = await queuedOnTheShop(FRESH, [
      save(fresh, draftFor(WED, cartons(9, 9), refs)),
      place(second, { deliveryDate: WED, refs }),
    ]);
    expect([saving!.status, ...answer(placing!)]).toEqual([200, 409, 'stale']);
    expect(await ordersOf()).toEqual([['chilled', 'draft', WED, 9], ['dry', 'draft', WED, 9]]);
    expect(announce).not.toHaveBeenCalled();

    // The place first: the save names orders that are no longer drafts, and what was placed is the draft as it was.
    const saved = StoreNextOrder.parse(saving!.body).draft!.refs;
    const [placed, tooLate] = await queuedOnTheShop(FRESH, [
      place(second, { deliveryDate: WED, refs: saved }),
      save(fresh, draftFor(WED, cartons(1, 1), saved)),
    ]);
    expect([placed!.status, ...answer(tooLate!)]).toEqual([200, 409, 'stale']);
    expect(await ordersOf()).toEqual([['chilled', 'placed', WED, 9], ['dry', 'placed', WED, 9]]);
  });
});

describe('placing', () => {
  it('AC-19 turns each draft into a placed order, records the app clock\'s time and the person, and announces orders to the shop and its depot', async () => {
    setClockForTests(at(TUE, '15:02'));
    const refs = await savedDraft();
    // Someone else at the shop places what the first manager started.
    setClockForTests(at(TUE, '15:05'));
    const res = await place(second, { deliveryDate: WED, refs });
    expect(res.status).toBe(200);

    const order = { deliveryDate: WED, scheduledDate: null, status: 'placed', placedAt: at(TUE, '15:05').toISOString(), deferralReason: null };
    expect(res.body.placedOrders).toEqual([
      { ...order, id: refs.chilled!.id, temp: 'chilled', lines: [{ ...CHILLED, quantity: 8 }], units: 8 },
      { ...order, id: refs.dry!.id, temp: 'dry', lines: [{ ...DRY, quantity: 4 }], units: 4 },
    ]);
    expect(() => PlaceOrdersResponse.parse(res.body)).not.toThrow();

    // The same two rows, now placed: the time is the app clock's and the person is the one who placed them.
    expect((await held()).orders.map((o) => [o.id, o.status, o.deliveryDate, o.placedAt, o.placedBy, o.createdBy, o.savedAt, o.revision])).toEqual([
      [refs.chilled!.id, 'placed', WED, at(TUE, '15:05'), userIds['orders-test-fresh-second'], userIds['orders-test-fresh'], at(TUE, '15:02'), 1],
      [refs.dry!.id, 'placed', WED, at(TUE, '15:05'), userIds['orders-test-fresh-second'], userIds['orders-test-fresh'], at(TUE, '15:02'), 1],
    ]);

    // One announcement for the shop and its depot, which is the shop's own and not the account's, made after
    // the commit.
    expect(vi.mocked(announce).mock.calls).toEqual([[{ topic: 'orders', outletId: FRESH, depotId: DEPOT }]]);
    expect(openWhenAnnounced).toEqual([0]);
  });

  it('AC-20 places one order when only one temperature has units', async () => {
    const chilledOnly = StoreNextOrder.parse((await save(fresh, draftFor(WED, cartons(8, 0)))).body).draft!.refs;
    expect(chilledOnly).toEqual({ chilled: { id: expect.any(String), revision: 0 } });
    const res = await place(fresh, { deliveryDate: WED, refs: chilledOnly });
    expect(PlaceOrdersResponse.parse(res.body).placedOrders.map((o) => [o.id, o.temp, o.units])).toEqual([[chilledOnly.chilled!.id, 'chilled', 8]]);
    expect(await ordersOf()).toEqual([['chilled', 'placed', WED, 8]]);

    // A Style order is dry whatever it holds, so its four items are one order.
    const styled = StoreNextOrder.parse((await save(style, draftFor(WED, [
      { productId: 'style-folded', quantity: 40 }, { productId: 'style-hanging', quantity: 30 },
      { productId: 'style-shoes', quantity: 20 }, { productId: 'style-bags', quantity: 10 },
    ]))).body).draft!.refs;
    const placed = PlaceOrdersResponse.parse((await place(style, { deliveryDate: WED, refs: styled })).body);
    expect(placed.placedOrders.map((o) => [o.temp, o.units, o.lines.map((l) => l.quantity)])).toEqual([['dry', 100, [40, 30, 20, 10]]]);
    expect(await ordersOf(STYLE)).toEqual([['dry', 'placed', WED, 100]]);
  });

  it('AC-21 answers a place that names drafts already placed with those orders and changes nothing, also after the cut-off', async () => {
    const asked = { deliveryDate: WED, refs: await savedDraft() };
    setClockForTests(at(TUE, '15:05'));
    const first = await place(fresh, asked);
    expect(first.status).toBe(200);
    const before = await held();
    vi.mocked(announce).mockClear();

    // The same request again, as a screen sends it when the first answer was lost.
    setClockForTests(at(TUE, '15:06'));
    const again = await place(fresh, asked);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);

    // A retry at 16:01. Wednesday has closed, and this is checked first: the answer is the placed orders, with
    // the next order as it is now around them.
    setClockForTests(at(TUE, '16:01'));
    const late = await place(fresh, asked);
    expect(late.status).toBe(200);
    expect(late.body.placedOrders).toEqual(first.body.placedOrders);
    expect(late.body).toMatchObject({ deliveryDate: THU, draft: null, placed: null });

    // Even with no delivery day open at all.
    setClockForTests(at('2026-06-26', '16:30'));
    const last = await place(fresh, asked);
    expect(last.status).toBe(200);
    expect(last.body.placedOrders).toEqual(first.body.placedOrders);
    expect(last.body.deliveryDate).toBeNull();

    expect(await held()).toEqual(before);
    expect(announce).not.toHaveBeenCalled();

    // A request that names a placed order beside a draft is no retry. It is refused, and the draft stays one.
    setClockForTests(at(TUE, '15:10'));
    const draft = StoreNextOrder.parse((await save(fresh, draftFor(WED, cartons(2, 0)))).body).draft!.refs;
    expect(answer(await place(fresh, { deliveryDate: WED, refs: { chilled: draft.chilled, dry: asked.refs.dry } }))).toEqual([409, 'stale']);
    expect(await ordersOf()).toEqual([['chilled', 'placed', WED, 8], ['chilled', 'draft', WED, 2], ['dry', 'placed', WED, 4]]);
  });

  it('AC-21 answers 409 nothing_to_place when a place names no draft and the shop has none', async () => {
    expect(answer(await place(fresh, { deliveryDate: WED, refs: {} }))).toEqual([409, 'nothing_to_place']);

    // The same once its orders are placed: they are orders now, and no draft is left.
    await place(fresh, { deliveryDate: WED, refs: await savedDraft() });
    const before = await held();
    expect(answer(await place(fresh, { deliveryDate: WED, refs: {} }))).toEqual([409, 'nothing_to_place']);
    expect(await held()).toEqual(before);
  });

  it('AC-22 places each draft once when two place requests arrive at the same moment, and both get the same placed orders', async () => {
    const refs = await savedDraft();
    setClockForTests(at(TUE, '15:05'));
    const [one, other] = await queuedOnTheShop(FRESH, [
      place(fresh, { deliveryDate: WED, refs }),
      place(second, { deliveryDate: WED, refs }),
    ]);
    expect([one!.status, other!.status]).toEqual([200, 200]);
    expect(one!.body.placedOrders.map((o: { id: string }) => o.id)).toEqual([refs.chilled!.id, refs.dry!.id]);
    expect(other!.body).toEqual(one!.body);

    // Placed once, by the first: one step on in revision, and one announcement.
    expect((await held()).orders.map((o) => [o.id, o.status, o.placedBy, o.revision])).toEqual([
      [refs.chilled!.id, 'placed', userIds['orders-test-fresh'], 1],
      [refs.dry!.id, 'placed', userIds['orders-test-fresh'], 1],
    ]);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('AC-23 leaves no draft and lists what is placed for that day, and placing again adds new orders and leaves the earlier ones', async () => {
    const refs = await savedDraft();
    setClockForTests(at(TUE, '15:05'));
    const first = await place(fresh, { deliveryDate: WED, refs });
    expect(first.body.draft).toBeNull();
    const placed = {
      orders: first.body.placedOrders,
      lines: [{ ...CHILLED, quantity: 8 }, { ...DRY, quantity: 4 }],
      lastPlacedAt: at(TUE, '15:05').toISOString(),
      summary: { kg: 82.8, m3: 0.444, units: 12, needsReefer: true, needsTailLift: false, keepUpright: false },
    };
    expect(first.body.placed).toEqual(placed);
    const opened = await fresh.get(NEXT);
    expect(opened.body).toMatchObject({ deliveryDate: WED, draft: null, placed });
    expect(() => StoreNextOrder.parse(opened.body)).not.toThrow();

    // Two more chilled cartons for the same day. While they are a draft, what is placed stays listed beside it.
    setClockForTests(at(TUE, '15:10'));
    const more = await save(fresh, draftFor(WED, cartons(2, 0)));
    expect(more.body).toMatchObject({ draft: { lines: [{ ...CHILLED, quantity: 2 }], summary: { units: 2 } }, placed });
    setClockForTests(at(TUE, '15:12'));
    const secondTime = PlaceOrdersResponse.parse((await place(fresh, { deliveryDate: WED, refs: more.body.draft.refs })).body);

    // This request placed one order. The day now holds three: chilled before dry, and the earlier one first.
    expect(secondTime.placedOrders.map((o) => [o.temp, o.units])).toEqual([['chilled', 2]]);
    expect(secondTime.draft).toBeNull();
    expect(secondTime.placed!.orders).toEqual([first.body.placedOrders[0], secondTime.placedOrders[0], first.body.placedOrders[1]]);
    // 14 cartons are 96.6 kg and 0.518 m³.
    expect(secondTime.placed).toMatchObject({
      lines: [{ ...CHILLED, quantity: 10 }, { ...DRY, quantity: 4 }],
      lastPlacedAt: at(TUE, '15:12').toISOString(),
      summary: { kg: 96.6, m3: 0.518, units: 14 },
    });
    expect(await ordersOf()).toEqual([['chilled', 'placed', WED, 8], ['chilled', 'placed', WED, 2], ['dry', 'placed', WED, 4]]);
  });

  it('AC-38 refuses to place a draft with an item that was archived after the save, with 400 unknown_product, and places nothing', async () => {
    const refs = await savedDraft();
    const before = await held();
    await archive('fresh-dry-carton');

    expect(answer(await place(fresh, { deliveryDate: WED, refs }))).toEqual([400, 'unknown_product']);
    // Nothing is placed, the chilled order neither.
    expect(await held()).toEqual(before);
    expect(announce).not.toHaveBeenCalled();

    // The draft still opens, with the line it holds. The item is no longer offered.
    const opened = StoreNextOrder.parse((await fresh.get(NEXT)).body);
    expect(opened.products.map((p) => p.id)).toEqual(['fresh-chilled-carton']);
    expect(opened.draft).toMatchObject({ lines: [{ ...CHILLED, quantity: 8 }, { ...DRY, quantity: 4 }], summary: { units: 12 } });

    // Saved without the item, it can be placed.
    const without = StoreNextOrder.parse((await save(fresh, draftFor(WED, [{ productId: CHILLED.productId, quantity: 8 }], refs))).body).draft!.refs;
    expect((await place(fresh, { deliveryDate: WED, refs: without })).status).toBe(200);
    expect(await ordersOf()).toEqual([['chilled', 'placed', WED, 8]]);
  });

  it('works on the caller\'s own shop, whatever a request names', async () => {
    const refs = await savedDraft();
    const before = await held();

    // A request cannot name a shop. One that tries is saved for the caller's own.
    const res = await save(style, { ...draftFor(WED, [{ productId: 'style-shoes', quantity: 2 }]), outletId: FRESH });
    expect(res.body.outlet.id).toBe(STYLE);
    expect(await ordersOf(STYLE)).toEqual([['dry', 'draft', WED, 2]]);

    // Another shop's drafts cannot be placed from here, and once they are placed this shop is not answered
    // with them.
    expect(answer(await place(style, { deliveryDate: WED, refs }))).toEqual([409, 'stale']);
    expect(await held()).toEqual(before);
    expect((await place(fresh, { deliveryDate: WED, refs })).status).toBe(200);
    const asOther = await place(style, { deliveryDate: WED, refs });
    expect(answer(asOther)).toEqual([409, 'stale']);
    expect(JSON.stringify(asOther.body)).not.toContain(refs.chilled!.id);
  });
});
