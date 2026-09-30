import { Router } from 'express';
import { requireDepot, requireRole } from '../middleware/auth';

// What needs the dispatcher (spec 012): the depot's open problems, and the answer to one. Every route works on the
// caller's own depot (depotCallerOf). Task T3 of spec 012 adds the two routes.
export const issuesRouter = Router();
issuesRouter.use(requireRole('dispatcher'), requireDepot);
