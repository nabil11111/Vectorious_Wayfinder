import {
  brandOfStop, driverAnswerSentence, driverAnswerShort, FlagReason, LoadingDecision, MAX_NOTIFICATIONS, Notification, PlanCheck, RefusalReason, tripFigures,
  type Brand, type Issue, type NotificationList,
} from '@wayfinder/contracts';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { auditLog, deferrals, depots, orderLines, orders, outlets, plans, stopOrders, stops, trips, users, vehicles } from '../db/schema';
import { driverTripsOf } from '../driver/day';
import { issuesOf } from '../issues/read';
import { depotClock, depotDate, depotMinutes } from '../lib/clock';
import { loaderDay, sentTrip } from '../loading/loader-day';
import { snapshot } from '../orders/store-orders';
import { toClock, toMinutes } from '../planning';
import { operatingDays, readMoment } from '../plans/board';
import * as words from './words';
import type { ByTemp, TruckFacts } from './words';

// A person's updates (spec 025, D-99), read from the records the app already keeps, each at its own time on the app
// clock: an order's placed_at, a plan's sends, a problem's raise and answer, a trip's ready, departure, stops and return.
// Nothing is stored for them, so the seeded day and a reset give the same updates.
//
// They cover the day being worked and the next one: the loader's day (D-34), today until 16:00 and then the next
// operating day, which every role's screens work on, and the operating day after it, which the shops order for and a
// plan may be sent for early. Wednesday's updates leave the bell when Thursday becomes the day at 16:00.

export type Reader =
  | { role: 'store_manager'; userId: string; outletId: string }
  | { role: 'dispatcher' | 'loader' | 'driver'; userId: string; depotId: string }
  | { role: 'admin'; userId: string };

type Plan = typeof plans.$inferSelect;
type Item = Omit<Notification, 'time'>;

export function getNotifications(reader: Reader): Promise<NotificationList> {
  return snapshot(async (tx) => {
    const moment = await readMoment(tx);
    return { demoDay: moment.demoDay, items: await notificationsOf(tx, reader, moment.at) };
  });
}

// The updates, newest first, at most 30, each with its time as the row shows it.
export async function notificationsOf(tx: Tx, reader: Reader, at: Date): Promise<Notification[]> {
  if (reader.role === 'admin') return [];
  const today = depotDate(at);
  const dates = await workedDays(tx, at);
  if (!dates.length) return [];
  let items: Item[];
  if (reader.role === 'store_manager') items = await shopUpdates(tx, reader.outletId, dates);
  else {
    const day = await depotDay(tx, reader.depotId, dates);
    if (reader.role === 'dispatcher') items = dispatcherUpdates(day);
    else if (reader.role === 'loader') items = loaderUpdates(day);
    else items = await driverUpdates(tx, day, reader.userId, at);
  }
  items.sort((a, b) => b.at.localeCompare(a.at) || a.line.localeCompare(b.line) || a.id.localeCompare(b.id));
  return items.slice(0, MAX_NOTIFICATIONS).map((item) => Notification.parse({ ...item, time: words.timeWords(new Date(item.at), today) }));
}

// The day being worked and the operating day after it.
async function workedDays(tx: Tx, at: Date): Promise<string[]> {
  const days = await operatingDays(tx);
  const day = loaderDay(depotDate(at), depotMinutes(at), days);
  if (!day) return [];
  const next = days.find((date) => date > day);
  return next ? [day, next] : [day];
}

const base = { issueKind: null, decision: null, answer: null } as const;
const iso = (at: Date) => at.toISOString();
const ms = (at: Date | string) => new Date(at).getTime();

// ── What a depot's day holds ─────────────────────────────────────────────────────────────────────────────────────

interface Send { kind: 'sent' | 'unsent'; at: Date }
interface DepotTrip extends TruckFacts { id: string; row: typeof trips.$inferSelect; plan: Plan; readyAt: Date | null; leftAt: Date | null; backAt: Date | null; driverId: string | null }
interface DepotStop { id: string; tripId: string; seq: number; outletId: string; shopName: string; brand: Brand; window: { open: string; close: string };
  arrivedAt: Date | null; doneAt: Date | null; outcome: 'delivered' | 'refused' | 'closed' | null;
  ordered: ByTemp; loaded: ByTemp; delivered: ByTemp }
interface DepotDay { plans: Plan[]; sends: Map<string, Send[]>; trips: DepotTrip[]; stops: DepotStop[]; issues: Issue[] }

// A plan's sends and takings back, in order, each at its app-clock time as the audit row keeps it. A plan sent before
// the audit kept the time, as the seed's earlier days are, was sent once, at its publication time.
async function sendsOf(tx: Tx, list: Plan[]): Promise<Map<string, Send[]>> {
  const ids = list.map((plan) => plan.id);
  const rows = ids.length ? await tx.select({ planId: auditLog.entityId, action: auditLog.action, after: auditLog.after }).from(auditLog)
    .where(and(eq(auditLog.entity, 'plan'), inArray(auditLog.entityId, ids), inArray(auditLog.action, ['plan.sent', 'plan.unsent']))).orderBy(asc(auditLog.at), asc(auditLog.id)) : [];
  const sends = new Map<string, Send[]>();
  for (const plan of list) {
    const kept = rows.filter((row) => row.planId === plan.id).flatMap((row): Send[] => {
      const after = row.after as { sentAt?: string; unsentAt?: string } | null;
      const time = row.action === 'plan.sent' ? after?.sentAt : after?.unsentAt;
      return time ? [{ kind: row.action === 'plan.sent' ? 'sent' : 'unsent', at: new Date(time) }] : [];
    });
    if (!kept.length && plan.status === 'published' && plan.publishedAt) kept.push({ kind: 'sent', at: plan.publishedAt });
    sends.set(plan.id, kept);
  }
  return sends;
}

// The units a stop's lines hold, by temperature: ordered, on the truck, and handed over.
async function stopsOf(tx: Tx, tripIds: string[]): Promise<DepotStop[]> {
  if (!tripIds.length) return [];
  const rows = await tx.select({ stop: stops, shop: outlets }).from(stops).innerJoin(outlets, eq(outlets.id, stops.outletId)).where(inArray(stops.tripId, tripIds));
  const lines = rows.length ? await tx.select({ stopId: stopOrders.stopId, temp: orders.temp, quantity: orderLines.quantity, loaded: orderLines.loadedQty, delivered: orderLines.deliveredQty })
    .from(stopOrders).innerJoin(orders, eq(orders.id, stopOrders.orderId)).innerJoin(orderLines, eq(orderLines.orderId, orders.id))
    .where(inArray(stopOrders.stopId, rows.map((row) => row.stop.id))) : [];
  return rows.map(({ stop, shop }) => {
    const own = lines.filter((line) => line.stopId === stop.id);
    const sum = (pick: (line: (typeof own)[number]) => number | null) => {
      const units = words.noUnits();
      for (const line of own) units[line.temp] += pick(line) ?? 0;
      return units;
    };
    // The window as the driver's stop shows it: the shop's own, narrowed to its mall's slot.
    const mall = shop.mallWindow?.split('-');
    const open = Math.max(toMinutes(shop.windowOpen.slice(0, 5)), mall ? toMinutes(mall[0]!) : 0);
    const close = Math.min(toMinutes(shop.windowClose.slice(0, 5)), mall ? toMinutes(mall[1]!) : 24 * 60);
    return { id: stop.id, tripId: stop.tripId, seq: stop.seq, outletId: stop.outletId, shopName: shop.name, brand: shop.brand,
      window: { open: toClock(open), close: toClock(close) }, arrivedAt: stop.arrivedAt, doneAt: stop.doneAt, outcome: stop.outcome,
      ordered: sum((line) => line.quantity), loaded: sum((line) => line.loaded), delivered: sum((line) => line.delivered) };
  });
}

// A depot's plans for the days, and of its sent ones every trip, stop and problem.
async function depotDay(tx: Tx, depotId: string, dates: string[]): Promise<DepotDay> {
  const list = await tx.select().from(plans).where(and(eq(plans.depotId, depotId), inArray(plans.date, dates)));
  const sent = list.filter((plan) => plan.status === 'published');
  const rows = sent.length ? await tx.select({ trip: trips, vehicle: vehicles, driver: users.displayName }).from(trips)
    .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId)).leftJoin(users, eq(users.id, trips.driverId))
    .where(inArray(trips.planId, sent.map((plan) => plan.id))) : [];
  const dayTrips = rows.map(({ trip, vehicle, driver }): DepotTrip => ({ id: trip.id, row: trip, plan: sent.find((plan) => plan.id === trip.planId)!, vehicleId: trip.vehicleId,
    type: vehicle.type, temp: vehicle.temp, tripNo: trip.tripNo, driver, driverId: trip.driverId, readyAt: trip.readyAt, leftAt: trip.leftAt, backAt: trip.backAt }));
  return {
    plans: list, sends: await sendsOf(tx, list), trips: dayTrips, stops: await stopsOf(tx, dayTrips.map((trip) => trip.id)),
    issues: sent.length ? await issuesOf(tx, inArray(plans.id, sent.map((plan) => plan.id))) : [],
  };
}

const tripOf = (day: DepotDay, tripId: string) => day.trips.find((trip) => trip.id === tripId)!;
const stopsOfTrip = (day: DepotDay, tripId: string) => day.stops.filter((stop) => stop.tripId === tripId);
const total = (units: ByTemp) => units.chilled + units.dry;
// The units a problem is about, by temperature: those short at the dock for a loader's flag, and those it counts for
// every other kind, as its card counts them.
function problemUnits(issue: Issue): ByTemp {
  const units = words.noUnits();
  for (const line of issue.lines) units[line.temp] += issue.kind === 'loading' ? line.quantity - line.counted : line.counted;
  return units;
}
const brandOfShop = (shopName: string) => brandOfStop(null, shopName);
// What a shop's report said, by its lines' reasons, as its card says it.
const reportOf = (issue: Issue) => words.reportWords(brandOfShop(issue.stop.shopName) ?? 'Fresh',
  issue.lines.map((line) => ({ temp: line.temp, units: line.counted, reason: line.reason ?? null })), issue.reason === 'not_cold');

// ── A store manager's ────────────────────────────────────────────────────────────────────────────────────────

async function shopUpdates(tx: Tx, outletId: string, dates: string[]): Promise<Item[]> {
  const [shop] = await tx.select().from(outlets).where(eq(outlets.id, outletId));
  if (!shop) return [];
  const items: Item[] = [];
  const unitsOf = async (orderIds: string[]) => {
    const lines = orderIds.length ? await tx.select({ orderId: orderLines.orderId, temp: orders.temp, quantity: orderLines.quantity }).from(orderLines)
      .innerJoin(orders, eq(orders.id, orderLines.orderId)).where(inArray(orderLines.orderId, orderIds)) : [];
    return (orderId: string) => {
      const units = words.noUnits();
      for (const line of lines) if (line.orderId === orderId) units[line.temp] += line.quantity;
      return units;
    };
  };

  // Their orders placed for the days. A replacement is the depot's answer, and a split part is not a new order.
  const placed = await tx.select().from(orders).where(and(eq(orders.outletId, outletId), inArray(orders.deliveryDate, dates),
    isNull(orders.replacesIssueId), isNull(orders.splitFrom)));
  const placedUnits = await unitsOf(placed.map((order) => order.id));
  for (const order of placed) {
    if (!order.placedAt || order.status === 'draft') continue;
    items.push({ ...base, id: `placed:${order.id}`, kind: 'order_placed', at: iso(order.placedAt), line: words.orderPlacedLine(shop.brand, placedUnits(order.id), order.deliveryDate),
      link: '/store/orders', tone: 'good' });
  }

  const day = await depotDay(tx, shop.depotId, dates);
  // Their deliveries on each sent plan, as the plan stands now, at its latest send.
  for (const plan of day.plans) {
    if (plan.status !== 'published' || !plan.publishedAt) continue;
    const sentAt = plan.publishedAt;
    for (const stop of day.stops.filter((stop) => stop.outletId === outletId && tripOf(day, stop.tripId).plan.id === plan.id)) {
      items.push({ ...base, id: `planned:${stop.id}:${ms(sentAt)}`, kind: 'delivery_planned', at: iso(sentAt),
        line: words.deliveryPlannedLine(plan.date, tripOf(day, stop.tripId), stop.window), link: '/store', tone: 'info' });
    }
    // An order the plan moved to another day, with the reason the dispatcher gave.
    const moved = await tx.select({ orderId: deferrals.orderId, reason: deferrals.reason }).from(deferrals).innerJoin(orders, eq(orders.id, deferrals.orderId))
      .where(and(eq(deferrals.planId, plan.id), eq(orders.outletId, outletId)));
    const movedUnits = await unitsOf(moved.map((row) => row.orderId));
    for (const row of moved) {
      items.push({ ...base, id: `moved:${plan.id}:${row.orderId}:${ms(sentAt)}`, kind: 'order_moved', at: iso(sentAt),
        line: words.orderMovedLine(shop.brand, movedUnits(row.orderId), plan.date, row.reason), link: '/store/orders', tone: 'warn' });
    }
  }

  // The truck leaving, the driver arriving and how the stop ended.
  for (const stop of day.stops.filter((stop) => stop.outletId === outletId)) {
    const trip = tripOf(day, stop.tripId);
    if (trip.leftAt) items.push({ ...base, id: `left:${stop.id}`, kind: 'truck_left', at: iso(trip.leftAt),
      line: words.truckLeftForShopLine(trip, stop.seq, stopsOfTrip(day, trip.id).length), link: '/store', tone: 'info' });
    if (stop.arrivedAt) items.push({ ...base, id: `arrived:${stop.id}:${ms(stop.arrivedAt)}`, kind: 'driver_arrived', at: iso(stop.arrivedAt),
      line: words.driverArrivedLine(trip), link: '/store', tone: 'info' });
    if (stop.doneAt && stop.outcome === 'delivered') items.push({ ...base, id: `delivered:${stop.id}`, kind: 'delivered', at: iso(stop.doneAt),
      line: words.deliveredLine(trip, stop.brand, stop.delivered), link: `/store/deliveries/${stop.id}`, tone: 'good' });
    if (stop.doneAt && stop.outcome === 'refused') items.push({ ...base, id: `refused:${stop.id}`, kind: 'refused', at: iso(stop.doneAt),
      line: words.refusedAtDoorLine(trip, stop.brand, stop.delivered, stop.loaded), link: `/store/deliveries/${stop.id}`, tone: 'warn' });
  }
  // A closed shop is its problem, which keeps its time and count after Try again clears the stop.
  for (const issue of day.issues.filter((issue) => issue.stop.outletId === outletId)) {
    const trip = tripOf(day, issue.trip.id);
    if (issue.kind === 'closed') items.push({ ...base, id: `closed:${issue.id}`, kind: 'shop_closed', at: issue.raisedAt,
      line: words.shopClosedLine(trip, shop.brand, problemUnits(issue)), link: '/store', tone: 'bad' });
    // The depot's answer to their receipt report.
    if (issue.kind === 'receipt' && issue.decision && issue.decidedAt) items.push({ ...base, id: `report:${issue.id}`, kind: 'report_answered', at: issue.decidedAt,
      line: words.reportAnsweredLine(reportOf(issue), issue.decision, issue.replacement), link: `/store/deliveries/${issue.stop.id}`, tone: 'info', decision: issue.decision });
  }
  return items;
}

// ── A dispatcher's, for the depot the read is for ────────────────────────────────────────────────────────────

function dispatcherUpdates(day: DepotDay): Item[] {
  const items: Item[] = [];
  for (const issue of day.issues) {
    const trip = tripOf(day, issue.trip.id);
    const shop = issue.stop.shopName;
    const brand = brandOfShop(shop);
    let line: string;
    if (issue.kind === 'loading') line = words.flagRaisedLine(issue.raisedBy, brand, problemUnits(issue), FlagReason.parse(issue.reason), shop, trip);
    else if (issue.kind === 'refused') line = words.refusalRaisedLine(shop, brand, problemUnits(issue), RefusalReason.parse(issue.reason), trip);
    else if (issue.kind === 'closed') line = words.closedRaisedLine(shop, brand, problemUnits(issue), trip);
    else line = words.reportRaisedLine(issue.raisedBy, reportOf(issue), shop);
    items.push({ ...base, id: `problem:${issue.id}`, kind: 'problem', at: issue.raisedAt, line, link: `/dispatcher/live?issue=${issue.id}`, tone: 'bad', issueKind: issue.kind });
  }
  for (const trip of day.trips) {
    const own = stopsOfTrip(day, trip.id);
    const link = `/dispatcher/live?trip=${trip.id}`;
    if (trip.readyAt) items.push({ ...base, id: `ready:${trip.id}`, kind: 'truck_ready', at: iso(trip.readyAt),
      line: words.truckReadyLine(trip, own.reduce((n, stop) => n + total(stop.loaded), 0), own.reduce((n, stop) => n + total(stop.ordered), 0)), link, tone: 'good' });
    if (trip.leftAt) items.push({ ...base, id: `left:${trip.id}`, kind: 'truck_left', at: iso(trip.leftAt), line: words.truckLeftLine(trip, own.length), link, tone: 'info' });
    if (trip.backAt) items.push({ ...base, id: `back:${trip.id}`, kind: 'truck_back', at: iso(trip.backAt),
      line: words.truckBackLine(trip, own.filter((stop) => stop.outcome !== null).length, own.length), link, tone: 'good' });
  }
  return items;
}

// ── A loader's, for their depot's dock ───────────────────────────────────────────────────────────────────────

function loaderUpdates(day: DepotDay): Item[] {
  const items: Item[] = [];
  for (const plan of day.plans) {
    const trucks = day.trips.filter((trip) => trip.plan.id === plan.id).length;
    // A plan with no truck, as the seed's earlier days have, gives the dock nothing to load.
    if (plan.status === 'published' && trucks === 0) continue;
    const sends = day.sends.get(plan.id) ?? [];
    const latest = plan.status === 'published' ? sends.filter((send) => send.kind === 'sent').at(-1) : undefined;
    sends.forEach((send, i) => {
      const at = iso(send.at);
      if (send.kind === 'unsent') {
        items.push({ ...base, id: `plan_taken_back:${plan.id}:${ms(send.at)}`, kind: 'plan_taken_back', at, line: words.planTakenBackLine(plan.date), link: '/loader', tone: 'warn' });
        return;
      }
      // Only the plan as it stands has a count of trucks.
      const count = send === latest ? trucks : null;
      if (sends.slice(0, i).some((earlier) => earlier.kind === 'sent')) {
        items.push({ ...base, id: `plan_changed:${plan.id}:${ms(send.at)}`, kind: 'plan_changed', at, line: words.planChangedLine(plan.date, count), link: '/loader/changes', tone: 'warn' });
      } else {
        items.push({ ...base, id: `plan_out:${plan.id}:${ms(send.at)}`, kind: 'plan_out', at, line: words.planOutLine(plan.date, count), link: '/loader', tone: 'info' });
      }
    });
  }
  // The dispatcher's answers to the dock's flags: any loader on the dock may be loading that truck.
  for (const issue of day.issues) {
    if (issue.kind !== 'loading' || !issue.decision || !issue.decidedAt) continue;
    items.push({ ...base, id: `flag_answered:${issue.id}`, kind: 'flag_answered', at: issue.decidedAt, link: `/loader/trucks/${issue.trip.id}`, tone: 'info', decision: issue.decision,
      line: words.flagAnsweredLine(issue.decidedBy ?? 'The dispatcher', issue.trip, LoadingDecision.parse(issue.decision), FlagReason.parse(issue.reason),
        brandOfShop(issue.stop.shopName), problemUnits(issue), issue.stop.shopName) });
  }
  return items;
}

// ── A driver's own trips ─────────────────────────────────────────────────────────────────────────────────────

async function driverUpdates(tx: Tx, day: DepotDay, userId: string, at: Date): Promise<Item[]> {
  const items: Item[] = [];
  const own = day.trips.filter((trip) => trip.driverId === userId);
  for (const trip of own) {
    const plan = trip.plan;
    const sends = (day.sends.get(plan.id) ?? []).filter((send) => send.kind === 'sent');
    const latest = sends.at(-1);
    if (latest) {
      const leaves = depotClock(sentTrip(plan.date, plan.sentCheck === null ? null : PlanCheck.parse(plan.sentCheck), trip.vehicleId, trip.tripNo).leavesAt);
      const count = stopsOfTrip(day, trip.id).length;
      // The trip as it stands, at the plan's latest send: sent, or changed when the plan was sent before.
      items.push(sends.length > 1
        ? { ...base, id: `trip_changed:${trip.id}:${ms(latest.at)}`, kind: 'trip_changed', at: iso(latest.at), line: words.tripChangedLine(plan.date, trip, leaves, count), link: '/driver', tone: 'warn' }
        : { ...base, id: `trip_sent:${trip.id}:${ms(latest.at)}`, kind: 'trip_sent', at: iso(latest.at), line: words.tripSentLine(plan.date, trip, leaves, count), link: '/driver', tone: 'info' });
    }
    if (trip.readyAt) {
      const stopsOn = stopsOfTrip(day, trip.id);
      items.push({ ...base, id: `ready:${trip.id}`, kind: 'truck_ready', at: iso(trip.readyAt), link: '/driver', tone: 'good',
        line: words.yourTruckReadyLine(trip, stopsOn.reduce((n, stop) => n + total(stop.loaded), 0), stopsOn.reduce((n, stop) => n + total(stop.ordered), 0)) });
    }
  }
  // The dispatcher's answers to their problems, in the words their phone uses, from the same figures.
  if (own.length) {
    const shown = await driverTripsOf(tx, own.map((trip) => ({ trip: trip.row, plan: trip.plan })), at);
    const [depot] = await tx.select({ name: depots.name }).from(depots).where(eq(depots.id, own[0]!.plan.depotId));
    const depotName = depot?.name ?? own[0]!.plan.depotId;
    for (const trip of shown) {
      const figures = tripFigures(trip);
      for (const problem of trip.problems) {
        if (!problem.decision || !problem.decidedAt) continue;
        const index = trip.stops.findIndex((stop) => stop.id === problem.stopId);
        const stop = trip.stops[index]!;
        const brand = brandOfStop(trip.brand, stop.shopName);
        const sentence = driverAnswerSentence(problem, stop, brand, figures.byStop[index]!, depotName);
        const by = problem.decidedBy ?? 'The dispatcher';
        items.push({ ...base, id: `answer:${problem.id}`, kind: 'problem_answered', at: problem.decidedAt, line: words.problemAnsweredLine(by, sentence), link: '/driver', tone: 'warn',
          decision: problem.decision, answer: { short: driverAnswerShort(problem, stop, brand, figures.byStop[index]!), by, sentence } });
      }
    }
  }
  return items;
}
