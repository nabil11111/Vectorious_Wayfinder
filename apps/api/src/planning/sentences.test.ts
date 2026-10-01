import { PROBLEM_CODES, type ProblemCode } from '@wayfinder/contracts';
import { describe, expect, it } from 'vitest';
import { checkPlan } from './check';
import { inputFor, order, outlets, vehicles } from './testing/shared';
import type { EngineOrder, EngineOutlet, EngineVehicle, PlanDeferral, PlanInput, PlanSettings, PlanTrip } from './types';
import { toMinutes as at } from './words';

// The plan checker in plain words (spec 024, AC-1): every sentence it writes, a problem's message and its fix, for
// every code and every way a code can be put. What is wrong comes first, a vehicle is its kind and id, and only a
// vehicle's second trip is numbered. The spec's worked examples are pinned word for word where the data can say them.

// The shops the spec's examples name, called by their names in data/fixtures/outlet-names.csv. Every other shop is
// called by its id, as in the other checker tests.
const NAMES: Record<string, string> = {
  OUT001: 'Fresh Nugegoda', OUT050: 'Fresh Hikkaduwa', OUT055: 'Fresh Koggala', OUT064: 'Tech Matara', OUT093: 'Tech Kadugannawa',
};
const named = outlets.map((o) => ({ ...o, name: NAMES[o.id] ?? o.id }));
// The shops with one of them changed, for what no shop in the data has.
const changed = (outletId: string, change: Partial<EngineOutlet>) => named.map((o) => (o.id === outletId ? { ...o, ...change } : o));
// The fleet with some vehicles changed.
const fleet = (changes: Record<string, Partial<EngineVehicle>>) => vehicles.map((v) => ({ ...v, ...changes[v.id] }));

// Every order the cases use, so a plan can find the ones on its trips.
const made = new Map<string, EngineOrder>();
const make = (o: EngineOrder) => {
  made.set(o.id, o);
  return o;
};
const dry = (id: string, outletId: string, cartons = 48) => make(order(id, outletId, 'fresh-dry-carton', cartons));
const chilled = (id: string, outletId: string, cartons = 40) => make(order(id, outletId, 'fresh-chilled-carton', cartons));
const folded = (id: string, outletId: string) => make(order(id, outletId, 'style-folded', 5));

// One trip with a stop for each order, in the order given.
const tripOf = (vehicleId: string, tripNo: number, orders: EngineOrder[], leaveAt?: string): PlanTrip =>
  ({ vehicleId, tripNo, ...(leaveAt === undefined ? {} : { leaveAt: at(leaveAt) }), stops: orders.map((o) => ({ outletId: o.outletId, orderIds: [o.id] })) });
// A trip from its stops, each written as the shop followed by the orders dropped there.
const stops = (vehicleId: string, tripNo: number, ...list: [outletId: string, ...orderIds: string[]][]): PlanTrip =>
  ({ vehicleId, tripNo, stops: list.map(([outletId, ...orderIds]) => ({ outletId, orderIds })) });
const deferral = (orderId: string, code = 'over_capacity', reason = 'No room left on a dry truck today.'): PlanDeferral => ({ orderId, code, reason });

type Parts = { orders?: EngineOrder[]; deferrals?: PlanDeferral[]; operatingDay?: boolean; settings?: Partial<PlanSettings>; vehicles?: EngineVehicle[]; outlets?: EngineOutlet[] };
const madeOrder = (id: string) => {
  const found = made.get(id);
  if (!found) throw new Error(`No order ${id} was made for this case`);
  return found;
};
// A plan whose day's orders are the ones on its trips, unless the case names them.
const plan = (depotId: string, trips: PlanTrip[], parts: Parts = {}): PlanInput => {
  const onTrips = [...new Set(trips.flatMap((trip) => trip.stops.flatMap((stop) => stop.orderIds)))].map(madeOrder);
  return inputFor(depotId, { outlets: named, orders: onTrips, ...parts, trips });
};

interface Words { message: string; fix?: string }
interface Case { code: ProblemCode; way: string; input: () => PlanInput; tripNo?: number; said: Words[] }

// What the checker says for one code, in its order: the message, and the fix when there is one.
const wordsOf = (input: PlanInput, code: ProblemCode, tripNo?: number): Words[] => checkPlan(input).problems
  .filter((problem) => problem.code === code && (tripNo === undefined || problem.tripNo === tripNo))
  .map(({ message, fix }) => (fix === undefined ? { message } : { message, fix }));

// ── What a vehicle carries ──────────────────────────────────────────────────────────────────────────────────────
const tvAtKadugannawa = make(order('tv-093', 'OUT093', 'tech-tv', 1));
const tvAtDigana = make(order('tv-095', 'OUT095', 'tech-tv', 1));
// 25 crates of refrigerators, 4 of washing machines, a pallet of televisions and one of small appliances: 7,450 kg.
const heavy = make({ id: 'heavy', outletId: 'OUT095', lines: [
  { productId: 'tech-fridge', quantity: 25 }, { productId: 'tech-washer', quantity: 4 }, { productId: 'tech-tv', quantity: 1 }, { productId: 'tech-small', quantity: 1 },
] });
// A crate of washing machines and a pallet of televisions for Tech Matara: 380 kg, and the crate needs a tail lift.
const washer = make({ id: 'washer', outletId: 'OUT064', lines: [{ productId: 'tech-washer', quantity: 1 }, { productId: 'tech-tv', quantity: 1 }] });
const rails = make(order('rails', 'OUT019', 'style-hanging', 80));
// 60 chilled cartons for each of four Colombo shops: three of them are 1,242 kg.
const vanFirst = chilled('van-005', 'OUT005', 60);
const vanLoad = ['OUT004', 'OUT006', 'OUT007'].map((shop) => chilled(`van-${shop}`, shop, 60));
// A Fresh shop and a Style shop, both in Colombo.
const freshAndStyle = [dry('fresh-004', 'OUT004'), folded('folded-019', 'OUT019')];

const cargo: Case[] = [
  {
    code: 'over_weight', way: 'the spec\'s example, VEH044 given the spec\'s 7,200 kg limit',
    input: () => plan('Kandy', [tripOf('VEH044', 1, [heavy])], { vehicles: fleet({ VEH044: { weightCapKg: 7200, volumeCapM3: 38 } }) }),
    said: [{ message: 'The dry truck VEH044 carries 7,450 kg, 250 kg over its 7,200 kg limit.', fix: 'Take 250 kg off this trip.' }],
  },
  {
    code: 'over_weight', way: 'on its second trip', tripNo: 2,
    input: () => plan('Peliyagoda', [tripOf('VEH035', 1, [vanFirst]), tripOf('VEH035', 2, vanLoad)]),
    said: [{ message: 'The reefer van VEH035 carries 1,242 kg on its second trip, 202 kg over its 1,040 kg limit.', fix: 'Take 202 kg off this trip.' }],
  },
  {
    code: 'over_volume', way: '80 rail boxes on a 22 m³ truck',
    input: () => plan('Peliyagoda', [tripOf('VEH008', 1, [rails])]),
    said: [{ message: 'The dry truck VEH008 carries 24 m³, 2 m³ over its 22 m³ limit.', fix: 'Take 2 m³ off this trip.' }],
  },
  {
    code: 'needs_reefer', way: 'the spec\'s example',
    input: () => plan('Peliyagoda', [tripOf('VEH044', 1, [chilled('cold-001', 'OUT001')])]),
    said: [{ message: 'The 276 kg chilled order for Fresh Nugegoda needs a fridge, and it is on the dry truck VEH044.', fix: 'Move it to a reefer truck or van.' }],
  },
  {
    code: 'needs_reefer', way: 'on a second trip',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, [dry('dry-006', 'OUT006')]), tripOf('VEH012', 2, [chilled('cold-005', 'OUT005')])]),
    said: [{ message: 'The 276 kg chilled order for OUT005 needs a fridge, and it is on the second trip of the dry truck VEH012.', fix: 'Move it to a reefer truck or van.' }],
  },
  {
    code: 'van_only', way: 'the spec\'s example',
    input: () => plan('Kandy', [tripOf('VEH044', 1, [tvAtKadugannawa])]),
    said: [{ message: 'Tech Kadugannawa only takes vans, and it is on the dry truck VEH044.', fix: 'Move it to a van.' }],
  },
  {
    code: 'van_only', way: 'on a second trip',
    input: () => plan('Kandy', [tripOf('VEH044', 1, [tvAtDigana]), tripOf('VEH044', 2, [tvAtKadugannawa])]),
    said: [{ message: 'Tech Kadugannawa only takes vans, and it is on the second trip of the dry truck VEH044.', fix: 'Move it to a van.' }],
  },
  {
    code: 'no_tail_lift', way: 'the spec\'s example on a dry van, which VEH037 is',
    input: () => plan('Peliyagoda', [tripOf('VEH037', 1, [washer])]),
    said: [{ message: 'The 380 kg dry order for Tech Matara needs a tail lift, and it is on the van VEH037; vans are taken to have no tail lift.', fix: 'Move it to a truck, or check how the shop unloads it.' }],
  },
  {
    // The spec's example calls VEH036 "the van", and in the data it is a fridge van.
    code: 'no_tail_lift', way: 'on a reefer van, which VEH036 is',
    input: () => plan('Peliyagoda', [tripOf('VEH036', 1, [washer])]),
    said: [{ message: 'The 380 kg dry order for Tech Matara needs a tail lift, and it is on the reefer van VEH036; vans are taken to have no tail lift.', fix: 'Move it to a truck, or check how the shop unloads it.' }],
  },
  {
    code: 'wrong_depot', way: 'a vehicle of another depot than the plan',
    input: () => plan('Peliyagoda', [tripOf('VEH059', 1, [dry('kandy-084', 'OUT084')])]),
    said: [{ message: 'The van VEH059 belongs to the Kandy depot, and it is in the Peliyagoda plan.', fix: 'Move this trip to a Peliyagoda vehicle.' }],
  },
  {
    code: 'wrong_depot', way: 'a vehicle of another depot than the plan, on its second trip', tripNo: 2,
    input: () => plan('Peliyagoda', [tripOf('VEH059', 1, [dry('kandy-084', 'OUT084')]), tripOf('VEH059', 2, [dry('kandy-086', 'OUT086')])]),
    said: [{ message: 'The van VEH059 belongs to the Kandy depot, and its second trip is in the Peliyagoda plan.', fix: 'Move this trip to a Peliyagoda vehicle.' }],
  },
  {
    code: 'wrong_depot', way: 'a shop of another depot than the vehicle',
    input: () => plan('Peliyagoda', [tripOf('VEH008', 1, [dry('kandy-084', 'OUT084')])]),
    said: [{ message: 'OUT084 belongs to the Kandy depot, and it is on the dry truck VEH008 from Peliyagoda.' }],
  },
  {
    code: 'mixed_brands', way: 'the spec\'s example',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, freshAndStyle)]),
    said: [{ message: 'The dry truck VEH012 has Fresh and Style shops on one trip.', fix: 'Split them, or turn on Mix brands.' }],
  },
  {
    code: 'mixed_brands', way: 'on its second trip',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, [dry('dry-026', 'OUT026')]), tripOf('VEH012', 2, freshAndStyle)]),
    said: [{ message: 'The dry truck VEH012 has Fresh and Style shops on its second trip.', fix: 'Split them, or turn on Mix brands.' }],
  },
];

// ── Every order accounted for ───────────────────────────────────────────────────────────────────────────────────
// 48 dry cartons for each of two Fresh shops in Colombo, and a chilled order for the first.
const a = dry('a', 'OUT004');
const b = dry('b', 'OUT006');
chilled('cold-004', 'OUT004');

const coverage: Case[] = [
  {
    code: 'order_not_planned', way: 'an order on no trip',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, [a])], { orders: [a, b] }),
    said: [{ message: 'The 331.2 kg dry order for OUT006 is on no trip and is not deferred.', fix: 'Put it on a trip or defer it with a reason.' }],
  },
  {
    code: 'order_twice', way: 'on two vehicles',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, [a]), tripOf('VEH008', 1, [a])]),
    said: [{ message: 'The 331.2 kg dry order for OUT004 is on the dry truck VEH012 at stop 1 and on the dry truck VEH008 at stop 1, and an order can be in the plan only once.', fix: 'Keep it in one place only.' }],
  },
  {
    code: 'order_twice', way: 'on a second trip and deferred',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, [b]), tripOf('VEH012', 2, [a])], { deferrals: [deferral('a')] }),
    said: [{ message: 'The 331.2 kg dry order for OUT004 is on the second trip of the dry truck VEH012 at stop 1 and deferred, and an order can be in the plan only once.', fix: 'Keep it in one place only.' }],
  },
  {
    code: 'order_twice', way: 'deferred twice',
    input: () => plan('Peliyagoda', [], { orders: [a], deferrals: [deferral('a'), deferral('a')] }),
    said: [{ message: 'The 331.2 kg dry order for OUT004 is deferred 2 times, and an order can be in the plan only once.', fix: 'Keep it in one place only.' }],
  },
  {
    code: 'deferral_incomplete', way: 'with no reason from the list',
    input: () => plan('Peliyagoda', [], { orders: [a], deferrals: [deferral('a', 'too_heavy')] }),
    said: [{ message: 'The 331.2 kg dry order for OUT004 is deferred without a reason from the list.', fix: 'Give it a reason from the list.' }],
  },
  {
    code: 'deferral_incomplete', way: 'with no written reason',
    input: () => plan('Peliyagoda', [], { orders: [a], deferrals: [deferral('a', 'over_capacity', ' ')] }),
    said: [{ message: 'The 331.2 kg dry order for OUT004 is deferred without a written reason.', fix: 'Give it a written reason.' }],
  },
  {
    code: 'deferral_incomplete', way: 'with neither',
    input: () => plan('Peliyagoda', [], { orders: [a], deferrals: [deferral('a', '', '')] }),
    said: [{ message: 'The 331.2 kg dry order for OUT004 is deferred without a reason from the list or a written reason.', fix: 'Give it a reason from the list and a written reason.' }],
  },
  {
    code: 'order_wrong_outlet', way: 'an order on the stop at another shop',
    input: () => plan('Peliyagoda', [stops('VEH012', 1, ['OUT006', 'b', 'a'])]),
    said: [{ message: 'The 331.2 kg dry order for OUT004 goes to OUT006 on the dry truck VEH012.', fix: 'Move it to a stop at OUT004.' }],
  },
  {
    code: 'empty_trip', way: 'a trip with no stops',
    input: () => plan('Peliyagoda', [stops('VEH012', 1)]),
    said: [{ message: 'The dry truck VEH012 has a trip with no stops.', fix: 'Add a stop or remove the trip.' }],
  },
  {
    code: 'empty_trip', way: 'a second trip with no stops',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, [a]), stops('VEH012', 2)]),
    said: [{ message: 'The second trip of the dry truck VEH012 has no stops.', fix: 'Add a stop or remove the trip.' }],
  },
  {
    code: 'empty_trip', way: 'a stop with no orders',
    input: () => plan('Peliyagoda', [stops('VEH012', 1, ['OUT004', 'a'], ['OUT006'])]),
    said: [{ message: 'OUT006 is a stop with no orders on the dry truck VEH012.', fix: 'Add its orders or take the stop off.' }],
  },
  {
    code: 'stop_repeated', way: 'one shop as two stops',
    input: () => plan('Peliyagoda', [stops('VEH003', 1, ['OUT004', 'a'], ['OUT006', 'b'], ['OUT004', 'cold-004'])]),
    said: [{ message: 'OUT004 is both stop 1 and stop 3 on the reefer truck VEH003.', fix: 'Put its orders on one stop.' }],
  },
];

// ── Time ────────────────────────────────────────────────────────────────────────────────────────────────────────
// Four Fresh shops in Badulla, 186 minutes from Kandy and 23 minutes apart.
const badulla = ['OUT110', 'OUT112', 'OUT111', 'OUT113'].map((shop) => dry(`badulla-${shop}`, shop));
// The chained day's first trip, to Gampaha, and its Colombo trip with OUT010, which closes at 07:30, last.
const gampaha = ['OUT026', 'OUT030', 'OUT028'].map((shop) => dry(`gampaha-${shop}`, shop));
const toOut010 = ['OUT006', 'OUT004', 'OUT007', 'OUT010'].map((shop) => dry(`colombo-${shop}`, shop));
// The Style trip: two mall shops in Colombo and then a shop with a rear dock.
const style = ['OUT015', 'OUT017', 'OUT019'].map((shop) => folded(`style-${shop}`, shop));
// Shops in three districts of Kandy's.
const atKandy = dry('kandy-086', 'OUT086');
const atMatale = dry('matale-097', 'OUT097');
const atNuwaraEliya = dry('nuwara-104', 'OUT104');

const time: Case[] = [
  {
    code: 'cross_district', way: 'the spec\'s example',
    input: () => plan('Kandy', [tripOf('VEH012', 1, [atKandy, atMatale])]),
    said: [{ message: 'The dry truck VEH012 goes to Kandy and Matale on one trip, and a trip stays in one district.', fix: 'Move the Matale stops to another trip.' }],
  },
  {
    code: 'cross_district', way: 'three districts',
    input: () => plan('Kandy', [tripOf('VEH044', 1, [atKandy, atMatale, atNuwaraEliya])]),
    said: [{ message: 'The dry truck VEH044 goes to Kandy, Matale and Nuwara Eliya on one trip, and a trip stays in one district.', fix: 'Move the Matale and Nuwara Eliya stops to other trips.' }],
  },
  {
    code: 'cross_district', way: 'on its second trip',
    input: () => plan('Kandy', [tripOf('VEH044', 1, [dry('kandy-087', 'OUT087')]), tripOf('VEH044', 2, [atKandy, atMatale])]),
    said: [{ message: 'The dry truck VEH044 goes to Kandy and Matale on its second trip, and a trip stays in one district.', fix: 'Move the Matale stops to another trip.' }],
  },
  {
    code: 'no_travel_data', way: 'a district with no drive from the plan\'s depot',
    input: () => plan('Peliyagoda', [tripOf('VEH008', 1, [dry('kandy-084', 'OUT084')])]),
    said: [{ message: 'There are no travel figures from the Peliyagoda depot to Kandy, and the dry truck VEH008 goes there.' }],
  },
  {
    code: 'no_travel_data', way: 'on a second trip',
    input: () => plan('Peliyagoda', [tripOf('VEH008', 1, [dry('dry-006', 'OUT006')]), tripOf('VEH008', 2, [dry('kandy-084', 'OUT084')])]),
    said: [{ message: 'There are no travel figures from the Peliyagoda depot to Kandy, and the second trip of the dry truck VEH008 goes there.' }],
  },
  {
    code: 'too_many_trips', way: 'more than two trips',
    input: () => plan('Peliyagoda', [
      tripOf('VEH012', 1, [dry('dry-006', 'OUT006')]), tripOf('VEH012', 2, [dry('dry-005', 'OUT005')]), tripOf('VEH012', 3, [dry('dry-011', 'OUT011')]),
    ]),
    said: [{ message: 'The dry truck VEH012 has 3 trips, and a vehicle runs at most two a day.' }],
  },
  {
    code: 'too_many_trips', way: 'two trips with one number',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, [dry('dry-006', 'OUT006')]), tripOf('VEH012', 1, [dry('dry-005', 'OUT005')])]),
    said: [{ message: 'The dry truck VEH012 has two trips numbered 1, and a vehicle\'s trips are numbered 1 and 2.' }],
  },
  {
    code: 'too_many_trips', way: 'a number other than 1 or 2',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 3, [dry('dry-006', 'OUT006')])]),
    said: [{ message: 'The dry truck VEH012 has a trip numbered 3, and a vehicle\'s trips are numbered 1 and 2.' }],
  },
  {
    // Gampaha and back with 30 minutes to reload: leaving at 06:11, the truck is ready again at 08:10.
    code: 'trips_overlap', way: 'the spec\'s example',
    input: () => plan('Peliyagoda', [tripOf('VEH001', 1, [chilled('cold-026', 'OUT026')], '06:11'), tripOf('VEH001', 2, [chilled('cold-006', 'OUT006')], '07:00')]),
    said: [{ message: 'The second trip of the reefer truck VEH001 leaves at 07:00, before it is back and reloaded at 08:10.', fix: 'Leave at 08:10 or later.' }],
  },
  {
    code: 'leaves_early', way: 'with a Fresh shop',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, [dry('dry-006', 'OUT006')], '03:29')]),
    said: [{ message: 'The dry truck VEH012 leaves at 03:29, and a trip with a Fresh shop normally leaves at 03:30 or later.' }],
  },
  {
    // OUT057 is a Style shop in Galle that opens at 09:00, 103 minutes from the depot.
    code: 'leaves_early', way: 'without a Fresh shop',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, [folded('style-057', 'OUT057')], '07:20')]),
    said: [{ message: 'The dry truck VEH012 leaves at 07:20, and a trip without a Fresh shop normally leaves at 07:30 or later.' }],
  },
  {
    code: 'leaves_early', way: 'on a second trip',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, [dry('dry-006', 'OUT006')]), tripOf('VEH012', 2, [folded('style-057', 'OUT057')], '07:00')]),
    said: [{ message: 'The second trip of the dry truck VEH012 leaves at 07:00, and a trip without a Fresh shop normally leaves at 07:30 or later.' }],
  },
  {
    // The spec's example has Fresh Koggala closing at 08:00. In the data it closes at 07:30, and a Fresh shop
    // reached at 08:05 is also told the booklet's rule.
    code: 'window_missed', way: 'the spec\'s example, with the data\'s window',
    input: () => plan('Peliyagoda', [tripOf('VEH006', 1, [chilled('koggala', 'OUT055')], '06:22')]),
    said: [{ message: 'Fresh Koggala is reached at 08:05 by the reefer truck VEH006, 35 minutes after its window closes at 07:30, and Fresh shops must be reached before 08:00.', fix: 'Leave by 05:47 to reach every stop in time.' }],
  },
  {
    code: 'window_missed', way: 'a minute after closing',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, [dry('dry-010', 'OUT010')], '07:07')]),
    said: [{ message: 'OUT010 is reached at 07:31 by the dry truck VEH012, 1 minute after its window closes at 07:30.', fix: 'Leave by 07:06 to reach every stop in time.' }],
  },
  {
    code: 'window_missed', way: 'a Fresh shop reached at 08:00, inside its window',
    input: () => plan('Kandy', [tripOf('VEH044', 1, badulla, '03:00')]),
    said: [{ message: 'OUT113 is reached at 08:00 by the dry truck VEH044, and Fresh shops must be reached before 08:00.', fix: 'Leave by 02:59 to reach every stop in time.' }],
  },
  {
    code: 'window_missed', way: 'on a second trip, with no earlier leaving time',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, gampaha), tripOf('VEH012', 2, toOut010)]),
    said: [{ message: 'OUT010 is reached at 07:54 by the second trip of the dry truck VEH012, 24 minutes after its window closes at 07:30.' }],
  },
  {
    code: 'window_missed', way: 'a window that opens after it closes',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, [style[2]!])], { outlets: changed('OUT019', { windowOpen: at('10:00'), windowClose: at('09:00') }) }),
    said: [{ message: 'OUT019\'s window opens at 10:00 and closes at 09:00, so the dry truck VEH012 can never reach it in time.' }],
  },
  {
    code: 'mall_slot_missed', way: 'after the mall slot',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, [style[1]!, style[0]!, style[2]!])]),
    said: [{ message: 'OUT015 is reached at 11:37 by the dry truck VEH012, 37 minutes after its mall slot of 09:00 to 11:00 ends.' }],
  },
  {
    code: 'mall_slot_missed', way: 'after the mall slot, with an earlier leaving time',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, style, '10:40')]),
    said: [{ message: 'OUT015 is reached at 11:04 by the dry truck VEH012, 4 minutes after its mall slot of 09:00 to 11:00 ends.', fix: 'Leave by 10:36 to reach every stop in time.' }],
  },
  {
    // No Fresh shop in the data is in a mall, so OUT017 is made one with a slot of 06:00 to 10:00.
    code: 'mall_slot_missed', way: 'a Fresh shop reached after its slot and after 08:00',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, [style[1]!], '09:46')], {
      outlets: changed('OUT017', { brand: 'Fresh', mallOpen: at('06:00'), mallClose: at('10:00'), windowOpen: at('06:00'), windowClose: at('10:00') }),
    }),
    said: [{ message: 'OUT017 is reached at 10:10 by the dry truck VEH012, 10 minutes after its mall slot of 06:00 to 10:00 ends, and Fresh shops must be reached before 08:00.', fix: 'Leave by 07:35 to reach every stop in time.' }],
  },
  {
    code: 'mall_slot_missed', way: 'a window that never meets the mall slot',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, [style[1]!])], { outlets: changed('OUT017', { windowOpen: at('09:00'), windowClose: at('10:00') }) }),
    said: [{ message: 'OUT017 takes deliveries from 09:00 to 10:00 and its mall slot is 10:30 to 12:30, so the dry truck VEH012 can never reach it in time.' }],
  },
  {
    // A wait of 15 minutes is long only with the setting lowered (D-19).
    code: 'long_wait', way: 'the spec\'s example',
    input: () => plan('Peliyagoda', [tripOf('VEH006', 1, [chilled('hikkaduwa', 'OUT050')], '03:32')], { settings: { waitWarnMin: 10 } }),
    said: [{ message: 'Fresh Hikkaduwa is reached at 05:15 by the reefer truck VEH006 and waits 15 minutes for its window to open at 05:30.', fix: 'Leave at 03:47 to arrive as it opens.' }],
  },
  {
    code: 'long_wait', way: 'at a later stop, where no leaving time takes it away',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, [b, a], '03:30')]),
    said: [{ message: 'OUT004 is reached at 04:18 by the dry truck VEH012 and waits 72 minutes for its window to open at 05:30.' }],
  },
  {
    code: 'over_time_budget', way: 'Fresh trips',
    input: () => plan('Kandy', [tripOf('VEH044', 1, badulla.slice(0, 3))]),
    said: [{ message: 'The dry truck VEH044\'s Fresh trips take 277 minutes of driving and unloading, 7 over the day\'s 270.' }],
  },
  {
    code: 'over_time_budget', way: 'Style and Tech trips',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, style)], { settings: { budgetMin: { fresh: 270, styleTech: 195 } } }),
    said: [{ message: 'The dry truck VEH012\'s Style and Tech trips take 196 minutes of driving and unloading, 1 over the day\'s 195.' }],
  },
];

// ── Fuel and the day ────────────────────────────────────────────────────────────────────────────────────────────
// Five Fresh shops in Galle: 120 + 10 × 4 + 120 = 280 km, which VEH006 drives on 63.6 litres at 4.4 km a litre.
const galle = ['OUT051', 'OUT053', 'OUT050', 'OUT052', 'OUT054'].map((shop) => chilled(`galle-${shop}`, shop, 10));

const day: Case[] = [
  {
    code: 'vehicle_off', way: 'both trips of a vehicle that is off',
    input: () => plan('Peliyagoda', [tripOf('VEH012', 1, gampaha), tripOf('VEH012', 2, [b])], { vehicles: fleet({ VEH012: { available: false } }) }),
    said: [
      { message: 'The dry truck VEH012 has a trip on a day it is not available.', fix: 'Move this trip to another vehicle.' },
      { message: 'The dry truck VEH012 has its second trip on a day it is not available.', fix: 'Move this trip to another vehicle.' },
    ],
  },
  {
    code: 'fuel_over_quota', way: 'litres over the weekly quota',
    input: () => plan('Peliyagoda', [tripOf('VEH006', 1, galle)], { vehicles: fleet({ VEH006: { litresUsedThisWeek: 330 } }) }),
    said: [{ message: 'The reefer truck VEH006 has used 330 litres this week and this plan needs 63.6 litres more, 13.6 litres over its weekly quota of 380 litres.', fix: 'Take 13.6 litres of driving off this vehicle.' }],
  },
  {
    code: 'fuel_over_quota', way: 'over by less than a tenth of a litre',
    input: () => plan('Peliyagoda', [tripOf('VEH006', 1, galle)], { vehicles: fleet({ VEH006: { litresUsedThisWeek: 316.4 } }) }),
    said: [{ message: 'The reefer truck VEH006 has used 316.4 litres this week and this plan needs 63.6 litres more, less than 0.1 litres over its weekly quota of 380 litres.', fix: 'Take less than 0.1 litres of driving off this vehicle.' }],
  },
  {
    code: 'not_operating_day', way: 'a day that does not operate',
    input: () => plan('Peliyagoda', [], { operatingDay: false }),
    said: [{ message: 'The plan is for a day that is not an operating day, so nothing can be delivered on it.' }],
  },
];

const CASES = [...cargo, ...coverage, ...time, ...day];

// ── Trucks named by their drivers (spec 026, AC-3) ──────────────────────────────────────────────────────────────
// The same plans with a driver on the trips: a truck is called by its driver, "Chaminda's dry truck", and a second
// trip is "the second trip of Chaminda's reefer truck". A trip with no driver keeps the kind and id, as above.
const driven = (input: PlanInput, names: Record<string, string>): PlanInput => ({
  ...input, plan: { ...input.plan, trips: input.plan.trips.map((trip) => (names[trip.vehicleId] ? { ...trip, driverName: names[trip.vehicleId] } : trip)) },
});
const withDriver = (code: ProblemCode, way: string, names: Record<string, string>, said: Words[]): Case => {
  const base = CASES.find((c) => c.code === code && c.way === way);
  if (!base) throw new Error(`No case ${code}, ${way}`);
  return { code, way: `${way}, with a driver`, input: () => driven(base.input(), names), tripNo: base.tripNo, said };
};
const DRIVEN: Case[] = [
  withDriver('over_weight', 'on its second trip', { VEH035: 'Chaminda' },
    [{ message: 'Chaminda\'s reefer van carries 1,242 kg on its second trip, 202 kg over its 1,040 kg limit.', fix: 'Take 202 kg off this trip.' }]),
  withDriver('over_volume', '80 rail boxes on a 22 m³ truck', { VEH008: 'Chaminda' },
    [{ message: 'Chaminda\'s dry truck carries 24 m³, 2 m³ over its 22 m³ limit.', fix: 'Take 2 m³ off this trip.' }]),
  withDriver('needs_reefer', 'the spec\'s example', { VEH044: 'Chaminda' },
    [{ message: 'The 276 kg chilled order for Fresh Nugegoda needs a fridge, and it is on Chaminda\'s dry truck.', fix: 'Move it to a reefer truck or van.' }]),
  withDriver('van_only', 'on a second trip', { VEH044: 'Chaminda' },
    [{ message: 'Tech Kadugannawa only takes vans, and it is on the second trip of Chaminda\'s dry truck.', fix: 'Move it to a van.' }]),
  withDriver('no_tail_lift', 'the spec\'s example on a dry van, which VEH037 is', { VEH037: 'Chaminda' },
    [{ message: 'The 380 kg dry order for Tech Matara needs a tail lift, and it is on Chaminda\'s van; vans are taken to have no tail lift.', fix: 'Move it to a truck, or check how the shop unloads it.' }]),
  withDriver('wrong_depot', 'a vehicle of another depot than the plan', { VEH059: 'Chaminda' },
    [{ message: 'Chaminda\'s van belongs to the Kandy depot, and it is in the Peliyagoda plan.', fix: 'Move this trip to a Peliyagoda vehicle.' }]),
  withDriver('wrong_depot', 'a shop of another depot than the vehicle', { VEH008: 'Chaminda' },
    [{ message: 'OUT084 belongs to the Kandy depot, and it is on Chaminda\'s dry truck from Peliyagoda.' }]),
  withDriver('mixed_brands', 'the spec\'s example', { VEH012: 'Chaminda' },
    [{ message: 'Chaminda\'s dry truck has Fresh and Style shops on one trip.', fix: 'Split them, or turn on Mix brands.' }]),
  // One vehicle with a driver and one without, in one sentence.
  withDriver('order_twice', 'on two vehicles', { VEH012: 'Chaminda' },
    [{ message: 'The 331.2 kg dry order for OUT004 is on Chaminda\'s dry truck at stop 1 and on the dry truck VEH008 at stop 1, and an order can be in the plan only once.', fix: 'Keep it in one place only.' }]),
  withDriver('order_wrong_outlet', 'an order on the stop at another shop', { VEH012: 'Chaminda' },
    [{ message: 'The 331.2 kg dry order for OUT004 goes to OUT006 on Chaminda\'s dry truck.', fix: 'Move it to a stop at OUT004.' }]),
  withDriver('empty_trip', 'a trip with no stops', { VEH012: 'Chaminda' },
    [{ message: 'Chaminda\'s dry truck has a trip with no stops.', fix: 'Add a stop or remove the trip.' }]),
  withDriver('empty_trip', 'a second trip with no stops', { VEH012: 'Chaminda' },
    [{ message: 'The second trip of Chaminda\'s dry truck has no stops.', fix: 'Add a stop or remove the trip.' }]),
  withDriver('empty_trip', 'a stop with no orders', { VEH012: 'Chaminda' },
    [{ message: 'OUT006 is a stop with no orders on Chaminda\'s dry truck.', fix: 'Add its orders or take the stop off.' }]),
  withDriver('stop_repeated', 'one shop as two stops', { VEH003: 'Chaminda' },
    [{ message: 'OUT004 is both stop 1 and stop 3 on Chaminda\'s reefer truck.', fix: 'Put its orders on one stop.' }]),
  withDriver('cross_district', 'the spec\'s example', { VEH012: 'Chaminda' },
    [{ message: 'Chaminda\'s dry truck goes to Kandy and Matale on one trip, and a trip stays in one district.', fix: 'Move the Matale stops to another trip.' }]),
  withDriver('no_travel_data', 'on a second trip', { VEH008: 'Chaminda' },
    [{ message: 'There are no travel figures from the Peliyagoda depot to Kandy, and the second trip of Chaminda\'s dry truck goes there.' }]),
  withDriver('too_many_trips', 'more than two trips', { VEH012: 'Chaminda' },
    [{ message: 'Chaminda\'s dry truck has 3 trips, and a vehicle runs at most two a day.' }]),
  withDriver('trips_overlap', 'the spec\'s example', { VEH001: 'Chaminda' },
    [{ message: 'The second trip of Chaminda\'s reefer truck leaves at 07:00, before it is back and reloaded at 08:10.', fix: 'Leave at 08:10 or later.' }]),
  withDriver('leaves_early', 'with a Fresh shop', { VEH012: 'Chaminda' },
    [{ message: 'Chaminda\'s dry truck leaves at 03:29, and a trip with a Fresh shop normally leaves at 03:30 or later.' }]),
  withDriver('window_missed', 'the spec\'s example, with the data\'s window', { VEH006: 'Chaminda' },
    [{ message: 'Fresh Koggala is reached at 08:05 by Chaminda\'s reefer truck, 35 minutes after its window closes at 07:30, and Fresh shops must be reached before 08:00.', fix: 'Leave by 05:47 to reach every stop in time.' }]),
  withDriver('window_missed', 'a window that opens after it closes', { VEH012: 'Chaminda' },
    [{ message: 'OUT019\'s window opens at 10:00 and closes at 09:00, so Chaminda\'s dry truck can never reach it in time.' }]),
  withDriver('mall_slot_missed', 'after the mall slot', { VEH012: 'Chaminda' },
    [{ message: 'OUT015 is reached at 11:37 by Chaminda\'s dry truck, 37 minutes after its mall slot of 09:00 to 11:00 ends.' }]),
  withDriver('long_wait', 'the spec\'s example', { VEH006: 'Chaminda' },
    [{ message: 'Fresh Hikkaduwa is reached at 05:15 by Chaminda\'s reefer truck and waits 15 minutes for its window to open at 05:30.', fix: 'Leave at 03:47 to arrive as it opens.' }]),
  // A driver's name already has the possessive, so the trips come first.
  withDriver('over_time_budget', 'Fresh trips', { VEH044: 'Chaminda' },
    [{ message: 'The Fresh trips of Chaminda\'s dry truck take 277 minutes of driving and unloading, 7 over the day\'s 270.' }]),
  withDriver('vehicle_off', 'both trips of a vehicle that is off', { VEH012: 'Chaminda' }, [
    { message: 'Chaminda\'s dry truck has a trip on a day it is not available.', fix: 'Move this trip to another vehicle.' },
    { message: 'Chaminda\'s dry truck has its second trip on a day it is not available.', fix: 'Move this trip to another vehicle.' },
  ]),
  withDriver('fuel_over_quota', 'litres over the weekly quota', { VEH006: 'Chaminda' },
    [{ message: 'Chaminda\'s reefer truck has used 330 litres this week and this plan needs 63.6 litres more, 13.6 litres over its weekly quota of 380 litres.', fix: 'Take 13.6 litres of driving off this vehicle.' }]),
];
// The codes whose sentences name no vehicle.
const NO_VEHICLE: ProblemCode[] = ['order_not_planned', 'deferral_incomplete', 'not_operating_day'];

describe('the plan checker in plain words (spec 024)', () => {
  it('AC-1 pins a sentence for every code the checker has', () => {
    expect(new Set(CASES.map((c) => c.code))).toEqual(new Set(PROBLEM_CODES));
  });

  it.each(CASES.map((c) => [c.code, c.way, c] as const))('AC-1 %s, %s', (code, _way, c) => {
    expect(wordsOf(c.input(), code, c.tripNo)).toEqual(c.said);
  });

  it('spec 026 AC-3 pins the driver\'s form for every code that names a vehicle', () => {
    expect(new Set(DRIVEN.map((c) => c.code))).toEqual(new Set(PROBLEM_CODES.filter((code) => !NO_VEHICLE.includes(code))));
  });

  it.each(DRIVEN.map((c) => [c.code, c.way, c] as const))('spec 026 AC-3 %s, %s', (code, _way, c) => {
    expect(wordsOf(c.input(), code, c.tripNo)).toEqual(c.said);
  });

  it('spec 026 calls a truck whose trip has a blank driver name by its kind and id, as one with no driver', () => {
    for (const blank of ['', '   ', '\t']) {
      for (const c of CASES.filter((x) => x.way === '80 rail boxes on a 22 m³ truck' || x.way === 'the spec\'s example' || x.way === 'both trips of a vehicle that is off')) {
        const vehicles = new Set(c.input().plan.trips.map((trip) => trip.vehicleId));
        const blankNames = Object.fromEntries([...vehicles].map((id) => [id, blank]));
        expect(wordsOf({ ...c.input(), plan: { ...c.input().plan, trips: c.input().plan.trips.map((trip) => ({ ...trip, driverName: blankNames[trip.vehicleId] })) } }, c.code, c.tripNo)).toEqual(c.said);
      }
    }
  });

  it('AC-1 writes each message and fix as one sentence, and never a trip number', () => {
    for (const { said } of [...CASES, ...DRIVEN]) {
      for (const text of said.flatMap(({ message, fix }) => (fix === undefined ? [message] : [message, fix]))) {
        expect(text).toMatch(/^[A-Z].*\.$/);
        expect(text.slice(0, -1)).not.toMatch(/[.!?]\s/);
        expect(text).not.toMatch(/\btrip \d/);
      }
    }
  });
});
