import { describe, expect, it } from 'vitest';
import { vehicle } from '../testing/shared';
import type { PlanInput, PlannerInput } from '../types';
import { tryCandidate } from './candidates';
import {
  deferralDecisions, deferralFor, earlyLeaveReason, furthestRejection, placementReason, priorityReason, quantityWord, refusedReason, type PlannerDeferralCode,
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
    expect(reason).toMatch(/new run on VEH012/);
    expect(reason).toContain('Gampaha');
    expect(reason).toContain('largest free truck');
    expect(placementReason(day, order, { ...attempt, slot: { ...attempt.slot, existing: true }, selectionReason: 'to fill an existing run' })).toMatch(/joined VEH012/);
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
    const priority = priorityReason(day, order, 1, true);
    expect(priority).toMatch(/Rank 1.*Wed.*chilled.*07:30/);
    expect(priority.length).toBeLessThan(65);
    const placement = placementReason(day, order, { ...attempt, selectionReason: 'keeps the usual leaving times' }, true);
    expect(placement).toMatch(/VEH035 trip 1.*usual/);
    expect(placement.length).toBeLessThan(55);
    const refusal = refusedReason(day, order, [attempt], 'over_capacity', true);
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
    const placed = (existing: boolean, tripNo: number, compact = false) =>
      placementReason(day, order, { ...attempt, slot: { ...attempt.slot, existing, tripNo }, selectionReason: existing ? 'fills an existing run' : 'vehicle ID breaks the tie' }, compact);
    expect(placed(false, 1)).toBe('new run on the dry truck VEH012 to Gampaha, vehicle ID breaks the tie');
    expect(placed(true, 1)).toBe('joined the dry truck VEH012\'s run to Gampaha, fills an existing run');
    expect(placed(false, 2)).toBe('new second trip on the dry truck VEH012 to Gampaha, vehicle ID breaks the tie');
    expect(placed(true, 2)).toBe('joined the dry truck VEH012\'s second trip to Gampaha, fills an existing run');
    // The short forms the 200-character cap falls back to.
    expect(placed(false, 1, true)).toBe('on the dry truck VEH012 (vehicle ID tie)');
    expect(placed(true, 1, true)).toBe('joined the dry truck VEH012 (fills existing run)');
    expect(placed(false, 2, true)).toBe('on the dry truck VEH012\'s second trip (vehicle ID tie)');
    expect(placed(true, 2, true)).toBe('joined the dry truck VEH012\'s second trip (fills existing run)');
  });

  it('says a refused shop first in the short form, then the vehicle by its kind', () => {
    // A Style run first, so the Colombo order could only go on a second trip, and that reaches it late.
    const style = plannerOrder('style', 'OUT019', 'style-folded');
    const fresh = plannerOrder('fresh', 'OUT006');
    const day = plannerInput([style, fresh], { vehicles: [vehicle('VEH012')] });
    const trial = planInput(day);
    trial.plan.trips = [{ vehicleId: 'VEH012', tripNo: 1, stops: [{ outletId: style.outletId, orderIds: [style.id] }] }];
    const late = tryCandidate(trial, fresh, { vehicleId: 'VEH012', tripNo: 2, existing: false });
    expect(refusedReason(day, fresh, [late], 'window', true)).toBe('Colombo is reached at 10:56 by the second trip of the dry truck VEH012, after the 08:00 deadline.');
    // The long form is the checker's own sentence, with the shop's id read as its district.
    expect(refusedReason(day, fresh, [late], 'window')).toBe('Colombo is reached at 10:56 by the second trip of the dry truck VEH012, 176 minutes after its window closes at 08:00, and Fresh shops must be reached before 08:00.');
  });

  it('says what a refused vehicle carries against its limits, and its fuel, by its kind', () => {
    const refused = (order: ReturnType<typeof plannerOrder>, fleet: PlannerInput['vehicles'], code: PlannerDeferralCode) => {
      const day = plannerInput([order], { vehicles: fleet });
      return refusedReason(day, order, [tryCandidate(planInput(day), order, { vehicleId: fleet[0]!.id, tripNo: 1, existing: false })], code, true);
    };
    const waiting = plannerOrder('big', 'OUT001', 'fresh-chilled-carton', 400, { deliveryDate: '2026-06-24', timesDeferred: 1 });
    expect(refused(waiting, [vehicle('VEH035')], 'over_capacity')).toBe('The reefer van VEH035 carries 2,760 kg, over its 1,040 kg limit.');
    expect(refused(plannerOrder('rails', 'OUT019', 'style-hanging', 80), [vehicle('VEH008')], 'over_capacity')).toBe('The dry truck VEH008 carries 24 m³, over its 22 m³ limit.');
    // A week's quota of 3.5 litres, which a 24 km trip to Colombo needs all of and a little more.
    expect(refused(plannerOrder('fuel', 'OUT006'), [{ ...vehicle('VEH012'), weeklyFuelQuotaL: 3.5, litresUsedThisWeek: 0 }], 'fuel'))
      .toBe('The dry truck VEH012 exceeds its fuel quota before rounding: 3.5 litres needed, 3.5 litres left.');
  });

  it('says why a mall shop whose window never meets its slot is refused, the shop first', () => {
    const refused = (hours: { windowOpen: number; windowClose: number; mallOpen: number; mallClose: number }) => {
      const order = plannerOrder('mall', 'OUT017', 'style-folded');
      const day = plannerInput([order], { vehicles: [vehicle('VEH012')] });
      Object.assign(day.outlets.find((shop) => shop.id === 'OUT017')!, hours);
      return refusedReason(day, order, [tryCandidate(planInput(day), order, { vehicleId: 'VEH012', tripNo: 1, existing: false })], 'window', true);
    };
    expect(refused({ windowOpen: 600, windowClose: 620, mallOpen: 700, mallClose: 750 }))
      .toBe('Colombo closes at 10:20, before its mall opens at 11:40, so the dry truck VEH012 can never reach it in time.');
    expect(refused({ windowOpen: 700, windowClose: 750, mallOpen: 600, mallClose: 620 }))
      .toBe('Colombo opens at 11:40, after its mall closes at 10:20, so the dry truck VEH012 can never reach it in time.');
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
