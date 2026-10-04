import type { SlotQuery, SlotSearch } from '@wayfinder/contracts';
import { HttpError } from '../lib/errors';
import { snapshot } from '../orders/store-orders';
import { checkPlan } from '../planning';
import type { Planner } from '../routes/plans';
import { readBoard } from './board';

// Try the same carried-over order on every trip, using the board's snapshot and the one plan checker.
// Each trial owns its draft copy; accepting a slot is a later ordinary save by the dispatcher.
export function findSlots(caller: Planner, date: string, { orderId }: SlotQuery): Promise<SlotSearch> {
  return snapshot(async (tx) => {
    const { board, input } = await readBoard(tx, caller.depotId, date);
    if (board.plan.status === 'published') throw new HttpError(409, 'plan_sent', 'This plan has been sent.');
    const order = board.orders.find((o) => o.id === orderId);
    if (!order) throw new HttpError(400, 'unknown_record', 'That order is not one of this depot\'s orders for the day.', { id: orderId });
    if (board.plan.trips.some((t) => t.stops.some((s) => s.orderIds.includes(orderId)))) {
      throw new HttpError(400, 'invalid_input', 'Find a slot for an order that is not already on a trip.');
    }
    if (!input) throw new Error('A dated plan board has no checker input.');
    const before = checkPlan(input);
    const result: SlotSearch = { orderId, revision: board.plan.revision, slots: [], refused: [] };
    for (const [index, trip] of input.plan.trips.entries()) {
      const existing = trip.stops.findIndex((stop) => stop.outletId === order.outletId);
      const positions = existing === -1 ? trip.stops.map((_, at) => at).concat(trip.stops.length) : [existing];
      const found: SlotSearch['slots'] = [];
      let refusal: SlotSearch['refused'][number] | null = null;
      for (const at of positions) {
        const candidate = { ...input, plan: structuredClone(input.plan) };
        candidate.plan.deferrals = candidate.plan.deferrals.filter((deferral) => deferral.orderId !== orderId);
        const trial = candidate.plan.trips[index]!;
        const newStop = existing === -1;
        if (newStop) trial.stops.splice(at, 0, { outletId: order.outletId, orderIds: [orderId] });
        else trial.stops[at]!.orderIds.push(orderId);
        const check = checkPlan(candidate);
        const problem = check.problems.find((item) => item.level === 'block' && item.vehicleId === trip.vehicleId);
        if (problem) {
          refusal = { vehicleId: trip.vehicleId, tripNo: trip.tripNo, problem };
          continue;
        }
        const timed = check.trips.find((item) => item.vehicleId === trip.vehicleId && item.tripNo === trip.tripNo)?.times;
        const stop = timed?.stops[at];
        if (!stop) throw new Error(`No stop times for ${trip.vehicleId} trip ${trip.tripNo} without a blocking problem.`);
        const previous = before.trips.find((item) => item.vehicleId === trip.vehicleId && item.tripNo === trip.tripNo)?.times;
        const previousFuel = before.vehicles.find((item) => item.vehicleId === trip.vehicleId)?.litresPlan ?? null;
        const nextFuel = check.vehicles.find((item) => item.vehicleId === trip.vehicleId)?.litresPlan ?? null;
        found.push({
          vehicleId: trip.vehicleId, tripNo: trip.tripNo, stopSeq: at + 1, newStop, arriveAt: stop.arriveAt,
          basis: newStop ? `Inserted at stop ${at + 1}` : 'Added to the shop\'s stop',
          fuelL: previousFuel !== null && nextFuel !== null ? Math.round((nextFuel - previousFuel) * 10) / 10 : null,
          addedMin: previous && timed ? (timed.backAt - timed.leaveAt) - (previous.backAt - previous.leaveAt) : null,
        });
      }
      found.sort((a, b) => (a.fuelL ?? 0) - (b.fuelL ?? 0) || a.arriveAt - b.arriveAt || a.stopSeq - b.stopSeq);
      result.slots.push(...found);
      if (found.length === 0 && refusal) result.refused.push(refusal);
    }
    return result;
  });
}
