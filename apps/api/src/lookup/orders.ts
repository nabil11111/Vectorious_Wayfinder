import { DeferralCode, IssueDecision, LookupOrders, type LookupOrderRow, type LookupOrdersQuery } from '@wayfinder/contracts';
import { and, between, desc, eq, inArray, lte, notInArray, or } from 'drizzle-orm';
import { deferrals, issues, orderLines, orders, outlets, plans, products, stopOrders, stops, trips } from '../db/schema';
import { depotDate, depotInstant, depotMinutes } from '../lib/clock';
import type { DepotCaller } from '../middleware/auth';
import { snapshot } from '../orders/store-orders';
import { computeLoad } from '../planning';
import { operatingDays, readMoment } from '../plans/board';
import { boardDay } from '../plans/board-day';
import { dateRange, keptTrip, publicationOf, scopeOf, shiftDate } from './dates';

export function getLookupOrders(caller: DepotCaller, query: LookupOrdersQuery): Promise<LookupOrders> {
  return snapshot(async tx => {
    const moment = await readMoment(tx), scope = await scopeOf(tx, caller.depotId, moment);
    const date = query.date ?? boardDay(depotDate(moment.at), depotMinutes(moment.at), await operatingDays(tx))?.date ?? null;
    if (!date) return LookupOrders.parse({ ...scope, date: null, from: null, range: query.range, summary: null, rows: [], skippedLately: null });
    const from = query.range === 'four_weeks' ? shiftDate(date, -27) : date, days = dateRange(from, date);
    const publications = await tx.select().from(plans).where(and(eq(plans.depotId, caller.depotId), eq(plans.status, 'published'), between(plans.date, from, date)));
    const planIds = publications.map(row => row.id);
    const assigned = planIds.length ? await tx.select({ orderId: stopOrders.orderId, stop: stops, trip: trips }).from(stopOrders)
      .innerJoin(stops, eq(stops.id, stopOrders.stopId)).innerJoin(trips, eq(trips.id, stops.tripId)).where(inArray(trips.planId, planIds)) : [];
    const deferred = planIds.length ? await tx.select().from(deferrals).where(inArray(deferrals.planId, planIds)) : [];
    const named = [...new Set([...assigned.map(row => row.orderId), ...deferred.map(row => row.orderId)])];
    const candidates = await tx.select({ order: orders, shop: outlets }).from(orders).innerJoin(outlets, eq(outlets.id, orders.outletId)).where(and(
      eq(outlets.depotId, caller.depotId), notInArray(orders.status, ['draft', 'split', 'cancelled']),
      or(between(orders.deliveryDate, from, date), named.length ? inArray(orders.id, named) : undefined,
        named.length ? inArray(orders.splitFrom, named) : undefined,
        and(inArray(orders.status, ['placed', 'deferred']), lte(orders.deliveryDate, date)))));
    const admitted = candidates.map(row => ({ ...row, days: days.filter(day => {
      const plan = publications.find(plan => plan.date === day);
      return row.order.deliveryDate === day || (plan
        ? assigned.some(member => member.trip.planId === plan.id && [row.order.id, row.order.splitFrom].includes(member.orderId))
          || deferred.some(member => member.planId === plan.id && [row.order.id, row.order.splitFrom].includes(member.orderId))
        : ['placed', 'deferred'].includes(row.order.status) && row.order.deliveryDate < day);
    }) })).filter(row => row.days.length);
    const parentIds = [...new Set(admitted.flatMap(row => row.order.splitFrom ? [row.order.splitFrom] : []))];
    const family = parentIds.length ? await tx.select().from(orders).innerJoin(outlets, eq(outlets.id, orders.outletId))
      .where(and(eq(outlets.depotId, caller.depotId), or(inArray(orders.id, parentIds), inArray(orders.splitFrom, parentIds)))) : [];
    const all = [...new Map([...admitted.map(row => row.order), ...family.map(row => row.orders)].map(row => [row.id, row])).values()];
    const ids = all.map(row => row.id);
    const lines = ids.length ? await tx.select({ line: orderLines, product: products }).from(orderLines).innerJoin(products, eq(products.id, orderLines.productId)).where(inArray(orderLines.orderId, ids)).orderBy(orderLines.productId) : [];
    const engineProducts = [...new Map(lines.map(({ product }) => [product.id, { ...product, kgPerUnit: Number(product.kgPerUnit), m3PerUnit: Number(product.m3PerUnit) }])).values()];
    const histories = ids.length ? await tx.select({ deferral: deferrals, date: plans.date }).from(deferrals).innerJoin(plans, eq(plans.id, deferrals.planId))
      .where(and(eq(plans.depotId, caller.depotId), eq(plans.status, 'published'), lte(plans.date, date), inArray(deferrals.orderId, ids))).orderBy(desc(plans.date), deferrals.id) : [];
    const detail = (order: typeof orders.$inferSelect) => {
      const own = lines.filter(row => row.line.orderId === order.id).map(({ line, product }) => ({ lineId: line.id, productId: product.id, name: product.name, unit: product.unit, quantity: line.quantity }));
      return { id: order.id, wantedDate: order.deliveryDate, placedAt: order.placedAt?.toISOString() ?? null, temp: order.temp, status: order.status,
        lines: own, note: order.driverNote, load: computeLoad(own, engineProducts) };
    };
    const reason = (row: typeof deferrals.$inferSelect) => ({ code: DeferralCode.parse(row.code), reason: row.reason });
    // Every sent stop each listed order was on, on any day, and the closed visits at those stops and the listed days'
    // (Q-46): an order whose latest stop was closed and answered "Bring them back" waits, placed, for the next plan.
    const rowIds = admitted.map(row => row.order.id);
    const visits = rowIds.length ? await tx.select({ orderId: stopOrders.orderId, stop: stops, date: plans.date }).from(stopOrders)
      .innerJoin(stops, eq(stops.id, stopOrders.stopId)).innerJoin(trips, eq(trips.id, stops.tripId)).innerJoin(plans, eq(plans.id, trips.planId))
      .where(and(inArray(stopOrders.orderId, rowIds), eq(plans.depotId, caller.depotId), eq(plans.status, 'published'))) : [];
    const visitedStops = [...new Set([...assigned.map(row => row.stop.id), ...visits.map(row => row.stop.id)])];
    const closedVisits = visitedStops.length ? await tx.select().from(issues).where(and(inArray(issues.stopId, visitedStops), eq(issues.kind, 'closed')))
      .orderBy(issues.raisedAt, issues.id) : [];
    const closedAt = (stopId: string) => closedVisits.filter(row => row.stopId === stopId).map(row => ({ issueId: row.id, at: row.raisedAt.toISOString(),
      decision: row.decision === null ? null : IssueDecision.parse(row.decision), decidedAt: row.decidedAt?.toISOString() ?? null }));
    const broughtBack = (order: typeof orders.$inferSelect) => {
      if (order.status !== 'placed') return false;
      const latest = visits.filter(row => row.orderId === order.id).sort((a, b) => b.date.localeCompare(a.date))[0];
      return latest?.stop.outcome === 'closed' && closedVisits.some(row => row.stopId === latest.stop.id && row.decision === 'bring_back');
    };
    const rows: LookupOrderRow[] = admitted.map(({ order, shop, days }) => {
      const inherited = histories.filter(row => row.deferral.orderId === order.id || row.deferral.orderId === order.splitFrom);
      const unique = [...new Set(inherited.map(row => row.deferral.planId))].map(id => inherited.find(row => row.deferral.planId === id && row.deferral.orderId === order.id) ?? inherited.find(row => row.deferral.planId === id)!);
      const original = order.splitFrom ? all.find(row => row.id === order.splitFrom) : null;
      if (order.splitFrom && !original) throw new Error(`No original for part ${order.id}.`);
      return { ...detail(order), outlet: shop, splitFrom: order.splitFrom, broughtBack: broughtBack(order),
        deferredEarlier: order.status === 'deferred' && days.some(day => !publications.some(plan => plan.date === day)), original: original ? detail(original) : null,
        parts: original ? all.filter(row => row.splitFrom === original.id).sort((a, b) => a.id.localeCompare(b.id)).map(detail) : [],
        deferralHistory: unique.map(row => ({ ...reason(row.deferral), planId: row.deferral.planId, date: row.date })), timesDeferred: unique.length,
        days: days.map(day => {
          const plan = publications.find(row => row.date === day);
          const member = assigned.find(row => row.orderId === order.id && row.trip.planId === plan?.id);
          // A leaf inherits its original's deferral for this day, never its old truck assignment.
          const skipped = deferred.find(row => row.orderId === order.id && row.planId === plan?.id)
            ?? deferred.find(row => row.orderId === order.splitFrom && row.planId === plan?.id);
          const time = member && plan ? keptTrip(plan, member.trip).times.stops.find(row => row.seq === member.stop.seq && row.outletId === member.stop.outletId) : null;
          if (member && !time) throw new Error(`No kept arrival for ${member.stop.id}.`);
          return { date: day, carriedOver: order.deliveryDate < day, publication: plan ? publicationOf(plan) : null,
            assignment: member ? { tripId: member.trip.id, vehicleId: member.trip.vehicleId, tripNo: member.trip.tripNo, stopId: member.stop.id, seq: member.stop.seq, plannedArrival: depotInstant(day, time!.arriveAt).toISOString(), closed: closedAt(member.stop.id) } : null,
            deferral: skipped ? reason(skipped) : null };
        }) };
    });
    const brands = ['Fresh', 'Style', 'Tech'];
    rows.sort((a, b) => brands.indexOf(a.outlet.brand) - brands.indexOf(b.outlet.brand) || a.outlet.district.localeCompare(b.outlet.district) || a.outlet.name.localeCompare(b.outlet.name)
      || a.wantedDate.localeCompare(b.wantedDate) || a.temp.localeCompare(b.temp) || a.id.localeCompare(b.id));
    const skippedFrom = shiftDate(date, -27);
    const skips = await tx.select({ deferral: deferrals, date: plans.date, shop: outlets }).from(deferrals).innerJoin(plans, eq(plans.id, deferrals.planId))
      .innerJoin(orders, eq(orders.id, deferrals.orderId)).innerJoin(outlets, eq(outlets.id, orders.outletId))
      .where(and(eq(plans.depotId, caller.depotId), eq(outlets.depotId, caller.depotId), eq(plans.status, 'published'), between(plans.date, skippedFrom, date)));
    const skippedRows = [...new Set(skips.map(row => row.shop.id))].map(id => {
      const own = skips.filter(row => row.shop.id === id).sort((a, b) => b.date.localeCompare(a.date));
      const latest = own[0]!;
      return { outlet: { id, name: latest.shop.name, brand: latest.shop.brand }, count: new Set(own.map(row => row.deferral.planId)).size, latestDate: latest.date,
        reasons: [...new Map(own.filter(row => row.deferral.planId === latest.deferral.planId).map(row => [JSON.stringify(reason(row.deferral)), reason(row.deferral)])).values()].sort((a, b) => a.code.localeCompare(b.code) || a.reason.localeCompare(b.reason)) };
    }).sort((a, b) => b.count - a.count || b.latestDate.localeCompare(a.latestDate) || a.outlet.name.localeCompare(b.outlet.name) || a.outlet.id.localeCompare(b.outlet.id));
    return LookupOrders.parse({ ...scope, date, from, range: query.range, rows, summary: { orders: rows.length,
      planned: new Set(assigned.map(row => row.orderId)).size,
      // A listed day's own sent plan's deferrals, and before a day is sent the orders still deferred from an earlier one
      // (Q-48), each order once.
      deferred: new Set([...deferred.map(row => row.orderId), ...rows.filter(row => row.deferredEarlier).map(row => row.id)]).size,
      carriedOver: rows.filter(row => row.days.some(day => day.carriedOver)).length, split: rows.filter(row => row.splitFrom).length },
      skippedLately: { from: skippedFrom, to: date, rows: skippedRows } });
  });
}
