import { isNotNull } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { clearDemoDay, seedDemoDay } from '../db/demo-day';
import { auditLog, demoDay, outlets, products, vehicles } from '../db/schema';
import { demoClockAt, initClock, realNow, restartClock } from '../lib/clock';
import { announce } from '../lib/live';
import { requireRole } from '../middleware/auth';

// POST /demo/reset: puts the day back as the seed wrote it, sets the clock to the first part and answers
// with the new ClockState (spec 008). Any signed-in role, and mounted only in demo mode. It is one
// transaction, so a reset that fails halfway leaves the day as it was.
export const demoResetRouter = Router();
demoResetRouter.post('/', requireRole(), async (req, res) => {
  const clock = await db.transaction(async (tx) => {
    // The lock makes two resets at the same moment take turns. The second waits here and then starts from
    // the clock the first one left.
    const [row] = await tx.select().from(demoDay).for('update');
    if (!row) throw new Error('The demo day has no clock row in demo_day. Run the seed first (npm run db:seed).');
    const before = demoClockAt(row, realNow());

    // Clearing locks the day's tables until the commit. From here every query goes through tx: one on
    // another connection would wait for this transaction and never be answered.
    await clearDemoDay(tx);
    // What an admin archived during the demo is in use again.
    await tx.update(vehicles).set({ archivedAt: null }).where(isNotNull(vehicles.archivedAt));
    await tx.update(outlets).set({ archivedAt: null }).where(isNotNull(outlets.archivedAt));
    await tx.update(products).set({ archivedAt: null }).where(isNotNull(products.archivedAt));
    await seedDemoDay(tx);
    const after = await restartClock(tx);
    await tx.insert(auditLog).values({ actorId: req.user!.id, action: 'demo.day_reset', entity: 'demo_day', entityId: String(row.id), before, after });
    return after;
  });
  // Memory first, then the screens, because they ask for the clock as soon as they hear of the reset.
  await initClock();
  announce({ topic: 'demo' });
  res.json(clock);
});
