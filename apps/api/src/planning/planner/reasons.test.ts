import { describe, expect, it } from 'vitest';
import { vehicle } from '../testing/shared';
import type { PlanInput, PlannerInput } from '../types';
import { tryCandidate } from './candidates';
import { deferralDecisions, deferralFor, furthestRejection, placementReason, priorityReason, quantityWord, refusedReason, type PlannerDeferralCode } from './reasons';
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
    ['over_capacity', 'The trucks going to Colombo on Thursday were full.'],
    ['window', 'No truck could reach Colombo before its window closed at 07:30 on Thursday.'],
    ['fuel', "The trucks that could reach Colombo on Thursday did not have enough of this week's fuel left."],
  ])('AC-17 %s is a plain shop sentence with a weekday', (code, sentence) => {
    const deferred = deferralFor(input(), source, code);
    expect(deferred).toMatchObject({ orderId: 'waiting', code, reason: sentence });
    plain(deferred.reason);
    expect(deferred.reason.length).toBeLessThanOrEqual(200);
  });

  it('uses a shop name when supplied and the district when the name is an ID or too long', () => {
    const day = input();
    day.outlets.find((o) => o.id === source.outletId)!.name = 'Fresh Wellawatte';
    expect(deferralFor(day, source, 'no_van').reason).toBe('No van was free for Fresh Wellawatte on Thursday, which takes vans only.');
    day.outlets.find((o) => o.id === source.outletId)!.name = 'A long shop name '.repeat(30);
    expect(deferralFor(day, source, 'window').reason).toBe('No truck could reach Colombo before its window closed at 07:30 on Thursday.');
  });

  it('AC-17 a deferred split is one sentence naming sent/left counts and brand packaging', () => {
    for (const [shop, product, noun] of [['OUT001', 'fresh-chilled-carton', 'cartons'], ['OUT019', 'style-folded', 'boxes'], ['OUT024', 'tech-tv', 'items']]) {
      const order = plannerOrder('rest', shop!, product!, 60, { splitFrom: 'parent' });
      const day = plannerInput([order]);
      const deferred = deferralFor(day, order, 'over_capacity', { split: { keptUnits: 75, remainingUnits: 60 } });
      expect(deferred.reason).toBe(`75 of the 135 ${noun} for Colombo go on Thursday; the other 60 wait for the next plan because the truck was full.`);
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
