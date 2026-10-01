import { checkPlan } from '../check';
import { computeLoad } from '../load';
import { defaultLeaveAt } from '../timeline';
import type { BuildSuggestedPlan, PlanInput, PlannerChoice, PlannerDecision, PlannerOrder, PlannerSplit } from '../types';
import { compare, prepareInput } from './priority';
import {
  deferralDecisions, deferralFor, earlyLeaveReason, fittedReason, furthestRejection, placementReason, priorityReason, quantityWord, refusedReason,
  type Placement, type Wording,
} from './reasons';
import { chooseWhole, type CandidateAttempt } from './candidates';
import { freeRunFor, type Relocations } from './repair';
import { chooseAllocation, rebalance, splitLimitDetail } from './split';

// A choice's reason is worded once the plan is final, because freeing a run for a later order can move an earlier
// order's goods onto another run, and its reason must say where they went.
interface Choice { orderId: string; rank: number; resultOrderIds: string[]; render: (wording: Wording) => string }

export const buildSuggestedPlan: BuildSuggestedPlan = (raw) => {
  const source = prepareInput(raw);
  const { date: _date, orders: originals, ...snapshot } = source;
  const input: PlanInput = { ...snapshot, orders: [], plan: { trips: [], deferrals: [] } };
  if (!source.operatingDay) {
    return { status: 'unavailable', check: checkPlan({ ...input, orders: originals }) };
  }
  const choices: Choice[] = [];
  const decisions: PlannerDecision[] = [];
  const splits: PlannerSplit[] = [];
  // Where each effective order went and the rule that decided it.
  const placements = new Map<string, Placement>();
  const earlyCauses = new Map<string, { order: PlannerOrder; rank: number; leaveAt: number; effectiveOrderId: string }>();
  const tripKey = (trip: { vehicleId: string; tripNo: number }) => `${trip.vehicleId}:${trip.tripNo}`;
  const accept = (attempt: CandidateAttempt, original: PlannerOrder, rank: number, effectiveOrderId: string) => {
    // Rechecking one insertion can change either trip's departure. Preserve the source insertion that
    // first forced the current fix, replacing it only when another order forces a stricter start.
    for (const trip of attempt.input.plan.trips) {
      const key = tripKey(trip);
      const cause = earlyCauses.get(key);
      if (trip.leaveAt === undefined) earlyCauses.delete(key);
      else if (!cause || trip.leaveAt < cause.leaveAt) earlyCauses.set(key, { order: original, rank, leaveAt: trip.leaveAt, effectiveOrderId });
      else earlyCauses.set(key, { ...cause, leaveAt: trip.leaveAt });
    }
    input.plan.trips = [
      ...input.plan.trips.filter((trip) => trip.vehicleId !== attempt.slot.vehicleId), ...attempt.input.plan.trips,
    ];
    placements.set(effectiveOrderId, { slot: attempt.slot, ...(attempt.selectionReason ? { selectionReason: attempt.selectionReason } : {}) });
  };
  const placed = (order: PlannerOrder, effectiveOrderId: string, wording: Wording) => placementReason(source, order, placements.get(effectiveOrderId)!, wording);
  const unitsOf = (id: string) => computeLoad(input.orders.find((o) => o.id === id)!.lines, source.products).units;

  // Free a run for a waiting order by moving goods the plan already carries, as the pass after the loop does.
  let relocations: Relocations = new Map();
  const freeRun = (order: PlannerOrder, original: PlannerOrder, rank: number): boolean => {
    const freed = freeRunFor(input, order, relocations);
    if (!freed) return false;
    relocations = new Map();
    input.plan.trips = freed.trips;
    earlyCauses.delete(tripKey(freed.freed));
    for (const move of freed.moves) {
      for (const id of move.orderIds) {
        placements.set(id, {
          slot: { ...move.to, existing: !move.whole },
          selectionReason: move.whole ? 'moved to free a run' : 'shares a stop to free a run',
        });
      }
    }
    accept({ ...freed.attempt, selectionReason: 'takes a run freed for it' }, original, rank, order.id);
    rejoinSplits();
    return true;
  };

  // A split whose two parts end on the same stop is not needed: the shop's order goes whole, as one order.
  const rejoinSplits = () => {
    for (const [i, split] of [...splits.entries()].reverse()) {
      const stop = input.plan.trips.flatMap((trip) => trip.stops).find((s) => s.orderIds.includes(split.keptOrderId));
      if (!stop?.orderIds.includes(split.remainderOrderId)) continue;
      const parent = originals.find((o) => o.id === split.orderId)!;
      stop.orderIds = stop.orderIds.flatMap((id) => (id === split.keptOrderId ? [parent.id] : id === split.remainderOrderId ? [] : [id]));
      input.orders = input.orders.flatMap((o) => (o.id === split.keptOrderId ? [parent] : o.id === split.remainderOrderId ? [] : [o]));
      splits.splice(i, 1);
      // The whole order goes where the part that was not moved to share the stop went.
      const [kept, rest] = [placements.get(split.keptOrderId)!, placements.get(split.remainderOrderId)!];
      placements.set(parent.id, kept.selectionReason === 'shares a stop to free a run' ? rest : kept);
      for (const [key, cause] of earlyCauses) {
        if (cause.effectiveOrderId === split.keptOrderId || cause.effectiveOrderId === split.remainderOrderId) earlyCauses.set(key, { ...cause, effectiveOrderId: parent.id });
      }
      const choice = choices.find((c) => c.orderId === parent.id)!;
      choice.resultOrderIds = [parent.id];
      choice.render = (wording) => `${priorityReason(source, parent, choice.rank, wording)}; ${placed(parent, parent.id, wording)}`;
    }
  };

  // A deferral waits for the pass below before it is final.
  const pending: { order: PlannerOrder; original: PlannerOrder; rank: number; deferral: ReturnType<typeof deferralFor> }[] = [];
  const defer = (order: PlannerOrder, original: PlannerOrder, rank: number, deferral: ReturnType<typeof deferralFor>) => {
    pending.push({ order, original, rank, deferral });
  };
  for (const [i, order] of originals.entries()) {
    const rank = i + 1;
    const allocation = chooseAllocation(input, order, originals.length + splits.length);
    const { best, proposal } = allocation;
    const priority = (wording: Wording) => priorityReason(source, order, rank, wording);
    if (!best) {
      if (!allocation.code) throw new Error(`No allocation or deferral code for ${order.id}`);
      const deferral = deferralFor(source, order, allocation.code, { detail: allocation.detail, attempts: allocation.attempts });
      input.orders.push(order);
      defer(order, order, rank, deferral);
      const { attempts, code } = allocation;
      choices.push({
        orderId: order.id, rank, resultOrderIds: [order.id],
        render: (wording) => `${priority(wording)}; ${placements.has(order.id) ? placed(order, order.id, wording) : refusedReason(source, order, attempts, code, wording)}`,
      });
      continue;
    }

    // Before the first part is accepted, so AC-13's rebalance can try the two parts again from the same plan.
    const before: PlanInput = { ...input, orders: [...input.orders], plan: { ...input.plan, trips: [...input.plan.trips] } };
    const causesBefore = new Map(earlyCauses);
    accept(best, order, rank, proposal?.kept.id ?? order.id);
    if (proposal) {
      input.orders.push(proposal.kept, proposal.remainder);
      const keptUnits = computeLoad(proposal.kept.lines, source.products).units;
      const remainingUnits = computeLoad(proposal.remainder.lines, source.products).units;
      const { kept, remainder: rest } = proposal;
      const choice: Choice = { orderId: order.id, rank, resultOrderIds: [kept.id, rest.id], render: () => '' };
      choices.push(choice);
      // The waiting parent's two children are handled together, before any younger original can claim
      // remaining room. The second child is searched whole, never passed back through the split search.
      const remainder = chooseWhole(input, rest);
      const code = remainder.refusal ?? furthestRejection(remainder.stages);
      const balanced = remainder.best ? null : rebalance(before, input, order, proposal, best.slot, remainder.slots);
      if (remainder.best) {
        splits.push(proposal.split);
        accept(remainder.best, order, rank, rest.id);
      } else if (balanced) {
        // AC-13: the two parts shared out again so both go, from the plan as it was before the first part.
        input.plan.trips = before.plan.trips;
        earlyCauses.clear();
        for (const [key, cause] of causesBefore) earlyCauses.set(key, cause);
        input.orders = [...before.orders, balanced.proposal.kept, balanced.proposal.remainder];
        splits.push(balanced.proposal.split);
        accept({ ...balanced.kept, ...(best.selectionReason ? { selectionReason: best.selectionReason } : {}) }, order, rank, kept.id);
        accept({ ...balanced.rest, selectionReason: 'parts rebalanced so both go' }, order, rank, rest.id);
      } else {
        splits.push(proposal.split);
        defer(rest, order, rank, deferralFor(source, rest, code, {
          attempts: remainder.attempts, split: { keptUnits, remainingUnits },
          detail: splitLimitDetail(input, rest, originals.length + splits.length, remainder.slots, code),
        }));
      }
      // The first part's vehicle is named just before, so the refusal's short form may call it "it".
      const restReason = (wording: Wording) => (placements.has(rest.id)
        ? `${unitsOf(rest.id)} ${quantityWord(source, order)} ${placed(order, rest.id, wording)}`
        : `${unitsOf(rest.id)} wait: ${refusedReason(source, rest, remainder.attempts, code, wording, placements.get(kept.id)!.slot.vehicleId)}`);
      choice.render = (wording) => `${priority(wording)}; ${unitsOf(kept.id)} ${quantityWord(source, order)} ${placed(order, kept.id, wording)}; ${restReason(wording)}`;
    } else {
      input.orders.push(order);
      choices.push({ orderId: order.id, rank, resultOrderIds: [order.id], render: (wording) => `${priority(wording)}; ${placed(order, order.id, wording)}` });
    }
  }

  // Spec 011, AC-23: once every order has had its turn, each waiting one, in priority order, may take a run freed by
  // moving goods the plan already carries. Nothing placed is displaced, so the pass only ever serves more.
  for (const { order, original, rank, deferral } of pending) {
    if (freeRun(order, original, rank)) continue;
    input.plan.deferrals.push(deferral);
    decisions.push(...deferralDecisions(source, order, deferral));
  }

  input.plan.trips.sort((a, b) => compare(a.vehicleId, b.vehicleId) || a.tripNo - b.tripNo);
  const check = checkPlan(input);
  if (!check.ok) return { status: 'unavailable', check };

  // Decisions describe the final departures, not earlier trial settings that a later insertion replaced.
  // An explicit setting can be earlier than default without being before the brand's minimum.
  const ready = new Map<string, number>();
  for (const trip of input.plan.trips) {
    const usual = defaultLeaveAt(input, trip, ready.get(trip.vehicleId) ?? null);
    if (trip.leaveAt !== undefined && trip.leaveAt < usual) {
      const cause = earlyCauses.get(tripKey(trip));
      if (!cause) throw new Error(`No forcing order for ${tripKey(trip)}`);
      const leaveAt = trip.leaveAt;
      decisions.push({
        kind: 'early_leave', vehicleId: trip.vehicleId, tripNo: trip.tripNo, leaveAt,
        reason: fittedReason((wording) => earlyLeaveReason(source, { vehicleId: trip.vehicleId, tripNo: trip.tripNo, leaveAt, usual }, cause.rank, cause.order, wording)),
      });
    }
    const times = check.trips.find((t) => t.vehicleId === trip.vehicleId && t.tripNo === trip.tripNo)?.times;
    if (!times) throw new Error(`The checked ${trip.vehicleId} trip ${trip.tripNo} has no times`);
    ready.set(trip.vehicleId, times.readyAgainAt);
  }
  const orderPosition = new Map(input.orders.map((order, i) => [order.id, i]));
  const position = (decision: PlannerDecision): number => orderPosition.get(decision.kind === 'early_leave'
    ? earlyCauses.get(tripKey(decision))!.effectiveOrderId : decision.orderId)!;
  decisions.sort((a, b) => position(a) - position(b));
  const worded: PlannerChoice[] = choices.map(({ render, ...choice }) => ({ ...choice, reason: fittedReason(render) }));
  return { status: decisions.length ? 'needs_decision' : 'suggested', input, check, splits, choices: worded, decisions };
};
