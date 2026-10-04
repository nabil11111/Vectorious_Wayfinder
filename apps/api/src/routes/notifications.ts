import { PushKey, PushSubscriptionRequest, PushUnsubscribeRequest, type Me } from '@wayfinder/contracts';
import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { pushSubscriptions, users } from '../db/schema';
import { config } from '../lib/config';
import { HttpError } from '../lib/errors';
import { readDepotOf, requireRole } from '../middleware/auth';
import { getNotifications, type Reader } from '../notifications/read';
import { accountReader } from '../push/send';

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

// The key the browser uses to subscribe. Null when push is not configured, and the bell then only asks permission.
notificationsRouter.get('/push-key', requireRole(), (_req, res) => {
  res.json(PushKey.parse({ publicKey: config.VAPID_PUBLIC_KEY ?? null }));
});

// Remember this browser for the signed-in person. Updates already on the bell are marked pushed, so allowing alerts
// does not repeat them. The same browser signing in as someone else replaces the owner.
notificationsRouter.put('/push', requireRole(), async (req, res) => {
  const user = req.user!;
  const body = PushSubscriptionRequest.parse(req.body);
  // The account's own depot, not the depot this tab is showing. Later pushes read the account the same way,
  // so turning alerts on while the dispatcher is on the other depot does not repeat the day.
  const [account] = await db.select({ role: users.role, depotId: users.depotId, outletId: users.outletId }).from(users).where(eq(users.id, user.id));
  const reader = account ? accountReader({ id: user.id, role: account.role, depotId: account.depotId, outletId: account.outletId }) : null;
  const pushedIds = reader ? (await getNotifications(reader)).items.map((item) => item.id) : [];
  await db.insert(pushSubscriptions).values({ userId: user.id, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, pushedIds })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: user.id, p256dh: body.keys.p256dh, auth: body.keys.auth, pushedIds },
    });
  res.status(204).end();
});

notificationsRouter.delete('/push', requireRole(), async (req, res) => {
  const body = PushUnsubscribeRequest.parse(req.body);
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, body.endpoint), eq(pushSubscriptions.userId, req.user!.id)));
  res.status(204).end();
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
