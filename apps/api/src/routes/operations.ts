import { Router } from 'express';
import { getReceivingList } from '../receiving/read';
import { getOperationsDay } from '../operations/read';
import { readerOf, requireDepot, requireRole } from '../middleware/auth';

// Spec 016: one depot-scoped snapshot for both dispatcher pages. A session on both depots names the depot it reads
// (spec 021).
export const operationsRouter = Router();
operationsRouter.use(requireRole('dispatcher'), requireDepot);

operationsRouter.get('/', async (req, res) => { res.json(await getOperationsDay(await readerOf(req))); });

operationsRouter.get('/receiving', async (req, res) => { res.json(await getReceivingList(await readerOf(req))); });
