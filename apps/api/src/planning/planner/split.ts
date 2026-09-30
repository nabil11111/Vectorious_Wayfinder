import type { PlanInput, PlannerOrder, PlannerSplit } from '../types';
import { candidateInput, capacityFits, chooseWhole, tryCandidate, type CandidateAttempt, type CandidateSlot } from './candidates';
import { compare } from './priority';
import { furthestRejection, type PlannerDeferralCode } from './reasons';

export interface SplitProposal { split: PlannerSplit; kept: PlannerOrder; remainder: PlannerOrder }
export interface Allocation {
  best: CandidateAttempt | null;
  proposal: SplitProposal | null;
  code?: PlannerDeferralCode;
  detail?: string;
}

const splitLimit = (order: PlannerOrder, effectiveCount: number): string | null => {
  if (order.splitFrom !== null) return 'this existing child cannot be split again';
  if (order.lines.length > 10) return 'automatic splits allow at most 10 product lines';
  if (order.lines.some((line) => line.quantity > 999)) return 'automatic splits allow at most 999 units per product line';
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

export function chooseAllocation(input: PlanInput, order: PlannerOrder, effectiveCount: number): Allocation {
  const whole = chooseWhole(input, order);
  if (whole.best) return { best: whole.best, proposal: null };
  if (whole.refusal) return { best: null, proposal: null, code: whole.refusal };
  const limit = splitLimit(order, effectiveCount);
  const stages = [...whole.stages];
  if (!limit) {
    // Slot order is the same tuple used for whole orders. The amount carried never outranks that policy.
    for (const slot of whole.slots) {
      const proposal = proposePart(input, order, slot);
      if (!proposal) continue;
      const attempt = tryCandidate(input, proposal.kept, slot);
      if (attempt.stage === 'accepted') return { best: attempt, proposal };
      stages.push(attempt.stage);
    }
  }
  const code = furthestRejection(stages);
  const detail = code === 'over_capacity'
    ? limit ?? (whole.slots.length ? 'compatible trips lack weight or volume room for a whole order or a unit'
      : 'no district/brand slot remains within two trips per vehicle and the board limits')
    : undefined;
  return { best: null, proposal: null, code, ...(detail ? { detail } : {}) };
}
