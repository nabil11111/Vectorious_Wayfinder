import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { describe, expect, it, vi } from 'vitest';
import * as checker from '../check';
import { checkPlan } from '../check';
import { computeLoad } from '../load';
import type { EngineOrder, PlannerInput, PlannerOrder, PlannerResult } from '../types';
import { buildSuggestedPlan } from './build';
import { prepareInput } from './priority';
import { demoFixture, kandyFixture, threeHundredOrders } from './testing/demo';

const quantities = (orders: EngineOrder[]) => {
  const totals = new Map<string, number>();
  for (const order of orders) for (const line of order.lines) {
    totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.quantity);
  }
  return [...totals].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
};
const conserveOriginals = (input: PlannerInput, result: Exclude<PlannerResult, { status: 'unavailable' }>) => {
  const byId = new Map(result.input.orders.map((order) => [order.id, order]));
  for (const original of input.orders) {
    const choice = result.choices.find((entry) => entry.orderId === original.id);
    expect(choice).toBeDefined();
    const children = choice!.resultOrderIds.map((id) => byId.get(id)!);
    expect(children.every((order) => order.outletId === original.outletId)).toBe(true);
    expect(quantities(children)).toEqual(quantities([original]));
  }
};
const freeze = (value: unknown): void => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
};
const shuffle = (input: PlannerInput): PlannerInput => {
  const copy = structuredClone(input);
  for (const key of ['orders', 'outlets', 'vehicles', 'products', 'travel', 'allowances'] as const) copy[key].reverse();
  copy.orders.forEach((order) => order.lines.reverse());
  return copy;
};

describe('the exact seeded planner day without a database', () => {
  it('AC-21 reconstructs the placed and waiting orders, real seed IDs, workshop and fuel history', async () => {
    const { input, fuelHistory } = await demoFixture();
    expect(input.date).toBe('2026-06-25');
    expect(input.depotId).toBe('Peliyagoda');
    expect(input.orders).toHaveLength(102);
    expect(input.orders.filter((o) => o.deliveryDate === input.date)).toHaveLength(98);
    expect(input.orders.find((o) => o.outletId === 'OUT002' && o.lines[0]?.productId === 'fresh-chilled-carton')?.id)
      .toBe('99ad1370-c157-54a8-a55e-ad41ae176e68');
    expect(input.orders.some((o) => o.outletId === 'OUT001' && o.deliveryDate === input.date)).toBe(false);
    expect(computeLoad(input.orders.flatMap((o) => o.lines), input.products)).toMatchObject({ units: 4942, kg: 39531, m3: 284.64 });
    const cold = input.orders.flatMap((o) => o.lines).filter((l) => l.productId === 'fresh-chilled-carton');
    expect(cold.reduce((sum, line) => sum + line.quantity, 0)).toBe(1825);
    expect(computeLoad(cold, input.products).m3).toBe(67.525);
    const working = input.vehicles.filter((v) => v.available && v.depotId === input.depotId);
    expect(working).toHaveLength(35);
    expect(input.vehicles.filter((v) => !v.available).map((v) => v.id)).toEqual(['VEH003', 'VEH005', 'VEH036']);
    expect(working.filter((v) => v.temp === 'reefer' && v.type === 'truck')).toHaveLength(5);
    expect(working.filter((v) => v.temp === 'reefer' && v.type === 'van')).toHaveLength(1);
    expect(working.filter((v) => v.temp === 'reefer').reduce((sum, v) => sum + v.volumeCapM3, 0)).toBeCloseTo(140.7, 8);
    expect(fuelHistory).toHaveLength(111);
    expect(fuelHistory.reduce((sum, row) => sum + row.litres, 0)).toBe(6945);
    const depotFleet = input.vehicles.filter((v) => v.depotId === input.depotId);
    expect(depotFleet.reduce((sum, v) => sum + v.weeklyFuelQuotaL, 0)).toBe(18600);
    expect(depotFleet.reduce((sum, v) => sum + v.litresUsedThisWeek, 0)).toBe(6945);
    expect(input.vehicles.find((v) => v.id === 'VEH001')?.litresUsedThisWeek).toBe(300);
    expect(prepareInput(input).orders.slice(0, 4).map((o) => [o.outletId, o.deliveryDate, o.timesDeferred])).toEqual([
      ['OUT060', '2026-06-23', 2], ['OUT001', '2026-06-24', 1], ['OUT054', '2026-06-24', 1], ['OUT030', '2026-06-24', 1],
    ]);
  });

  it('spec 020 reconstructs Kandy\'s seeded day: 64 orders by the same rules, none waiting, and 22 vehicles with a full fuel week', async () => {
    const { input } = await kandyFixture();
    expect([input.date, input.depotId]).toEqual(['2026-06-25', 'Kandy']);
    expect(input.orders).toHaveLength(64);
    expect(input.orders.every((o) => o.deliveryDate === input.date && o.timesDeferred === 0 && o.splitFrom === null)).toBe(true);
    // The seed's own totals (tests/demo-day.test.ts).
    expect(computeLoad(input.orders.flatMap((o) => o.lines), input.products)).toMatchObject({ units: 3025, kg: 24694.1, m3: 165.513 });
    // OUT076: 45 + (836 mod 21) = 62 dry cartons and 38 + (380 mod 23) = 50 chilled ones, under the seed's ids.
    expect(input.orders.filter((o) => o.outletId === 'OUT076').map((o) => [o.id, o.lines])).toEqual([
      ['d503f849-bc1c-5b87-bbe6-b7370452bd5d', [{ productId: 'fresh-dry-carton', quantity: 62 }]],
      ['21756f46-df43-53ca-b243-a31e015300e7', [{ productId: 'fresh-chilled-carton', quantity: 50 }]],
    ]);
    expect(input.vehicles).toHaveLength(22);
    expect(input.vehicles.every((v) => v.depotId === 'Kandy' && v.available && v.litresUsedThisWeek === 0)).toBe(true);
    expect(buildSuggestedPlan(input).status).not.toBe('unavailable');
  });

  it('AC-21 returns a valid plan with every seeded unit accounted for exactly once', async () => {
    const { input } = await demoFixture();
    const result = buildSuggestedPlan(input);
    expect(result.status).not.toBe('unavailable');
    if (result.status === 'unavailable') throw new Error('Expected a checked seeded-day suggestion');
    expect(result.check.ok).toBe(true);
    expect(result.check).toEqual(checkPlan(result.input));
    expect(computeLoad(result.input.orders.flatMap((o) => o.lines), input.products))
      .toEqual(computeLoad(input.orders.flatMap((o) => o.lines), input.products));
    expect(quantities(result.input.orders)).toEqual(quantities(input.orders));
    conserveOriginals(input, result);
    const assigned = result.input.plan.trips.flatMap((t) => t.stops.flatMap((s) => s.orderIds));
    const deferred = result.input.plan.deferrals.map((d) => d.orderId);
    expect([...assigned, ...deferred].sort()).toEqual(result.input.orders.map((o) => o.id).sort());
    expect(new Set([...assigned, ...deferred]).size).toBe(result.input.orders.length);
    expect(result.choices).toHaveLength(102);
    const servedIds = new Set(assigned);
    const servedOrders = result.input.orders.filter((o) => servedIds.has(o.id));
    const deferredOrders = result.input.orders.filter((o) => !servedIds.has(o.id));
    expect(deferredOrders).toHaveLength(6);
    // Pin the measured outcome, not a forecast based on aggregate fridge capacity. Exact stop order, trip
    // numbering, explicit leaving changes, order references, splits and reason text are all reviewable.
    expect({
      status: result.status,
      totals: {
        trips: result.input.plan.trips.length, splits: result.splits.length,
        served: { orders: servedOrders.length, ...computeLoad(servedOrders.flatMap((o) => o.lines), input.products) },
        deferred: { orders: deferredOrders.length, ...computeLoad(deferredOrders.flatMap((o) => o.lines), input.products) },
      },
      trips: result.input.plan.trips,
      splits: result.splits,
      deferrals: result.input.plan.deferrals,
      decisions: result.decisions,
    }).toMatchSnapshot();
  });

  it('AC-1/17 explains the seeded choices without IDs, ISO dates, units or search language', async () => {
    const { input } = await demoFixture();
    const result = buildSuggestedPlan(input);
    if (result.status === 'unavailable') throw new Error('Expected a checked seeded-day suggestion');
    const reasons = [...result.choices, ...result.decisions, ...result.input.plan.deferrals].map((entry) => entry.reason);
    for (const reason of reasons) {
      expect(reason).not.toMatch(/OUT\d{3}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{23}|\d{4}-\d{2}-\d{2}|\bunits\b|tested stop order|after earlier choices/);
      expect(reason.length).toBeLessThanOrEqual(200);
    }
    for (const deferral of result.input.plan.deferrals) {
      expect(deferral.reason).toBe(deferral.reason.trim());
      expect(deferral.reason.length).toBeGreaterThan(0);
      expect(deferral.reason.length).toBeLessThanOrEqual(200);
      expect(deferral.reason).toContain('Thursday');
      expect(deferral.reason.match(/[.!?](?:\s|$)/g)).toHaveLength(1);
    }
  });

  it('AC-17 keeps every reason within 200 characters and whole words on varied days made from Peliyagoda\'s and Kandy\'s seeded ones', async () => {
    // A fixed sample of days, Peliyagoda's and Kandy's by turns: some of the day's orders on a few of its working vehicles,
    // about a third of them waiting and larger, and every other pair of days a heavy one, a few waiting orders with lines
    // near the 999 a line can hold. So splits and refused remainders come up. On half the days drivers have long
    // three-part names, and on half the shops have the names the seed gives them, of up to 26 characters, where the
    // fixtures' ids leave a reason the shop's district, of up to 12.
    const seeded = [(await demoFixture()).input, (await kandyFixture()).input];
    const shopNames: { outlet_id: string; name: string }[] = parse(readFileSync(new URL('../../../../../data/fixtures/outlet-names.csv', import.meta.url)), { columns: true });
    const nameOf = new Map(shopNames.map((row) => [row.outlet_id, row.name]));
    // The multiplication is done in whole 32-bit numbers: as a plain product it runs past 2^53 and loses its last
    // digits, and the numbers then come round again every 10,466 draws or sooner.
    let seed = 7;
    const next = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 2147483648; };
    const some = <T>(rows: T[], n: number) => rows.map((row) => [next(), row] as const).sort(([a], [b]) => a - b).slice(0, n).map(([, row]) => row);
    const waiting = (order: PlannerOrder, nearCap: boolean): PlannerOrder => ({
      ...order, deliveryDate: '2026-06-24', timesDeferred: 1,
      lines: order.lines.map((line) => ({ ...line, quantity: nearCap ? 900 + Math.floor(next() * 100) : line.quantity * (2 + Math.floor(next() * 4)) })),
    });
    const names = ['Chaminda Kumara Wickramasinghe', 'Dilshan Pradeep Jayawardena', 'Lasantha Bandara Ekanayake', 'Priyantha Gamini Senanayake'];
    const reasons: { depot: string; reason: string }[] = [];
    for (let day = 0; day < 64; day += 1) {
      const seededDay = seeded[day % 2]!;
      const heavy = day % 4 >= 2;
      const input = next() < 0.5 ? { ...seededDay, outlets: seededDay.outlets.map((o) => ({ ...o, name: nameOf.get(o.id) ?? o.name })) } : seededDay;
      const fleet = some(input.vehicles.filter((v) => v.available), 2 + Math.floor(next() * 6));
      const withDrivers = next() < 0.5;
      const orders = heavy
        ? some(input.orders, 3 + Math.floor(next() * 6)).map((order) => waiting(order, true))
        : some(input.orders, 10 + Math.floor(next() * 40)).map((order) => (next() < 0.3 ? waiting(order, next() < 0.3) : order));
      const result = buildSuggestedPlan({ ...input, orders, vehicles: fleet.map((v, i) => (withDrivers ? { ...v, driverName: names[i % names.length]! } : v)) });
      if (result.status === 'unavailable') continue;
      reasons.push(...[...result.choices, ...result.decisions, ...result.input.plan.deferrals].map((entry) => ({ depot: input.depotId, reason: entry.reason })));
    }
    expect(reasons.filter((r) => r.depot === 'Peliyagoda').length).toBeGreaterThan(500);
    expect(reasons.filter((r) => r.depot === 'Kandy').length).toBeGreaterThan(500);
    for (const { reason } of reasons) {
      expect(reason.length, reason).toBeLessThanOrEqual(200);
      expect(reason, reason).not.toContain('…');
    }
    // The sample reaches every wording: shops' and drivers' names where they fit, the tight form where even kind and id
    // do not, and the tightest, with no deciding rule in brackets, where even the tight form does not.
    expect(reasons.some(({ reason }) => shopNames.some(({ name }) => reason.includes(name)))).toBe(true);
    expect(reasons.some(({ reason }) => names.some((name) => reason.includes(`${name}'s `)))).toBe(true);
    expect(reasons.some(({ reason }) => / wait: reached at /.test(reason))).toBe(true);
    expect(reasons.some(({ reason }) => /; \d+ (?:cartons|boxes|items) (?:on|joined) (?:dry truck|reefer truck|reefer van|van) VEH\d{3}(?:'s second trip)?(?:;|$)/.test(reason))).toBe(true);
  });

  it('AC-17 keeps the three longest reasons the sweeps found within 200 characters, the limit before the load', async () => {
    // Kandy days at 201 characters even at the tightest wording, cut down to the orders that shape them: two remainders
    // refused for weight on a Kegalle split, and the same at rank 103, behind 100 orders of 999 fridges that wait since
    // Monday, are divided already and so are refused whole. The last wording says the limit first and the load after it,
    // which keeps every fact in four fewer characters.
    const { input: kandy } = await kandyFixture();
    type Line = [productId: string, quantity: number];
    const day = (vehicles: [id: string, driverName?: string][], orders: [outletId: string, lines: Line[], wantedFor: string, timesDeferred: number][]): PlannerInput => ({
      ...kandy,
      vehicles: vehicles.map(([id, driverName]) => ({ ...kandy.vehicles.find((v) => v.id === id)!, ...(driverName ? { driverName } : {}) })),
      orders: orders.map(([outletId, lines, deliveryDate, timesDeferred]) => ({
        ...kandy.orders.find((o) => o.outletId === outletId && o.lines[0]!.productId === lines[0]![0])!,
        deliveryDate, timesDeferred, lines: lines.map(([productId, quantity]) => ({ productId, quantity })),
      })),
    });
    const reasonFor = (input: PlannerInput, outletId: string) => {
      const result = buildSuggestedPlan(input);
      if (result.status === 'unavailable') throw new Error('Expected a checked suggestion');
      const order = input.orders.find((o) => o.outletId === outletId && o.lines[0]!.productId === 'fresh-chilled-carton')!;
      return result.choices.find((choice) => choice.orderId === order.id)!.reason;
    };
    const chilled = (outletId: string, cartons: number, wantedFor: string, timesDeferred: number) =>
      [outletId, [['fresh-chilled-carton', cartons]], wantedFor, timesDeferred] as [string, Line[], string, number];
    const dry = (outletId: string, cartons: number, wantedFor: string, timesDeferred: number) =>
      [outletId, [['fresh-dry-carton', cartons]], wantedFor, timesDeferred] as [string, Line[], string, number];

    const first = reasonFor(day([['VEH041'], ['VEH039']], [
      dry('OUT080', 384, '2026-06-23', 2), chilled('OUT086', 216, '2026-06-24', 2), chilled('OUT081', 947, '2026-06-24', 2),
      chilled('OUT101', 977, '2026-06-23', 1), chilled('OUT118', 941, '2026-06-23', 2), chilled('OUT079', 210, '2026-06-24', 2),
      ['OUT091', [['style-folded', 70], ['style-hanging', 42], ['style-shoes', 25], ['style-bags', 12]], '2026-06-23', 2],
      chilled('OUT119', 991, '2026-06-24', 2), ['OUT093', [['tech-tv', 912], ['tech-small', 920]], '2026-06-23', 2],
      chilled('OUT078', 360, '2026-06-24', 1), chilled('OUT076', 976, '2026-06-24', 1), chilled('OUT105', 990, '2026-06-24', 1),
    ]), 'OUT119');
    expect(first).toBe('Rank 12: waited since Wed; chilled; Kegalle by 07:59; 390 cartons joined reefer truck VEH041\'s second trip; 601 wait: Reefer truck VEH039 over its 6,180 kg limit with 9,722.1 kg on its second trip.');

    const second = reasonFor(day([['VEH047', 'Chaminda Kumara Wickramasinghe'], ['VEH039', 'Lasantha Bandara Ekanayake'], ['VEH043', 'Chaminda Kumara Wickramasinghe']], [
      chilled('OUT105', 985, '2026-06-24', 1), dry('OUT086', 92, '2026-06-23', 1), chilled('OUT119', 948, '2026-06-24', 1),
      chilled('OUT079', 210, '2026-06-24', 1), chilled('OUT085', 933, '2026-06-24', 2), chilled('OUT076', 995, '2026-06-24', 2),
      chilled('OUT112', 230, '2026-06-24', 1), chilled('OUT108', 343, '2026-06-24', 2), chilled('OUT118', 957, '2026-06-24', 1),
      dry('OUT112', 177, '2026-06-23', 2),
    ]), 'OUT119');
    expect(second).toBe('Rank 10: waited since Wed; chilled; Kegalle by 07:59; 564 cartons joined reefer truck VEH043\'s second trip; 384 wait: Reefer truck VEH039 over its 6,180 kg limit with 8,224.8 kg on its second trip.');

    const tech = ['OUT093', 'OUT094', 'OUT095', 'OUT103', 'OUT115'];
    const behind = day([['VEH040'], ['VEH058']], [chilled('OUT101', 120, '2026-06-24', 1), chilled('OUT108', 978, '2026-06-24', 1), chilled('OUT083', 996, '2026-06-24', 1)]);
    behind.orders.unshift(...Array.from({ length: 100 }, (_, i) => ({
      id: `ahead-${i + 1}`, outletId: tech[i % tech.length]!, deliveryDate: '2026-06-22', timesDeferred: 3, splitFrom: `ahead-parent-${i + 1}`,
      lines: [{ productId: 'tech-fridge', quantity: 999 }],
    })));
    expect(reasonFor(behind, 'OUT108')).toBe('Rank 103: waited since Wed; chilled; Nuwara Eliya by 07:45; 150 cartons on reefer van VEH058\'s second trip; 828 wait: Reefer truck VEH040 over its 5,510 kg limit with 5,713.2 kg on its second trip.');
    for (const reason of [first, second, reasonFor(behind, 'OUT108')]) expect(reason.length).toBeLessThanOrEqual(200);
  });

  it('AC-17 says fridge truck in every seeded chilled deferral', async () => {
    // Each of these shops also gets its dry cartons from a truck before 08:00 on this plan, so only the
    // fridge vehicles the search tried make the sentence true.
    const { input } = await demoFixture();
    const result = buildSuggestedPlan(input);
    if (result.status === 'unavailable') throw new Error('Expected a checked seeded-day suggestion');
    const orderOf = new Map(result.input.orders.map((order) => [order.id, order]));
    const chilled = result.input.plan.deferrals.filter((d) => computeLoad(orderOf.get(d.orderId)!.lines, input.products).needsReefer);
    expect(chilled).toHaveLength(6);
    for (const deferral of chilled) expect(deferral.reason).toContain('fridge truck');
  });

  it('AC-1/21 pins every seeded explanation', async () => {
    const { input } = await demoFixture();
    const result = buildSuggestedPlan(input);
    if (result.status === 'unavailable') throw new Error('Expected a checked seeded-day suggestion');
    expect(result.choices.map((choice) => choice.reason)).toMatchSnapshot();
  });

  it('AC-22 bounds the checker runs of the seeded search', async () => {
    // Each placed order needs only its winner and the runner-up that names the deciding rule. Trying every
    // candidate took 2,471 checker runs here and stopping after those two takes 305. Trying a stop that misses its
    // window at the trip's other places (AC-7), freeing a run for the six waiting orders (AC-23) and trying each of
    // them alone for its sentence (AC-17) bring it to 390: one search of each run's moves serves every waiting order
    // while the plan is unchanged. The bound leaves room for small changes but fails if the search goes back to
    // trying every candidate.
    const { input } = await demoFixture();
    const runs = vi.spyOn(checker, 'checkPlan');
    try {
      buildSuggestedPlan(input);
      expect(runs.mock.calls.length).toBeLessThanOrEqual(400);
    } finally {
      runs.mockRestore();
    }
  });

  it('AC-20/21 repeats the exact result with frozen inputs and shuffled seed rows and lines', async () => {
    const { input } = await demoFixture();
    const before = structuredClone(input);
    freeze(input);
    const result = buildSuggestedPlan(input);
    expect(buildSuggestedPlan(input)).toEqual(result);
    expect(buildSuggestedPlan(shuffle(input))).toEqual(result);
    expect(input).toEqual(before);
  });

  it('AC-22 uses a fixed 300-order case with fresh IDs and the same fleet and conserves it', async () => {
    const { input: seed } = await demoFixture();
    const input = threeHundredOrders(seed);
    expect(input.orders).toHaveLength(300);
    expect(new Set(input.orders.map((o) => o.id)).size).toBe(300);
    expect(input.vehicles).toEqual(seed.vehicles);
    expect(input.orders[102]).toEqual({ ...seed.orders[0], id: 'benchmark-103' });
    const result = buildSuggestedPlan(input);
    expect(result.status).not.toBe('unavailable');
    if (result.status === 'unavailable') throw new Error('Expected a checked 300-order suggestion');
    expect(result.check.ok).toBe(true);
    expect(result.input.orders.length).toBeLessThanOrEqual(300);
    expect(quantities(result.input.orders)).toEqual(quantities(input.orders));
    conserveOriginals(input, result);
    const allIds = [
      ...result.input.plan.trips.flatMap((trip) => trip.stops.flatMap((stop) => stop.orderIds)),
      ...result.input.plan.deferrals.map((deferral) => deferral.orderId),
    ];
    expect(new Set(allIds).size).toBe(result.input.orders.length);
    expect(allIds.sort()).toEqual(result.input.orders.map((o) => o.id).sort());
    expect({
      status: result.status,
      effectiveOrders: result.input.orders.length,
      trips: result.input.plan.trips.length,
      splits: result.splits.length,
      served: result.input.plan.trips.flatMap((trip) => trip.stops.flatMap((stop) => stop.orderIds)).length,
      deferred: result.input.plan.deferrals.length,
      reasons: result.input.plan.deferrals.reduce<Record<string, number>>((counts, deferral) => {
        counts[deferral.code] = (counts[deferral.code] ?? 0) + 1;
        return counts;
      }, {}),
    }).toMatchSnapshot();
  });
});
