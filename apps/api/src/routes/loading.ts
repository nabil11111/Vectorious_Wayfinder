import { Router } from 'express';
import { requireDepot, requireRole } from '../middleware/auth';

// The loader's day (spec 012): reading it, starting a truck, marking a stop loaded, flagging a problem and marking the
// truck ready. Every route works on the caller's own depot (depotCallerOf); nothing in a request names a depot. Tasks
// T1 and T2 of spec 012 add the five routes.
export const loadingRouter = Router();
loadingRouter.use(requireRole('loader'), requireDepot);
