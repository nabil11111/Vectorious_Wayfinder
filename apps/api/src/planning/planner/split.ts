import type { PlanInput, PlannerOrder, PlannerSplit } from '../types';
import { candidateInput, capacityFits, chooseWhole, rankAttempts, selectAttempt, tryCandidate, type CandidateAttempt, type CandidateSlot } from './candidates';
import { compare } from './priority';
import { furthestRejection, type PlannerDeferralCode } from './reasons';

export interface SplitProposal { split: PlannerSplit; kept: PlannerOrder; remainder: PlannerOrder }
export interface Allocation {
  best: CandidateAttempt | null;
  proposal: SplitProposal | null;
  code?: PlannerDeferralCode;
  detail?: string;
  attempts: CandidateAttempt[];
}

const splitLimit = (order: PlannerOrder, effectiveCount: number): string | null => {
  if (order.splitFrom !== null) return 'this existing child cannot be split again';
  if (order.lines.length > 10) return 'automatic splits allow at most 10 product lines';
  if (order.lines.some((line) => line.quantity > 999)) return 'automatic splits allow at most 999 per product line';
  if (effectiveCount >= 300) return 'splitting would exceed the 300-order limit';
  return null;
};

export function proposePart(input: PlanInput, order: PlannerOrder, slot: CandidateSlot): SplitProposal | null {
  if (splitLimit(order, 0)) return null;
  const lines = [...order.lines].sort((a, b) => compare(a.productId, b.productId));
  const keep = lines.map((line) => ({ productId: line.productId, quantity: 0 }));
  const keptOrderId = `split:${order.id}:keep`;
  const remainderOrderId = `split:${order.id}:rest`;
  const positive = () => keep.filter((line) => line.quantity > 0).map((line) => ({ ...line }));
  const fits = () => capacityFits(candidateInput(input, { ...order, id: keptOrderId, lines: positive() }, slot), slot.tripNo);

  // A whole later line has precedence over a fragment of an earlier line. Only after that pass do we
  // fill the remaining space with integer units, testing the checker's aggregate load at each probe.
  for (const [i, line] of lines.entries()) {
    keep[i]!.quantity = line.quantity;
    if (!fits()) keep[i]!.quantity = 0;
  }
  for (const [i, line] of lines.entries()) {
    if (keep[i]!.quantity === line.quantity) continue;
    let low = 0, high = line.quantity;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      keep[i]!.quantity = mid;
      if (fits()) low = mid;
      else high = mid - 1;
    }
    keep[i]!.quantity = low;
  }
  const kept = { ...order, id: keptOrderId, splitFrom: order.id, lines: positive() };
  const remainder = {
    ...order, id: remainderOrderId, splitFrom: order.id,
    lines: lines.map((line, i) => ({ productId: line.productId, quantity: line.quantity - keep[i]!.quantity })).filter((line) => line.quantity > 0),
  };
  if (!kept.lines.length || !remainder.lines.length) return null;
  return { split: { orderId: order.id, keep, keptOrderId, remainderOrderId }, kept, remainder };
}

// AC-13: when the second part fits no run whole, the two parts are shared out once more before the split is made. For
// each run the second part could have taken, in its own AC-6 order, that run takes the most of the order it can carry
// by AC-14, and the first part's run the rest; the first that passes both, the first part's run first, is the split.
// Both parts keep their temporary IDs and the parent's priority, quantities stay whole and add up exactly, and there is
// never a third part. before is the plan as it was before the first part; after has the first part on its run.
export function rebalance(
  before: PlanInput, after: PlanInput, order: PlannerOrder, proposal: SplitProposal, slot: CandidateSlot, restSlots: readonly CandidateSlot[],
): { proposal: SplitProposal; kept: CandidateAttempt; rest: CandidateAttempt } | null {
  const lines = [...order.lines].sort((a, b) => compare(a.productId, b.productId));
  const same = (a: readonly { productId: string; quantity: number }[], b: readonly { productId: string; quantity: number }[]) =>
    a.length === b.length && a.every((line, i) => line.productId === b[i]!.productId && line.quantity === b[i]!.quantity);
  for (const other of restSlots) {
    if (other.vehicleId === slot.vehicleId && other.tripNo === slot.tripNo) continue;
    const part = proposePart(after, order, other);
    if (!part) continue;
    const taken = new Map(part.kept.lines.map((line) => [line.productId, line.quantity]));
    const keep = lines.map((line) => ({ productId: line.productId, quantity: line.quantity - (taken.get(line.productId) ?? 0) }));
    const kept = { ...order, id: proposal.kept.id, splitFrom: order.id, lines: keep.filter((line) => line.quantity > 0) };
    const rest = { ...order, id: proposal.remainder.id, splitFrom: order.id, lines: part.kept.lines };
    if (!kept.lines.length || same(kept.lines, proposal.kept.lines)) continue;
    const keptAttempt = tryCandidate(before, kept, slot);
    if (keptAttempt.stage !== 'accepted') continue;
    const withKept: PlanInput = {
      ...before, orders: [...before.orders, kept],
      plan: { ...before.plan, trips: [...before.plan.trips.filter((t) => t.vehicleId !== slot.vehicleId), ...keptAttempt.input.plan.trips] },
    };
    const restAttempt = tryCandidate(withKept, rest, other);
    if (restAttempt.stage !== 'accepted') continue;
    return {
      proposal: { split: { orderId: order.id, keep, keptOrderId: kept.id, remainderOrderId: rest.id }, kept, remainder: rest },
      kept: keptAttempt, rest: restAttempt,
    };
  }
  return null;
}

export function splitLimitDetail(
  input: PlanInput, order: PlannerOrder, effectiveCount: number, slots: readonly CandidateSlot[], code: PlannerDeferralCode,
): string | undefined {
  const limit = splitLimit(order, effectiveCount);
  // This is evidence for the explanation, never another split proposal. One positive piece proves
  // whether a split restriction is binding; an empty slot list or a completely full fleet does not.
  const hadRoom = limit && code === 'over_capacity' && slots.some((slot) => order.lines.some((line) =>
    capacityFits(candidateInput(input, { ...order, lines: [{ ...line, quantity: 1 }] }, slot), slot.tripNo)));
  return hadRoom ? limit : undefined;
}

export function chooseAllocation(input: PlanInput, order: PlannerOrder, effectiveCount: number): Allocation {
  const whole = chooseWhole(input, order);
  if (whole.best) return { best: whole.best, proposal: null, attempts: whole.attempts };
  if (whole.refusal) return { best: null, proposal: null, code: whole.refusal, attempts: whole.attempts };
  const limit = splitLimit(order, effectiveCount);
  const partial: { attempt: CandidateAttempt; proposal: SplitProposal }[] = [];
  if (!limit) {
    for (const slot of whole.slots) {
      const proposal = proposePart(input, order, slot);
      if (proposal) partial.push({ attempt: tryCandidate(input, proposal.kept, slot), proposal });
    }
  }
  const best = selectAttempt(input, order, partial.map((part) => part.attempt));
  if (best) {
    const proposal = partial.find((part) => part.attempt.slot === best.slot)!.proposal;
    return { best, proposal, attempts: whole.attempts };
  }
  // Pair each slot's whole and partial refusal before ranking, so explanations describe the highest
  // ranked vehicle at the exhausted stage rather than whichever phase happened to run first.
  const attempts = rankAttempts(whole.slots.flatMap((slot) => [
    ...whole.attempts.filter((attempt) => attempt.slot === slot),
    ...partial.filter((part) => part.attempt.slot === slot).map((part) => part.attempt),
  ]));
  const code = furthestRejection(attempts.map((attempt) => attempt.stage as Exclude<typeof attempt.stage, 'accepted'>));
  const detail = splitLimitDetail(input, order, effectiveCount, whole.slots, code);
  return { best: null, proposal: null, code, attempts, ...(detail ? { detail } : {}) };
}
