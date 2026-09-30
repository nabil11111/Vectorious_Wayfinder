import { MoveClockRequest } from '@wayfinder/contracts';
import { Router } from 'express';
import { clockState, moveToNextPart } from '../lib/clock';
import { requireRole } from '../middleware/auth';

// The app's clock for every signed-in role, and the demo control's move to the next part of the day
// (spec 008). Judges hold one account per role, so any role may move the clock.

// GET /clock: the time now, whether demo mode is on, the part of the day, the instant the clock waits at,
// the next part, the revision and the day (ClockState).
export const clockRouter = Router();
clockRouter.get('/', requireRole(), (_req, res) => {
  res.json(clockState());
});

// POST /demo/clock/next: carries the revision the screen holds (MoveClockRequest) and answers with the new
// ClockState. Mounted only in demo mode.
export const demoClockRouter = Router();
demoClockRouter.post('/next', requireRole(), async (req, res) => {
  const { revision } = MoveClockRequest.parse(req.body);
  res.json(await moveToNextPart(req.user!, revision));
});
