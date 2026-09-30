import { inputFor } from '../../testing/shared';
import type { OrderLineQty, PlannerInput, PlannerOrder } from '../../types';

// Test and benchmark fixture only. Reconstruct spec 008's db/demo-day.ts rules from the shared rows without
// importing the seed, its database client, config or clock. Source totals are asserted independently of the
// planner's allocation snapshot. Neither this helper nor shared.ts belongs to the production import graph.
const DATE = '2026-06-25';
const DEPOT = 'Peliyagoda';
const workshop: Record<string, readonly string[]> = {
  VEH003: ['2026-06-23', '2026-06-24', DATE],
  VEH005: ['2026-06-24', DATE],
  VEH036: [DATE],
};
type SeedLine = [productId: string, quantity: number];
export interface DemoFuelRow { date: string; vehicleId: string; litres: number }

// Same SHA-1 UUID layout as demoId, using the global Web Crypto API so this fixture stays within the
// planning import boundary. Fixture loading (including hashes) is outside all benchmark measurements.
async function orderId(date: string, outletId: string, temp: 'dry' | 'chilled'): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`order:${date}:${outletId}:${temp}`));
  const bytes = new Uint8Array(hash).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function demoFixture(): Promise<{ input: PlannerInput; fuelHistory: DemoFuelRow[] }> {
  const { plan: _plan, ...shared } = structuredClone(inputFor(DEPOT));
  const orders: Promise<PlannerOrder>[] = [];
  const place = (outletId: string, temp: 'dry' | 'chilled', lines: SeedLine[], deliveryDate = DATE, timesDeferred = 0) => {
    orders.push(orderId(deliveryDate, outletId, temp).then((id) => ({
      id, outletId, deliveryDate, timesDeferred, splitFrom: null,
      lines: lines.map(([productId, quantity]): OrderLineQty => ({ productId, quantity })),
    })));
  };

  for (const shop of shared.outlets.filter((s) => s.depotId === DEPOT)) {
    const n = Number(shop.id.slice(3));
    // OUT001 has two unplaced drafts. Its carried-over chilled order is added separately below.
    if (shop.brand === 'Fresh' && shop.id !== 'OUT001') {
      place(shop.id, 'dry', [['fresh-dry-carton', 45 + ((11 * n) % 21)]]);
      if (![0, 4, 7].includes(n % 10)) place(shop.id, 'chilled', [['fresh-chilled-carton', 38 + ((5 * n) % 23)]]);
    }
    if (shop.brand === 'Style' && n % 5 !== 0) {
      place(shop.id, 'dry', shop.id === 'OUT017'
        ? [['style-folded', 50], ['style-hanging', 45], ['style-shoes', 25], ['style-bags', 15]]
        : [['style-folded', 10 + ((4 * n) % 9)], ['style-hanging', 6 + ((5 * n) % 7)], ['style-shoes', 4 + (n % 6)], ['style-bags', 3 + (n % 4)]]);
    }
  }
  place('OUT022', 'dry', [['tech-tv', 2], ['tech-small', 1]]);
  place('OUT039', 'dry', [['tech-fridge', 3]]);
  place('OUT058', 'dry', [['tech-washer', 2], ['tech-small', 2]]);
  place('OUT072', 'dry', [['tech-washer', 1]]);
  place('OUT001', 'chilled', [['fresh-chilled-carton', 12]], '2026-06-24', 1);
  place('OUT030', 'chilled', [['fresh-chilled-carton', 50]], '2026-06-24', 1);
  place('OUT054', 'chilled', [['fresh-chilled-carton', 55]], '2026-06-24', 1);
  place('OUT060', 'chilled', [['fresh-chilled-carton', 39]], '2026-06-23', 2);

  const fuelHistory: DemoFuelRow[] = [];
  const vehicles = shared.vehicles.filter((v) => v.depotId === DEPOT).map((vehicle) => {
    const n = Number(vehicle.id.slice(3));
    const litres = vehicle.id === 'VEH001' ? 100 : Math.floor(vehicle.weeklyFuelQuotaL * (9 + ((5 * n) % 8)) / 100);
    const rows = ['2026-06-22', '2026-06-23', '2026-06-24']
      .filter((date) => !workshop[vehicle.id]?.includes(date))
      .map((date) => ({ date, vehicleId: vehicle.id, litres }));
    fuelHistory.push(...rows);
    return { ...vehicle, available: !workshop[vehicle.id]?.includes(DATE), litresUsedThisWeek: rows.reduce((sum, row) => sum + row.litres, 0) };
  });
  return { input: { ...shared, date: DATE, vehicles, orders: await Promise.all(orders) }, fuelHistory };
}

// Fixed larger case: cycle the same 102-order seed in seed order, retaining quantities, outlet, product and
// history; give every copy a fresh deterministic ID. Fleet, availability, fuel and settings are unchanged.
export function threeHundredOrders(seed: PlannerInput): PlannerInput {
  const input = structuredClone(seed);
  input.orders = Array.from({ length: 300 }, (_, index) => ({
    ...structuredClone(seed.orders[index % seed.orders.length]!), id: `benchmark-${String(index + 1).padStart(3, '0')}`,
  }));
  return input;
}
