import { Router } from 'express';
import { requireDepot, requireRole } from '../middleware/auth';

// The driver's own depot and assigned trips (spec 013). The read and write routes follow the shared parts.
export const driverRouter = Router();
driverRouter.use(requireRole('driver'), requireDepot);
