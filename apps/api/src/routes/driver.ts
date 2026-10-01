import { DriverWrite } from '@wayfinder/contracts';
import { Router } from 'express';
import { getDriverDay } from '../driver/day';
import { applyWrite } from '../driver/writes';
import { HttpError } from '../lib/errors';
import { depotCallerOf, requireDepot, requireRole } from '../middleware/auth';

// The driver's own depot and assigned trips (spec 013). The read and write routes follow the shared parts.
export const driverRouter = Router();
driverRouter.use(requireRole('driver'), requireDepot);

driverRouter.get('/', async (req, res) => { res.json(await getDriverDay(depotCallerOf(req))); });
driverRouter.post('/writes', async (req, res) => {
  const parsed = DriverWrite.safeParse(req.body);
  if (!parsed.success) {
    if (parsed.error.issues.some(issue => issue.path[0] === 'photo')) throw new HttpError(400, 'invalid_input', 'The photo must be a whole JPEG of at most 500 KB.');
    throw parsed.error;
  }
  res.json(await applyWrite(depotCallerOf(req), parsed.data));
});
