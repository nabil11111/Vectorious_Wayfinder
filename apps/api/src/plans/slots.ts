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
    if (!order.carriedOver || board.plan.trips.some((t) => t.stops.some((s) => s.orderIds.includes(orderId)))) {
      throw new HttpError(400, 'invalid_input', 'Find a slot for a carried-over order that is not already on a trip.');
    }
    if (!input) throw new Error('A dated plan board has no checker input.');

    const result: SlotSearch = { orderId, revision: board.plan.revision, slots: [], refused: [] };
    for (const [index, trip] of input.plan.trips.entries()) {
      const candidate = { ...input, plan: structuredClone(input.plan) };
      candidate.plan.deferrals = candidate.plan.deferrals.filter((d) => d.orderId !== orderId);
      const trial = candidate.plan.trips[index]!;
      let stopIndex = trial.stops.findIndex((s) => s.outletId === order.outletId);
      const newStop = stopIndex === -1;
      if (newStop) {
        stopIndex = trial.stops.length;
        trial.stops.push({ outletId: order.outletId, orderIds: [orderId] });
      } else {
        trial.stops[stopIndex]!.orderIds.push(orderId);
      }

      const check = checkPlan(candidate);
      // Fuel and the second trip belong to the whole vehicle, so a block on either trip refuses the slot.
      const problem = check.problems.find((p) => p.level === 'block' && p.vehicleId === trip.vehicleId);
      if (problem) {
        result.refused.push({ vehicleId: trip.vehicleId, tripNo: trip.tripNo, problem });
        continue;
      }
      const timed = check.trips.find((t) => t.vehicleId === trip.vehicleId && t.tripNo === trip.tripNo)?.times;
      const stop = timed?.stops[stopIndex];
      if (!stop) throw new Error(`No stop times for ${trip.vehicleId} trip ${trip.tripNo} without a blocking problem.`);
      result.slots.push({ vehicleId: trip.vehicleId, tripNo: trip.tripNo, stopSeq: stopIndex + 1, newStop, arriveAt: stop.arriveAt });
    }
    return result;
  });
}
