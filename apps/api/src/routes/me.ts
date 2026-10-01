import { SwitchDepotRequest, type Me } from '@wayfinder/contracts';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { depots, sessions } from '../db/schema';
import { HttpError } from '../lib/errors';
import { SESSION_COOKIE, hashToken, requireRole } from '../middleware/auth';

// What the person signed in chooses for their own session (spec 020).
export const meRouter = Router();

// PUT /me/depot: the dispatcher's depot switch (D-93). The choice is kept on the session, so every route that reads the
// caller's depot follows it until the dispatcher switches again or signs out, and a new sign-in starts at their own
// depot. It answers Me with the chosen depot. requireRole lets an admin through every door, but only a dispatcher
// plans a depot, so every other role is refused here, before the body is read.
meRouter.put('/depot', requireRole(), async (req, res) => {
  const user = req.user!;
  if (user.role !== 'dispatcher') throw new HttpError(403, 'forbidden', 'Only a dispatcher can switch depots.');
  const { depotId } = SwitchDepotRequest.parse(req.body);
  const [depot] = await db.select({ id: depots.id }).from(depots).where(eq(depots.id, depotId));
  if (!depot) throw new HttpError(400, 'unknown_record', 'That depot is not on the list.', { id: depotId });
  // The session can have ended since this request was let in, and then there is nothing to switch.
  const [switched] = await db.update(sessions).set({ depotId: depot.id })
    .where(eq(sessions.id, hashToken(req.cookies[SESSION_COOKIE]))).returning({ id: sessions.id });
  if (!switched) throw new HttpError(401, 'signed_out', 'Please sign in.');
  const me: Me = { ...user, depotId: depot.id };
  res.json(me);
});
