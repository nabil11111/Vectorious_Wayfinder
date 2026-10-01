import {
  BOTH_DEPOTS, DEMO_DAY, PlaceOrdersRequest, SaveDraftRequest, type Brand, type SampleOrdersDepot, type SampleOrdersPreview, type SampleOrdersRequest,
  type SampleOrdersResult,
} from '@wayfinder/contracts';
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { db, type Db, type Tx } from '../db/client';
import { auditLog, demoDay, depots, orders, outlets, products, users } from '../db/schema';
import { clockState, depotDate, depotInstant, now } from '../lib/clock';
import { HttpError } from '../lib/errors';
import type { DepotCaller } from '../middleware/auth';
import { pickShops, sampleOrder, spacedTimes, type SampleItem, type SampleLine, type SampleShop } from './sample-lines';
import { openDayAt, placeOrders, saveDraft } from './store-orders';

// The demo control's "Add sample shop orders" (spec 028, D-103). While orders are open, shops of the depot on show that
// have not ordered each place their own order for the open day, through the shop's own save and place and signed as
// the shop's store manager, so every rule and every announcement is the one a shop's own Place meets.

type Reader = Db | Tx;

const notOpen = () => new HttpError(409, 'orders_not_open', 'Sample orders can be added only while orders are open, before 16:00.');

// The depots of the session: its one depot, or every depot on Both with the seeded day's depot first, as the screens
// list them.
async function depotsOf(on: Reader, scope: string): Promise<string[]> {
  if (scope !== BOTH_DEPOTS) return [scope];
  const rows = await on.select({ id: depots.id }).from(depots);
  return rows.map((row) => row.id).sort((a, b) => Number(b === DEMO_DAY.depotId) - Number(a === DEMO_DAY.depotId) || a.localeCompare(b));
}

interface Candidate extends SampleShop {
  // The shop's store manager who places the order, or null when the shop has none.
  managerId: string | null;
  // The shop has a draft, or an order for the open day that is not cancelled, so a press leaves it alone (rule 2).
  busy: boolean;
}

// The depot's shops that are not archived, each with its manager and whether it already has an order or a draft.
async function candidates(on: Reader, depotId: string, deliveryDate: string): Promise<Candidate[]> {
  const shops = await on.select({ id: outlets.id, brand: outlets.brand, parking: outlets.parking }).from(outlets)
    .where(and(eq(outlets.depotId, depotId), isNull(outlets.archivedAt))).orderBy(outlets.id);
  if (!shops.length) return [];
  const ids = shops.map((shop) => shop.id);
  // A shop has one store manager since spec 020. Should it have more, the first by staff ID orders.
  const managers = await on.select({ id: users.id, outletId: users.outletId }).from(users)
    .where(and(eq(users.role, 'store_manager'), eq(users.active, true), inArray(users.outletId, ids)))
    .orderBy(sql`${users.staffId} asc nulls last`, asc(users.id));
  const busy = await on.selectDistinct({ outletId: orders.outletId }).from(orders)
    .where(and(inArray(orders.outletId, ids), or(eq(orders.status, 'draft'), and(eq(orders.deliveryDate, deliveryDate), ne(orders.status, 'cancelled')))));
  const busyIds = new Set(busy.map((row) => row.outletId));
  return shops.map((shop) => ({
    ...shop,
    managerId: managers.find((manager) => manager.outletId === shop.id)?.id ?? null,
    busy: busyIds.has(shop.id),
  }));
}

// What each brand's shops can order now: its active items.
async function itemsByBrand(on: Reader): Promise<(brand: Brand) => SampleItem[]> {
  const rows = await on.select({ id: products.id, brand: products.brand, needsTailLift: products.needsTailLift }).from(products).where(isNull(products.archivedAt));
  return (brand) => rows.filter((row) => row.brand === brand).map(({ id, needsTailLift }) => ({ id, needsTailLift }));
}

// GET /demo/sample-orders: for each depot of the session, its shops and how many may still order.
export async function previewSampleOrders(caller: DepotCaller): Promise<SampleOrdersPreview> {
  const open = await openDayAt(db, now());
  const list = await depotsOf(db, caller.depotId);
  return {
    deliveryDate: open?.deliveryDate ?? null,
    depots: await Promise.all(list.map(async (depotId) => {
      const shops = open ? await candidates(db, depotId, open.deliveryDate) : [];
      return { depotId, shops: shops.length, canOrder: shops.filter((shop) => !shop.busy && shop.managerId).length };
    })),
  };
}

// The shop's own save and then its own place, as its manager, with the time it placed. A refusal leaves no draft of
// the press behind and says why.
async function placeAsTheShop(shop: Candidate & { lines: SampleLine[]; driverNote: string }, deliveryDate: string, at: Date): Promise<number | 'stale' | 'refused'> {
  const caller = { userId: shop.managerId!, outletId: shop.id };
  let made: string[] = [];
  try {
    const saved = await saveDraft(caller, SaveDraftRequest.parse({ deliveryDate, refs: {}, lines: shop.lines, driverNote: shop.driverNote }), { writtenAt: at });
    const refs = saved.draft!.refs;
    made = [refs.chilled?.id, refs.dry?.id].filter((id): id is string => id !== undefined);
    const placed = await placeOrders(caller, PlaceOrdersRequest.parse({ deliveryDate, refs }), { writtenAt: at });
    return placed.placedOrders.length;
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    if (made.length) await db.delete(orders).where(and(inArray(orders.id, made), eq(orders.status, 'draft')));
    // The shop's own draft came first: it is ordering itself.
    return err.code === 'stale' ? 'stale' : 'refused';
  }
}

// POST /demo/sample-orders: places the orders and answers what it did for each depot of the session.
export function addSampleOrders(caller: DepotCaller, body: SampleOrdersRequest): Promise<SampleOrdersResult> {
  return db.transaction(async (tx) => {
    // The clock's row is held until the press is done, so a second press, a move of the clock and a reset wait for it
    // (rule 7). The clock cannot reach 16:00 halfway through.
    const [row] = await tx.select({ id: demoDay.id }).from(demoDay).for('update');
    if (!row || clockState().part !== 'ordering') throw notOpen();
    const at = now();
    const open = await openDayAt(tx, at);
    if (!open) throw new HttpError(409, 'no_delivery_day', 'No delivery day is open for orders.');
    const itemsOf = await itemsByBrand(tx);
    // Every time is on the day of the press, at or before it (rule 5).
    const earliest = depotInstant(depotDate(at), 0);

    const result: SampleOrdersResult = { deliveryDate: open.deliveryDate, depots: [] };
    for (const depotId of await depotsOf(tx, caller.depotId)) {
      const shops = await candidates(tx, depotId, open.deliveryDate);
      // The day's shuffle of every shop of the depot, so the same press on the same day takes the same shops (rule 3).
      const free = pickShops(shops, open.deliveryDate, depotId).filter((shop) => !shop.busy);
      const ready = free.filter((shop) => shop.managerId)
        .map((shop) => ({ ...shop, ...sampleOrder(shop, itemsOf(shop.brand), open.deliveryDate) }))
        .filter((shop) => shop.lines.length);
      const chosen = body.shops === 'all' ? ready : ready.slice(0, body.shops);
      const times = spacedTimes(at, chosen.map((shop) => shop.gapSeconds), earliest);

      const done: SampleOrdersDepot = { depotId, orders: 0, outletIds: [], alreadyHad: shops.length - free.length, cannotOrder: free.length - ready.length };
      for (const [i, shop] of chosen.entries()) {
        const placed = await placeAsTheShop(shop, open.deliveryDate, times[i]!);
        if (placed === 'stale') done.alreadyHad += 1;
        else if (placed === 'refused') done.cannotOrder += 1;
        else {
          done.orders += placed;
          done.outletIds.push(shop.id);
        }
      }
      result.depots.push(done);
    }
    await tx.insert(auditLog).values({ actorId: caller.userId, action: 'demo.sample_orders', entity: 'demo_day', entityId: String(row.id), before: null, after: result });
    return result;
  });
}
