import { Suggestion, type DraftPlan, type SuggestionDecision } from '@wayfinder/contracts';
import { describe, expect, it } from 'vitest';
import { buildSuggestedPlan, type PlannerResult } from '../planning';
import { plannerInput, plannerOrder } from '../planning/planner/testing/input';
import { vehicle } from '../planning/testing/shared';
import { boardSuggestion, decisionOpen, driversFor, namedDrivers, suggestionOf, usualPairing } from './suggestion';

// Spec 014's plain functions on made-up days: when a decision is open (AC-11), and how the planner's result becomes
// the draft to save and the suggestion to keep. Spec 022's drivers for the vehicles a suggestion uses (AC-3), which spec
// 026 takes from each vehicle's usual driver, and the names the planner's sentences call the vehicles by.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [A, B, C, FIRST, SECOND, DILSHAN] = [1, 2, 3, 4, 5, 6].map(id) as [string, string, string, string, string, string];
// Four of the depot's drivers in staff ID order: D-001, D-003, D-004 and D-005.
const [D001, D003, D004, D005] = [11, 13, 14, 15].map(id) as [string, string, string, string];
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

  it('spec 022 AC-3 gives a vehicle the same driver on both its trips', () => {
    const result = planned(buildSuggestedPlan(plannerInput([
      plannerOrder(C, 'OUT006'),
      plannerOrder(A, 'OUT001', 'fresh-chilled-carton', 180, { deliveryDate: '2026-06-24', timesDeferred: 1 }),
    ], { vehicles: [vehicle('VEH035'), vehicle('VEH012')] })));
    const drivers = driversFor(result.input.plan.trips.map((trip) => trip.vehicleId), new Map(), new Map(), [D001, D003, D004]);
    const { draft } = suggestionOf(result, new Map([[`split:${A}:keep`, FIRST], [`split:${A}:rest`, SECOND]]), drivers, BUILT);
    expect(draft.trips.map((trip) => [trip.vehicleId, trip.tripNo, trip.driverId])).toEqual([['VEH012', 1, D001], ['VEH035', 1, D003], ['VEH035', 2, D003]]);
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

describe('the drivers of the vehicles a suggestion uses (spec 022, D-97, spec 026)', () => {
  // Each vehicle's usual driver here, as usualPairing gives them: VEH001 D-001, VEH002 D-003, VEH004 D-004, VEH035 D-005.
  const USUAL = new Map<string, string | null>([['VEH001', D001], ['VEH002', D003], ['VEH004', D004], ['VEH035', D005]]);

  it('spec 026 gives each vehicle the driver the draft already had, else its usual driver, else the first free one', () => {
    // VEH035 had D-001 in the draft: the dispatcher's choice wins, so VEH001 cannot have its usual D-001.
    expect(driversFor(['VEH035', 'VEH004', 'VEH001', 'VEH035'], new Map([['VEH035', D001]]), USUAL, [D001, D003, D004, D005]))
      .toEqual(new Map([['VEH001', D003], ['VEH004', D004], ['VEH035', D001]]));
    // With no draft before, each takes its usual driver.
    expect(driversFor(['VEH002', 'VEH001', 'VEH004'], new Map(), USUAL, [D001, D003, D004, D005]))
      .toEqual(new Map([['VEH001', D001], ['VEH002', D003], ['VEH004', D004]]));
  });

  it('spec 026 lets no vehicle take another\'s usual driver ahead of it, and a vehicle with none takes the first free', () => {
    // VEH002's usual D-003 drives VEH004 in the draft, so VEH002 takes the first driver free by staff ID once VEH001
    // and VEH035 have their own: D-004, VEH004's usual driver, whom VEH004 no longer needs.
    expect(driversFor(['VEH001', 'VEH002', 'VEH004', 'VEH035'], new Map([['VEH004', D003]]), USUAL, [D001, D003, D004, D005]))
      .toEqual(new Map([['VEH001', D001], ['VEH002', D004], ['VEH004', D003], ['VEH035', D005]]));
    // VEH036 has no usual driver.
    expect(driversFor(['VEH036', 'VEH001'], new Map(), USUAL, [D001, D003])).toEqual(new Map([['VEH001', D001], ['VEH036', D003]]));
  });

  it('spec 022 AC-3 gives no driver to two vehicles, frees a left-out vehicle\'s driver, and runs out only with every driver taken', () => {
    // VEH008 had D-001 and is not in the suggestion, so D-001 is free again for VEH001, whose usual driver it is.
    expect(driversFor(['VEH001', 'VEH010'], new Map([['VEH008', D001], ['VEH010', D003]]), USUAL, [D001, D003, D004]))
      .toEqual(new Map([['VEH001', D001], ['VEH010', D003]]));
    expect(driversFor(['VEH003', 'VEH006', 'VEH007'], new Map(), new Map(), [D001, D003]))
      .toEqual(new Map([['VEH003', D001], ['VEH006', D003], ['VEH007', null]]));
    expect(driversFor([], new Map([['VEH003', D001]]), USUAL, [D001])).toEqual(new Map());
  });
});

describe('the driver each vehicle is named by in the planner\'s sentences (spec 026)', () => {
  it('names a vehicle of the plan by its driver, and any other by its first driver unless the plan gave him to another', () => {
    // Before the build: the draft's or usual driver of every vehicle, VEH038 with none.
    const first = new Map<string, string | null>([['VEH001', D001], ['VEH003', D003], ['VEH008', D004], ['VEH038', null]]);
    // The plan uses VEH001 and VEH038, which takes D-003, the driver of VEH003, which stays in the workshop.
    expect(namedDrivers(first, new Map([['VEH001', D001], ['VEH038', D003]])))
      .toEqual(new Map([['VEH001', D001], ['VEH003', null], ['VEH008', D004], ['VEH038', D003]]));
    // Nothing moved: the names are the first ones.
    expect(namedDrivers(first, new Map([['VEH001', D001], ['VEH008', D004]]))).toEqual(first);
  });
});

describe('each vehicle\'s usual driver (spec 026)', () => {
  it('AC-4 is the driver who drove it on the latest sent plan, else the next driver by staff ID, vehicles in id order', () => {
    // No history: the depot's drivers pair with its vehicles in order, and a vehicle past the last driver has none.
    expect(usualPairing(['VEH001', 'VEH002', 'VEH003'], new Map(), [D001, D003])).toEqual(new Map([['VEH001', D001], ['VEH002', D003], ['VEH003', null]]));
    // VEH002 drove with D-001 last time: it keeps him, and the others pair with the drivers history left.
    expect(usualPairing(['VEH001', 'VEH002', 'VEH003'], new Map([['VEH002', D001]]), [D001, D003, D004]))
      .toEqual(new Map([['VEH001', D003], ['VEH002', D001], ['VEH003', D004]]));
    // VEH009 drove with D-001 and is archived since: it is not one of the vehicles, so D-001 is free to pair again.
    expect(usualPairing(['VEH001', 'VEH002'], new Map([['VEH009', D001]]), [D001, D003])).toEqual(new Map([['VEH001', D001], ['VEH002', D003]]));
  });
});
