import type { DeferralCode } from '@wayfinder/contracts';
import { computeLoad } from '../load';
import { lookup } from '../lookup';
import type { PlanDeferral, PlannerDecision, PlannerInput, PlannerOrder } from '../types';
import { isWaiting } from './priority';

export type PlannerDeferralCode = Exclude<DeferralCode, 'dispatcher_choice'>;
export type RejectionStage = 'over_capacity' | 'window' | 'fuel';

// A candidate reaching a later stage proves the preceding stage still had a survivor. This deliberately
// ignores the order in which vehicles were tried and the order in which the checker displays problems.
export function furthestRejection(stages: readonly RejectionStage[]): RejectionStage {
  if (stages.includes('fuel')) return 'fuel';
  if (stages.includes('window')) return 'window';
  return 'over_capacity';
}

const why: Record<PlannerDeferralCode, string> = {
  no_reefer: 'no working fridge vehicle is available',
  no_van: 'no compatible working van is available',
  over_capacity: 'the tested trips have no room within their limits',
  window: 'no tested stop order meets the window or mall slot',
  fuel: 'otherwise usable trips exceed their remaining weekly fuel',
};
const shorten = (s: string, length: number) => s.length <= length ? s : `${s.slice(0, length - 1).trimEnd()}…`;

export function deferralFor(
  input: PlannerInput, order: PlannerOrder, code: PlannerDeferralCode,
  options: { detail?: string; split?: { keptUnits: number; remainingUnits: number } } = {},
): PlanDeferral {
  const shop = lookup(input.outlets, 'shop')(order.outletId);
  const load = computeLoad(order.lines, input.products);
  const identity = `${shorten(shop.name.trim(), 40)} wanted ${order.deliveryDate}, ${load.units} ${load.needsReefer ? 'chilled' : 'dry'} units: `;
  const detail = options.split
    ? `${options.split.keptUnits} sent, ${options.split.remainingUnits} left; trip room exhausted`
    : options.detail?.trim() || why[code];
  const ending = ' after earlier choices.';
  return { orderId: order.id, code, reason: `${identity}${shorten(detail, 200 - identity.length - ending.length)}${ending}` };
}

export function deferralDecisions(input: PlannerInput, order: PlannerOrder, deferral: PlanDeferral): PlannerDecision[] {
  const decisions: PlannerDecision[] = [];
  if (isWaiting(order, input.date)) decisions.push({ kind: 'waited_again', orderId: order.id, reason: deferral.reason });
  if (deferral.code === 'window') decisions.push({ kind: 'late_order', orderId: order.id, reason: deferral.reason });
  return decisions;
}
