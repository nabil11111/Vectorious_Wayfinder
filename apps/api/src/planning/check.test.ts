import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { levelOf, PlanCheck, Problem, type StopTime } from '@wayfinder/contracts';
import { describe, expect, it } from 'vitest';
import { checkPlan } from './check';
import { PlanInputError } from './errors';
import { inputFor, order, outlets, vehicles } from './testing/shared';
import type { EngineOrder, EngineVehicle, PlanInput, PlanTrip } from './types';
import { toMinutes as at } from './words';

// One trip with a stop for each order, in the order given.
const tripOf = (vehicleId: string, tripNo: number, orders: EngineOrder[], leaveAt?: number): PlanTrip =>
  ({ vehicleId, tripNo, ...(leaveAt === undefined ? {} : { leaveAt }), stops: orders.map((o) => ({ outletId: o.outletId, orderIds: [o.id] })) });
const dry = (id: string, outletId: string, cartons = 48) => order(id, outletId, 'fresh-dry-carton', cartons);
const chilled = (id: string, outletId: string, cartons: number) => order(id, outletId, 'fresh-chilled-carton', cartons);
// The fleet with some vehicles changed.
const fleet = (changes: Record<string, Partial<EngineVehicle>>) => vehicles.map((v) => ({ ...v, ...changes[v.id] }));

// The chained day of the spec: dry truck VEH012 runs a Gampaha trip and then a Colombo trip, with 48 dry
// cartons ordered at each of its seven stops.
const gampahaOrders = ['OUT026', 'OUT030', 'OUT028'].map((shop) => dry(`order-${shop}`, shop));
const colomboOrders = ['OUT006', 'OUT004', 'OUT007', 'OUT014'].map((shop) => dry(`order-${shop}`, shop));
const chainedDay = () => inputFor('Peliyagoda', {
  orders: [...gampahaOrders, ...colomboOrders],
  trips: [tripOf('VEH012', 1, gampahaOrders), tripOf('VEH012', 2, colomboOrders)],
});

// One plan that goes wrong in many ways at once, with the shops given names so a sentence that says an id
// shows up. It is a day that does not operate, VEH008 is off and VEH035 has 2 litres of its week left.
//   VEH035 trip 1   three chilled orders of 60 cartons, 1,242 kg on a 1,040 kg van
//   VEH012 trip 1   a chilled order on this dry truck, then a van-only shop with far too many dry cartons
//   VEH012 trip 2   set to leave at 05:00, before the truck is back and reloaded at 06:10
//   VEH008 trip 1   a Style shop and a Tech shop together
//   and one order on no trip, and one deferred with no proper reason
const messyPlan = (): PlanInput => {
  const van = [chilled('order-1', 'OUT004', 60), chilled('order-2', 'OUT006', 60), chilled('order-3', 'OUT007', 60)];
  const truck = [chilled('order-4', 'OUT005', 40), dry('order-5', 'OUT001', 700)];
  const second = [dry('order-10', 'OUT028')];
  const mixed = [order('order-6', 'OUT019', 'style-folded', 10), order('order-7', 'OUT024', 'tech-tv', 2)];
  const leftOut = dry('order-8', 'OUT026');
  const deferred = dry('order-9', 'OUT030');
  return inputFor('Peliyagoda', {
    operatingDay: false,
    outlets: outlets.map((o) => ({ ...o, name: `${o.brand} shop ${Number(o.id.slice(3))}` })),
    vehicles: fleet({ VEH008: { available: false }, VEH035: { litresUsedThisWeek: 478 } }),
    orders: [...van, ...truck, ...second, ...mixed, leftOut, deferred],
    // Listed out of order on purpose: the result is sorted, whatever order the plan comes in.
    trips: [tripOf('VEH012', 2, second, at('05:00')), tripOf('VEH035', 1, van), tripOf('VEH008', 1, mixed), tripOf('VEH012', 1, truck)],
    deferrals: [{ orderId: 'order-9', code: 'because', reason: ' ' }],
  });
};

describe('the plan checker', () => {
  it('AC-40 returns ok when no problem is a block, so warnings never stop a plan', () => {
    // Set to leave at 03:30 for a shop that opens at 05:00, the truck waits 66 minutes. That is only a warning.
    const waiting = [dry('order-a', 'OUT008')];
    const warned = checkPlan(inputFor('Peliyagoda', { orders: waiting, trips: [tripOf('VEH012', 1, waiting, at('03:30'))] }));
    expect(warned.problems.map((p) => [p.code, p.level])).toEqual([['long_wait', 'warn']]);
    expect(warned.ok).toBe(true);

    // A chilled order on a dry truck is a block, and one block is enough.
    const cold = [chilled('order-b', 'OUT008', 40)];
    const blocked = checkPlan(inputFor('Peliyagoda', { orders: cold, trips: [tripOf('VEH012', 1, cold, at('03:30'))] }));
    expect(blocked.problems.map((p) => [p.code, p.level])).toEqual([['needs_reefer', 'block'], ['long_wait', 'warn']]);
    expect(blocked.ok).toBe(false);

    // Nothing to say is ok too.
    expect(checkPlan(inputFor('Peliyagoda'))).toMatchObject({ ok: true, problems: [] });
  });

  it('AC-41 gives every problem its code, its level, one plain sentence and what it is about', () => {
    const { problems } = checkPlan(messyPlan());
    expect(problems).toHaveLength(13);
    for (const problem of problems) {
      // Exactly the fields of the shape, so nothing else reaches a screen.
      expect(Problem.parse(problem)).toEqual(problem);
      expect(problem.level).toBe(levelOf(problem.code));
      // One sentence: it ends with a full stop and has no other sentence end inside it.
      expect(problem.message).toMatch(/^[A-Z].*\.$/);
      expect(problem.message.slice(0, -1)).not.toMatch(/[.!?]\s/);
      for (const text of [problem.message, problem.fix ?? '']) {
        // Plain words: no code, no shop id and no order id. A shop is called by its name.
        expect(text).not.toMatch(/_|OUT\d|order-\d/);
      }
      // Every problem names what it is about, except the one about the whole day.
      const about = [problem.vehicleId, problem.tripNo, problem.stopSeq, problem.outletId, problem.orderId].filter((x) => x !== undefined);
      if (problem.code === 'not_operating_day') expect(about).toEqual([]);
      else expect(about.length).toBeGreaterThan(0);
    }
    // The numbers are in the sentence, and the shop is there by name.
    expect(problems.find((p) => p.code === 'over_weight' && p.vehicleId === 'VEH035')).toMatchObject({
      tripNo: 1, message: 'The reefer van VEH035 carries 1,242 kg, 202 kg over its 1,040 kg limit.', fix: 'Take 202 kg off this trip.',
    });
    expect(problems.find((p) => p.code === 'van_only')).toMatchObject({
      vehicleId: 'VEH012', tripNo: 1, stopSeq: 2, outletId: 'OUT001',
      message: 'Fresh shop 1 only takes vans, and it is on the dry truck VEH012.', fix: 'Move it to a van.',
    });
    expect(problems.find((p) => p.code === 'needs_reefer')).toMatchObject({
      vehicleId: 'VEH012', tripNo: 1, stopSeq: 1, outletId: 'OUT005', orderId: 'order-4',
      message: 'The 276 kg chilled order for Fresh shop 5 needs a fridge, and it is on the dry truck VEH012.', fix: 'Move it to a reefer truck or van.',
    });
    expect(problems.find((p) => p.code === 'order_not_planned')).toMatchObject({
      orderId: 'order-8', outletId: 'OUT026', message: 'The 331.2 kg dry order for Fresh shop 26 is on no trip and is not deferred.',
    });
  });

  it('AC-42 returns each trip\'s load, times, kilometres and litres and each vehicle\'s minutes and litres, and an untimed trip always carries a block', () => {
    // Three trips that cannot be timed, each for its own reason, beside one that can.
    const timed = [dry('order-a', 'OUT005')];
    const twoDistricts = [dry('order-b', 'OUT026'), dry('order-c', 'OUT006')];
    const noDrive = [dry('order-d', 'OUT084')];
    const input = inputFor('Peliyagoda', {
      orders: [...timed, ...twoDistricts, ...noDrive],
      trips: [tripOf('VEH012', 1, timed), tripOf('VEH010', 1, twoDistricts), tripOf('VEH008', 1, noDrive), tripOf('VEH009', 1, [])],
    });
    const result = checkPlan(input);
    // Exactly the fields of the shape, so nothing else reaches a screen.
    expect(PlanCheck.parse(result)).toEqual(result);

    // A trip for every trip of the plan, by vehicle and then by trip number, each with its load.
    expect(result.trips.map((t) => [t.vehicleId, t.tripNo, t.load.kg, t.times === null])).toEqual([
      ['VEH008', 1, 331.2, true], ['VEH009', 1, 0, true], ['VEH010', 1, 662.4, true], ['VEH012', 1, 331.2, false],
    ]);
    // OUT005 opens at 04:00 and Colombo is 24 minutes and 12 km away: there and back is 24 km, 3.5 litres.
    expect(result.trips[3]!.times).toMatchObject({ district: 'Colombo', leaveAt: at('03:36'), lastDoneAt: at('04:15'), backAt: at('04:39'), tripMin: 39, km: 24, litres: 3.5 });

    // Each untimed trip has its block and nothing from the rules that need times, and the plan is not ok.
    const codesOf = (vehicleId: string) => result.problems.filter((p) => p.vehicleId === vehicleId).map((p) => p.code);
    expect(codesOf('VEH008')).toEqual(['wrong_depot', 'no_travel_data']);
    expect(codesOf('VEH009')).toEqual(['empty_trip']);
    expect(codesOf('VEH010')).toEqual(['cross_district']);
    expect(codesOf('VEH012')).toEqual([]);
    expect(result.ok).toBe(false);

    // Every vehicle of the input has its line, also the ones the plan does not drive, so any truck's fuel left
    // can be shown. An untimed trip is not driven, so it uses no minutes and no litres.
    expect(result.vehicles.map((v) => v.vehicleId)).toEqual(vehicles.map((v) => v.id));
    const lineOf = (vehicleId: string) => result.vehicles.find((v) => v.vehicleId === vehicleId);
    expect(lineOf('VEH012')).toEqual({ vehicleId: 'VEH012', freshMin: 39, styleTechMin: 0, litresBefore: 0, litresPlan: 3.5, litresLeft: 536.5, quotaL: 540 });
    expect(lineOf('VEH010')).toEqual({ vehicleId: 'VEH010', freshMin: 0, styleTechMin: 0, litresBefore: 0, litresPlan: 0, litresLeft: 540, quotaL: 540 });
    expect(lineOf('VEH006')).toEqual({ vehicleId: 'VEH006', freshMin: 0, styleTechMin: 0, litresBefore: 0, litresPlan: 0, litresLeft: 380, quotaL: 380 });

    // A vehicle the plan does not drive is not judged, even one that is off and past its quota already.
    const parked = checkPlan({ ...input, vehicles: fleet({ VEH006: { available: false, litresUsedThisWeek: 400 } }) });
    expect(parked.problems).toEqual(result.problems);
    expect(parked.vehicles.find((v) => v.vehicleId === 'VEH006')).toMatchObject({ litresBefore: 400, litresPlan: 0, litresLeft: -20 });
  });

  it('AC-43 puts blocks before warnings, and inside each by vehicle, trip and stop, with the wider problem after the narrower ones and the whole plan last', () => {
    const { problems, trips } = checkPlan(messyPlan());
    expect(problems.map((p) => [p.level, p.code, p.vehicleId ?? '', p.tripNo ?? '', p.stopSeq ?? ''])).toEqual([
      ['block', 'vehicle_off', 'VEH008', 1, ''],
      // A trip's stops in order, then what is about the whole trip, then the vehicle's next trip.
      ['block', 'needs_reefer', 'VEH012', 1, 1],
      ['block', 'van_only', 'VEH012', 1, 2],
      ['block', 'over_weight', 'VEH012', 1, ''],
      ['block', 'over_volume', 'VEH012', 1, ''],
      ['block', 'trips_overlap', 'VEH012', 2, ''],
      // What is about the whole vehicle comes after its trips.
      ['block', 'over_weight', 'VEH035', 1, ''],
      ['block', 'fuel_over_quota', 'VEH035', '', ''],
      // What is about the whole plan comes last.
      ['block', 'deferral_incomplete', '', '', ''],
      ['block', 'order_not_planned', '', '', ''],
      ['block', 'not_operating_day', '', '', ''],
      ['warn', 'mixed_brands', 'VEH008', 1, ''],
      ['warn', 'long_wait', 'VEH012', 1, 2],
    ]);
    // The trips come back in the same order, whatever order the plan listed them in.
    expect(trips.map((t) => [t.vehicleId, t.tripNo])).toEqual([['VEH008', 1], ['VEH012', 1], ['VEH012', 2], ['VEH035', 1]]);
  });

  it('AC-44 returns ok for the chained day, with its times, loads of 993.6 kg and 1,324.8 kg, and 15.6 litres', () => {
    const result = checkPlan(chainedDay());
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);

    // Every shop here opens well before the truck arrives, so nothing waits and unloading starts on arrival.
    const stop = (seq: number, outletId: string, arrive: string, leave: string, opens: string): StopTime =>
      ({ seq, outletId, arriveAt: at(arrive), waitMin: 0, startAt: at(arrive), leaveAt: at(leave), windowOpen: at(opens), windowClose: at('08:00'), late: false });
    const dryLoad = { needsReefer: false, needsTailLift: false, keepUpright: false };
    expect(result.trips).toEqual([
      {
        vehicleId: 'VEH012', tripNo: 1, load: { kg: 993.6, m3: 5.328, units: 144, ...dryLoad },
        times: {
          district: 'Gampaha', leaveAt: at('03:30'),
          stops: [stop(1, 'OUT026', '04:07', '04:22', '03:00'), stop(2, 'OUT030', '04:31', '04:46', '03:00'), stop(3, 'OUT028', '04:55', '05:11', '03:00')],
          lastDoneAt: at('05:11'), backAt: at('05:48'), readyAgainAt: at('06:18'), tripMin: 101, km: 70, litres: 10.3,
        },
      },
      {
        vehicleId: 'VEH012', tripNo: 2, load: { kg: 1324.8, m3: 7.104, units: 192, ...dryLoad },
        times: {
          district: 'Colombo', leaveAt: at('06:18'),
          stops: [
            stop(1, 'OUT006', '06:42', '06:58', '03:00'), stop(2, 'OUT004', '07:06', '07:22', '05:30'),
            stop(3, 'OUT007', '07:30', '07:46', '05:30'), stop(4, 'OUT014', '07:54', '08:10', '05:30'),
          ],
          lastDoneAt: at('08:10'), backAt: at('08:34'), readyAgainAt: at('09:04'), tripMin: 112, km: 36, litres: 5.3,
        },
      },
    ]);
    // 101 + 112 of the 270 Fresh minutes, and 106 km for 15.6 litres of its 540.
    expect(result.vehicles.find((v) => v.vehicleId === 'VEH012')).toEqual({ vehicleId: 'VEH012', freshMin: 213, styleTechMin: 0, litresBefore: 0, litresPlan: 15.6, litresLeft: 524.4, quotaL: 540 });
  });

  it('AC-45 throws an error that names a vehicle, shop or order the plan names and the input does not hold', () => {
    const orders = [dry('order-a', 'OUT005')];
    const missing: [string, () => unknown][] = [
      ['No vehicle VEH999', () => checkPlan(inputFor('Peliyagoda', { orders, trips: [tripOf('VEH999', 1, orders)] }))],
      ['No shop OUT999', () => checkPlan(inputFor('Peliyagoda', { orders, trips: [{ vehicleId: 'VEH012', tripNo: 1, stops: [{ outletId: 'OUT999', orderIds: ['order-a'] }] }] }))],
      ['No order order-z', () => checkPlan(inputFor('Peliyagoda', { orders, trips: [{ vehicleId: 'VEH012', tripNo: 1, stops: [{ outletId: 'OUT005', orderIds: ['order-z'] }] }] }))],
      ['No order order-z', () => checkPlan(inputFor('Peliyagoda', { orders, deferrals: [{ orderId: 'order-z', code: 'fuel', reason: 'No fuel was left.' }] }))],
      // One of the day's orders is for a shop the input does not hold, or has a line for an item it does not.
      // Every order is checked, on a trip or not.
      ['No shop OUT999', () => checkPlan(inputFor('Peliyagoda', { orders: [dry('order-a', 'OUT999')] }))],
      ['No product shoes', () => checkPlan(inputFor('Peliyagoda', { orders: [order('order-a', 'OUT005', 'shoes', 3)] }))],
    ];
    for (const [named, plan] of missing) {
      expect(plan).toThrow(PlanInputError);
      expect(plan).toThrow(named);
    }
  });

  it('AC-46 says the same thing twice, leaves the input as it came, and no engine file reaches outside the folder', () => {
    for (const input of [chainedDay(), messyPlan()]) {
      const before = structuredClone(input);
      const first = checkPlan(input);
      expect(checkPlan(input)).toEqual(first);
      expect(input).toEqual(before);
    }

    // The engine is every file in this folder that is not a test or the test helper. It may import from the
    // folder itself and from the contracts, and from nowhere else: not the database, the config or the clock.
    const folder = path.dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(folder, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.startsWith(`testing${path.sep}`));
    expect(files).toContain('check.ts');
    expect(files).toContain(path.join('rules', 'time.ts'));
    const outside: string[] = [];
    for (const file of files) {
      const source = readFileSync(path.join(folder, file), 'utf8');
      for (const [, from] of source.matchAll(/(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        const inFolder = from!.startsWith('.') && !path.relative(folder, path.resolve(folder, path.dirname(file), from!)).startsWith('..');
        if (!inFolder && from !== '@wayfinder/contracts') outside.push(`${file} imports ${from}`);
      }
    }
    expect(outside).toEqual([]);
  });
});
