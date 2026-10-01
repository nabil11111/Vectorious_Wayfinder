import type { BoardOrder, Brand, Crew, CrewList, DraftPlan } from '@wayfinder/contracts';
import type { Undo } from '../board';
import { freeTripNo, keyOf, startTrip, swapTruck, tripOf, vehicleOfDriver, type CrewRef, type TripKey } from '../draft';
import { countOf, crewName, cubic, hhmm, tonnes } from '../words';
import { movesLine } from './drivers';
import type { BoardIndex } from './lookup';

// The crew picker (spec 026, D-100): a truck and its driver picked as one. Its rows say what the crews read says of each
// crew, in the read's order, and a pick is one change of the draft with one Undo. Nothing here judges the plan: the
// crews read and the checker do.

// What a crew is picked for: a new trip, from a group's "Start a trip" (the group's orders, and the trip starts empty),
// from Find a slot or an order dropped in the empty middle (the trip starts with that order); or another truck for an
// open trip. dropped names what a drop started the trip with, for the trip's Undo line (spec 023).
export type Pick =
  | { kind: 'start'; group: { brand: Brand; district: string } | null; orders: BoardOrder[]; startWith: BoardOrder[]; dropped?: string }
  | { kind: 'swap'; key: TripKey };

// The orders the crews are read for: the group's or the dropped ones, or the open trip's.
export function pickOrders(pick: Pick, plan: DraftPlan, index: BoardIndex): BoardOrder[] {
  if (pick.kind === 'start') return pick.orders;
  return tripOf(plan, pick.key)?.stops.flatMap((stop) => stop.orderIds.flatMap((id) => index.order(id) ?? [])) ?? [];
}

// The draft without the trip being moved, so a truck's free trip is counted as the move would leave it.
const withoutMoved = (pick: Pick, plan: DraftPlan): DraftPlan => (pick.kind === 'swap' ? { ...plan, trips: plan.trips.filter((t) => keyOf(t) !== pick.key) } : plan);

// A crew's row: "Chaminda · dry truck · 7.2 t · 38 m³", what matters under it, and what a pick would leave a truck
// without (rule 2). A truck in the workshop or on two trips cannot be picked.
export interface CrewRow { vehicleId: string; driverId: string | null; title: string; line: string; warning: string | null; disabled: boolean }

const list = new Intl.ListFormat('en-GB');

// Why a truck may not take the orders, in a few words, from the crews read's misfits.
function misfitWords(crew: Crew, load: CrewList['load'], index: BoardIndex): string[] {
  const words: string[] = [];
  if (crew.misfits.some((m) => m.code === 'over_weight')) words.push(`too heavy: ${tonnes(load.kg)} of ${tonnes(crew.weightCapKg)}`);
  if (crew.misfits.some((m) => m.code === 'over_volume')) words.push(`too big: ${cubic(load.m3)} of ${cubic(crew.volumeCapM3)}`);
  for (const outletId of new Set(crew.misfits.filter((m) => m.code === 'van_only').map((m) => m.outletId))) {
    words.push(`cannot reach ${(outletId && index.shop(outletId)?.name) ?? 'a shop'}: van only`);
  }
  const chilled = new Set(crew.misfits.filter((m) => m.code === 'needs_reefer').map((m) => m.orderId)).size;
  if (chilled > 0) words.push(chilled === 1 ? 'no fridge for the chilled order' : `no fridge for ${countOf(chilled, 'chilled order')}`);
  return words;
}

export function crewRows(read: CrewList, pick: Pick, plan: DraftPlan, index: BoardIndex): CrewRow[] {
  const moving = pick.kind === 'swap' ? tripOf(plan, pick.key) : null;
  const left = withoutMoved(pick, plan);
  return read.crews.filter((crew) => crew.vehicleId !== moving?.vehicleId).map((crew) => {
    const driver = index.driver(crew.driverId);
    const title = `${crewName({ id: crew.vehicleId, type: crew.type, temp: crew.temp }, driver?.name ?? null)} · ${tonnes(crew.weightCapKg)} · ${cubic(crew.volumeCapM3)}`;
    const tripNo = freeTripNo(left, crew.vehicleId);
    // The draft on screen can be a save ahead of the read, so a truck it already runs twice is off too.
    if (crew.unavailable || tripNo === null) {
      const why = crew.unavailable?.kind === 'workshop' ? `in the workshop: ${crew.unavailable.reason.toLowerCase()}` : 'on two trips already';
      return { vehicleId: crew.vehicleId, driverId: crew.driverId, title, line: why, warning: null, disabled: true };
    }
    const ready = tripNo === 2 ? index.trip(crew.vehicleId, 1)?.times?.readyAgainAt : undefined;
    const line = [
      ...(read.orderIds.length > 0 ? (crew.fits ? ['fits'] : misfitWords(crew, read.load, index)) : []),
      ...(tripNo === 2 ? [`trip 2${ready !== undefined ? ` · ready ${hhmm(ready)}` : ''}`] : []),
      ...(crew.lastDistricts.length > 0 ? [`ran ${list.format(crew.lastDistricts)} last time`] : []),
      `fuel ${crew.fuelLeftPct}% left`,
    ].join(' · ');
    // The crew's driver drives another truck that keeps a trip after the pick: it will have none (rule 2).
    const other = crew.driverId === null ? null : vehicleOfDriver(left, crew.driverId, crew.vehicleId);
    return { vehicleId: crew.vehicleId, driverId: crew.driverId, title, line, warning: other && driver ? `${driver.name} ${movesLine(other)}` : null, disabled: false };
  });
}

// The change a picked crew makes (rule 1): the trip started on its truck, or moved there, with its driver, as one change
// of the draft with one Undo, whose line names the crew and any truck the driver left. null when the truck runs two
// trips already.
export function crewChange(pick: Pick, plan: DraftPlan, crew: CrewRef, index: BoardIndex): { plan: DraftPlan; key: TripKey; undo: Undo } | null {
  const made = pick.kind === 'start' ? startTrip(plan, crew, pick.startWith) : swapTruck(plan, pick.key, crew);
  const trip = made ? tripOf(made.plan, made.key) : null;
  if (!made || !trip) return null;
  const truck = index.called({ ...trip, tripNo: 1 });
  let line = pick.kind === 'swap' ? `Trip moved to ${truck}${trip.tripNo === 2 ? ', as its second trip' : ''}`
    : pick.dropped !== undefined ? `${pick.dropped} added to ${index.called(trip)}`
      : `${trip.tripNo === 2 ? 'Second trip' : 'Trip'} started on ${truck}`;
  const left = crew.driverId === null ? null : vehicleOfDriver(withoutMoved(pick, plan), crew.driverId, crew.vehicleId);
  if (left !== null) line += `. ${left} has no driver now.`;
  return { ...made, undo: { before: plan, line, tripKey: made.key } };
}
