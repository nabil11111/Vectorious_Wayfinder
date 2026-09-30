import {
  TEMPS, type Brand, type CutoffPassedDetails, type DraftRefs, type OrderLine, type PlaceOrdersRequest, type PlaceOrdersResponse,
  type SaveDraftRequest, type StoreNextOrder, type StoreOrder, type StoreOutlet, type StoreProduct,
} from '@wayfinder/contracts';
import { and, desc, eq, gte, inArray, max, ne, notInArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { db, type Db, type Tx } from '../db/client';
import { PRODUCTS } from '../db/fixtures';
import { calendarDays, deferrals, depots, orderLines, orders, outlets, plans, products, stopOrders, stops, trips } from '../db/schema';
import { depotDate, depotInstant, depotMinutes, now } from '../lib/clock';
import { HttpError } from '../lib/errors';
import { announce } from '../lib/live';
import { computeLoad } from '../planning/load';
import { CUTOFF_MINUTES, orderableDay } from './orderable-day';

// The store manager's next order (spec 009): what the shop can order and for which day, the draft its form
// saves after every change, and placing it. Everything here works on the caller's own shop. Nothing in a
// request names one.

// The person asking and the shop their account belongs to.
export interface Caller { userId: string; outletId: string }

type Reader = Db | Tx;

// An item as the form shows it, with what the load calculator needs on top.
interface Item extends StoreProduct { brand: Brand; keepUpright: boolean; archived: boolean }

export interface Shop {
  outlet: StoreOutlet;
  depotId: string;
  // Every item there is, in the product list's order. An order keeps its lines when an item is archived, so
  // naming a line and adding up a load need the archived ones too.
  items: Item[];
}

// The products table has no column for the list's order, so the order is taken from the list itself. An item
// that is not on it comes last.
const LIST_ORDER = new Map<string, number>(PRODUCTS.map((product, place) => [product.id, place]));
const placeInList = (id: string) => LIST_ORDER.get(id) ?? PRODUCTS.length;

export async function readShop(on: Reader, outletId: string): Promise<Shop> {
  const [row] = await on.select().from(outlets).where(eq(outlets.id, outletId));
  // An account's outlet points at this table, so its shop is always there.
  if (!row) throw new Error(`No outlet ${outletId}.`);
  const items = (await on.select().from(products)).map((p): Item => ({
    id: p.id, name: p.name, unit: p.unit, kgPerUnit: Number(p.kgPerUnit), m3PerUnit: Number(p.m3PerUnit), temp: p.temp,
    needsTailLift: p.needsTailLift, brand: p.brand, keepUpright: p.keepUpright, archived: p.archivedAt !== null,
  }));
  items.sort((a, b) => placeInList(a.id) - placeInList(b.id) || a.id.localeCompare(b.id));
  return {
    // The table keeps a window to the second. The screens show hours and minutes.
    outlet: { id: row.id, name: row.name, brand: row.brand, windowOpen: row.windowOpen.slice(0, 5), windowClose: row.windowClose.slice(0, 5), dockType: row.dockType },
    depotId: row.depotId,
    items,
  };
}

// What the shop can order: the active items of its brand.
const orderable = (shop: Shop) => shop.items.filter((item) => item.brand === shop.outlet.brand && !item.archived);
// The refusal for a line whose item is not one of those. It names the item when there is such an item at all.
const notOnTheList = (shop: Shop, productId: string) => {
  const name = shop.items.find((item) => item.id === productId)?.name ?? productId;
  return new HttpError(400, 'unknown_product', `${name} is not on this shop's order list.`);
};

// Every save and place of a shop queues on its row in outlets, so two of them never read the same drafts.
// 'no key update' makes them wait for each other and leaves alone the work that only points at the shop,
// such as a plan that adds a stop there.
const lockShop = (tx: Tx, outletId: string) => tx.select({ id: outlets.id }).from(outlets).where(eq(outlets.id, outletId)).for('no key update');

// One snapshot for a whole answer, so a place that commits halfway through a read is seen whole or not at
// all. It is read only: reading never writes. A demo reset truncates orders first and then the rest of the
// day's tables, and a read keeps every table it touched until it ends. So the read takes orders before anything
// else, which makes a read and a reset take turns: one that held plans and then asked for orders would
// deadlock with the reset. Taken first, the lock also comes before the snapshot.
export const snapshot = <T>(read: (tx: Tx) => Promise<T>) => db.transaction(async (tx) => {
  await tx.execute(sql`lock table ${orders} in access share mode`);
  return read(tx);
}, { isolationLevel: 'repeatable read', accessMode: 'read only' });

interface OpenDay { deliveryDate: string; cutoffAt: Date; cutoffIsToday: boolean }

// The day an order placed at this instant is for, or null when no delivery day is open.
async function openDayAt(on: Reader, at: Date): Promise<OpenDay | null> {
  const today = depotDate(at);
  // The rule looks no further than the third operating day from today.
  const days = await on.select({ date: calendarDays.date }).from(calendarDays)
    .where(and(eq(calendarDays.isOperating, true), gte(calendarDays.date, today))).orderBy(calendarDays.date).limit(3);
  const day = orderableDay(today, depotMinutes(at), days.map((d) => d.date));
  return day && { deliveryDate: day.deliveryDate, cutoffAt: depotInstant(day.cutoffDate, CUTOFF_MINUTES), cutoffIsToday: day.cutoffDate === today };
}

// A save and a place name the day their screen shows, and that day must still be the open one.
function requireOpen(open: OpenDay | null, named: string): OpenDay {
  if (!open) throw new HttpError(409, 'no_delivery_day', 'No delivery day is open for orders.');
  if (named !== open.deliveryDate) {
    const details: CutoffPassedDetails = { deliveryDate: open.deliveryDate, cutoffAt: open.cutoffAt.toISOString() };
    throw new HttpError(409, 'cutoff_passed', 'Orders for that day have closed.', details);
  }
  return open;
}

async function linesOf(on: Reader, orderIds: string[]) {
  if (!orderIds.length) return [];
  return on.select().from(orderLines).where(inArray(orderLines.orderId, orderIds));
}

// Lines as a screen shows them: each with its item's name and unit, in the product list's order, and one line
// per item however many orders the lines come from.
function shownLines(lines: { productId: string; quantity: number }[], items: Item[]): OrderLine[] {
  return items.flatMap((item) => {
    const quantity = lines.reduce((sum, line) => (line.productId === item.id ? sum + line.quantity : sum), 0);
    return quantity ? [{ productId: item.id, name: item.name, unit: item.unit, quantity }] : [];
  });
}

// The day of the latest sent plan that has an order on a stop.
const scheduled = db.select({ orderId: stopOrders.orderId, date: max(plans.date).as('scheduled_date') })
  .from(stopOrders)
  .innerJoin(stops, eq(stops.id, stopOrders.stopId))
  .innerJoin(trips, eq(trips.id, stops.tripId))
  .innerJoin(plans, eq(plans.id, trips.planId))
  .where(eq(plans.status, 'published'))
  .groupBy(stopOrders.orderId)
  .as('scheduled');

// The reason in the latest sent plan that left an order out.
const lastDeferral = db.selectDistinctOn([deferrals.orderId], { orderId: deferrals.orderId, reason: deferrals.reason })
  .from(deferrals)
  .innerJoin(plans, eq(plans.id, deferrals.planId))
  .where(eq(plans.status, 'published'))
  .orderBy(deferrals.orderId, desc(plans.date))
  .as('last_deferral');

// The day an order counts for: the day of the sent plan it is on, and until then the day the shop wanted.
export const countsFor = sql<string>`coalesce(${scheduled.date}, ${orders.deliveryDate})`;

// The shop's orders that match, as its screens show them. Unless told otherwise they come chilled before dry,
// then the one placed first. It reads the given shop's orders and no others, whatever the condition asks for.
export async function readOrders(
  on: Reader, shop: Shop, where: SQL | undefined,
  { orderBy = [orders.temp, orders.placedAt, orders.id], limit }: { orderBy?: (PgColumn | SQL)[]; limit?: number } = {},
): Promise<StoreOrder[]> {
  const matching = on.select({
    id: orders.id, deliveryDate: orders.deliveryDate, scheduledDate: scheduled.date, temp: orders.temp, status: orders.status,
    placedAt: orders.placedAt, deferralReason: lastDeferral.reason,
  }).from(orders)
    .leftJoin(scheduled, eq(scheduled.orderId, orders.id))
    .leftJoin(lastDeferral, eq(lastDeferral.orderId, orders.id))
    .where(and(eq(orders.outletId, shop.outlet.id), where))
    .orderBy(...orderBy);
  const rows = await (limit ? matching.limit(limit) : matching);
  const lines = await linesOf(on, rows.map((row) => row.id));
  return rows.map((row) => {
    const own = shownLines(lines.filter((line) => line.orderId === row.id), shop.items);
    return {
      id: row.id,
      deliveryDate: row.deliveryDate,
      scheduledDate: row.scheduledDate,
      temp: row.temp,
      status: row.status,
      lines: own,
      units: own.reduce((sum, line) => sum + line.quantity, 0),
      placedAt: row.placedAt?.toISOString() ?? null,
      deferralReason: row.status === 'deferred' ? row.deferralReason : null,
    };
  });
}

// The shop's drafts with their lines: one per temperature at most, chilled first.
async function readDrafts(on: Reader, outletId: string) {
  const rows = await on.select().from(orders).where(and(eq(orders.outletId, outletId), eq(orders.status, 'draft'))).orderBy(orders.temp);
  const lines = await linesOf(on, rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, lines: lines.filter((line) => line.orderId === row.id) }));
}
type Draft = Awaited<ReturnType<typeof readDrafts>>[number];

// A request names each draft by its id and revision. It is current when, for both temperatures, it names the
// draft that is there, or names none where there is none.
function requireCurrent(drafts: Draft[], refs: DraftRefs): void {
  const current = TEMPS.every((temp) => {
    const draft = drafts.find((d) => d.temp === temp);
    const ref = refs[temp];
    return draft ? ref?.id === draft.id && ref.revision === draft.revision : !ref;
  });
  if (!current) throw new HttpError(409, 'stale', 'This order was changed somewhere else.');
}

// The latest of the moments a save or a place wrote. One that is missing was not written by the app, and
// there is no honest time to show in its place.
function latest(moments: (string | null)[], what: string): string {
  return moments.reduce<string>((last, moment) => {
    if (!moment) throw new Error(`An order of this shop has no ${what}.`);
    return moment > last ? moment : last;
  }, '');
}

// What GET /store/next-order answers, and a save and a place after their change.
async function nextOrder(on: Reader, shop: Shop, open: OpenDay | null): Promise<StoreNextOrder> {
  const drafts = await readDrafts(on, shop.outlet.id);
  const placed = open
    ? await readOrders(on, shop, and(eq(orders.deliveryDate, open.deliveryDate), notInArray(orders.status, ['draft', 'cancelled'])))
    : [];
  const draftLines = shownLines(drafts.flatMap((draft) => draft.lines), shop.items);
  const placedLines = shownLines(placed.flatMap((order) => order.lines), shop.items);
  const refs: DraftRefs = {};
  for (const draft of drafts) refs[draft.temp] = { id: draft.id, revision: draft.revision };

  return {
    outlet: shop.outlet,
    products: orderable(shop).map(({ brand: _brand, keepUpright: _upright, archived: _archived, ...product }) => product),
    deliveryDate: open?.deliveryDate ?? null,
    cutoffAt: open?.cutoffAt.toISOString() ?? null,
    cutoffIsToday: open?.cutoffIsToday ?? false,
    // A draft whose day has closed is offered for the open day, and nothing is written until it is saved or placed.
    movedFrom: (open && drafts.find((draft) => draft.deliveryDate !== open.deliveryDate)?.deliveryDate) ?? null,
    draft: drafts.length ? {
      lines: draftLines,
      // The form has one note, which a save writes onto each of the draft's orders.
      driverNote: drafts.find((draft) => draft.driverNote)?.driverNote ?? '',
      refs,
      savedAt: latest(drafts.map((draft) => draft.savedAt?.toISOString() ?? null), 'saved time'),
      // The screen never multiplies: every number of the summary comes from the load calculator.
      summary: computeLoad(draftLines, shop.items),
      tailLiftItems: shop.items.filter((item) => item.needsTailLift && draftLines.some((line) => line.productId === item.id)).map((item) => item.name),
    } : null,
    placed: placed.length ? {
      orders: placed,
      lines: placedLines,
      lastPlacedAt: latest(placed.map((order) => order.placedAt), 'placed time'),
      summary: computeLoad(placedLines, shop.items),
    } : null,
  };
}

export function getNextOrder(caller: Caller): Promise<StoreNextOrder> {
  return snapshot(async (tx) => nextOrder(tx, await readShop(tx, caller.outletId), await openDayAt(tx, now())));
}

// Saves the whole draft, so it replaces what was there, and answers as the GET does.
export function saveDraft(caller: Caller, body: SaveDraftRequest): Promise<StoreNextOrder> {
  return db.transaction(async (tx) => {
    await lockShop(tx, caller.outletId);
    // The cut-off is judged now, with the shop's lock held, not when the request arrived.
    const at = now();
    const shop = await readShop(tx, caller.outletId);
    const open = requireOpen(await openDayAt(tx, at), body.deliveryDate);

    // Every line is checked, also one at 0, which only takes its item out.
    const canOrder = orderable(shop);
    const wanted: { item: Item; quantity: number }[] = [];
    for (const { productId, quantity } of body.lines) {
      const item = canOrder.find((i) => i.id === productId);
      if (!item) throw notOnTheList(shop, productId);
      if (wanted.some((line) => line.item === item)) throw new HttpError(400, 'invalid_input', `${item.name} is on two lines.`);
      wanted.push({ item, quantity });
    }

    const drafts = await readDrafts(tx, shop.outlet.id);
    requireCurrent(drafts, body.refs);

    // One order per temperature (D-05). A temperature with units gets its draft made or updated, and one
    // with none loses its draft.
    for (const temp of TEMPS) {
      const lines = wanted.filter((line) => line.quantity > 0 && line.item.temp === temp);
      const draft = drafts.find((d) => d.temp === temp);
      if (!lines.length) {
        if (draft) await tx.delete(orders).where(eq(orders.id, draft.id));
        continue;
      }
      const saved = { deliveryDate: open.deliveryDate, driverNote: body.driverNote || null, savedAt: at };
      let orderId = draft?.id;
      if (orderId) {
        await tx.update(orders).set({ ...saved, revision: sql`${orders.revision} + 1`, updatedAt: sql`now()` }).where(eq(orders.id, orderId));
        await tx.delete(orderLines).where(eq(orderLines.orderId, orderId));
      } else {
        const [made] = await tx.insert(orders).values({ outletId: shop.outlet.id, temp, createdBy: caller.userId, ...saved }).returning({ id: orders.id });
        orderId = made!.id;
      }
      await tx.insert(orderLines).values(lines.map((line) => ({ orderId, productId: line.item.id, quantity: line.quantity })));
    }
    return nextOrder(tx, shop, open);
  });
}

// Places the drafts the request names, and answers with the next order as it is now and the orders placed.
export async function placeOrders(caller: Caller, body: PlaceOrdersRequest): Promise<PlaceOrdersResponse> {
  const done = await db.transaction(async (tx) => {
    // Planning holds this depot for no key update. Place takes a share first, so a send sees either the
    // whole placement or none of it, and both paths take the depot before any shop row (spec 010).
    await tx.select({ id: depots.id }).from(depots)
      .innerJoin(outlets, eq(outlets.depotId, depots.id)).where(eq(outlets.id, caller.outletId)).for('share', { of: depots });
    await lockShop(tx, caller.outletId);
    const at = now();
    const shop = await readShop(tx, caller.outletId);
    const open = await openDayAt(tx, at);

    // The safe retry comes before the cut-off, so a screen that lost the first answer still gets it after
    // 16:00: drafts that are already placed are answered with those orders, and nothing changes.
    const named = TEMPS.flatMap((temp) => body.refs[temp]?.id ?? []);
    const already = named.length ? await readOrders(tx, shop, and(inArray(orders.id, named), ne(orders.status, 'draft'))) : [];
    if (named.length && already.length === named.length) return { answer: { ...(await nextOrder(tx, shop, open)), placedOrders: already }, placedNow: false, shop };

    const day = requireOpen(open, body.deliveryDate);
    const drafts = await readDrafts(tx, shop.outlet.id);
    requireCurrent(drafts, body.refs);
    if (!drafts.length) throw new HttpError(409, 'nothing_to_place', 'There is nothing to place.');

    // An item can be archived between the last save and now, so the lines are checked again.
    const canOrder = orderable(shop);
    for (const { productId } of drafts.flatMap((draft) => draft.lines)) {
      if (!canOrder.some((item) => item.id === productId)) throw notOnTheList(shop, productId);
    }

    const ids = drafts.map((draft) => draft.id);
    await tx.update(orders)
      .set({ status: 'placed', deliveryDate: day.deliveryDate, placedAt: at, placedBy: caller.userId, revision: sql`${orders.revision} + 1`, updatedAt: sql`now()` })
      .where(inArray(orders.id, ids));
    return { answer: { ...(await nextOrder(tx, shop, open)), placedOrders: await readOrders(tx, shop, inArray(orders.id, ids)) }, placedNow: true, shop };
  });

  // Announced once the change is committed, to the shop and to its depot (D-21).
  if (done.placedNow) announce({ topic: 'orders', outletId: done.shop.outlet.id, depotId: done.shop.depotId });
  return done.answer;
}
