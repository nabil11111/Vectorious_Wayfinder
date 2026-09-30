import { checkPlan } from '../check';
import { computeLoad } from '../load';
import { lookup } from '../lookup';
import { defaultLeaveAt } from '../timeline';
import type { BuildSuggestedPlan, PlanInput, PlannerChoice, PlannerDecision, PlannerOrder, PlannerSplit } from '../types';
import { toClock } from '../words';
import { compare, effectiveWindow, isWaiting, prepareInput } from './priority';
import { deferralDecisions, deferralFor } from './reasons';
import { chooseAllocation } from './split';

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
  const outletOf = lookup(source.outlets, 'shop');

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
      const deferral = deferralFor(source, order, allocation.code, { detail: allocation.detail });
      input.orders.push(order);
      defer(order, deferral);
      choices.push({ orderId: order.id, rank, resultOrderIds: [order.id], reason: `Rank ${rank}: ${deferral.reason}` });
      continue;
    }

    // A successful trial replaces only this vehicle's day. Other vehicles and every accepted order stay
    // where earlier priority choices put them. A failed trial never reaches this point.
    input.plan.trips = [
      ...input.plan.trips.filter((trip) => trip.vehicleId !== best.slot.vehicleId), ...best.input.plan.trips,
    ];
    const resultOrderIds = proposal ? [proposal.kept.id, proposal.remainder.id] : [order.id];
    const load = computeLoad(order.lines, source.products);
    const shop = outletOf(order.outletId);
    const priority = `${isWaiting(order, source.date) ? 'waiting' : 'new'} goods wanted ${order.deliveryDate}, ${load.needsReefer ? 'chilled' : 'dry'}, ${shop.name} closing ${toClock(effectiveWindow(shop).close)}`;
    const placed = `${best.slot.vehicleId} trip ${best.slot.tripNo}, the first feasible trip in the vehicle preference order`;
    if (proposal) {
      input.orders.push(proposal.kept, proposal.remainder);
      splits.push(proposal.split);
      const keptUnits = computeLoad(proposal.kept.lines, source.products).units;
      const remainingUnits = computeLoad(proposal.remainder.lines, source.products).units;
      defer(proposal.remainder, deferralFor(source, proposal.remainder, 'over_capacity', { split: { keptUnits, remainingUnits } }));
      choices.push({ orderId: order.id, rank, resultOrderIds, reason: `Rank ${rank}: ${priority}; no whole candidate passed, so ${keptUnits} units go on ${placed} and ${remainingUnits} wait for room.` });
    } else {
      input.orders.push(order);
      choices.push({ orderId: order.id, rank, resultOrderIds, reason: `Rank ${rank}: ${priority}; all ${load.units} units go on ${placed}.` });
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
      decisions.push({
        kind: 'early_leave', vehicleId: trip.vehicleId, tripNo: trip.tripNo, leaveAt: trip.leaveAt,
        reason: `${trip.vehicleId} trip ${trip.tripNo} leaves at ${toClock(trip.leaveAt)} instead of its usual ${toClock(usual)} to meet delivery windows.`,
      });
    }
    const times = check.trips.find((t) => t.vehicleId === trip.vehicleId && t.tripNo === trip.tripNo)?.times;
    if (!times) throw new Error(`The checked ${trip.vehicleId} trip ${trip.tripNo} has no times`);
    ready.set(trip.vehicleId, times.readyAgainAt);
  }
  const orderPosition = new Map(input.orders.map((order, i) => [order.id, i]));
  const position = (decision: PlannerDecision): number => {
    if (decision.kind !== 'early_leave') return orderPosition.get(decision.orderId)!;
    const trip = input.plan.trips.find((t) => t.vehicleId === decision.vehicleId && t.tripNo === decision.tripNo)!;
    return Math.min(...trip.stops.flatMap((stop) => stop.orderIds).map((id) => orderPosition.get(id)!));
  };
  decisions.sort((a, b) => position(a) - position(b));
  return { status: decisions.length ? 'needs_decision' : 'suggested', input, check, splits, choices, decisions };
};
