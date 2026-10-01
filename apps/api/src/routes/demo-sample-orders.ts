import { SampleOrdersRequest } from '@wayfinder/contracts';
import { Router, type RequestHandler } from 'express';
import { HttpError } from '../lib/errors';
import { depotCallerOf, requireRole } from '../middleware/auth';
import { addSampleOrders, previewSampleOrders } from '../orders/sample-orders';

// The demo control's sample shop orders (spec 028). The dispatcher's alone: requireRole lets an admin through every
// door, but an admin has no depot on show. Mounted only in demo mode. It acts on the depot the session is on, or both
// on Both, so it is not on D-95's list of requests that go on whatever depot a tab names.
export const demoSampleOrdersRouter = Router();
const dispatcherOnly: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'dispatcher' || !req.user.depotId) return next(new HttpError(403, 'forbidden', 'Your role cannot do this.'));
  next();
};
demoSampleOrdersRouter.use(requireRole('dispatcher'), dispatcherOnly);

// GET /demo/sample-orders: for each depot of the session, its shops and how many may still order (SampleOrdersPreview).
demoSampleOrdersRouter.get('/', async (req, res) => {
  res.json(await previewSampleOrders(depotCallerOf(req)));
});

// POST /demo/sample-orders: { shops: 10 | 25 | 'all' } (SampleOrdersRequest). Answers what it placed (SampleOrdersResult).
demoSampleOrdersRouter.post('/', async (req, res) => {
  res.json(await addSampleOrders(depotCallerOf(req), SampleOrdersRequest.parse(req.body)));
});
