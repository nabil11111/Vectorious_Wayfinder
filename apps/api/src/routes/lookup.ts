import { Router } from 'express';
import { requireDepot, requireRole } from '../middleware/auth';

// Spec 017: the read handlers follow these shared dispatcher/depot checks in T1.
export const lookupRouter = Router();
lookupRouter.use(requireRole('dispatcher'), requireDepot);
