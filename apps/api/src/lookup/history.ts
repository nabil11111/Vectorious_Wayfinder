import { DeferralCode, LookupHistory, ReceiptReport, RefusalReason, deliveryFigures, tripFigures,
  type HistoryLine, type HistoryReceipt, type HistoryStop, type HistoryTrip, type LookupHistoryQuery } from '@wayfinder/contracts';
import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import { deferrals, orderLines, orders, outlets, photos, plans, stopOrders, stops, trips, users, vehicles } from '../db/schema';
import { driverTripsOf } from '../driver/day';
import { issuesOf } from '../issues/read';
import { depotDate, depotInstant } from '../lib/clock';
import type { DepotCaller } from '../middleware/auth';
import { snapshot } from '../orders/store-orders';
import { readMoment } from '../plans/board';
import { attemptsOf, photoOf, problemOf } from './attempts';
import { keptTrip, publicationOf, scopeOf } from './dates';
import { stagesOf } from './figures';

export function getLookupHistory(caller: DepotCaller, query: LookupHistoryQuery): Promise<LookupHistory> {
  return snapshot(async tx => {
    const moment = await readMoment(tx), today = depotDate(moment.at), scope = await scopeOf(tx, caller.depotId, moment);
    const published = and(eq(plans.depotId, caller.depotId), eq(plans.status, 'published'));
    const latest = await tx.select({ date: plans.date }).from(plans).where(published).orderBy(desc(plans.date)).limit(3);
    const [plan] = await tx.select().from(plans).where(and(published, query.date ? eq(plans.date, query.date) : lte(plans.date, today))).orderBy(desc(plans.date)).limit(1);
    const date = query.date ?? plan?.date ?? null, base = { ...scope, date, publishedDates: latest.map(row => row.date) };
    if (!plan) return LookupHistory.parse({ ...base, publication: null, counts: null, groups: [], trips: [], deferrals: [] });
    const rows = await tx.select().from(trips).where(eq(trips.planId, plan.id));
    const kept = new Map(rows.map(trip => [trip.id, keptTrip(plan, trip)]));
    const facts = await driverTripsOf(tx, rows.map(trip => ({ trip, plan })), moment.at);
    const ids = rows.map(row => row.id);
    const members = ids.length ? await tx.select({ stop: stops, shop: outlets }).from(stops).innerJoin(outlets, eq(outlets.id, stops.outletId)).where(inArray(stops.tripId, ids)) : [];
    if (members.some(row => row.shop.depotId !== caller.depotId)) throw new Error(`Publication ${plan.id} contains a shop outside its depot.`);
    const stopIds = members.map(row => row.stop.id);
    const receiptOrders = stopIds.length ? await tx.select({ stopId: stopOrders.stopId, order: orders }).from(stopOrders).innerJoin(orders, eq(orders.id, stopOrders.orderId)).where(inArray(stopOrders.stopId, stopIds)) : [];
    const orderIds = [...new Set(receiptOrders.map(row => row.order.id))];
    const received = orderIds.length ? await tx.select({ lineId: orderLines.id, received: orderLines.receivedQty }).from(orderLines).where(inArray(orderLines.orderId, orderIds)) : [];
    const problems = ids.length ? await issuesOf(tx, inArray(trips.id, ids)) : [];
    const pictures = stopIds.length ? await tx.select({ stopId: photos.stopId, issueId: photos.issueId, takenAt: photos.takenAt }).from(photos).where(inArray(photos.stopId, stopIds)) : [];
    const fleet = ids.length ? await tx.select().from(vehicles).where(inArray(vehicles.id, rows.map(row => row.vehicleId))) : [];
    const driverIds = rows.flatMap(row => row.driverId ? [row.driverId] : []);
    const people = driverIds.length ? await tx.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, driverIds)) : [];
    const brands = ['Fresh', 'Style', 'Tech', null] as const;
    const shown: HistoryTrip[] = rows.map(trip => {
      const fact = facts.find(row => row.tripId === trip.id)!, schedule = kept.get(trip.id)!, figures = tripFigures(fact);
      const vehicle = fleet.find(row => row.id === trip.vehicleId);
      if (!vehicle || vehicle.depotId !== caller.depotId) throw new Error(`Trip ${trip.id} has no depot vehicle.`);
      const driver = trip.driverId ? people.find(row => row.id === trip.driverId) : null;
      if (trip.driverId && !driver) throw new Error(`No driver ${trip.driverId}.`);
      const shownStops: HistoryStop[] = fact.stops.map(stop => {
        const member = members.find(row => row.stop.id === stop.id)!, time = schedule.times.stops.find(row => row.seq === stop.seq && row.outletId === stop.outletId);
        if (!time) throw new Error(`No kept time for stop ${stop.id}.`);
        const ownProblems = problems.filter(row => row.stop.id === stop.id), ownOrders = receiptOrders.filter(row => row.stopId === stop.id).map(row => row.order);
        const lineCounts = figures.byStop.find(row => row.stopId === stop.id)!.byLine;
        const completed = stop.outcome !== null, handed = stop.outcome === 'delivered' || stop.outcome === 'refused';
        const windowOpen = depotInstant(plan.date, time.windowOpen).toISOString(), windowClose = depotInstant(plan.date, time.windowClose).toISOString();
        const late = stop.arrivedAt === null ? null : stop.arrivedAt > windowClose;
        let receipt: HistoryReceipt | null = null;
        // Closed attempts deliberately never inspect mutable order receipts, including after Friday's reallocation.
        const evidence = handed && (ownOrders.some(row => row.status === 'received' || row.receivedAt !== null || row.receiptSentAt !== null || row.arrivedCold !== null)
          || stop.lines.some(line => received.find(row => row.lineId === line.lineId)?.received != null));
        if (evidence) {
          const first = ownOrders[0], chilled = ownOrders.filter(row => row.temp === 'chilled'), cold = chilled[0]?.arrivedCold ?? null;
          if (!first?.receivedAt || ownOrders.some(row => row.status !== 'received' || row.receivedAt?.getTime() !== first.receivedAt!.getTime()
            || row.receiptSentAt?.getTime() !== first.receiptSentAt?.getTime() || (row.temp === 'dry' && row.arrivedCold !== null))
            || chilled.some(row => row.arrivedCold !== cold) || stop.lines.some(line => received.find(row => row.lineId === line.lineId)?.received == null)) {
            throw new Error(`Stop ${stop.id} has an incomplete or inconsistent receipt.`);
          }
          const report = ownProblems.find(row => row.kind === 'receipt');
          receipt = { stopId: stop.id, confirmedAt: first.receivedAt.toISOString(), sentAt: first.receiptSentAt?.toISOString() ?? null, cold,
            orderCount: ownOrders.length, lines: stop.lines.map(line => ({ lineId: line.lineId, orderId: line.orderId, received: received.find(row => row.lineId === line.lineId)!.received! })), received: 0, short: 0,
            report: report ? { ...ReceiptReport.parse({ ...report, lines: report.lines.map(line => ({ lineId: line.lineId, counted: line.counted, reason: line.reason ?? null })) }), photo: photoOf(pictures.find(row => row.issueId === report.id)) } : null };
        }
        const delivery = handed ? deliveryFigures({ stopId: stop.id, revision: stop.revision, day: plan.date, vehicleId: trip.vehicleId, driver: driver?.name ?? null,
          arrivedAt: stop.arrivedAt!, doneAt: stop.doneAt!, outcome: stop.outcome as 'delivered' | 'refused', late: late!,
          refusalReason: stop.outcome === 'refused' ? RefusalReason.parse(ownProblems.find(row => row.kind === 'refused')?.reason) : null,
          receipt: receipt ? { at: receipt.confirmedAt, sentAt: receipt.sentAt, cold: receipt.cold, report: receipt.report } : null,
          lines: stop.lines.map(line => {
            if (line.loaded === null || line.delivered === null) throw new Error(`Handed over line ${line.lineId} has no counts.`);
            return { ...line, ordered: line.quantity, loaded: line.loaded, delivered: line.delivered, received: receipt?.lines.find(row => row.lineId === line.lineId)!.received ?? null };
          }) }) : null;
        if (receipt && delivery) { receipt.received = delivery.received!; receipt.short = delivery.short; }
        const loaded = trip.status !== 'planned' && trip.status !== 'loading';
        // A closed shop was handed nothing, so nothing was received or short on a receipt: recorded zeros, which nothing
        // later changes, not stages still to record (L-13). Its goods count under not delivered.
        const closed = stop.outcome === 'closed';
        const lines: HistoryLine[] = stop.lines.map(line => {
          const counted = lineCounts.find(row => row.lineId === line.lineId)!, confirmed = delivery?.byLine.find(row => row.lineId === line.lineId);
          return { ...line, loaded: loaded ? line.loaded : null, delivered: handed ? line.delivered : closed ? 0 : null,
            // What did not fit on the truck is not short of stock (L-21).
            received: receipt ? confirmed!.received : closed ? 0 : null, depotShort: loaded && line.loaded !== null ? counted.short - counted.wontFit : null,
            wontFit: loaded && line.loaded !== null ? counted.wontFit : 0,
            refused: completed ? counted.refused : null, receiptShort: receipt ? confirmed!.short : closed ? 0 : null, notDelivered: completed ? counted.notDelivered : null };
        });
        const stages = stagesOf(lines);
        return { id: stop.id, seq: stop.seq, outlet: member.shop, orderIds: ownOrders.map(row => row.id).sort(),
          plannedArrival: depotInstant(plan.date, time.arriveAt).toISOString(), plannedDeparture: depotInstant(plan.date, time.leaveAt).toISOString(), windowOpen, windowClose,
          loadedAt: member.stop.loadedAt?.toISOString() ?? null, arrivedAt: stop.arrivedAt, doneAt: stop.doneAt, outcome: stop.outcome, lines, stages,
          flags: { late, short: lines.some(line => (line.depotShort ?? 0) > 0 || line.wontFit > 0 || (line.refused ?? 0) > 0 || (line.receiptShort ?? 0) > 0),
            returned: ownProblems.some(row => (row.kind === 'closed' && row.decision === 'bring_back') || (row.kind === 'refused' && ['bring_back', 'send_replacements'].includes(row.decision ?? ''))) },
          receipt, proof: photoOf(pictures.find(row => row.stopId === stop.id && row.issueId === null)), problems: ownProblems.map(row => problemOf(row, lines, pictures)), attempts: attemptsOf(ownProblems, pictures) };
      });
      const ownBrands = [...new Set(shownStops.map(row => row.outlet.brand))].sort((a, b) => brands.indexOf(a) - brands.indexOf(b));
      return { tripId: trip.id, planId: plan.id, date: plan.date, vehicleId: vehicle.id, vehicleType: vehicle.type, vehicleTemp: vehicle.temp, archived: vehicle.archivedAt !== null,
        tripNo: trip.tripNo, driver: driver ?? null, brand: ownBrands.length === 1 ? ownBrands[0]! : null, brands: ownBrands, district: schedule.times.district, status: trip.status,
        schedule: { leavesAt: fact.leavesAt, backAt: fact.backBy, load: schedule.load, km: schedule.times.km }, readyAt: fact.readyAt, leftAt: fact.leftAt, backAt: fact.backAt, stops: shownStops,
        flags: { late: shownStops.some(row => row.flags.late === true) ? true : shownStops.some(row => row.flags.late === null) ? null : false,
          short: shownStops.some(row => row.flags.short), returned: shownStops.some(row => row.flags.returned) }, stages: stagesOf(shownStops.flatMap(row => row.lines)) };
    });
    shown.sort((a, b) => brands.indexOf(a.brand) - brands.indexOf(b.brand) || a.district.localeCompare(b.district) || a.schedule.leavesAt.localeCompare(b.schedule.leavesAt) || a.vehicleId.localeCompare(b.vehicleId) || a.tripNo - b.tripNo);
    const deferred = await tx.select({ deferral: deferrals, order: orders, shop: outlets }).from(deferrals).innerJoin(orders, eq(orders.id, deferrals.orderId)).innerJoin(outlets, eq(outlets.id, orders.outletId)).where(and(eq(deferrals.planId, plan.id), eq(outlets.depotId, caller.depotId))).orderBy(outlets.brand, outlets.district, outlets.name, orders.id);
    const deferredLines = deferred.length ? await tx.select().from(orderLines).where(inArray(orderLines.orderId, deferred.map(row => row.order.id))) : [];
    const allStops = shown.flatMap(row => row.stops), delivered = allStops.filter(row => (row.stages.handedOver.units ?? 0) > 0);
    return LookupHistory.parse({ ...base, publication: publicationOf(plan), trips: shown,
      groups: [...new Set(shown.map(row => JSON.stringify([row.brand, row.district])))].map(key => {
        const own = shown.filter(row => JSON.stringify([row.brand, row.district]) === key);
        return { brand: own[0]!.brand, district: own[0]!.district, tripIds: own.map(row => row.tripId) };
      }), counts: { trips: shown.length, stops: allStops.length, orders: new Set(allStops.flatMap(row => row.orderIds)).size, delivered: delivered.length, finished: allStops.filter(row => row.outcome !== null).length,
        partial: delivered.filter(row => (row.stages.refused.units ?? 0) > 0).length,
        noGoods: allStops.filter(row => (row.outcome === 'delivered' || row.outcome === 'refused') && row.stages.handedOver.units === 0).length,
        closed: allStops.filter(row => row.outcome === 'closed').length, late: allStops.filter(row => row.flags.late === true).length, short: allStops.filter(row => row.flags.short).length,
        returned: allStops.filter(row => row.flags.returned).length, deferred: new Set(deferred.map(row => row.order.id)).size, confirmations: allStops.filter(row => row.receipt !== null).length,
        receivedOrders: new Set(allStops.flatMap(row => row.receipt ? row.orderIds : [])).size, stages: stagesOf(allStops.flatMap(row => row.lines)) },
      deferrals: deferred.map(({ deferral, order, shop }) => ({ planId: plan.id, date: plan.date, orderId: order.id, outlet: shop, temp: order.temp, code: DeferralCode.parse(deferral.code), reason: deferral.reason,
        units: deferredLines.filter(row => row.orderId === order.id).reduce((sum, row) => sum + row.quantity, 0) })) });
  });
}
