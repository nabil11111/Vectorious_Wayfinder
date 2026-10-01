import { LookupFleetQuery, LookupHistoryQuery, LookupOrdersQuery, LookupProofParams } from '@wayfinder/contracts';
import { Router } from 'express';
import { getLookupFleet } from '../lookup/fleet';
import { getLookupOrders } from '../lookup/orders';
import { getLookupHistory } from '../lookup/history';
import { lookupProof } from '../lookup/photo';
import { depotCallerOf, requireDepot, requireRole } from '../middleware/auth';

export const lookupRouter = Router();
lookupRouter.use(requireRole('dispatcher'), requireDepot);
lookupRouter.get('/orders', async (req, res) => {
  res.json(await getLookupOrders(depotCallerOf(req), LookupOrdersQuery.parse(req.query)));
});
lookupRouter.get('/fleet', async (req, res) => {
  LookupFleetQuery.parse(req.query);
  res.json(await getLookupFleet(depotCallerOf(req)));
});

lookupRouter.get('/history', async (req, res) => {
  res.json(await getLookupHistory(depotCallerOf(req), LookupHistoryQuery.parse(req.query)));
});
lookupRouter.get('/stops/:stopId/photo', async (req, res) => {
  LookupFleetQuery.parse(req.query);
  const { stopId } = LookupProofParams.parse(req.params);
  const jpeg = await lookupProof(depotCallerOf(req), stopId);
  res.set('Cache-Control', 'private, no-store').type('image/jpeg').send(jpeg);
});
