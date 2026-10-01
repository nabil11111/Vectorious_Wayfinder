import { Router } from 'express';
import { requireDepot, requireRole } from '../middleware/auth';

// Spec 016: one depot-scoped read; the shared mount precedes the server task's GET.
export const operationsRouter = Router();
operationsRouter.use(requireRole('dispatcher'), requireDepot);
