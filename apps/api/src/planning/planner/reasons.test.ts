import { describe, expect, it } from 'vitest';
import { vehicle } from '../testing/shared';
import type { PlanInput, PlannerInput } from '../types';
import { tryCandidate } from './candidates';
import { toMinutes } from '../words';
import {
  deferralDecisions, deferralFor, earlyLeaveReason, fittedReason, furthestRejection, placementReason, priorityReason, quantityWord, refusedReason,
  type PlannerDeferralCode, type Wording,
} from './reasons';
import { plannerInput, plannerOrder } from './testing/input';

const source = plannerOrder('waiting', 'OUT001', 'fresh-chilled-carton', 180, { deliveryDate: '2026-06-24', timesDeferred: 1 });
const input = () => plannerInput([source]);
const planInput = (source: PlannerInput): PlanInput => ({ ...source, plan: { trips: [], deferrals: [] } });
const plain = (reason: string) => {
  expect(reason).not.toMatch(/OUT\d+|\d{4}-\d{2}-\d{2}|\bunits\b|tested stop order|after earlier choices|first feasible/i);
  expect(reason).toBe(reason.trim());
};

describe('shop-facing deferrals and dispatcher explanations', () => {
  it('AC-17 chooses the first exhausted stage across all attempts', () => {
    expect(furthestRejection([])).toBe('over_capacity');
    expect(furthestRejection(['over_capacity'])).toBe('over_capacity');
    expect(furthestRejection(['window', 'over_capacity'])).toBe('window');
    expect(furthestRejection(['window', 'fuel'])).toBe('fuel');
    expect(furthestRejection(['fuel', 'window', 'over_capacity'])).toBe('fuel');
  });

  it.each<[PlannerDeferralCode, string]>([
    ['no_reefer', 'No fridge truck was free for Colombo on Thursday.'],
    ['no_van', 'No van was free for Colombo on Thursday, which takes vans only.'],
    ['over_capacity', 'The fridge vans going to Colombo on Thursday were full.'],
    ['window', 'No fridge van could reach Colombo before its window closed at 07:30 on Thursday.'],
    ['fuel', "The fridge vans that could reach Colombo on Thursday did not have enough of this week's fuel left."],
  ])('AC-17 %s is a plain shop sentence with a weekday', (code, sentence) => {
    const deferred = deferralFor(input(), source, code);
    expect(deferred).toMatchObject({ orderId: 'waiting', code, reason: sentence });
    plain(deferred.reason);
    expect(deferred.reason.length).toBeLessThanOrEqual(200);
  });

  // Chilled goods were only ever tried on fridge vehicles and a van-only shop only on vans, so the sentence
  // names those. "No truck" would be untrue on a day when a dry truck reached the same shop.
  it.each([
    ['a dry order at an ordinary shop', 'OUT008', 'fresh-dry-carton', 'truck'],
    ['a chilled order at an ordinary shop', 'OUT008', 'fresh-chilled-carton', 'fridge truck'],
    ['a dry order at a van-only shop', 'OUT001', 'fresh-dry-carton', 'van'],
    ['a chilled order at a van-only shop', 'OUT001', 'fresh-chilled-carton', 'fridge van'],
  ])('AC-17 names the vehicles the search could use for %s', (_kind, shop, product, vehicle) => {
    const order = plannerOrder('late', shop, product, 10);
    const day = plannerInput([order]);
    const reasons = [
      [deferralFor(day, order, 'window').reason, `No ${vehicle} could reach Colombo before its window closed at 07:30 on Thursday.`],
      [deferralFor(day, order, 'over_capacity').reason, `The ${vehicle}s going to Colombo on Thursday were full.`],
      [deferralFor(day, order, 'fuel').reason, `The ${vehicle}s that could reach Colombo on Thursday did not have enough of this week's fuel left.`],
      [deferralFor(day, order, 'over_capacity', { split: { keptUnits: 6, remainingUnits: 4 } }).reason,
        `6 of the 10 cartons for Colombo go on Thursday; the other 4 wait for the next plan because the ${vehicle} was full.`],
    ];
    for (const [reason, sentence] of reasons) {
      expect(reason).toBe(sentence);
      plain(reason!);
    }
  });

  it('uses a shop name when supplied and the district when the name is an ID or too long', () => {
    const day = input();
    day.outlets.find((o) => o.id === source.outletId)!.name = 'Fresh Wellawatte';
    expect(deferralFor(day, source, 'no_van').reason).toBe('No van was free for Fresh Wellawatte on Thursday, which takes vans only.');
    day.outlets.find((o) => o.id === source.outletId)!.name = 'A long shop name '.repeat(30);
    expect(deferralFor(day, source, 'window').reason).toBe('No fridge van could reach Colombo before its window closed at 07:30 on Thursday.');
  });

  it('AC-17 a deferred split is one sentence naming sent/left counts and brand packaging', () => {
    for (const [shop, product, noun, vehicle] of [['OUT001', 'fresh-chilled-carton', 'cartons', 'fridge van'], ['OUT019', 'style-folded', 'boxes', 'truck'], ['OUT024', 'tech-tv', 'items', 'truck']]) {
      const order = plannerOrder('rest', shop!, product!, 60, { splitFrom: 'parent' });
      const day = plannerInput([order]);
      const deferred = deferralFor(day, order, 'over_capacity', { split: { keptUnits: 75, remainingUnits: 60 } });
      expect(deferred.reason).toBe(`75 of the 135 ${noun} for Colombo go on Thursday; the other 60 wait for the next plan because the ${vehicle} was full.`);
      plain(deferred.reason);
      expect(deferred.reason.length).toBeLessThanOrEqual(200);
      expect(quantityWord(day, order)).toBe(noun);
    }
  });

  it('AC-17 names a binding split limit in shop words only when supplied', () => {
    expect(deferralFor(input(), source, 'over_capacity', { detail: 'this existing child cannot be split again' }).reason).toMatch(/already been divided.*cannot be divided again.*Thursday/);
    expect(deferralFor(input(), source, 'over_capacity', { detail: 'splitting would exceed the 300-order limit' }).reason).toMatch(/300-order limit.*Colombo.*Thursday/);
    const limit = deferralFor(input(), source, 'over_capacity', { detail: 'automatic splits allow at most 999 units per product line' });
    expect(limit.reason).toMatch(/999/);
    plain(limit.reason);
  });

  it('keeps the prohibition on dividing a remainder again in both normal and compact split sentences', () => {
    const day = input();
    const options = { split: { keptUnits: 150, remainingUnits: 250 }, detail: 'this existing child cannot be split again' };
    const reason = deferralFor(day, source, 'over_capacity', options).reason;
    expect(reason).toMatch(/150 of the 400 cartons.*250 wait.*cannot be divided again/);
    expect(reason).not.toContain('truck was full');
    // Long display values force the compact rendering; the binding reason still has to survive.
    day.outlets.find((shop) => shop.id === source.outletId)!.name = 'Fresh Supermarket Colombo Central Distribution';
    day.outlets.find((shop) => shop.id === source.outletId)!.district = 'Colombo Metropolitan Distribution Service Region';
    const compact = deferralFor(day, source, 'over_capacity', { ...options, split: { keptUnits: 4_000_000_000_000_000, remainingUnits: 4_000_000_000_000_000 } }).reason;
    expect(compact).toContain('cannot be divided again');
    expect(compact).not.toContain('truck was full');
    expect(compact.length).toBeLessThanOrEqual(200);
  });

  it('describes insufficient remaining fuel for split goods without saying the allowance is exhausted', () => {
    const reason = deferralFor(input(), source, 'fuel', { split: { keptUnits: 150, remainingUnits: 30 } }).reason;
    expect(reason).toContain("did not have enough of this week's fuel left");
    expect(reason).not.toMatch(/used up|exhaust/);
    expect(reason.length).toBeLessThanOrEqual(200);
  });

  it('AC-17 distinguishes reaching this shop late from delaying another accepted shop', () => {
    const style = plannerOrder('style', 'OUT019', 'style-folded');
    const fresh = plannerOrder('fresh', 'OUT006');
    const day = plannerInput([style, fresh], { vehicles: [vehicle('VEH012')] });
    const trial = planInput(day);
    trial.plan.trips = [{ vehicleId: 'VEH012', tripNo: 1, stops: [{ outletId: style.outletId, orderIds: [style.id] }] }];
    const ownLate = tryCandidate(trial, fresh, { vehicleId: 'VEH012', tripNo: 2, existing: false });
    expect(ownLate.stage).toBe('window');
    expect(deferralFor(day, fresh, 'window', { attempts: [ownLate] }).reason).toBe('No truck could reach Colombo before 08:00 on Thursday.');

    const first = ['OUT026', 'OUT030', 'OUT028'].map((id) => plannerOrder(id, id));
    const deadline = plannerOrder('deadline', 'OUT010');
    const added = plannerOrder('added', 'OUT027');
    const nextDay = plannerInput([...first, deadline, added], { vehicles: [vehicle('VEH012')] });
    nextDay.outlets.find((s) => s.id === added.outletId)!.windowOpen = 420;
    const nextTrial = planInput(nextDay);
    nextTrial.plan.trips = [
      { vehicleId: 'VEH012', tripNo: 1, stops: first.map((o) => ({ outletId: o.outletId, orderIds: [o.id] })) },
      { vehicleId: 'VEH012', tripNo: 2, stops: [{ outletId: deadline.outletId, orderIds: [deadline.id] }] },
    ];
    const otherLate = tryCandidate(nextTrial, added, { vehicleId: 'VEH012', tripNo: 1, existing: true });
    expect(otherLate.stage).toBe('window');
    expect(otherLate.check?.trips[0]!.times?.stops.find((s) => s.outletId === added.outletId)?.late).toBe(false);
    const reason = deferralFor(nextDay, added, 'window', { attempts: [otherLate] }).reason;
    expect(reason).toBe('The truck that could reach Gampaha in time would then have been late for its other shops on Thursday.');
    plain(reason);
  });

  it('AC-17 explains a nonoverlapping mall slot using the real closing and opening times', () => {
    const order = plannerOrder('mall', 'OUT017', 'style-folded');
    const day = plannerInput([order]);
    Object.assign(day.outlets.find((s) => s.id === order.outletId)!, { windowOpen: 600, windowClose: 620, mallOpen: 700, mallClose: 750 });
    const reason = deferralFor(day, order, 'window').reason;
    expect(reason).toMatch(/window.*10:20.*mall.*11:40.*Thursday/);
    expect(reason).not.toMatch(/could reach|late/);
    plain(reason);
  });

  it.each([['2024-02-29', 'Thursday'], ['2000-03-01', 'Wednesday'], ['2026-10-01', 'Thursday']])('gets the weekday for %s with pure calendar arithmetic', (date, weekday) => {
    const day = input();
    day.date = date!;
    expect(deferralFor(day, source, 'no_reefer').reason).toContain(weekday);
  });

  it('AC-1 explains the rank using waiting weekday, refrigeration and the effective closing time', () => {
    const reason = priorityReason(input(), source, 1);
    expect(reason).toMatch(/Rank 1/);
    expect(reason).toMatch(/waited since Wednesday/);
    expect(reason).toMatch(/chilled/);
    expect(reason).toContain('07:30');
    plain(reason);
    const fresh = plannerOrder('fresh', 'OUT006');
    expect(priorityReason(plannerInput([fresh]), fresh, 2)).toContain('due 07:59');
    expect(priorityReason(plannerInput([fresh]), fresh, 2)).not.toContain('closes 07:59');
  });

  it('AC-1 names joining/new trip and uses the actual tuple advantage supplied by selection', () => {
    const order = plannerOrder('dry', 'OUT030');
    const day = plannerInput([order], { vehicles: [vehicle('VEH012')] });
    const attempt = tryCandidate(planInput(day), order, { vehicleId: 'VEH012', tripNo: 1, existing: false });
    const reason = placementReason(day, order, { ...attempt, selectionReason: 'the largest free truck' });
    expect(reason).toMatch(/new run on the dry truck VEH012/);
    expect(reason).toContain('Gampaha');
    expect(reason).toContain('largest free truck');
    expect(placementReason(day, order, { ...attempt, slot: { ...attempt.slot, existing: true }, selectionReason: 'to fill an existing run' })).toMatch(/joined the dry truck VEH012/);
    plain(reason);
  });

  it('AC-1 takes the best-ranked refusal in the exhausted stage and preserves checker facts', () => {
    const order = plannerOrder('dry', 'OUT006');
    const day = plannerInput([order], { vehicles: [{ ...vehicle('VEH012'), litresUsedThisWeek: 540 }, { ...vehicle('VEH008'), litresUsedThisWeek: 460 }] });
    const first = tryCandidate(planInput(day), order, { vehicleId: 'VEH012', tripNo: 1, existing: false });
    const second = tryCandidate(planInput(day), order, { vehicleId: 'VEH008', tripNo: 1, existing: false });
    const reason = refusedReason(day, order, [first, second], 'fuel');
    expect(reason).toContain('VEH012');
    expect(reason).toContain('540');
    expect(reason).not.toContain('VEH008');
    plain(reason);
  });

  it('compacts a split explanation by preserving its rank, reason for the trip, load and capacity facts', () => {
    const order = plannerOrder('big', 'OUT001', 'fresh-chilled-carton', 400, { deliveryDate: '2026-06-24', timesDeferred: 1 });
    const day = plannerInput([order], { vehicles: [vehicle('VEH035')] });
    const attempt = tryCandidate(planInput(day), order, { vehicleId: 'VEH035', tripNo: 1, existing: false });
    const priority = priorityReason(day, order, 1, 'short');
    expect(priority).toMatch(/Rank 1.*Wed.*chilled.*07:30/);
    expect(priority.length).toBeLessThan(65);
    const placement = placementReason(day, order, { ...attempt, selectionReason: 'keeps the usual leaving times' }, 'short');
    expect(placement).toMatch(/on the reefer van VEH035.*usual/);
    expect(placement.length).toBeLessThan(55);
    const refusal = refusedReason(day, order, [attempt], 'over_capacity', 'short');
    expect(refusal).toContain('2,760 kg');
    expect(refusal).toContain('1,040 kg');
    expect(refusal.length).toBeLessThan(65);
    plain(`${priority}; ${placement}; ${refusal}`);
  });

  it('AC-3 flags waiting originals, children and window deferrals without technical wording', () => {
    for (const waiting of [source, { ...source, id: 'split:a:rest', splitFrom: 'a' }, { ...source, deliveryDate: '2026-06-25' }, { ...source, timesDeferred: 0 }]) {
      const deferred = deferralFor(input(), waiting, 'over_capacity');
      expect(deferralDecisions(input(), waiting, deferred)).toEqual([{ kind: 'waited_again', orderId: waiting.id, reason: deferred.reason }]);
    }
    const current = { ...source, deliveryDate: '2026-06-25', timesDeferred: 0 };
    expect(deferralDecisions(input(), current, deferralFor(input(), current, 'fuel'))).toEqual([]);
    expect(deferralDecisions(input(), source, deferralFor(input(), source, 'window')).map((d) => d.kind)).toEqual(['waited_again', 'late_order']);
  });
});

// The planner's own sentences follow the checker's five rules (spec 024): the shop first where there is one, a
// vehicle by its kind and id, and a trip numbered only when it is a vehicle's second.
describe('the planner\'s own sentences in plain words', () => {
  it('names the run an order joins or starts by the vehicle\'s kind, and only a second trip by its number', () => {
    const order = plannerOrder('dry', 'OUT030');
    const day = plannerInput([order], { vehicles: [vehicle('VEH012')] });
    const attempt = tryCandidate(planInput(day), order, { vehicleId: 'VEH012', tripNo: 1, existing: false });
    const placed = (existing: boolean, tripNo: number, wording: Wording = 'full') =>
      placementReason(day, order, { ...attempt, slot: { ...attempt.slot, existing, tripNo }, selectionReason: existing ? 'fills an existing run' : 'vehicle ID breaks the tie' }, wording);
    expect(placed(false, 1)).toBe('new run on the dry truck VEH012 to Gampaha, vehicle ID breaks the tie');
    expect(placed(true, 1)).toBe('joined the dry truck VEH012 on its run to Gampaha, fills an existing run');
    expect(placed(false, 2)).toBe('new second trip on the dry truck VEH012 to Gampaha, vehicle ID breaks the tie');
    expect(placed(true, 2)).toBe('joined the dry truck VEH012 on its second trip to Gampaha, fills an existing run');
    // The short forms the 200-character cap falls back to.
    expect(placed(false, 1, 'short')).toBe('on the dry truck VEH012 (vehicle ID tie)');
    expect(placed(true, 1, 'short')).toBe('joined the dry truck VEH012 (fills existing run)');
    expect(placed(false, 2, 'short')).toBe('on the second trip of the dry truck VEH012 (vehicle ID tie)');
    expect(placed(true, 2, 'short')).toBe('joined the second trip of the dry truck VEH012 (fills existing run)');
  });

  it('says a refused shop first in the short form, then the vehicle by its kind', () => {
    // A Style run first, so the Colombo order could only go on a second trip, and that reaches it late.
    const style = plannerOrder('style', 'OUT019', 'style-folded');
    const fresh = plannerOrder('fresh', 'OUT006');
    const day = plannerInput([style, fresh], { vehicles: [vehicle('VEH012')] });
    const trial = planInput(day);
    trial.plan.trips = [{ vehicleId: 'VEH012', tripNo: 1, stops: [{ outletId: style.outletId, orderIds: [style.id] }] }];
    const late = tryCandidate(trial, fresh, { vehicleId: 'VEH012', tripNo: 2, existing: false });
    expect(refusedReason(day, fresh, [late], 'window', 'short')).toBe('Colombo is reached at 10:56 by the second trip of the dry truck VEH012, after the 08:00 deadline.');
    // The long form is the checker's own sentence, with the shop's id read as its district.
    expect(refusedReason(day, fresh, [late], 'window')).toBe('Colombo is reached at 10:56 by the second trip of the dry truck VEH012, 176 minutes after its window closes at 08:00, and Fresh shops must be reached before 08:00.');
    // Once the explanation has named the vehicle, as a split does for its first part, the short form says "its".
    expect(refusedReason(day, fresh, [late], 'window', 'short', 'VEH012')).toBe('Colombo is reached at 10:56 by its second trip, after the 08:00 deadline.');
    // Another vehicle named before changes nothing.
    expect(refusedReason(day, fresh, [late], 'window', 'short', 'VEH008')).toBe('Colombo is reached at 10:56 by the second trip of the dry truck VEH012, after the 08:00 deadline.');
  });

  it('says what a refused vehicle carries against its limits, and its fuel, by its kind', () => {
    const refused = (order: ReturnType<typeof plannerOrder>, fleet: PlannerInput['vehicles'], code: PlannerDeferralCode, named?: string) => {
      const day = plannerInput([order], { vehicles: fleet });
      return refusedReason(day, order, [tryCandidate(planInput(day), order, { vehicleId: fleet[0]!.id, tripNo: 1, existing: false })], code, 'short', named);
    };
    const waiting = plannerOrder('big', 'OUT001', 'fresh-chilled-carton', 400, { deliveryDate: '2026-06-24', timesDeferred: 1 });
    expect(refused(waiting, [vehicle('VEH035')], 'over_capacity')).toBe('The reefer van VEH035 carries 2,760 kg, over its 1,040 kg limit.');
    expect(refused(waiting, [vehicle('VEH035')], 'over_capacity', 'VEH035')).toBe('It carries 2,760 kg, over its 1,040 kg limit.');
    expect(refused(plannerOrder('rails', 'OUT019', 'style-hanging', 80), [vehicle('VEH008')], 'over_capacity')).toBe('The dry truck VEH008 carries 24 m³, over its 22 m³ limit.');
    // A week's quota of 3.5 litres, which a 24 km trip to Colombo needs all of and a little more.
    expect(refused(plannerOrder('fuel', 'OUT006'), [{ ...vehicle('VEH012'), weeklyFuelQuotaL: 3.5, litresUsedThisWeek: 0 }], 'fuel'))
      .toBe('The dry truck VEH012 exceeds its fuel quota before rounding: 3.5 litres needed, 3.5 litres left.');
  });

  it('says why a mall shop whose window never meets its slot is refused, the shop first', () => {
    const refused = (hours: { windowOpen: number; windowClose: number; mallOpen: number; mallClose: number }, named?: string) => {
      const order = plannerOrder('mall', 'OUT017', 'style-folded');
      const day = plannerInput([order], { vehicles: [vehicle('VEH012')] });
      Object.assign(day.outlets.find((shop) => shop.id === 'OUT017')!, hours);
      return refusedReason(day, order, [tryCandidate(planInput(day), order, { vehicleId: 'VEH012', tripNo: 1, existing: false })], 'window', 'short', named);
    };
    expect(refused({ windowOpen: 600, windowClose: 620, mallOpen: 700, mallClose: 750 }))
      .toBe('Colombo closes at 10:20, before its mall opens at 11:40, so the dry truck VEH012 can never reach it in time.');
    expect(refused({ windowOpen: 700, windowClose: 750, mallOpen: 600, mallClose: 620 }))
      .toBe('Colombo opens at 11:40, after its mall closes at 10:20, so the dry truck VEH012 can never reach it in time.');
    expect(refused({ windowOpen: 600, windowClose: 620, mallOpen: 700, mallClose: 750 }, 'VEH012'))
      .toBe('Colombo closes at 10:20, before its mall opens at 11:40, so it can never be reached in time.');
  });

  it('spec 026 calls a truck by its driver when the planner\'s input gives its vehicle one', () => {
    const chaminda = { ...vehicle('VEH012'), driverName: 'Chaminda' };
    const order = plannerOrder('dry', 'OUT030');
    const day = plannerInput([order], { vehicles: [chaminda] });
    const attempt = tryCandidate(planInput(day), order, { vehicleId: 'VEH012', tripNo: 1, existing: false });
    const placed = (existing: boolean, tripNo: number, wording: Wording = 'full') =>
      placementReason(day, order, { ...attempt, slot: { ...attempt.slot, existing, tripNo }, selectionReason: existing ? 'fills an existing run' : 'vehicle ID breaks the tie' }, wording);
    expect(placed(false, 1)).toBe('new run on Chaminda\'s dry truck to Gampaha, vehicle ID breaks the tie');
    expect(placed(true, 2)).toBe('joined Chaminda\'s dry truck on its second trip to Gampaha, fills an existing run');
    expect(placed(false, 1, 'short')).toBe('on Chaminda\'s dry truck (vehicle ID tie)');
    expect(placed(false, 2, 'short')).toBe('on the second trip of Chaminda\'s dry truck (vehicle ID tie)');

    // The trips the planner tries carry the driver, so the checker's own sentence it quotes names him too.
    const style = plannerOrder('style', 'OUT019', 'style-folded');
    const fresh = plannerOrder('fresh', 'OUT006');
    const lateDay = plannerInput([style, fresh], { vehicles: [chaminda] });
    const trial = planInput(lateDay);
    trial.plan.trips = [{ vehicleId: 'VEH012', tripNo: 1, driverName: 'Chaminda', stops: [{ outletId: style.outletId, orderIds: [style.id] }] }];
    const late = tryCandidate(trial, fresh, { vehicleId: 'VEH012', tripNo: 2, existing: false });
    expect(late.input.plan.trips.map((trip) => [trip.tripNo, trip.driverName])).toEqual([[1, 'Chaminda'], [2, 'Chaminda']]);
    expect(refusedReason(lateDay, fresh, [late], 'window', 'short')).toBe('Colombo is reached at 10:56 by the second trip of Chaminda\'s dry truck, after the 08:00 deadline.');
    expect(refusedReason(lateDay, fresh, [late], 'window'))
      .toBe('Colombo is reached at 10:56 by the second trip of Chaminda\'s dry truck, 176 minutes after its window closes at 08:00, and Fresh shops must be reached before 08:00.');

    const waiting = plannerOrder('big', 'OUT001', 'fresh-chilled-carton', 400, { deliveryDate: '2026-06-24', timesDeferred: 1 });
    const vanDay = plannerInput([waiting], { vehicles: [{ ...vehicle('VEH035'), driverName: 'Dilshan' }] });
    const full = tryCandidate(planInput(vanDay), waiting, { vehicleId: 'VEH035', tripNo: 1, existing: false });
    expect(refusedReason(vanDay, waiting, [full], 'over_capacity', 'short')).toBe('Dilshan\'s reefer van carries 2,760 kg, over its 1,040 kg limit.');

    const badulla = plannerOrder('badulla', 'OUT113');
    const kandy = plannerInput([badulla], { depotId: 'Kandy', vehicles: [{ ...vehicle('VEH044'), driverName: 'Prasanna' }] });
    expect(earlyLeaveReason(kandy, { vehicleId: 'VEH044', tripNo: 2, leaveAt: 400, usual: 430 }, 4, badulla))
      .toBe('The rank 4 order for Badulla makes the second trip of Prasanna\'s dry truck leave at 06:40 instead of 07:10.');
  });

  it('names the order that makes a trip leave early first, then the vehicle by its kind', () => {
    const order = plannerOrder('badulla', 'OUT113');
    const day = plannerInput([order], { depotId: 'Kandy', vehicles: [vehicle('VEH044')] });
    expect(earlyLeaveReason(day, { vehicleId: 'VEH044', tripNo: 1, leaveAt: 179, usual: 210 }, 4, order))
      .toBe('The rank 4 order for Badulla makes the dry truck VEH044 leave at 02:59 instead of 03:30.');
    expect(earlyLeaveReason(day, { vehicleId: 'VEH044', tripNo: 2, leaveAt: 400, usual: 430 }, 4, order))
      .toBe('The rank 4 order for Badulla makes the second trip of the dry truck VEH044 leave at 06:40 instead of 07:10.');
  });
});

// The planner's 200 characters hold for the whole reason (spec 011, spec 026): the reason is tightened first with the
// drivers' names kept, and only when no tight form fits do the names give way to kind and id (review of 026), never by
// cutting a word or leaving out a fact.
describe('every reason within 200 characters', () => {
  it('takes the fullest wording that fits: whole sentences, the short forms, the tight forms by driver, then kind and id', () => {
    const rendered: Wording[] = [];
    const sized = (lengths: Record<Wording, number>) => (wording: Wording) => {
      rendered.push(wording);
      return 'x'.repeat(lengths[wording]);
    };
    const lengths = (named: [number, number, number, number, number], plain: [number, number, number, number]): Record<Wording, number> => ({
      full: named[0], short: named[1], 'named tight': named[2], 'named tightest': named[3], 'named shortest': named[4],
      plain: plain[0], tight: plain[1], tightest: plain[2], shortest: plain[3],
    });
    expect(fittedReason(sized(lengths([200, 150, 140, 130, 126], [150, 120, 100, 96])))).toHaveLength(200);
    expect(rendered).toEqual(['full']);
    rendered.length = 0;
    // A tight form with the names fits, so the kind-and-id forms, shorter still, are never tried.
    expect(fittedReason(sized(lengths([260, 206, 199, 180, 176], [165, 150, 130, 126])))).toHaveLength(199);
    expect(rendered).toEqual(['full', 'short', 'named tight']);
    rendered.length = 0;
    expect(fittedReason(sized(lengths([260, 230, 210, 200, 196], [207, 183, 165, 161])))).toHaveLength(200);
    expect(rendered).toEqual(['full', 'short', 'named tight', 'named tightest']);
    rendered.length = 0;
    expect(fittedReason(sized(lengths([260, 240, 220, 204, 199], [207, 183, 165, 161])))).toHaveLength(199);
    expect(rendered).toEqual(['full', 'short', 'named tight', 'named tightest', 'named shortest']);
    rendered.length = 0;
    // Only when no form with the names fits do they give way to kind and id, short then tight.
    expect(fittedReason(sized(lengths([260, 250, 230, 215, 211], [207, 183, 165, 161])))).toHaveLength(183);
    expect(rendered).toEqual(['full', 'short', 'named tight', 'named tightest', 'named shortest', 'plain', 'tight']);
    rendered.length = 0;
    expect(fittedReason(sized(lengths([260, 250, 240, 230, 220], [240, 220, 201, 197])))).toHaveLength(197);
    expect(rendered).toEqual(['full', 'short', 'named tight', 'named tightest', 'named shortest', 'plain', 'tight', 'tightest', 'shortest']);
    // Longer even then, it keeps its length rather than be cut.
    expect(fittedReason(sized(lengths([260, 250, 240, 230, 220], [240, 230, 210, 206])))).toHaveLength(206);
  });

  it('keeps the drivers\' names in the tight forms: "joined Chaminda\'s dry truck"', () => {
    const chaminda = { ...vehicle('VEH012'), driverName: 'Chaminda' };
    const order = plannerOrder('dry', 'OUT030');
    const day = plannerInput([order], { vehicles: [chaminda] });
    const attempt = tryCandidate(planInput(day), order, { vehicleId: 'VEH012', tripNo: 1, existing: false });
    const placed = (existing: boolean, tripNo: number, wording: Wording) =>
      placementReason(day, order, { ...attempt, slot: { ...attempt.slot, existing, tripNo }, selectionReason: existing ? 'fills an existing run' : 'vehicle ID breaks the tie' }, wording);
    expect(placed(false, 2, 'named tight')).toBe('on Chaminda\'s dry truck\'s second trip (vehicle ID tie)');
    expect(placed(true, 1, 'named tightest')).toBe('joined Chaminda\'s dry truck');
    // A truck with no driver goes by its kind and id in the tight forms with names too.
    const plain = plannerInput([order], { vehicles: [vehicle('VEH012')] });
    expect(placementReason(plain, order, { ...attempt, selectionReason: 'vehicle ID breaks the tie' }, 'named tight')).toBe('on dry truck VEH012 (vehicle ID tie)');
    const waiting = plannerOrder('waiting', 'OUT001', 'fresh-chilled-carton', 400, { deliveryDate: '2026-06-24', timesDeferred: 1 });
    const vanDay = plannerInput([waiting], { vehicles: [{ ...vehicle('VEH035'), driverName: 'Dilshan' }] });
    const full = tryCandidate(planInput(vanDay), waiting, { vehicleId: 'VEH035', tripNo: 1, existing: false });
    expect(refusedReason(vanDay, waiting, [full], 'over_capacity', 'named tight')).toBe('Dilshan\'s reefer van carries 2,760 kg, over its 1,040 kg limit.');
    expect(refusedReason(vanDay, waiting, [full], 'over_capacity', 'named shortest')).toBe('Dilshan\'s reefer van over its 1,040 kg limit with 2,760 kg.');
  });

  it('names trucks by kind and id once the drivers\' names do not fit, and words them tightly only after that', () => {
    const chaminda = { ...vehicle('VEH012'), driverName: 'Chaminda' };
    const order = plannerOrder('dry', 'OUT030');
    const day = plannerInput([order], { vehicles: [chaminda] });
    const attempt = tryCandidate(planInput(day), order, { vehicleId: 'VEH012', tripNo: 1, existing: false });
    const placed = (existing: boolean, tripNo: number, wording: Wording) =>
      placementReason(day, order, { ...attempt, slot: { ...attempt.slot, existing, tripNo }, selectionReason: existing ? 'fills an existing run' : 'vehicle ID breaks the tie' }, wording);
    expect(placed(false, 2, 'short')).toBe('on the second trip of Chaminda\'s dry truck (vehicle ID tie)');
    expect(placed(false, 2, 'plain')).toBe('on the second trip of the dry truck VEH012 (vehicle ID tie)');
    expect(placed(false, 2, 'tight')).toBe('on dry truck VEH012\'s second trip (vehicle ID tie)');
    expect(placed(true, 1, 'tight')).toBe('joined dry truck VEH012 (fills existing run)');
    // The last wording also leaves out the deciding rule, and keeps the truck and its trip.
    expect(placed(false, 2, 'tightest')).toBe('on dry truck VEH012\'s second trip');
    expect(placed(true, 1, 'tightest')).toBe('joined dry truck VEH012');

    // A late second trip to the order's own shop: kind and id, then also without the shop its rank has named already.
    const style = plannerOrder('style', 'OUT019', 'style-folded');
    const fresh = plannerOrder('fresh', 'OUT006');
    const lateDay = plannerInput([style, fresh], { vehicles: [chaminda] });
    const trial = planInput(lateDay);
    trial.plan.trips = [{ vehicleId: 'VEH012', tripNo: 1, driverName: 'Chaminda', stops: [{ outletId: style.outletId, orderIds: [style.id] }] }];
    const late = tryCandidate(trial, fresh, { vehicleId: 'VEH012', tripNo: 2, existing: false });
    expect(refusedReason(lateDay, fresh, [late], 'window', 'plain')).toBe('Colombo is reached at 10:56 by the second trip of the dry truck VEH012, after the 08:00 deadline.');
    expect(refusedReason(lateDay, fresh, [late], 'window', 'tight')).toBe('reached at 10:56 by dry truck VEH012\'s second trip, after 08:00.');
    expect(refusedReason(lateDay, fresh, [late], 'window', 'tightest')).toBe('reached at 10:56 by dry truck VEH012\'s second trip, after 08:00.');
    expect(refusedReason(lateDay, fresh, [late], 'window', 'tight', 'VEH012')).toBe('reached at 10:56 by its second trip, after 08:00.');

    // Another shop made late keeps its place, as the order's own is not the one named.
    const first = ['OUT026', 'OUT030', 'OUT028'].map((id) => plannerOrder(id, id));
    const deadline = plannerOrder('deadline', 'OUT010');
    const added = plannerOrder('added', 'OUT027');
    const nextDay = plannerInput([...first, deadline, added], { vehicles: [chaminda] });
    nextDay.outlets.find((s) => s.id === added.outletId)!.windowOpen = 420;
    const nextTrial = planInput(nextDay);
    nextTrial.plan.trips = [
      { vehicleId: 'VEH012', tripNo: 1, driverName: 'Chaminda', stops: first.map((o) => ({ outletId: o.outletId, orderIds: [o.id] })) },
      { vehicleId: 'VEH012', tripNo: 2, driverName: 'Chaminda', stops: [{ outletId: deadline.outletId, orderIds: [deadline.id] }] },
    ];
    const otherLate = tryCandidate(nextTrial, added, { vehicleId: 'VEH012', tripNo: 1, existing: true });
    expect(refusedReason(nextDay, added, [otherLate], 'window', 'tight')).toBe('Gampaha reached at 08:14 by dry truck VEH012, after 08:00.');

    const waiting = plannerOrder('big', 'OUT001', 'fresh-chilled-carton', 400, { deliveryDate: '2026-06-24', timesDeferred: 1 });
    const vanDay = plannerInput([waiting], { vehicles: [{ ...vehicle('VEH035'), driverName: 'Dilshan' }] });
    const full = tryCandidate(planInput(vanDay), waiting, { vehicleId: 'VEH035', tripNo: 1, existing: false });
    expect(refusedReason(vanDay, waiting, [full], 'over_capacity', 'plain')).toBe('The reefer van VEH035 carries 2,760 kg, over its 1,040 kg limit.');
    expect(refusedReason(vanDay, waiting, [full], 'over_capacity', 'tight')).toBe('Reefer van VEH035 carries 2,760 kg, over its 1,040 kg limit.');
    // The last wording says the limit first and the load after it, four characters shorter with every figure kept.
    expect(refusedReason(vanDay, waiting, [full], 'over_capacity', 'tightest')).toBe('Reefer van VEH035 carries 2,760 kg, over its 1,040 kg limit.');
    expect(refusedReason(vanDay, waiting, [full], 'over_capacity', 'shortest')).toBe('Reefer van VEH035 over its 1,040 kg limit with 2,760 kg.');
    expect(refusedReason(vanDay, waiting, [full], 'over_capacity', 'shortest', 'VEH035')).toBe('It is over its 1,040 kg limit with 2,760 kg.');
    const rails = plannerOrder('rails', 'OUT019', 'style-hanging', 80);
    const railsDay = plannerInput([rails], { vehicles: [vehicle('VEH008')] });
    const railsFull = tryCandidate(planInput(railsDay), rails, { vehicleId: 'VEH008', tripNo: 2, existing: false });
    expect(refusedReason(railsDay, rails, [railsFull], 'over_capacity', 'shortest')).toBe('Dry truck VEH008 over its 22 m³ limit with 24 m³ on its second trip.');

    // Fuel in the tight form: the litres it needs and has left say it is over, unless rounding hides that.
    const fuelRefused = (fleet: PlannerInput['vehicles'], shop: string, product?: string) => {
      const order = plannerOrder('fuel', shop, product);
      const fuelDay = plannerInput([order], { vehicles: fleet });
      return refusedReason(fuelDay, order, [tryCandidate(planInput(fuelDay), order, { vehicleId: fleet[0]!.id, tripNo: 1, existing: false })], 'fuel', 'tight');
    };
    expect(fuelRefused([{ ...vehicle('VEH001'), driverName: 'Chaminda', litresUsedThisWeek: 300 }], 'OUT054', 'fresh-chilled-carton'))
      .toBe('Reefer truck VEH001 needs 51.1 litres, with 40 left of its quota.');
    expect(fuelRefused([{ ...vehicle('VEH012'), weeklyFuelQuotaL: 3.5, litresUsedThisWeek: 0 }], 'OUT006'))
      .toBe('Dry truck VEH012 exceeds its quota before rounding: 3.5 litres needed, 3.5 left.');

    const mall = plannerOrder('mall', 'OUT017', 'style-folded');
    const mallDay = plannerInput([mall], { vehicles: [chaminda] });
    Object.assign(mallDay.outlets.find((s) => s.id === 'OUT017')!, { windowOpen: 600, windowClose: 620, mallOpen: 700, mallClose: 750 });
    const never = tryCandidate(planInput(mallDay), mall, { vehicleId: 'VEH012', tripNo: 1, existing: false });
    expect(refusedReason(mallDay, mall, [never], 'window', 'tight')).toBe('Colombo closes at 10:20, before its mall opens at 11:40, so dry truck VEH012 can never reach it in time.');

    const badulla = plannerOrder('badulla', 'OUT113');
    const kandy = plannerInput([badulla], { depotId: 'Kandy', vehicles: [{ ...vehicle('VEH044'), driverName: 'Prasanna' }] });
    const early = (wording: Wording) => earlyLeaveReason(kandy, { vehicleId: 'VEH044', tripNo: 1, leaveAt: 179, usual: 210 }, 4, badulla, wording);
    expect(early('short')).toBe('The rank 4 order for Badulla makes Prasanna\'s dry truck leave at 02:59 instead of 03:30.');
    expect(early('plain')).toBe('The rank 4 order for Badulla makes the dry truck VEH044 leave at 02:59 instead of 03:30.');
    expect(early('tight')).toBe('The rank 4 order for Badulla makes dry truck VEH044 leave at 02:59 instead of 03:30.');
  });

  it('checks a sentence the short forms cannot say again without the drivers\' names once they have given way', () => {
    // A second trip set to leave before the truck is back: its block is the checker's own sentence.
    const a = plannerOrder('a', 'OUT026');
    const b = plannerOrder('b', 'OUT006');
    const day = plannerInput([a, b], { vehicles: [{ ...vehicle('VEH012'), driverName: 'Chaminda' }] });
    const input = { ...planInput(day), orders: [a, b], vehicles: day.vehicles.filter((v) => v.id === 'VEH012'), plan: { deferrals: [], trips: [
      { vehicleId: 'VEH012', tripNo: 1, driverName: 'Chaminda', stops: [{ outletId: 'OUT026', orderIds: ['a'] }] },
      { vehicleId: 'VEH012', tripNo: 2, driverName: 'Chaminda', leaveAt: toMinutes('04:00'), stops: [{ outletId: 'OUT006', orderIds: ['b'] }] },
    ] } };
    const overlap = { slot: { vehicleId: 'VEH012', tripNo: 2, existing: false }, input, check: null, stage: 'window' as const };
    expect(refusedReason(day, b, [overlap], 'window', 'short')).toBe('The second trip of Chaminda\'s dry truck leaves at 04:00, before it is back and reloaded at 05:29.');
    expect(refusedReason(day, b, [overlap], 'window', 'plain')).toBe('The second trip of the dry truck VEH012 leaves at 04:00, before it is back and reloaded at 05:29.');
  });
});
