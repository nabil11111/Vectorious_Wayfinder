import { Suggestion, type DraftPlan, type SuggestionDecision } from '@wayfinder/contracts';
import { describe, expect, it } from 'vitest';
import { buildSuggestedPlan, type PlannerResult } from '../planning';
import { plannerInput, plannerOrder } from '../planning/planner/testing/input';
import { vehicle } from '../planning/testing/shared';
import { boardSuggestion, decisionOpen, suggestionOf } from './suggestion';

// Spec 014's plain functions on made-up days: when a decision is open (AC-11), and how the planner's result becomes
// the draft to save and the suggestion to keep.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [A, B, C, FIRST, SECOND, DILSHAN] = [1, 2, 3, 4, 5, 6].map(id) as [string, string, string, string, string, string];
const BUILT = '2026-06-24T10:30:00.000Z';
const ACCEPTED = '2026-06-24T10:38:00.000Z';

// Spec 011's Badulla trip, which leaves at 02:59 to reach every shop in time, and an order that waits for its window.
const early: SuggestionDecision = {
  key: 'early_leave:VEH044:1', kind: 'early_leave', reason: 'VEH044 trip 1 leaves at 02:59 instead of 03:30 after adding the rank 4 order for Badulla.',
  orderId: null, vehicleId: 'VEH044', tripNo: 1, leaveAt: 179, acceptedAt: null,
};
const late: SuggestionDecision = {
  key: `late_order:${B}`, kind: 'late_order', reason: 'No truck could reach Badulla before 08:00 on Thursday.',
  orderId: B, vehicleId: null, tripNo: null, leaveAt: null, acceptedAt: null,
};
const waited: SuggestionDecision = { ...late, key: `waited_again:${B}`, kind: 'waited_again' };
const suggested: DraftPlan = {
  mixBrands: false,
  trips: [{ vehicleId: 'VEH044', tripNo: 1, leaveAt: 179, driverId: null, stops: [{ outletId: 'OUT110', orderIds: [A] }] }],
  deferrals: [{ orderId: B, code: 'window', reason: late.reason }],
};
const edited = (change: (plan: DraftPlan) => void) => {
  const plan = structuredClone(suggested);
  change(plan);
  return plan;
};
const planned = (result: PlannerResult) => {
  if (result.status === 'unavailable') throw new Error('Expected a suggestion');
  return result;
};

describe('when a decision is open', () => {
  it('AC-11 an early departure is open while its trip leaves at that time, and closed at 03:30 or once removed', () => {
    expect(decisionOpen(early, suggested, suggested)).toBe(true);
    expect(decisionOpen(early, suggested, edited((plan) => { plan.trips[0]!.driverId = DILSHAN; }))).toBe(true);
    expect(decisionOpen(early, suggested, edited((plan) => { plan.trips[0]!.leaveAt = 210; }))).toBe(false);
    expect(decisionOpen(early, suggested, edited((plan) => { plan.trips[0]!.leaveAt = null; }))).toBe(false);
    expect(decisionOpen(early, suggested, edited((plan) => { plan.trips = []; }))).toBe(false);
    expect(decisionOpen(early, suggested, edited((plan) => { plan.trips[0]!.tripNo = 2; }))).toBe(false);
  });

  it('AC-11 a waiting or late order is open while the draft defers it with the planner\'s code and reason', () => {
    for (const decision of [late, waited]) {
      expect(decisionOpen(decision, suggested, suggested)).toBe(true);
      // On a trip, unplanned, reworded, or kept out for another reason: the dispatcher has decided by editing.
      expect(decisionOpen(decision, suggested, edited((plan) => { plan.deferrals = []; plan.trips[0]!.stops[0]!.orderIds.push(B); }))).toBe(false);
      expect(decisionOpen(decision, suggested, edited((plan) => { plan.deferrals = []; }))).toBe(false);
      expect(decisionOpen(decision, suggested, edited((plan) => { plan.deferrals[0]!.reason = 'Badulla takes it on Friday.'; }))).toBe(false);
      expect(decisionOpen(decision, suggested, edited((plan) => { plan.deferrals[0]!.code = 'dispatcher_choice'; }))).toBe(false);
    }
  });

  it('AC-11 an accepted decision is never open again', () => {
    for (const decision of [early, late, waited]) expect(decisionOpen({ ...decision, acceptedAt: ACCEPTED }, suggested, suggested)).toBe(false);
  });

  it('AC-11 the board answers every decision with whether it is open on the draft, and the choices as they were', () => {
    const stored: Suggestion = { builtAt: BUILT, plan: suggested, choices: [{ orderId: A, rank: 1, resultOrderIds: [A], reason: 'Rank 1: new order.' }],
      decisions: [early, { ...late, acceptedAt: ACCEPTED }, waited] };
    const draft = edited((plan) => { plan.trips[0]!.leaveAt = 210; });
    expect(boardSuggestion(stored, draft)).toEqual({
      builtAt: BUILT, choices: stored.choices,
      decisions: [{ ...early, open: false }, { ...late, acceptedAt: ACCEPTED, open: false }, { ...waited, open: true }],
    });
  });
});

describe('the planner\'s result as a draft and a suggestion', () => {
  it('puts each part of a split where the planner put it, keeps each vehicle\'s driver and ranks every order', () => {
    // A carried-over order of 180 chilled cartons that only the fridge van can take: 150 go on its first trip and
    // the other 30 on its second (spec 011, AC-13).
    const result = planned(buildSuggestedPlan(plannerInput([
      plannerOrder(C, 'OUT006'),
      plannerOrder(A, 'OUT001', 'fresh-chilled-carton', 180, { deliveryDate: '2026-06-24', timesDeferred: 1 }),
    ], { vehicles: [vehicle('VEH035'), vehicle('VEH012')] })));
    const parts = new Map([[`split:${A}:keep`, FIRST], [`split:${A}:rest`, SECOND]]);
    const { draft, suggestion } = suggestionOf(result, parts, new Map([['VEH035', DILSHAN], ['VEH020', id(7)]]), BUILT);
    expect(draft).toEqual({
      mixBrands: false,
      trips: [
        { vehicleId: 'VEH012', tripNo: 1, leaveAt: null, driverId: null, stops: [{ outletId: 'OUT006', orderIds: [C] }] },
        { vehicleId: 'VEH035', tripNo: 1, leaveAt: null, driverId: DILSHAN, stops: [{ outletId: 'OUT001', orderIds: [FIRST] }] },
        { vehicleId: 'VEH035', tripNo: 2, leaveAt: null, driverId: DILSHAN, stops: [{ outletId: 'OUT001', orderIds: [SECOND] }] },
      ],
      deferrals: [],
    });
    expect(suggestion).toEqual({
      builtAt: BUILT, plan: draft,
      choices: [
        { orderId: A, rank: 1, resultOrderIds: [FIRST, SECOND], reason: result.choices[0]!.reason },
        { orderId: C, rank: 2, resultOrderIds: [C], reason: result.choices[1]!.reason },
      ],
      decisions: [],
    });
    expect(Suggestion.parse(suggestion)).toEqual(suggestion);
  });

  it('keys every decision, with the part it names and the early trip\'s time, none accepted', () => {
    // The shop opens after the Fresh deadline, so the kept part's trip leaves early and the rest waits for its window
    // (spec 011's AC-20 example).
    const input = plannerInput([plannerOrder(A, 'OUT001', 'fresh-chilled-carton', 180, { deliveryDate: '2026-06-24', timesDeferred: 1 })], { vehicles: [vehicle('VEH035')] });
    Object.assign(input.outlets.find((s) => s.id === 'OUT001')!, { windowOpen: 600, windowClose: 800 });
    const result = planned(buildSuggestedPlan(input));
    const leaveAt = result.input.plan.trips.find((t) => t.vehicleId === 'VEH035' && t.tripNo === 1)!.leaveAt!;
    const { draft, suggestion } = suggestionOf(result, new Map([[`split:${A}:keep`, FIRST], [`split:${A}:rest`, SECOND]]), new Map(), BUILT);
    expect(draft.trips).toEqual([{ vehicleId: 'VEH035', tripNo: 1, leaveAt, driverId: null, stops: [{ outletId: 'OUT001', orderIds: [FIRST] }] }]);
    expect(draft.deferrals).toEqual([{ orderId: SECOND, code: 'window', reason: result.input.plan.deferrals[0]!.reason }]);
    expect(suggestion.decisions).toEqual([
      { key: 'early_leave:VEH035:1', kind: 'early_leave', reason: result.decisions[0]!.reason, orderId: null, vehicleId: 'VEH035', tripNo: 1, leaveAt, acceptedAt: null },
      { key: `waited_again:${SECOND}`, kind: 'waited_again', reason: result.decisions[1]!.reason, orderId: SECOND, vehicleId: null, tripNo: null, leaveAt: null, acceptedAt: null },
      { key: `late_order:${SECOND}`, kind: 'late_order', reason: result.decisions[2]!.reason, orderId: SECOND, vehicleId: null, tripNo: null, leaveAt: null, acceptedAt: null },
    ]);
    expect(boardSuggestion(suggestion, draft).decisions.map((d) => d.open)).toEqual([true, true, true]);
    const reworded = { ...draft, trips: draft.trips.map((t) => ({ ...t, leaveAt: null })), deferrals: draft.deferrals.map((d) => ({ ...d, reason: 'Next run.' })) };
    expect(boardSuggestion(suggestion, reworded).decisions.map((d) => d.open)).toEqual([false, false, false]);
  });

  it('refuses a split reference with no part made for it, and keeps Mix brands as the planner had it', () => {
    const result = planned(buildSuggestedPlan(plannerInput([
      plannerOrder(A, 'OUT001', 'fresh-chilled-carton', 180, { deliveryDate: '2026-06-24', timesDeferred: 1 }),
    ], { vehicles: [vehicle('VEH035')] })));
    expect(() => suggestionOf(result, new Map(), new Map(), BUILT)).toThrow(/split:/);
    const mixed = planned(buildSuggestedPlan(plannerInput([plannerOrder(C, 'OUT006')], { vehicles: [vehicle('VEH012')], settings: { ...plannerInput().settings, mixBrands: true } })));
    expect(suggestionOf(mixed, new Map(), new Map(), BUILT).draft.mixBrands).toBe(true);
  });
});
