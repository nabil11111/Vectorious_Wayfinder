import { LookupFleetQuery, LookupHistoryQuery, LookupOrdersQuery, LookupProofParams } from '@wayfinder/contracts';
import { Router } from 'express';
import { getLookupFleet } from '../lookup/fleet';
import { getLookupOrders } from '../lookup/orders';
import { getLookupHistory } from '../lookup/history';
import { lookupProof } from '../lookup/photo';
import { pageQueryOf, readerOf, requireDepot, requireRole } from '../middleware/auth';

// The look-up pages (spec 017), each of the depot the read names on a session on both depots (spec 021). Each page's
// own query is checked without that depot.
export const lookupRouter = Router();
lookupRouter.use(requireRole('dispatcher'), requireDepot);
lookupRouter.get('/orders', async (req, res) => {
  const reader = await readerOf(req);
  res.json(await getLookupOrders(reader, LookupOrdersQuery.parse(pageQueryOf(req))));
});
lookupRouter.get('/fleet', async (req, res) => {
  const reader = await readerOf(req);
  LookupFleetQuery.parse(pageQueryOf(req));
  res.json(await getLookupFleet(reader));
});

lookupRouter.get('/history', async (req, res) => {
  const reader = await readerOf(req);
  res.json(await getLookupHistory(reader, LookupHistoryQuery.parse(pageQueryOf(req))));
});
lookupRouter.get('/stops/:stopId/photo', async (req, res) => {
  const reader = await readerOf(req);
  LookupFleetQuery.parse(pageQueryOf(req));
  const { stopId } = LookupProofParams.parse(req.params);
  const jpeg = await lookupProof(reader, stopId);
  res.set('Cache-Control', 'private, no-store').type('image/jpeg').send(jpeg);
});
