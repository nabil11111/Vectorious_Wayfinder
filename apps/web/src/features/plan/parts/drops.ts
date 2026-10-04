import type { BoardOrder, Brand, DraftPlan, DraftTrip } from '@wayfinder/contracts';
import type { Undo } from '../board';
import { addOrders, moveStop, takeOff, tripOf, type TripKey } from '../draft';
import type { Pick } from './crews';

// Drag and drop on the plan board (spec 023, D-98). What can be dragged, where it can land, and the change each drop
// is: always the change the board's button or menu for it makes, from draft.ts, as one change of the draft with a line
// that names it for Undo (rule 1). Nothing here judges the plan. The checker does, once the change is saved (rule 2).

// What is dragged: unplanned orders (one order, a shop's orders or a whole group's), or a stop of the open trip. label
// names it in the Undo line and the announcements, and detail says more on the card that follows the pointer.
export type Dragged =
  | { kind: 'orders'; orders: BoardOrder[]; group: { brand: Brand; district: string }; label: string; detail: string }
  | { kind: 'stop'; tripKey: TripKey; index: number; label: string; brand: Brand; chilled?: boolean };

// Where it can land: the open trip's stops at place `at` (before the stop there, or after the last when `at` is their
// number), a trip's card in Done, the Unplanned orders column, or the empty middle.
export type Landing =
  | { kind: 'stops'; tripKey: TripKey; at: number }
  | { kind: 'card'; tripKey: TripKey }
  | { kind: 'unplanned' }
  | { kind: 'middle' };

// A drop: a change of the draft with its Undo, or the crew picker for orders dropped in the empty middle (spec 026).
export type Drop = { kind: 'change'; plan: DraftPlan; undo: Undo } | { kind: 'start'; pick: Pick };

// What a draggable carries, and what a place to land carries: its landing, and its name for the announcements.
export interface DragData { dragged: Dragged }
export interface DropData { landing: Landing; name: string }

// A trip stays in one district. With Mix brands off it also stays with one brand. An empty trip, or one with no
// district yet, can take the first orders that land on it.
export function fitsRoute(route: { brand: Brand; district: string } | null, mixBrands: boolean, shop: { brand: Brand; district: string }): boolean {
  if (!route) return true;
  return shop.district === route.district && (mixBrands || shop.brand === route.brand);
}

// Orders land on a trip's stops, its card or the empty middle. A stop lands among its own trip's stops, on a card or
// back on Unplanned orders. Anything dropped anywhere else goes back.
export function canLand(dragged: Dragged, landing: Landing): boolean {
  if (dragged.kind === 'orders') return landing.kind !== 'unplanned';
  return landing.kind === 'unplanned' || landing.kind === 'card' || (landing.kind === 'stops' && landing.tripKey === dragged.tripKey);
}

// A trip's truck in a sentence, named by its driver: "Chaminda's dry truck", "the second trip of Chaminda's dry truck"
// (spec 026). The board index's called gives it.
export type Called = (trip: DraftTrip) => string;

// The drop as a change of the draft, or null when it lands where it cannot or changes nothing.
export function dropOf(plan: DraftPlan, dragged: Dragged, landing: Landing, called: Called): Drop | null {
  if (!canLand(dragged, landing)) return null;
  if (dragged.kind === 'orders') {
    // In the empty middle, its group's "Start a trip": pick a crew, and the trip starts with these orders.
    if (landing.kind === 'middle') {
      return { kind: 'start', pick: { kind: 'start', group: dragged.group, orders: dragged.orders, startWith: dragged.orders, dropped: dragged.label } };
    }
    if (landing.kind === 'unplanned') return null;
    const trip = tripOf(plan, landing.tripKey);
    if (!trip) return null;
    // "Add": on the stop at the order's shop, or a new stop where it landed, at the end on a card.
    const next = addOrders(plan, landing.tripKey, dragged.orders, landing.kind === 'stops' ? landing.at : undefined);
    return { kind: 'change', plan: next, undo: { line: `${dragged.label} added to ${called(trip)}`, tripKey: landing.tripKey } };
  }

  const trip = tripOf(plan, dragged.tripKey);
  const stop = trip?.stops[dragged.index];
  if (!trip || !stop) return null;
  const change = (next: DraftPlan, line: string): Drop => ({ kind: 'change', plan: next, undo: { line, tripKey: dragged.tripKey } });
  if (landing.kind === 'stops') {
    // "Move up" and "Move down", as many places as it went: the end of the list is the last place.
    const to = Math.min(landing.at, trip.stops.length - 1);
    if (to === dragged.index) return null;
    const [first, last] = [Math.min(to, dragged.index) + 1, Math.max(to, dragged.index) + 1];
    return change(moveStop(plan, dragged.tripKey, dragged.index, to - dragged.index), `Stops ${first} and ${last} ${last - first === 1 ? 'swapped' : 'moved'}`);
  }
  // "Take off" for each of the stop's orders.
  if (landing.kind === 'unplanned') return change(takeOff(plan, stop.orderIds), `${dragged.label} taken off ${called(trip)}`);
  if (landing.kind === 'card') {
    const target = tripOf(plan, landing.tripKey);
    if (!target) return null;
    // Its orders put on that trip, which takes them off this one first.
    const moved = addOrders(plan, landing.tripKey, stop.orderIds.map((id) => ({ id, outletId: stop.outletId })));
    return change(moved, `${dragged.label} moved to ${called(target)}`);
  }
  return null;
}
