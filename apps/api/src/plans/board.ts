import { DeferralCode, PlanCheck, type DraftPlan, type PlanBoard, type TripFigures } from '@wayfinder/contracts';
import { and, desc, eq, inArray, lt, lte } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { calendarDays, deferrals, demoDay, districtTravel, fuelLog, orderLines, orders, outlets, plans, products, serviceAllowance, stopOrders, stops, trips, users, vehicleDaysOff, vehicles } from '../db/schema';
import { demoClockAt, depotDate, depotInstant, depotMinutes, now, realNow } from '../lib/clock';
import { config } from '../lib/config';
import { HttpError } from '../lib/errors';
import { CUTOFF_MINUTES } from '../orders/orderable-day';
import { snapshot } from '../orders/store-orders';
import { checkPlan, computeLoad, DEFAULT_SETTINGS, toMinutes, type PlanInput } from '../planning';
import type { Planner } from '../routes/plans';
import { boardDay, percent } from './board-day';

export interface BoardMoment { at: Date; demoDay: number }
export const emptyDraft = (): DraftPlan => ({ mixBrands: false, trips: [], deferrals: [] });
const sum = (values: number[], precision = 1) => Math.round(values.reduce((a, b) => a + b, 0) * 10 ** precision) / 10 ** precision;
const minutes = (value: string) => toMinutes(value.slice(0, 5));

export async function operatingDays(tx: Tx): Promise<string[]> {
  return (await tx.select({ date: calendarDays.date }).from(calendarDays).where(eq(calendarDays.isOperating, true)).orderBy(calendarDays.date)).map((row) => row.date);
}

// Called inside `snapshot`, whose lock on orders keeps a reset wholly before or after the read.
export async function readMoment(tx: Tx): Promise<BoardMoment> {
  if (!config.DEMO_MODE) return { at: now(), demoDay: 1 };
  const [row] = await tx.select().from(demoDay);
  if (!row) throw new Error('The demo day has no clock row. Run the seed first.');
  return { at: new Date(demoClockAt(row, realNow()).now), demoDay: row.day };
}

export function getBoard(caller: Planner, date?: string): Promise<PlanBoard> {
  return snapshot(async (tx) => {
    const moment = await readMoment(tx);
    const day = boardDay(depotDate(moment.at), depotMinutes(moment.at), await operatingDays(tx));
    return boardOf(tx, caller.depotId, date ?? day?.date ?? null, moment);
  });
}

// Kept beside the board so slot searches can pass precisely the same data to the checker.
export async function readBoard(tx: Tx, depotId: string, date: string | null, moment?: BoardMoment): Promise<{ board: PlanBoard; input: PlanInput | null }> {
  const clock = moment ?? await readMoment(tx);
  const days = await operatingDays(tx);
  const currentDay = boardDay(depotDate(clock.at), depotMinutes(clock.at), days);
  const blank: PlanBoard = {
    depot: depotId, demoDay: clock.demoDay, day: null,
    plan: { ...emptyDraft(), id: null, revision: 0, status: 'draft', savedAt: null, sentAt: null, canUnsend: false },
    dropped: [], check: null, orders: [], shops: [], vehicles: [], drivers: [], figures: null, counts: null,
  };
  if (!date) return { board: blank, input: null };
  const cutoffDate = days.filter((day) => day < date).at(-1);
  if (!cutoffDate) throw new HttpError(400, 'invalid_input', 'That day has no preceding operating day in the calendar.');
  const cutoffAt = depotInstant(cutoffDate, CUTOFF_MINUTES);
  const [calendar] = await tx.select().from(calendarDays).where(eq(calendarDays.date, date));
  if (!calendar) throw new HttpError(400, 'invalid_input', 'That day is outside the delivery calendar.');
  const [saved] = await tx.select().from(plans).where(and(eq(plans.depotId, depotId), eq(plans.date, date)));
  const tripRows = saved ? await tx.select().from(trips).where(eq(trips.planId, saved.id)).orderBy(trips.vehicleId, trips.tripNo) : [];
  const stopRows = tripRows.length ? await tx.select().from(stops).where(inArray(stops.tripId, tripRows.map((t) => t.id))).orderBy(stops.seq) : [];
  const assignments = stopRows.length ? await tx.select().from(stopOrders).where(inArray(stopOrders.stopId, stopRows.map((s) => s.id))).orderBy(stopOrders.orderId) : [];
  const deferred = saved ? await tx.select().from(deferrals).where(eq(deferrals.planId, saved.id)).orderBy(deferrals.orderId) : [];
  const named = new Set([...assignments.map((a) => a.orderId), ...deferred.map((d) => d.orderId)]);
  const shopRows = await tx.select().from(outlets).where(eq(outlets.depotId, depotId)).orderBy(outlets.id);
  const orderRows = shopRows.length ? await tx.select().from(orders).where(and(
    inArray(orders.outletId, shopRows.map((s) => s.id)),
    saved?.status === 'published' ? inArray(orders.id, [...named]) : and(inArray(orders.status, ['placed', 'deferred']), lte(orders.deliveryDate, date)),
  )).orderBy(orders.deliveryDate, orders.outletId, orders.temp, orders.id) : [];
  const eligible = new Set(orderRows.map((o) => o.id));
  const allIds = [...new Set([...eligible, ...orderRows.flatMap((o) => o.splitFrom ? [o.splitFrom] : [])])];
  const lineRows = allIds.length ? await tx.select().from(orderLines).where(inArray(orderLines.orderId, allIds)).orderBy(orderLines.productId) : [];
  const productRows = await tx.select().from(products).orderBy(products.id);
  const engineProducts = productRows.map((p) => ({ ...p, kgPerUnit: Number(p.kgPerUnit), m3PerUnit: Number(p.m3PerUnit) }));
  const histories = allIds.length ? await tx.select({ orderId: deferrals.orderId, code: deferrals.code, reason: deferrals.reason, date: plans.date })
    .from(deferrals).innerJoin(plans, eq(plans.id, deferrals.planId))
    .where(and(inArray(deferrals.orderId, allIds), eq(plans.status, 'published'), lte(plans.date, date))).orderBy(desc(plans.date)) : [];
  const boardOrders: PlanBoard['orders'] = orderRows.map((order) => {
    const lines = lineRows.filter((l) => l.orderId === order.id).map((line) => {
      const item = productRows.find((p) => p.id === line.productId);
      if (!item) throw new Error(`No product ${line.productId}.`);
      return { productId: item.id, name: item.name, unit: item.unit, quantity: line.quantity };
    });
    const history = histories.filter((h) => h.orderId === order.id || h.orderId === order.splitFrom);
    const last = history[0];
    return { id: order.id, outletId: order.outletId, temp: order.temp, deliveryDate: order.deliveryDate, lines,
      load: computeLoad(lines, engineProducts), carriedOver: order.deliveryDate < date,
      timesDeferred: new Set(history.map((h) => h.date)).size,
      lastDeferral: last ? { code: DeferralCode.parse(last.code), reason: last.reason } : null,
      splitFrom: order.splitFrom, originalUnits: order.splitFrom ? lineRows.filter((l) => l.orderId === order.splitFrom).reduce((n, l) => n + l.quantity, 0) : null };
  });
  const draft: DraftPlan = {
    mixBrands: saved?.mixBrands ?? false,
    trips: tripRows.map((trip) => ({ vehicleId: trip.vehicleId, tripNo: trip.tripNo as 1 | 2, driverId: trip.driverId,
      leaveAt: trip.departAt === null ? null : minutes(trip.departAt),
      stops: stopRows.filter((s) => s.tripId === trip.id).map((s) => ({ outletId: s.outletId,
        orderIds: assignments.filter((a) => a.stopId === s.id && eligible.has(a.orderId)).map((a) => a.orderId),
      })).filter((s) => s.orderIds.length > 0),
    })),
    deferrals: deferred.filter((d) => eligible.has(d.orderId)).map((d) => ({ orderId: d.orderId, code: DeferralCode.parse(d.code), reason: d.reason })),
  };
  const allowances = await tx.select().from(serviceAllowance);
  const engineShops = shopRows.map((shop) => {
    const mall = shop.mallWindow?.split('-');
    return { ...shop, windowOpen: minutes(shop.windowOpen), windowClose: minutes(shop.windowClose),
      ...(mall ? { mallOpen: minutes(mall[0]!), mallClose: minutes(mall[1]!) } : {}) };
  });
  const fleet = await tx.select().from(vehicles).where(eq(vehicles.depotId, depotId)).orderBy(vehicles.id);
  const off = await tx.select().from(vehicleDaysOff).where(eq(vehicleDaysOff.date, date));
  const fuel = await tx.select({ vehicleId: fuelLog.vehicleId, litres: fuelLog.litres }).from(fuelLog)
    .innerJoin(calendarDays, eq(calendarDays.date, fuelLog.date))
    .where(and(eq(calendarDays.isoYear, calendar.isoYear), eq(calendarDays.isoWeek, calendar.isoWeek), lt(fuelLog.date, date)));
  const engineVehicles = fleet.map((v) => ({ ...v, volumeCapM3: Number(v.volumeCapM3), kmPerL: Number(v.kmPerL),
    available: v.archivedAt === null && !off.some((o) => o.vehicleId === v.id),
    litresUsedThisWeek: sum(fuel.filter((f) => f.vehicleId === v.id).map((f) => Number(f.litres))),
  }));
  const travel = await tx.select().from(districtTravel).where(eq(districtTravel.depotId, depotId));
  const input: PlanInput = {
    depotId, operatingDay: calendar.isOperating, settings: { ...DEFAULT_SETTINGS, mixBrands: draft.mixBrands }, products: engineProducts,
    orders: boardOrders.map((o) => ({ id: o.id, outletId: o.outletId, lines: o.lines })), outlets: engineShops, vehicles: engineVehicles,
    allowances, travel: travel.map((t) => ({ depotId: t.depotId, district: t.district, outMin: t.depotToDistrictMin, outKm: t.depotToDistrictKm, betweenMin: t.interStopMin, betweenKm: Number(t.interStopKm) })),
    plan: { trips: draft.trips.map(({ leaveAt, ...t }) => ({ ...t, ...(leaveAt === null ? {} : { leaveAt }) })), deferrals: draft.deferrals },
  };
  const check = saved?.status === 'published' ? saved.sentCheck === null ? null : PlanCheck.parse(saved.sentCheck) : checkPlan(input);
  // Older sent plans have no saved check. Fleet fuel still comes from the checker with no trips to recalculate.
  const fuelCheck = check ?? checkPlan({ ...input, plan: { trips: [], deferrals: [] } });
  const boardVehicles: PlanBoard['vehicles'] = engineVehicles.map((v) => {
    const checked = fuelCheck.vehicles.find((c) => c.vehicleId === v.id);
    if (!checked) throw new Error(`No fuel figures for ${v.id}.`);
    return { id: v.id, type: v.type, temp: v.temp, weightCapKg: v.weightCapKg, volumeCapM3: v.volumeCapM3,
      working: v.available, offReason: off.find((o) => o.vehicleId === v.id)?.reason ?? (v.archivedAt ? 'Archived' : null),
      litresLeft: checked.litresLeft, fuelLeftPct: percent(checked.litresLeft, checked.quotaL) };
  });
  const figures: TripFigures[] | null = check && check.trips.map((t) => {
    const vehicle = engineVehicles.find((v) => v.id === t.vehicleId)!;
    const used = check.vehicles.find((v) => v.vehicleId === t.vehicleId)!;
    const trip = draft.trips.find((x) => x.vehicleId === t.vehicleId && x.tripNo === t.tripNo)!;
    const fresh = trip.stops.some((s) => engineShops.find((o) => o.id === s.outletId)?.brand === 'Fresh');
    return { vehicleId: t.vehicleId, tripNo: t.tripNo, kgPct: percent(t.load.kg, vehicle.weightCapKg), m3Pct: percent(t.load.m3, vehicle.volumeCapM3),
      timePct: percent(fresh ? used.freshMin : used.styleTechMin, fresh ? DEFAULT_SETTINGS.budgetMin.fresh : DEFAULT_SETTINGS.budgetMin.styleTech) };
  });
  const assigned = new Set(draft.trips.flatMap((t) => t.stops.flatMap((s) => s.orderIds)));
  const timings = check?.trips.flatMap((t) => t.times ? [t.times] : []) ?? [];
  const drivers = await tx.select({ id: users.id, name: users.displayName }).from(users).where(and(eq(users.depotId, depotId), eq(users.role, 'driver'), eq(users.active, true))).orderBy(users.displayName);
  const board: PlanBoard = {
    ...blank, day: { date, cutoffAt: cutoffAt.toISOString(), open: clock.at >= cutoffAt },
    plan: { ...draft, id: saved?.id ?? null, revision: saved?.revision ?? 0, status: saved?.status ?? 'draft', savedAt: saved?.savedAt?.toISOString() ?? null,
      sentAt: saved?.publishedAt?.toISOString() ?? null, canUnsend: saved?.status === 'published' && currentDay?.date === date && tripRows.every((t) => t.status === 'planned') },
    dropped: [...named].filter((id) => !eligible.has(id)), check, orders: boardOrders, vehicles: boardVehicles, drivers, figures,
    shops: engineShops.map((s) => {
      const allowance = allowances.find((a) => a.brand === s.brand && a.dockType === s.dockType);
      if (!allowance) throw new Error(`No unloading allowance for ${s.brand} at ${s.dockType}.`);
      return { ...s, mallOpen: s.mallOpen ?? null, mallClose: s.mallClose ?? null, unloadMin: allowance.minutes };
    }),
    counts: check && { vehiclesUsed: new Set(draft.trips.map((t) => t.vehicleId)).size, vehiclesWorking: boardVehicles.filter((v) => v.working).length,
      trips: draft.trips.length, ordersDue: boardOrders.length, ordersOnTrips: assigned.size, ordersDeferred: draft.deferrals.length,
      ordersUnplanned: boardOrders.length - assigned.size - draft.deferrals.length,
      fuelWeekPct: percent(sum(check.vehicles.map((v) => v.litresBefore + v.litresPlan)), sum(check.vehicles.map((v) => v.quotaL))),
      fridgeM3Used: sum(check.trips.filter((t) => engineVehicles.find((v) => v.id === t.vehicleId)?.temp === 'reefer').map((t) => t.load.m3), 3),
      fridgeM3Working: sum(boardVehicles.filter((v) => v.working && v.temp === 'reefer').map((v) => v.volumeCapM3), 3),
      stops: draft.trips.reduce((n, t) => n + t.stops.length, 0), stopsOnTime: timings.flatMap((t) => t.stops).filter((s) => !s.late).length,
      km: sum(timings.map((t) => t.km)), hoursOnRoad: sum(timings.map((t) => (t.backAt - t.leaveAt) / 60)),
      drivers: new Set(draft.trips.flatMap((t) => t.driverId ? [t.driverId] : [])).size },
  };
  return { board, input };
}

export async function boardOf(tx: Tx, depotId: string, date: string | null, moment?: BoardMoment): Promise<PlanBoard> {
  return (await readBoard(tx, depotId, date, moment)).board;
}
