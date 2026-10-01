import { checkPlan } from '../check';
import { computeLoad } from '../load';
import { defaultLeaveAt } from '../timeline';
import type { BuildSuggestedPlan, PlanInput, PlannerChoice, PlannerDecision, PlannerOrder, PlannerSplit } from '../types';
import { compare, prepareInput } from './priority';
import {
  deferralDecisions, deferralFor, earlyLeaveReason, fittedReason, furthestRejection, placementReason, priorityReason, quantityWord, refusedReason, type Wording,
} from './reasons';
import { chooseWhole, type CandidateAttempt } from './candidates';
import { chooseAllocation, splitLimitDetail } from './split';

export const buildSuggestedPlan: BuildSuggestedPlan = (raw) => {
  const source = prepareInput(raw);
  const { date: _date, orders: originals, ...snapshot } = source;
  let input: PlanInput = { ...snapshot, orders: [], plan: { trips: [], deferrals: [] } };
  if (!source.operatingDay) {
    return { status: 'unavailable', check: checkPlan({ ...input, orders: originals }) };
  }
  const choices: PlannerChoice[] = [];
  const decisions: PlannerDecision[] = [];
  const splits: PlannerSplit[] = [];
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
  };

  const defer = (order: PlannerOrder, deferral: ReturnType<typeof deferralFor>) => {
    input.plan.deferrals.push(deferral);
    decisions.push(...deferralDecisions(source, order, deferral));
  };
  for (const [i, order] of originals.entries()) {
    const rank = i + 1;
    const allocation = chooseAllocation(input, order, originals.length + splits.length);
    const { best, proposal } = allocation;
    if (!best) {
      if (!allocation.code) throw new Error(`No allocation or deferral code for ${order.id}`);
      const deferral = deferralFor(source, order, allocation.code, { detail: allocation.detail, attempts: allocation.attempts });
      input.orders.push(order);
      defer(order, deferral);
      choices.push({ orderId: order.id, rank, resultOrderIds: [order.id], reason: fittedReason((wording) => `${priorityReason(source, order, rank, wording)}; ${refusedReason(source, order, allocation.attempts, allocation.code!, wording)}`) });
      continue;
    }

    accept(best, order, rank, proposal?.kept.id ?? order.id);
    const resultOrderIds = proposal ? [proposal.kept.id, proposal.remainder.id] : [order.id];
    const priority = (wording: Wording) => priorityReason(source, order, rank, wording);
    const placed = (wording: Wording) => placementReason(source, order, best, wording);
    if (proposal) {
      input.orders.push(proposal.kept, proposal.remainder);
      splits.push(proposal.split);
      const keptUnits = computeLoad(proposal.kept.lines, source.products).units;
      const remainingUnits = computeLoad(proposal.remainder.lines, source.products).units;
      // The waiting parent's two children are handled together, before any younger original can claim
      // remaining room. The second child is searched whole, never passed back through the split search.
      const remainder = chooseWhole(input, proposal.remainder);
      let restReason: (wording: Wording) => string;
      if (remainder.best) {
        accept(remainder.best, order, rank, proposal.remainder.id);
        restReason = (wording) => `${remainingUnits} ${quantityWord(source, order)} ${placementReason(source, order, remainder.best!, wording)}`;
      } else {
        const code = remainder.refusal ?? furthestRejection(remainder.stages);
        const deferral = deferralFor(source, proposal.remainder, code, {
          attempts: remainder.attempts, split: { keptUnits, remainingUnits },
          detail: splitLimitDetail(input, proposal.remainder, originals.length + splits.length, remainder.slots, code),
        });
        defer(proposal.remainder, deferral);
        // The first part's vehicle is named just before, so the refusal's short form may call it "it".
        restReason = (wording) => `${remainingUnits} wait: ${refusedReason(source, proposal.remainder, remainder.attempts, code, wording, best.slot.vehicleId)}`;
      }
      choices.push({ orderId: order.id, rank, resultOrderIds, reason: fittedReason((wording) => `${priority(wording)}; ${keptUnits} ${quantityWord(source, order)} ${placed(wording)}; ${restReason(wording)}`) });
    } else {
      input.orders.push(order);
      choices.push({ orderId: order.id, rank, resultOrderIds, reason: fittedReason((wording) => `${priority(wording)}; ${placed(wording)}`) });
    }
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
  return { status: decisions.length ? 'needs_decision' : 'suggested', input, check, splits, choices, decisions };
};
