import { describe, expect, it } from 'vitest';
import { checkPlan } from '../check';
import { inputFor, order, vehicle } from '../testing/shared';
import type { EngineOrder, EngineVehicle, PlanInput, PlanTrip } from '../types';
import { candidateInput, candidateSlots, chooseWhole, fixDepartures, tryCandidate } from './candidates';

const dry = (id: string, shop = 'OUT006', quantity = 1) => order(id, shop, 'fresh-dry-carton', quantity);
const trip = (vehicleId: string, tripNo: number, orders: EngineOrder[]): PlanTrip => ({
  vehicleId, tripNo, stops: orders.map((o) => ({ outletId: o.outletId, orderIds: [o.id] })),
});
const day = (orders: EngineOrder[] = [], trips: PlanTrip[] = [], fleet = [vehicle('VEH012')], depotId = 'Peliyagoda') =>
  structuredClone(inputFor(depotId, { orders, trips, vehicles: fleet }));
const accept = (input: PlanInput, next: EngineOrder): PlanInput => {
  const selected = chooseWhole(input, next).best;
  expect(selected?.stage).toBe('accepted');
  if (!selected) throw new Error('Expected a whole candidate');
  return { ...input, orders: [...input.orders, next], plan: {
    trips: [...input.plan.trips.filter((t) => t.vehicleId !== selected.slot.vehicleId), ...selected.input.plan.trips],
    deferrals: [],
  } };
};

describe('whole-order planner candidates', () => {
  it('AC-4 lists each matching existing trip and only the next free numbered trip', () => {
    const a = dry('a', 'OUT026');
    const input = day([a], [trip('VEH012', 1, [a])], [vehicle('VEH012'), vehicle('VEH008')]);
    expect(candidateSlots(input, dry('b', 'OUT030')).slots.map((s) => [s.vehicleId, s.tripNo, s.existing])).toEqual([
      ['VEH012', 1, true], ['VEH008', 1, false], ['VEH012', 2, false],
    ]);
    expect(candidateSlots(input, dry('c')).slots.some((s) => s.vehicleId === 'VEH012' && s.tripNo === 1)).toBe(false);
    input.plan.trips.push(trip('VEH012', 2, [dry('d')]));
    input.orders.push(dry('d'));
    expect(candidateSlots(input, dry('e', 'OUT054')).slots.filter((s) => s.vehicleId === 'VEH012')).toEqual([]);
  });

  it('AC-5 filters by chilled goods, van access, depot and availability in that order', () => {
    const cold = order('cold', 'OUT001', 'fresh-chilled-carton', 2);
    const input = day([], [], [vehicle('VEH008'), vehicle('VEH035'), vehicle('VEH057')]);
    expect(candidateSlots(input, cold).slots.map((s) => s.vehicleId)).toEqual(['VEH035']);
    input.vehicles.find((v) => v.id === 'VEH035')!.available = false;
    expect(candidateSlots(input, cold)).toMatchObject({ slots: [], refusal: 'no_reefer' });
    input.vehicles.push(vehicle('VEH001'));
    expect(candidateSlots(input, cold)).toMatchObject({ slots: [], refusal: 'no_van' });
    expect(candidateSlots(day([], [], []), dry('empty'))).toEqual({ slots: [] });
  });

  it('AC-6 preserves reefers and vans before filling a larger special vehicle', () => {
    const input = day([], [], [vehicle('VEH035'), vehicle('VEH001'), vehicle('VEH008'), vehicle('VEH038')]);
    expect(candidateSlots(input, dry('plain')).slots.map((s) => s.vehicleId)).toEqual(['VEH008', 'VEH038', 'VEH001', 'VEH035']);
    expect(chooseWhole(input, dry('plain')).best?.slot.vehicleId).toBe('VEH008');
  });

  it.each<[string, Partial<EngineVehicle>, Partial<EngineVehicle>]>([
    ['volume', { volumeCapM3: 30, weightCapKg: 3000, kmPerL: 4 }, { volumeCapM3: 20, weightCapKg: 5000, kmPerL: 9 }],
    ['weight', { weightCapKg: 5000, kmPerL: 4 }, { weightCapKg: 3000, kmPerL: 9 }],
    ['efficiency', { kmPerL: 9 }, { kmPerL: 4 }],
  ])('AC-6 prefers greater %s before later ties', (_label, better, worse) => {
    const input = day([], [], [{ ...vehicle('VEH008'), id: 'Z', ...better }, { ...vehicle('VEH008'), id: 'A', ...worse }]);
    expect(candidateSlots(input, dry('a')).slots[0]!.vehicleId).toBe('Z');
  });

  it('AC-6 prefers existing trips before capacity and uses vehicle ID then trip number for final ties', () => {
    const a = dry('a');
    const input = day([a], [trip('VEH008', 1, [a])], [vehicle('VEH023'), vehicle('VEH008')]);
    expect(chooseWhole(input, dry('b')).best?.slot).toEqual({ vehicleId: 'VEH008', tripNo: 1, existing: true });
    const equal = day([a, dry('b')], [trip('B', 1, [a]), trip('B', 2, [dry('b')])],
      [{ ...vehicle('VEH008'), id: 'B' }, { ...vehicle('VEH008'), id: 'A' }]);
    expect(candidateSlots(equal, dry('c')).slots.map((s) => [s.vehicleId, s.tripNo])).toEqual([['B', 1], ['B', 2], ['A', 1]]);
    expect(candidateSlots(day([], [], equal.vehicles), dry('c')).slots.map((s) => s.vehicleId)).toEqual(['A', 'B']);
  });

  it('AC-6 uses a smaller vehicle first trip before a larger vehicle second trip', () => {
    const old = order('old-style', 'OUT019', 'style-folded', 1);
    const input = day([old], [trip('VEH001', 1, [old])], [vehicle('VEH001'), vehicle('VEH002')]);
    const next = order('style', 'OUT037', 'style-folded', 1);
    expect(tryCandidate(input, next, { vehicleId: 'VEH001', tripNo: 2, existing: false }).stage).toBe('accepted');
    expect(tryCandidate(input, next, { vehicleId: 'VEH002', tripNo: 1, existing: false }).stage).toBe('accepted');
    const best = chooseWhole(input, next).best;
    expect(best?.slot).toEqual({ vehicleId: 'VEH002', tripNo: 1, existing: false });
    expect(best?.selectionReason).toBe('uses a first run before a second');
  });

  it('AC-7 caps Fresh closing at 07:59 before comparing opening times', () => {
    const existing = dry('existing', 'OUT004');
    const input = day([existing], [trip('VEH012', 1, [existing])]);
    Object.assign(input.outlets.find((s) => s.id === 'OUT004')!, { windowOpen: 420, windowClose: 480 });
    Object.assign(input.outlets.find((s) => s.id === 'OUT006')!, { windowOpen: 400, windowClose: 540 });
    const attempt = tryCandidate(input, dry('new', 'OUT006'), { vehicleId: 'VEH012', tripNo: 1, existing: true });
    expect(attempt.input.plan.trips[0]!.stops.map((s) => s.outletId)).toEqual(['OUT006', 'OUT004']);
  });

  it('AC-7 consolidates a shop and keeps its orders in accepted priority order', () => {
    let input = day();
    for (const next of [dry('first'), dry('second'), dry('deadline', 'OUT010'), dry('opening', 'OUT009')]) input = accept(input, next);
    expect(input.plan.trips).toHaveLength(1);
    expect(input.plan.trips[0]!.stops).toEqual([
      { outletId: 'OUT010', orderIds: ['deadline'] }, { outletId: 'OUT009', orderIds: ['opening'] },
      { outletId: 'OUT006', orderIds: ['first', 'second'] },
    ]);
  });

  it('AC-7 breaks equal closing times by effective opening, then outlet ID', () => {
    const old = dry('old', 'OUT007');
    const input = day([old], [trip('VEH012', 1, [old])]);
    const result = tryCandidate(input, dry('new', 'OUT004'), { vehicleId: 'VEH012', tripNo: 1, existing: true });
    expect(result.input.plan.trips[0]!.stops.map((s) => s.outletId)).toEqual(['OUT004', 'OUT007']);
    const earlier = tryCandidate(input, dry('early', 'OUT006'), { vehicleId: 'VEH012', tripNo: 1, existing: true });
    expect(earlier.input.plan.trips[0]!.stops.map((s) => s.outletId)).toEqual(['OUT006', 'OUT007']);
  });

  it('AC-8 checks the other trip and refuses an insertion that delays an accepted delivery', () => {
    const first = ['OUT026', 'OUT030', 'OUT028'].map((s) => dry(s, s));
    const second = [dry('deadline', 'OUT010')];
    const input = day([...first, ...second], [trip('VEH012', 1, first), trip('VEH012', 2, second)]);
    expect(checkPlan(input).ok).toBe(true);
    input.outlets.find((s) => s.id === 'OUT027')!.windowOpen = 420; // Boundary: late opening forces a wait.
    const before = structuredClone(input);
    const result = tryCandidate(input, dry('late-opening', 'OUT027'), { vehicleId: 'VEH012', tripNo: 1, existing: true });
    expect(result.stage).toBe('window');
    expect(result.check?.problems.some((p) => p.level === 'block' && p.tripNo === 2)).toBe(true);
    expect(input).toEqual(before);
  });

  it('AC-8 uses both capacity limits including exactly full loads', () => {
    const input = day([], [], [vehicle('VEH012')]);
    expect(chooseWhole(input, order('exact', 'OUT019', 'style-hanging', 80)).best?.check?.trips[0]!.load.m3).toBe(24);
    expect(chooseWhole(input, order('too-much', 'OUT019', 'style-hanging', 81)).stages).toEqual(['over_capacity']);
    expect(chooseWhole(day([], [], [vehicle('VEH035')]), order('heavy', 'OUT001', 'fresh-chilled-carton', 151)).stages).toEqual(['over_capacity']);
  });

  it('AC-9 uses the numeric 02:59 fix for the ordered Badulla trip and keeps its warnings', () => {
    const orders = ['OUT110', 'OUT112', 'OUT111', 'OUT113'].map((s) => dry(s, s));
    const input = day(orders, [trip('VEH044', 1, orders)], [vehicle('VEH044')], 'Kandy');
    const result = fixDepartures(input);
    expect(result.input.plan.trips[0]!.leaveAt).toBe(179);
    expect(result.check.ok).toBe(true);
    expect(result.check.trips[0]!.times?.stops[3]!.arriveAt).toBe(479);
    expect(result.check.trips[0]!.times?.tripMin).toBe(315);
    expect(result.check.problems.map((p) => p.code)).toEqual(['leaves_early', 'over_time_budget']);
    expect(input.plan.trips[0]).not.toHaveProperty('leaveAt');
  });

  it('AC-9 resets both departures and never applies a long-wait suggestion', () => {
    const orders = ['OUT015', 'OUT017', 'OUT019'].map((s) => order(s, s, 'style-folded', 1));
    const input = day(orders, [{ ...trip('VEH023', 1, orders), leaveAt: 400 }], [vehicle('VEH023')]);
    input.settings.waitWarnMin = 20;
    const result = fixDepartures(input);
    expect(result.input.plan.trips[0]).not.toHaveProperty('leaveAt');
    expect(result.check.trips[0]!.times?.leaveAt).toBe(516);
    expect(result.check.problems.map((p) => p.code)).toContain('long_wait');
    const impossible = day([dry('a')], [trip('VEH012', 1, [dry('a')])]);
    Object.assign(impossible.outlets.find((s) => s.id === 'OUT006')!, { mallOpen: 600, mallClose: 700 });
    expect(fixDepartures(impossible).check.ok).toBe(false);
  });

  it('AC-10 keeps a brand per trip unless mixing is enabled, and accepts warning-only cargo', () => {
    const style = order('style', 'OUT019', 'style-folded', 1);
    const input = day([style], [trip('VEH012', 1, [style])]);
    const tech = order('tech', 'OUT024', 'tech-tv', 1);
    expect(candidateSlots(input, tech).slots.map((s) => s.tripNo)).toEqual([2]);
    input.settings.mixBrands = true;
    expect(chooseWhole(input, tech).best?.slot.tripNo).toBe(1);
    const washers = chooseWhole(day([], [], [vehicle('VEH059')], 'Kandy'), order('washers', 'OUT093', 'tech-washer', 2)).best;
    expect(washers?.check?.ok).toBe(true);
    expect(washers?.check?.problems.map((p) => p.code)).toContain('no_tail_lift');
  });

  it('AC-11 uses weekly fuel history and unrounded combined-trip fuel', () => {
    const input = day([], [], [{ ...vehicle('VEH001'), litresUsedThisWeek: 300 }]);
    const farShop = input.outlets.find((s) => s.district === 'Kurunegala' && s.parking === 'normal')!;
    expect(chooseWhole(input, dry('far', farShop.id)).stages).toEqual(['fuel']);
    const near = dry('near');
    const second = day([near], [trip('VEH012', 1, [near])], [{ ...vehicle('VEH012'), weeklyFuelQuotaL: 7, litresUsedThisWeek: 0 }]);
    // Two 24 km routes need 7.058... litres: the displayed 7.1 is not the quota predicate.
    expect(tryCandidate(second, dry('other', 'OUT004'), { vehicleId: 'VEH012', tripNo: 2, existing: false }).stage).toBe('fuel');
    const rounded = day([], [], [{ ...vehicle('VEH012'), weeklyFuelQuotaL: 3.5, litresUsedThisWeek: 0 }]);
    expect(chooseWhole(rounded, dry('rounded')).stages).toEqual(['fuel']); // 24/6.8 >3.5 while display is 3.5.
  });

  it('AC-12 builds the shared-row mall run and includes the 59-minute unloading allowance', () => {
    let input = day([], [], [vehicle('VEH023')]);
    for (const s of ['OUT019', 'OUT017', 'OUT015']) input = accept(input, order(s, s, 'style-folded', 1));
    expect(input.plan.trips).toHaveLength(1);
    expect(input.plan.trips[0]!.stops.map((s) => s.outletId)).toEqual(['OUT015', 'OUT017', 'OUT019']);
    expect(input.plan.trips[0]).not.toHaveProperty('leaveAt');
    const timed = checkPlan(input).trips[0]!.times!;
    expect(timed.leaveAt).toBe(516);
    expect(timed.stops[1]).toMatchObject({ arriveAt: 607, waitMin: 23, startAt: 630 });
    expect(timed.stops[2]!.arriveAt).toBe(697);
  });
  it('AC-7 tries a new stop at each other place after a window miss, and a later stop leaves that order as it is', () => {
    // Spec 011's A/B example: A takes deliveries 10:00 to 10:10 and B 09:00 to 10:20, 20 minutes' unloading and 10
    // between them. At its closing-time place B comes after A and is reached at 10:30; before A it passes.
    const [a, b, c] = [order('a', 'OUT019', 'style-folded', 1), order('b', 'OUT020', 'style-folded', 1), order('c', 'OUT015', 'style-folded', 1)];
    const input = day([a], [trip('VEH012', 1, [a])]);
    Object.assign(input.outlets.find((s) => s.id === 'OUT019')!, { windowOpen: 600, windowClose: 610 });
    Object.assign(input.outlets.find((s) => s.id === 'OUT020')!, { windowOpen: 540, windowClose: 620 });
    input.allowances = input.allowances.map((row) => (row.brand === 'Style' ? { ...row, minutes: 20 } : row));
    input.travel = input.travel.map((row) => (row.district === 'Colombo' ? { ...row, betweenMin: 10 } : row));
    const slot = { vehicleId: 'VEH012', tripNo: 1, existing: true };
    const joined = tryCandidate(input, b, slot);
    expect(joined.stage).toBe('accepted');
    expect(joined.input.plan.trips[0]!.stops.map((s) => s.outletId)).toEqual(['OUT020', 'OUT019']);
    expect(joined.input.plan.trips[0]!.leaveAt).toBeUndefined();
    // A mall shop closing at 11:00 joins at its own closing-time place, last; B stays before A.
    const next = { ...input, orders: [a, b], plan: { trips: joined.input.plan.trips, deferrals: [] } };
    expect(candidateInput(next, c, slot).plan.trips[0]!.stops.map((s) => s.outletId)).toEqual(['OUT020', 'OUT019', 'OUT015']);
    // With no place that passes, the refusal is the closing-time place's, so its reason names what that place missed.
    Object.assign(input.outlets.find((s) => s.id === 'OUT020')!, { windowOpen: 615, windowClose: 616 });
    const refused = tryCandidate(input, b, slot);
    expect(refused.stage).toBe('window');
    expect(refused.input.plan.trips[0]!.stops.map((s) => s.outletId)).toEqual(['OUT019', 'OUT020']);
  });
});
