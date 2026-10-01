import type { Me } from '@wayfinder/contracts';
import { Router } from 'express';
import { HttpError } from '../lib/errors';
import { readDepotOf, requireRole } from '../middleware/auth';
import { getNotifications, type Reader } from '../notifications/read';

// GET /notifications: the signed-in person's updates, newest first, at most 30 (spec 025, NotificationList). A shop's are
// its own outlet's, a loader's their depot's dock, a driver's their own trips', and a dispatcher's the depot the read is
// for, which a session on both depots names with ?depot= (spec 021). Who and where come from the session alone, so nobody
// can ask for another shop's or depot's. Admin belongs to no shop or depot, and is told nothing.
export const notificationsRouter = Router();
notificationsRouter.get('/', requireRole(), async (req, res) => {
  const user = req.user!;
  const depotId = user.role === 'dispatcher' ? await readDepotOf(req) : user.depotId;
  res.json(await getNotifications(readerOf(user, depotId)));
});

function readerOf(user: Me, depotId: string | null): Reader {
  if (user.role === 'admin') return { role: 'admin', userId: user.id };
  if (user.role === 'store_manager') {
    if (!user.outletId) throw new HttpError(403, 'no_outlet', 'This account does not belong to a shop.');
    return { role: 'store_manager', userId: user.id, outletId: user.outletId };
  }
  if (!depotId) throw new HttpError(403, 'no_depot', 'This account does not belong to a depot.');
  return { role: user.role, userId: user.id, depotId };
}
