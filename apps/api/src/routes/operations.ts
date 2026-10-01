import { Router } from 'express';
import { getOperationsDay } from '../operations/read';
import { depotCallerOf, requireDepot, requireRole } from '../middleware/auth';

// Spec 016: one depot-scoped snapshot for both dispatcher pages.
export const operationsRouter = Router();
operationsRouter.use(requireRole('dispatcher'), requireDepot);

operationsRouter.get('/', async (req, res) => { res.json(await getOperationsDay(depotCallerOf(req))); });
