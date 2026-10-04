import { eq } from 'drizzle-orm';
import type webpush from 'web-push';
import { db } from '../db/client';
import { pushSubscriptions, users } from '../db/schema';
import { config } from '../lib/config';
import type { Announcement } from '../lib/live';
import { logger } from '../lib/logger';
import { getNotifications, type Reader } from '../notifications/read';

// A new update, handed to a browser that has subscribed (spec 031). The page may already be frozen, so the
// service worker shows it. Topics are the ones that can change a person's bell.
const TOPICS = new Set(['plans', 'loading', 'driver', 'orders', 'issues', 'receiving']);

export interface PushPayload { title: string; body: string; tag: string; link: string }
type Subscription = { endpoint: string; p256dh: string; auth: string };
type Deliver = (sub: Subscription, payload: PushPayload) => Promise<void>;

async function webPushDeliver(sub: Subscription, payload: PushPayload): Promise<void> {
  const lib = (await import('web-push')).default as typeof webpush;
  lib.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY!, config.VAPID_PRIVATE_KEY!);
  await lib.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload));
}

let deliverImpl: Deliver = webPushDeliver;
// Tests hand the payload to themselves instead of a push service.
export function setDeliverForTests(deliver: Deliver | null): void {
  deliverImpl = deliver ?? webPushDeliver;
}

function gone(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return false;
  const status = Number(error.statusCode);
  return status === 404 || status === 410;
}

// A dispatcher plans both depots, so a push for either reaches him. A loader or driver hears their own depot.
// A shop hears its own outlet. This matches who the live stream would tell, without needing the open page.
function hears(user: { id: string; role: string; depotId: string | null; outletId: string | null }, change: Announcement): boolean {
  if (change.recipientIds && !change.recipientIds.includes(user.id)) return false;
  if (user.role === 'store_manager') return user.outletId !== null && user.outletId === change.outletId;
  if (user.role === 'dispatcher') return change.depotId !== undefined;
  return user.depotId !== null && user.depotId === change.depotId;
}

// The signed-in account as the bell will be read for a push. A dispatcher's tab can be showing the other
// depot; the push still follows the depot on the account, which is the one this reader uses.
export function accountReader(user: { id: string; role: string; depotId: string | null; outletId: string | null }): Reader | null {
  if (user.role === 'store_manager' && user.outletId) return { role: 'store_manager', userId: user.id, outletId: user.outletId };
  if ((user.role === 'dispatcher' || user.role === 'loader' || user.role === 'driver') && user.depotId) {
    return { role: user.role, userId: user.id, depotId: user.depotId };
  }
  return null;
}

// One send at a time. A plan going out announces several topics in a row, and each one starts a push.
// Running them together would read the same pushed ids and hand the same update over more than once.
let tail: Promise<void> = Promise.resolve();

export function pushFor(change: Announcement): Promise<void> {
  const run = tail.then(() => sendChange(change));
  tail = run.then(() => undefined, () => undefined);
  return run;
}

// Tell every subscribed person who should hear this change about updates they have not been shown yet.
// A browser that has dropped the subscription is forgotten. One that fails for any other reason is tried again
// next time, and an update that did go out is not sent twice.
async function sendChange(change: Announcement): Promise<void> {
  if (!TOPICS.has(change.topic)) return;
  if (deliverImpl === webPushDeliver && (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY)) return;
  const rows = await db.select({
    id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth,
    pushedIds: pushSubscriptions.pushedIds, userId: users.id, role: users.role, depotId: users.depotId, outletId: users.outletId,
  }).from(pushSubscriptions).innerJoin(users, eq(users.id, pushSubscriptions.userId));
  for (const row of rows) {
    // row.id is the subscription. The person is userId; hears and the bell both key off that.
    const user = { id: row.userId, role: row.role, depotId: row.depotId, outletId: row.outletId };
    if (!hears(user, change)) continue;
    const reader = accountReader(user);
    if (!reader) continue;
    const fresh = (await getNotifications(reader)).items.filter((item) => !row.pushedIds.includes(item.id));
    if (!fresh.length) continue;
    const sent = [...row.pushedIds];
    let drop = false;
    for (const item of fresh) {
      try {
        await deliverImpl(row, { title: 'Wayfinder', body: item.line, tag: item.id, link: item.link });
        sent.push(item.id);
      } catch (error) {
        if (gone(error)) drop = true;
        else logger.warn({ err: error }, 'could not push an update');
        break;
      }
    }
    if (drop) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id));
    else if (sent.length !== row.pushedIds.length) await db.update(pushSubscriptions).set({ pushedIds: sent.slice(-100) }).where(eq(pushSubscriptions.id, row.id));
  }
}
