import type { BoardOrder, DraftPlan } from '@wayfinder/contracts';
import { placesOf } from '../draft';
import { countOf, whole } from '../words';
export interface ShopSummary { orders: number; parts: number; onTrips: number; waiting: number; deferred: number; carriedOver: number }
// A split parent represents its pieces, not additional outstanding demand. Count each active record once.
export function activeOrders(orders: BoardOrder[]) {
  const parents = new Set(orders.flatMap(order => order.splitFrom ? [order.splitFrom] : []));
  return [...new Map(orders.filter(order => !parents.has(order.id)).map(order => [order.id, order])).values()];
}
export function shopSummaries(orders: BoardOrder[], draft: DraftPlan) {
  const places = placesOf(draft);
  const shops = new Map<string, ShopSummary>();
  for (const order of activeOrders(orders)) {
    const summary = shops.get(order.outletId) ?? { orders: 0, parts: 0, onTrips: 0, waiting: 0, deferred: 0, carriedOver: 0 };
    if (order.splitFrom) summary.parts += 1; else summary.orders += 1;
    const place = places.get(order.id);
    if (!place) summary.waiting += 1;
    else if (place.kind === 'stop') summary.onTrips += 1;
    else summary.deferred += 1;
    if (order.carriedOver) summary.carriedOver += 1;
    shops.set(order.outletId, summary);
  }
  return shops;
}
export function demandCount(orders: BoardOrder[]) {
  const active = activeOrders(orders); const parts = active.filter(order => order.splitFrom !== null).length;
  return [active.length > parts && countOf(active.length - parts, 'order'), parts > 0 && countOf(parts, 'split part')].filter(Boolean).join(' + ');
}
export function summaryLine(summary: ShopSummary) {
  const count = [summary.orders > 0 && countOf(summary.orders, 'order'), summary.parts > 0 && countOf(summary.parts, 'split part')].filter(Boolean).join(' + ');
  return [count, `${whole(summary.onTrips)} on trips`, `${whole(summary.waiting)} waiting`, `${whole(summary.deferred)} deferred`, summary.carriedOver > 0 && `includes ${whole(summary.carriedOver)} carried over`].filter(Boolean).join(' · ');
}
