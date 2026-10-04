import type { BoardOrder, BoardShop, Brand } from '@wayfinder/contracts';
import { cubic, tonnes, whole } from '../words';

// What a person needs before choosing a vehicle: how much, and which requirements are in the selection.
export function demandOf(orders: readonly BoardOrder[], shopOf: (id: string) => BoardShop | null | undefined) {
  const shops = new Set(orders.map((order) => order.outletId));
  const chilled = orders.filter((order) => order.load.needsReefer).length;
  const van = [...shops].filter((id) => shopOf(id)?.parking === 'van_only').length;
  const earliest = orders.reduce((close, order) => {
    const shop = shopOf(order.outletId);
    return shop ? Math.min(close, shop.windowClose) : close;
  }, 24 * 60);
  return {
    shops: shops.size,
    orders: orders.length,
    originals: new Set(orders.map((order) => order.splitFrom ?? order.id)).size,
    kg: orders.reduce((sum, order) => sum + order.load.kg, 0),
    m3: orders.reduce((sum, order) => sum + order.load.m3, 0),
    chilled,
    van,
    earliest: orders.length > 0 && earliest < 24 * 60 ? earliest : null,
  };
}

export function demandLine(orders: readonly BoardOrder[], shopOf: (id: string) => BoardShop | null | undefined): string {
  const demand = demandOf(orders, shopOf);
  const requirements = [
    demand.chilled > 0 ? `${whole(demand.chilled)} chilled` : '',
    demand.van > 0 ? `${whole(demand.van)} van-only ${demand.van === 1 ? 'shop' : 'shops'}` : '',
  ].filter(Boolean);
  return [
    `${whole(demand.shops)} ${demand.shops === 1 ? 'shop' : 'shops'}`,
    `${whole(demand.originals)} ${demand.originals === 1 ? 'order' : 'orders'}`,
    tonnes(demand.kg),
    cubic(demand.m3),
    ...requirements,
  ].join(' · ');
}

export const BRANDS: Brand[] = ['Fresh', 'Style', 'Tech'];

export function brandLabel(brands: readonly Brand[]): string {
  const present = BRANDS.filter((brand) => brands.includes(brand));
  if (present.length === 0) return '';
  if (present.length === 1) return present[0]!;
  return `Mixed · ${present.join(' + ')}`;
}
