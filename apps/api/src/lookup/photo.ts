import { and, eq, isNull } from 'drizzle-orm';
import { photos, plans, stops, trips } from '../db/schema';
import { HttpError } from '../lib/errors';
import type { DepotCaller } from '../middleware/auth';
import { snapshot } from '../orders/store-orders';
import { readMoment } from '../plans/board';

export function lookupProof(caller: DepotCaller, stopId: string): Promise<Buffer> {
  return snapshot(async tx => {
    await readMoment(tx);
    const [owned] = await tx.select({ id: stops.id }).from(stops).innerJoin(trips, eq(trips.id, stops.tripId)).innerJoin(plans, eq(plans.id, trips.planId))
      .where(and(eq(stops.id, stopId), eq(plans.depotId, caller.depotId), eq(plans.status, 'published')));
    if (!owned) throw new HttpError(400, 'unknown_record', 'That stop is not on this depot\'s list.', { id: stopId });
    const [photo] = await tx.select({ jpeg: photos.jpeg }).from(photos).where(and(eq(photos.stopId, owned.id), isNull(photos.issueId)));
    if (!photo) throw new HttpError(404, 'not_found', 'This stop has no proof photo.');
    return photo.jpeg;
  });
}
