import { LookupFleetQuery, LookupOrdersQuery } from '@wayfinder/contracts';
import { Router } from 'express';
import { getLookupFleet } from '../lookup/fleet';
import { getLookupOrders } from '../lookup/orders';
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
