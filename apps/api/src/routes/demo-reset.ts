import { Router } from 'express';
import { HttpError } from '../lib/errors';
import { requireRole } from '../middleware/auth';

// POST /demo/reset: puts the day back as the seed wrote it, sets the clock to the first part and answers
// with the new ClockState (spec 008). Any signed-in role, and mounted only in demo mode. Task T4 fills it in.
export const demoResetRouter = Router();
demoResetRouter.post('/', requireRole(), () => {
  throw new HttpError(501, 'not_built', 'Resetting the demo day is not built yet.');
});
