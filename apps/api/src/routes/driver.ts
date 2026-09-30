import { DriverWrite } from '@wayfinder/contracts';
import { Router } from 'express';
import { getDriverDay } from '../driver/day';
import { applyWrite } from '../driver/writes';
import { depotCallerOf, requireDepot, requireRole } from '../middleware/auth';

// The driver's own depot and assigned trips (spec 013). The read and write routes follow the shared parts.
export const driverRouter = Router();
driverRouter.use(requireRole('driver'), requireDepot);

driverRouter.get('/', async (req, res) => { res.json(await getDriverDay(depotCallerOf(req))); });
driverRouter.post('/writes', async (req, res) => { res.json(await applyWrite(depotCallerOf(req), DriverWrite.parse(req.body))); });
