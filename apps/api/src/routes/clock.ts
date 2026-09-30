import { Router, type RequestHandler } from 'express';
import { HttpError } from '../lib/errors';
import { requireRole } from '../middleware/auth';

// The app's clock for every signed-in role, and the demo control's move to the next part of the day
// (spec 008). The routes are mounted. Task T1 fills them in.
const notBuilt: RequestHandler = () => {
  throw new HttpError(501, 'not_built', 'The clock is not built yet.');
};

// GET /clock: the time now, whether demo mode is on, the part of the day, the instant the clock waits at,
// the next part, the revision and the day (ClockState).
export const clockRouter = Router();
clockRouter.get('/', requireRole(), notBuilt);

// POST /demo/clock/next: carries the revision the screen holds (MoveClockRequest) and answers with the new
// ClockState. Mounted only in demo mode.
export const demoClockRouter = Router();
demoClockRouter.post('/next', requireRole(), notBuilt);
