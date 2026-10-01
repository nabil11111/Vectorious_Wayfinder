import { LookupFleet, type LookupFuel, type LookupTripRef, type LookupVehicle } from '@wayfinder/contracts';
import { and, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { calendarDays, fuelLog, plans, trips, users, vehicleDaysOff, vehicles } from '../db/schema';
import { depotDate, depotInstant } from '../lib/clock';
import type { DepotCaller } from '../middleware/auth';
import { snapshot } from '../orders/store-orders';
import { readMoment } from '../plans/board';
import { percent } from '../plans/board-day';
import { keptTrip, scopeOf } from './dates';

export function getLookupFleet(caller: DepotCaller): Promise<LookupFleet> {
  return snapshot(async tx => {
    const moment = await readMoment(tx), today = depotDate(moment.at), scope = await scopeOf(tx, caller.depotId, moment);
    const fleet = await tx.select().from(vehicles).where(eq(vehicles.depotId, caller.depotId));
    const ids = fleet.map(row => row.id);
    const off = ids.length ? await tx.select().from(vehicleDaysOff).where(and(inArray(vehicleDaysOff.vehicleId, ids), eq(vehicleDaysOff.date, today))) : [];
    const [calendar] = await tx.select().from(calendarDays).where(eq(calendarDays.date, today));
    const week = calendar ? await tx.select().from(calendarDays).where(and(eq(calendarDays.isoYear, calendar.isoYear), eq(calendarDays.isoWeek, calendar.isoWeek), lt(calendarDays.dow, 6))).orderBy(calendarDays.date) : [];
    const dates = week.map(row => row.date);
    const ledger = ids.length && dates.length ? await tx.select().from(fuelLog).where(and(inArray(fuelLog.vehicleId, ids), inArray(fuelLog.date, dates))) : [];
    // Rank just identifiers in SQL: never materialize every historical plan/check for the five-link rail.
    const ranked = tx.select({ id: trips.id, date: plans.date, status: trips.status,
      rank: sql<number>`row_number() over (partition by ${trips.vehicleId} order by ${plans.date} desc, ${trips.tripNo} desc, ${trips.id})`.as('rank') })
      .from(trips).innerJoin(plans, eq(plans.id, trips.planId)).where(and(eq(plans.depotId, caller.depotId), eq(plans.status, 'published'))).as('ranked_trips');
    const relevant = tx.select({ id: ranked.id }).from(ranked).where(or(lte(ranked.rank, 5), eq(ranked.date, today), eq(ranked.status, 'out'), dates.length ? inArray(ranked.date, dates) : undefined));
    const rows = await tx.select({ trip: trips, plan: plans, driver: { id: users.id, name: users.displayName } }).from(trips).innerJoin(plans, eq(plans.id, trips.planId))
      .leftJoin(users, eq(users.id, trips.driverId)).where(inArray(trips.id, relevant));
    const refs: LookupTripRef[] = rows.map(({ trip, plan, driver }) => {
      if (!ids.includes(trip.vehicleId)) throw new Error(`Trip ${trip.id} names a vehicle outside its depot.`);
      const kept = keptTrip(plan, trip);
      return { tripId: trip.id, planId: plan.id, date: plan.date, vehicleId: trip.vehicleId, tripNo: trip.tripNo, status: trip.status, driver,
        leavesAt: depotInstant(plan.date, kept.times.leaveAt).toISOString(), plannedReturn: depotInstant(plan.date, kept.times.backAt).toISOString(), km: kept.times.km,
        readyAt: trip.readyAt?.toISOString() ?? null, leftAt: trip.leftAt?.toISOString() ?? null, backAt: trip.backAt?.toISOString() ?? null };
    });
    const fuelOf = (selected: typeof fleet): LookupFuel | null => {
      if (!calendar) return null;
      const selectedIds = new Set(selected.map(row => row.id)), own = ledger.filter(row => selectedIds.has(row.vehicleId));
      const quota = selected.reduce((n, row) => n + row.weeklyFuelQuotaL, 0);
      const sum = (rows: typeof own) => rows.reduce((n, row) => n + Math.round(Number(row.litres) * 10), 0) / 10;
      const recordedCommitted = sum(own), remaining = (quota * 10 - Math.round(recordedCommitted * 10)) / 10;
      const sent = refs.filter(row => selectedIds.has(row.vehicleId) && dates.includes(row.date));
      return { isoYear: calendar.isoYear, isoWeek: calendar.isoWeek, recordedCommitted, quota, remaining,
        recordedCommittedPct: quota === 0 ? null : percent(recordedCommitted, quota), remainingPct: quota === 0 ? null : percent(remaining, quota),
        sentTrips: sent.length, plannedKm: sent.reduce((n, row) => n + Math.round(row.km * 10), 0) / 10,
        days: week.map(day => ({ date: day.date, dow: day.dow, litres: sum(own.filter(row => row.date === day.date)) })) };
    };
    const shown: LookupVehicle[] = fleet.map(vehicle => {
      const own = refs.filter(row => row.vehicleId === vehicle.id);
      const outTrips = own.filter(row => row.status === 'out').sort((a, b) => a.date.localeCompare(b.date) || a.tripNo - b.tripNo || a.tripId.localeCompare(b.tripId));
      const todayTrips = own.filter(row => row.date === today).sort((a, b) => a.leavesAt.localeCompare(b.leavesAt) || a.tripNo - b.tripNo || a.tripId.localeCompare(b.tripId));
      const returned = todayTrips.filter(row => row.status === 'done').sort((a, b) => (b.backAt ?? '').localeCompare(a.backAt ?? '') || b.tripNo - a.tripNo || b.tripId.localeCompare(a.tripId));
      return { ...vehicle, volumeCapM3: Number(vehicle.volumeCapM3), kmPerL: Number(vehicle.kmPerL), archivedAt: vehicle.archivedAt?.toISOString() ?? null,
        group: vehicle.type === 'van' ? 'vans' : vehicle.temp === 'reefer' ? 'reefer_trucks' : 'dry_trucks', offReason: off.find(row => row.vehicleId === vehicle.id)?.reason ?? null,
        recordedOut: outTrips.length > 0, selectedTrip: outTrips[0] ?? todayTrips.find(row => row.status !== 'done') ?? returned[0] ?? null, outTrips, todayTrips,
        recentTrips: [...own].sort((a, b) => b.date.localeCompare(a.date) || b.tripNo - a.tripNo || a.tripId.localeCompare(b.tripId)).slice(0, 5), fuel: fuelOf([vehicle]) };
    });
    const groups = ['reefer_trucks', 'dry_trucks', 'vans'];
    shown.sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group) || Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt))
      || (a.fuel?.remaining ?? Infinity) - (b.fuel?.remaining ?? Infinity) || a.id.localeCompare(b.id));
    const active = shown.filter(row => row.archivedAt === null), activeOut = active.filter(row => row.recordedOut).length, activeOff = active.filter(row => row.offReason !== null).length;
    return LookupFleet.parse({ ...scope, today, vehicles: shown, summary: { active: active.length, reefers: active.filter(row => row.temp === 'reefer').length,
      vans: active.filter(row => row.type === 'van').length, recordedOut: activeOut, notRecordedOut: active.length - activeOut,
      activeOffToday: activeOff, activeWithoutOffToday: active.length - activeOff, fuel: fuelOf(fleet.filter(row => row.archivedAt === null)) } });
  });
}
