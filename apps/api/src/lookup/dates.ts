import { PlanCheck, type LookupPublication, type LookupScope } from '@wayfinder/contracts';
import { eq } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { depots, type plans, type trips } from '../db/schema';
import type { BoardMoment } from '../plans/board';

export const shiftDate = (date: string, days: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
export function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = shiftDate(date, 1)) dates.push(date);
  return dates;
}
export async function scopeOf(tx: Tx, depotId: string, moment: BoardMoment): Promise<LookupScope> {
  const [depot] = await tx.select().from(depots).where(eq(depots.id, depotId));
  if (!depot) throw new Error('The dispatcher depot no longer exists.');
  return { depot: { id: depot.id, name: depot.name }, readAt: moment.at.toISOString(), demoDay: moment.demoDay };
}
export function publicationOf(plan: typeof plans.$inferSelect): LookupPublication {
  if (!plan.publishedAt) throw new Error(`Published plan ${plan.id} has no publication time.`);
  return { id: plan.id, date: plan.date, revision: plan.revision, publishedAt: plan.publishedAt.toISOString() };
}
export function keptTrip(plan: typeof plans.$inferSelect, trip: typeof trips.$inferSelect) {
  const kept = PlanCheck.parse(plan.sentCheck).trips.find(row => row.vehicleId === trip.vehicleId && row.tripNo === trip.tripNo);
  if (!kept?.times) throw new Error(`Publication ${plan.id} has no kept schedule for trip ${trip.id}.`);
  return { ...kept, times: kept.times };
}
