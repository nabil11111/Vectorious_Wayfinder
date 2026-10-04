import { ApplyArrangeRequest, ArrangeRequest, Arrangement, type ArrangementCrew, type DraftPlan } from '@wayfinder/contracts';
import { eq } from 'drizzle-orm';
import { db, type Tx } from '../db/client';
import { auditLog, orders } from '../db/schema';
import { HttpError } from '../lib/errors';
import { announce } from '../lib/live';
import { checkPlan, computeLoad } from '../planning';
import { lookup } from '../planning/lookup';
import { fixDepartures, type CandidateAttempt } from '../planning/planner/candidates';
import { chooseAllocation } from '../planning/planner/split';
import { prepareInput } from '../planning/planner/priority';
import type { PlanInput, PlannerInput, PlannerOrder, PlanTrip } from '../planning/types';
import type { Planner } from '../routes/plans';
import { readBoard } from './board';
import { crewsOf } from './crews';
import { finishPlan, openPlan, replaceDraft, validateDraft } from './draft';
import { plannerInputOf, withDrivers } from './suggest';
import { makeParts } from './split';
import { snapshot } from '../orders/store-orders';

// A checked way to place the orders the dispatcher selected, leaving every other assignment where it is.

export interface Placement { orderId: string; outletId: string; vehicleId: string; tripNo: number; newTrip: boolean; note: string }
export interface ArrangedSplit { orderId: string; keep: { productId: string; quantity: number }[]; keptOrderId: string; remainderOrderId: string; remainderWaiting: boolean }
export interface Arranged {
  selectedIds: string[];
  singleVehicle: boolean;
  summary: string;
  placements: Placement[];
  waiting: { orderId: string; reason: string }[];
  splits: ArrangedSplit[];
  plan: PlanInput['plan'];
  input: PlanInput;
}

const WAIT: Record<string, string> = {
  no_reefer: 'No refrigerated vehicle can take it',
  no_van: 'No van can reach this shop',
  over_capacity: 'No vehicle has room left for it',
  window: 'It would miss the delivery window',
  fuel: 'It would pass a weekly fuel quota',
};

const waitReason = (code: string) => WAIT[code] ?? 'No checked place was found';

const addOrders = (stops: PlanTrip['stops'], orders: readonly { id: string; outletId: string }[]): PlanTrip['stops'] => {
  const next = stops.map((stop) => ({ ...stop, orderIds: [...stop.orderIds] }));
  for (const order of orders) {
    const stop = next.find((item) => item.outletId === order.outletId);
    if (stop) stop.orderIds.push(order.id);
    else next.push({ outletId: order.outletId, orderIds: [order.id] });
  }
  return next;
};

const strip = (plan: PlanInput['plan'], selected: ReadonlySet<string>): PlanInput['plan'] => {
  const trips = plan.trips.map((trip) => ({
    ...trip,
    stops: trip.stops.map((stop) => ({ ...stop, orderIds: stop.orderIds.filter((id) => !selected.has(id)) })).filter((stop) => stop.orderIds.length > 0),
  })).filter((trip) => trip.stops.length > 0);
  return { trips, deferrals: plan.deferrals.filter((deferral) => !selected.has(deferral.orderId)) };
};

function accept(input: PlanInput, attempt: CandidateAttempt) {
  input.plan.trips = [
    ...input.plan.trips.filter((trip) => trip.vehicleId !== attempt.slot.vehicleId),
    ...attempt.input.plan.trips,
  ];
}

// One vehicle that can take every selected order, checked as a whole. Null when none can.
function tryWhole(base: PlanInput, selected: PlannerOrder[]): { vehicleId: string; tripNo: number; input: PlanInput } | null {
  const shopOf = lookup(base.outlets, 'shop');
  const chilled = selected.some((order) => computeLoad(order.lines, base.products).needsReefer);
  const needsVan = selected.some((order) => shopOf(order.outletId).parking === 'van_only');
  const fleet = base.vehicles.filter((vehicle) => vehicle.available && vehicle.depotId === base.depotId
    && (!chilled || vehicle.temp === 'reefer') && (!needsVan || vehicle.type === 'van'));
  const passing: { vehicleId: string; tripNo: number; input: PlanInput; existing: boolean }[] = [];
  for (const vehicle of fleet) {
    const existing = base.plan.trips.filter((trip) => trip.vehicleId === vehicle.id);
    if (existing.length >= 2) continue;
    const same = existing.find((trip) => trip.stops.every((stop) => {
      const shop = shopOf(stop.outletId);
      const first = shopOf(selected[0]!.outletId);
      return shop.district === first.district && (base.settings.mixBrands || shop.brand === first.brand);
    }));
    const tripNo = same?.tripNo ?? existing.length + 1;
    const trips = same
      ? existing.map((trip) => (trip.tripNo === same.tripNo ? { ...trip, stops: addOrders(trip.stops, selected) } : { ...trip, stops: trip.stops.map((stop) => ({ ...stop, orderIds: [...stop.orderIds] })) }))
      : [...existing.map((trip) => ({ ...trip, stops: trip.stops.map((stop) => ({ ...stop, orderIds: [...stop.orderIds] })) })), { vehicleId: vehicle.id, tripNo, stops: addOrders([], selected) }];
    const ids = new Set(trips.flatMap((trip) => trip.stops.flatMap((stop) => stop.orderIds)));
    const trial: PlanInput = {
      ...base,
      orders: [...base.orders, ...selected].filter((order) => ids.has(order.id)),
      vehicles: base.vehicles,
      plan: { trips, deferrals: [] },
    };
    const fixed = fixDepartures(structuredClone(trial));
    const blocked = fixed.check.problems.some((problem) => problem.level === 'block' && problem.vehicleId === vehicle.id);
    if (!blocked) passing.push({ vehicleId: vehicle.id, tripNo, input: fixed.input, existing: same !== undefined });
  }
  passing.sort((a, b) => Number(b.existing) - Number(a.existing) || a.vehicleId.localeCompare(b.vehicleId));
  const best = passing[0];
  return best ? { vehicleId: best.vehicleId, tripNo: best.tripNo, input: best.input } : null;
}

export function arrangeSelection(raw: PlannerInput, current: PlanInput['plan'], selectedIds: readonly string[]): Arranged {
  const source = prepareInput(raw);
  const selected = new Set(selectedIds);
  const asked = source.orders.filter((order) => selected.has(order.id));
  const parked = strip(current, selected);
  const placedIds = new Set(parked.trips.flatMap((trip) => trip.stops.flatMap((stop) => stop.orderIds)));
  const { date: _date, ...rest } = source;
  const input: PlanInput = { ...rest, orders: source.orders.filter((order) => placedIds.has(order.id)), plan: parked };
  const whole = asked.length > 0 ? tryWhole(input, asked) : null;
  if (whole) {
    const plan = whole.input.plan;
    return {
      selectedIds: [...selected], singleVehicle: true,
      summary: `${asked.length === 1 ? 'This order' : `All ${asked.length} orders`} can go on one vehicle.`,
      placements: asked.map((order) => ({ orderId: order.id, outletId: order.outletId, vehicleId: whole.vehicleId, tripNo: whole.tripNo, newTrip: !current.trips.some((trip) => trip.vehicleId === whole.vehicleId && trip.tripNo === whole.tripNo), note: 'Can take all of these orders' })),
      waiting: [], splits: [], plan, input: whole.input,
    };
  }

  const placements: Placement[] = [];
  const waiting: Arranged['waiting'] = [];
  const splits: ArrangedSplit[] = [];
  for (const order of asked) {
    const allocation = chooseAllocation(input, order, source.orders.length + splits.length);
    if (!allocation.best) {
      waiting.push({ orderId: order.id, reason: waitReason(allocation.code ?? 'over_capacity') });
      continue;
    }
    const before: PlanInput = { ...input, orders: [...input.orders], plan: { trips: structuredClone(input.plan.trips), deferrals: input.plan.deferrals } };
    const proposal = allocation.proposal;
    accept(input, allocation.best);
    if (!proposal) {
      input.orders.push(order);
      placements.push({ orderId: order.id, outletId: order.outletId, vehicleId: allocation.best.slot.vehicleId, tripNo: allocation.best.slot.tripNo, newTrip: !allocation.best.slot.existing, note: allocation.best.selectionReason ?? 'Takes these orders' });
      continue;
    }
    input.orders.push(proposal.kept);
      placements.push({ orderId: proposal.kept.id, outletId: order.outletId, vehicleId: allocation.best.slot.vehicleId, tripNo: allocation.best.slot.tripNo, newTrip: !allocation.best.slot.existing, note: allocation.best.selectionReason ?? 'Takes part of this order' });
    const remainder = chooseAllocation(input, proposal.remainder, source.orders.length + splits.length + 1);
    let remainderWaiting = true;
    if (remainder.best && !remainder.proposal) {
      accept(input, remainder.best);
      input.orders.push(proposal.remainder);
      placements.push({ orderId: proposal.remainder.id, outletId: order.outletId, vehicleId: remainder.best.slot.vehicleId, tripNo: remainder.best.slot.tripNo, newTrip: !remainder.best.slot.existing, note: remainder.best.selectionReason ?? 'Takes the rest of this order' });
      remainderWaiting = false;
    } else {
      input.plan = before.plan;
      input.orders = before.orders;
      accept(input, allocation.best);
      input.orders.push(proposal.kept);
      waiting.push({ orderId: order.id, reason: `Part stays behind: ${waitReason(remainder.code ?? 'over_capacity')}` });
    }
    splits.push({ orderId: order.id, keep: proposal.split.keep, keptOrderId: proposal.kept.id, remainderOrderId: proposal.remainder.id, remainderWaiting });
  }
  const vehicles = new Set(placements.map((placement) => placement.vehicleId));
  const summary = vehicles.size === 0
    ? 'No checked arrangement can take these orders.'
    : `No single vehicle can take all these orders. ${vehicles.size === 1 ? 'One vehicle' : `${vehicles.size} vehicles`} can take ${waiting.length > 0 ? 'part of them' : 'them'}.`;
  return { selectedIds: [...selected], singleVehicle: false, summary, placements, waiting, splits, plan: input.plan, input };
}

export function arrangementFingerprint(arranged: Arranged): string {
  const crews = [...arranged.placements].sort((a, b) => a.vehicleId.localeCompare(b.vehicleId) || a.tripNo - b.tripNo || a.orderId.localeCompare(b.orderId))
    .map((placement) => [placement.vehicleId, placement.tripNo, placement.orderId]);
  const waiting = [...arranged.waiting].sort((a, b) => a.orderId.localeCompare(b.orderId)).map((item) => [item.orderId, item.reason]);
  const splits = arranged.splits.map((split) => ({ orderId: split.orderId, keep: split.keep, remainderWaiting: split.remainderWaiting }));
  return JSON.stringify({ crews, waiting, splits });
}

const shopName = (boardShops: { id: string; name: string }[], outletId: string) => boardShops.find((shop) => shop.id === outletId)?.name ?? outletId;

const ROLE: Record<string, string> = {
  'keeps fridge trucks free': 'Keeps a refrigerated truck free',
  'keeps vans free': 'Keeps vans free for shops that need one',
  'fills an existing run': 'Joins a trip already going this way',
  'the only run that could carry these goods': 'The only vehicle that can take them',
  'uses a first run before a second': 'Uses a first trip',
  'takes a run freed for it': 'Uses a trip freed for these orders',
};

// One sentence for this crew: what it carries, and the checker's reason when that reason is a real choice.
export function crewWhy(placements: readonly Placement[], orders: readonly { id: string; load: { needsReefer: boolean } }[], driverId: string | null): string {
  const rows = placements.flatMap((placement) => {
    const order = orders.find((item) => item.id === placement.orderId);
    return order ? [order] : [];
  });
  const chilled = rows.filter((order) => order.load.needsReefer).length;
  const dry = rows.length - chilled;
  const shops = new Set(placements.map((placement) => placement.outletId)).size;
  const demand = rows.length === 0 ? '' : chilled > 0 && dry > 0 ? `${chilled} chilled and ${dry} dry` : chilled > 0 ? `${chilled} chilled` : `${dry} dry`;
  const role = ROLE[[...new Set(placements.map((placement) => placement.note))].find((note) => ROLE[note]) ?? ''] ?? '';
  const driver = driverId === null ? 'Needs a driver. ' : '';
  return `${driver}${demand ? `${demand} · ` : ''}${shops} ${shops === 1 ? 'shop' : 'shops'}${role ? `. ${role}` : ''}.`;
}

function present(arranged: Arranged, board: { plan: { revision: number }; orders: { id: string; load: { needsReefer: boolean } }[]; shops: { id: string; name: string }[]; vehicles: { id: string; type: string; temp: string; weightCapKg: number; volumeCapM3: number }[]; drivers: { id: string; name: string }[] }, drivers: Map<string, string | null>): Arrangement {
  const check = checkPlan(arranged.input);
  const groups = new Map<string, Placement[]>();
  for (const placement of arranged.placements) {
    const key = `${placement.vehicleId}:${placement.tripNo}`;
    groups.set(key, [...(groups.get(key) ?? []), placement]);
  }
  const crews: ArrangementCrew[] = [...groups.entries()].map(([key, placements]) => {
    const [vehicleId, tripNo] = [placements[0]!.vehicleId, placements[0]!.tripNo];
    const vehicle = board.vehicles.find((item) => item.id === vehicleId);
    const trip = check.trips.find((item) => item.vehicleId === vehicleId && item.tripNo === tripNo);
    const day = check.vehicles.find((item) => item.vehicleId === vehicleId);
    const orderIds = placements.map((placement) => placement.orderId).filter((id) => !id.startsWith('split:'));
    const splitIds = arranged.splits.flatMap((split) => placements.some((placement) => placement.orderId === split.keptOrderId || placement.orderId === split.remainderOrderId) ? [split.orderId] : []);
    return {
      vehicleId, driverId: drivers.get(vehicleId) ?? null, tripNo, newTrip: placements.some((placement) => placement.newTrip),
      orderIds: [...new Set([...orderIds, ...splitIds])],
      shops: [...new Set(placements.map((placement) => shopName(board.shops, placement.outletId)))],
      kg: trip?.load.kg ?? 0, m3: trip?.load.m3 ?? 0,
      weightCapKg: vehicle?.weightCapKg ?? 0, volumeCapM3: vehicle?.volumeCapM3 ?? 0,
      refrigerated: vehicle?.temp === 'reefer',
      leaveAt: trip?.times?.leaveAt ?? null, backAt: trip?.times?.backAt ?? null,
      fuelL: trip?.times?.litres ?? null, quotaLeftL: day?.litresLeft ?? null,
      why: crewWhy(placements, board.orders, drivers.get(vehicleId) ?? null),
    };
  });
  return Arrangement.parse({
    revision: board.plan.revision, orderIds: arranged.selectedIds, fingerprint: arrangementFingerprint(arranged),
    summary: arranged.summary, singleVehicle: arranged.singleVehicle, crews,
    waiting: arranged.waiting.map((item) => ({ orderId: item.orderId, shop: item.reason, reason: item.reason })),
    splits: arranged.splits,
  });
}

// Waiting orders are not on the plan input. Their shop comes from the source order, passed in below.
function presentWaiting(arranged: Arranged, shops: { id: string; name: string }[], orders: { id: string; outletId: string }[]) {
  return arranged.waiting.map((item) => {
    const order = orders.find((candidate) => candidate.id === item.orderId);
    return { orderId: item.orderId, shop: shopName(shops, order?.outletId ?? ''), reason: item.reason };
  });
}

async function arrangedFor(tx: Tx, caller: Planner, date: string, orderIds: string[]) {
  const { board, input } = await readBoard(tx, caller.depotId, date);
  if (board.plan.status === 'published') throw new HttpError(409, 'plan_sent', 'This plan has been sent.');
  if (!input || !board.day) throw new Error('A dated plan board has no checker input.');
  for (const id of orderIds) {
    if (!board.orders.some((order) => order.id === id)) throw new HttpError(400, 'unknown_record', 'That order is not one of this depot\'s orders for the day.', { id });
  }
  const onTrip = new Set(board.plan.trips.flatMap((trip) => trip.stops.flatMap((stop) => stop.orderIds)));
  if (orderIds.some((id) => onTrip.has(id))) throw new HttpError(400, 'invalid_input', 'Plan orders that are not already on a trip.');
  const crews = await crewsOf(tx, caller.depotId, date);
  const earlier = new Map(board.plan.trips.flatMap((trip) => (trip.driverId ? [[trip.vehicleId, trip.driverId] as const] : [])));
  const day = withDrivers(plannerInputOf(board, input), earlier, crews.staff);
  const arranged = arrangeSelection(day, input.plan, orderIds);
  const driving = new Set(board.plan.trips.flatMap((trip) => (trip.driverId ? [trip.driverId] : [])));
  const drivers = new Map<string, string | null>();
  for (const vehicleId of new Set(arranged.placements.map((placement) => placement.vehicleId))) {
    const own = board.plan.trips.find((trip) => trip.vehicleId === vehicleId)?.driverId ?? null;
    const usual = crews.usual.get(vehicleId) ?? null;
    drivers.set(vehicleId, own ?? (usual && !driving.has(usual) ? usual : null));
  }
  const view = present(arranged, board, drivers);
  view.waiting = presentWaiting(arranged, board.shops, board.orders);
  return { board, input, arranged, drivers, view, crews };
}

export function previewArrangement(caller: Planner, date: string, body: ArrangeRequest) {
  const request = ArrangeRequest.parse(body);
  return snapshot((tx) => arrangedFor(tx, caller, date, request.orderIds).then((result) => result.view));
}

export function draftFrom(current: DraftPlan, arranged: Arranged, drivers: Map<string, string | null>, idMap: Map<string, string>): DraftPlan {
  const selected = new Set(arranged.selectedIds);
  const touched = new Set(arranged.placements.map((placement) => placement.vehicleId));
  const mapId = (id: string) => idMap.get(id) ?? id;
  const keep = current.trips.filter((trip) => !touched.has(trip.vehicleId)).flatMap((trip) => {
    if (trip.stops.length === 0) return [trip];
    const stops = trip.stops.map((stop) => ({ ...stop, orderIds: stop.orderIds.filter((id) => !selected.has(id)) })).filter((stop) => stop.orderIds.length > 0);
    return stops.length > 0 ? [{ ...trip, stops }] : [];
  });
  const replaced = arranged.plan.trips.filter((trip) => touched.has(trip.vehicleId)).map((trip) => ({
    vehicleId: trip.vehicleId,
    tripNo: trip.tripNo === 2 ? 2 as const : 1 as const,
    leaveAt: trip.leaveAt ?? null,
    driverId: drivers.get(trip.vehicleId) ?? current.trips.find((item) => item.vehicleId === trip.vehicleId)?.driverId ?? null,
    stops: trip.stops.map((stop) => ({ outletId: stop.outletId, orderIds: stop.orderIds.map(mapId) })).filter((stop) => stop.orderIds.length > 0),
  })).filter((trip) => trip.stops.length > 0);
  const assigned = new Set(replaced.flatMap((trip) => (trip.driverId ? [trip.driverId] : [])));
  const trips = [...keep.map((trip) => (trip.driverId && assigned.has(trip.driverId) && !replaced.some((item) => item.vehicleId === trip.vehicleId) ? { ...trip, driverId: null } : trip)), ...replaced];
  return { mixBrands: current.mixBrands, trips, deferrals: current.deferrals.filter((deferral) => !selected.has(deferral.orderId)) };
}

export async function applyArrangement(caller: Planner, date: string, body: ApplyArrangeRequest) {
  const request = ApplyArrangeRequest.parse(body);
  const board = await db.transaction(async (tx) => {
    const opened = await openPlan(tx, caller, date, request);
    const result = await arrangedFor(tx, caller, date, request.orderIds);
    if (result.board.plan.revision !== opened.plan.revision) throw new HttpError(409, 'stale', 'The plan was changed in another tab, so it was loaded again.');
    if (arrangementFingerprint(result.arranged) !== request.fingerprint) throw new HttpError(409, 'stale', 'These orders changed while the arrangement was open. Look again.');
    const idMap = new Map<string, string>();
    for (const split of result.arranged.splits) {
      const [original] = await tx.select().from(orders).where(eq(orders.id, split.orderId));
      if (!original) throw new HttpError(400, 'unknown_record', 'That order is not one of this depot\'s orders for the day.', { id: split.orderId });
      const [first, second] = await makeParts(tx, caller, original, split.keep);
      idMap.set(split.keptOrderId, first.id);
      idMap.set(split.remainderOrderId, second.id);
    }
    const draft = draftFrom(result.board.plan, result.arranged, result.drivers, idMap);
    validateDraft(draft, await readBoard(tx, caller.depotId, date, opened.moment).then((read) => read.board));
    await replaceDraft(tx, opened.plan.id, draft);
    await tx.insert(auditLog).values({
      actorId: caller.userId, action: 'plan.arranged', entity: 'plan', entityId: opened.plan.id,
      before: { revision: opened.plan.revision, orderIds: request.orderIds },
      after: { trips: draft.trips.length, waiting: result.arranged.waiting.map((item) => item.orderId), splits: result.arranged.splits.map((split) => split.orderId) },
    });
    return finishPlan(tx, opened);
  });
  announce({ topic: 'plans', depotId: caller.depotId });
  return board;
}
