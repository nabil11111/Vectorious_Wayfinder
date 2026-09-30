import { PlaceOrdersRequest, SaveDraftRequest, StoreOrdersQuery } from '@wayfinder/contracts';
import { Router, type Request, type RequestHandler } from 'express';
import { HttpError } from '../lib/errors';
import { requireRole } from '../middleware/auth';
import { listOrders } from '../orders/store-lists';
import { getNextOrder, placeOrders, saveDraft, type Caller } from '../orders/store-orders';

// The store manager's endpoints (spec 009): the next order with its draft, placing it, and the lists of
// orders. Every one works on the caller's own shop. Nothing in a request names a shop, so there is no way to
// ask for another shop's orders.
export const storeRouter = Router();

// requireRole lets an admin through every door, but these screens belong to one shop and an admin has none.
const requireOutlet: RequestHandler = (req, _res, next) => {
  if (!req.user?.outletId) return next(new HttpError(403, 'no_outlet', 'This account does not belong to a shop.'));
  next();
};
storeRouter.use(requireRole('store_manager'), requireOutlet);

// Both checks above have passed, so the caller is a person with a shop.
const callerOf = (req: Request): Caller => ({ userId: req.user!.id, outletId: req.user!.outletId! });

// GET /store/next-order: the shop, its items, the day an order placed now is for and when that day closes,
// the draft and what is already placed for that day (StoreNextOrder).
storeRouter.get('/next-order', async (req, res) => {
  res.json(await getNextOrder(callerOf(req)));
});

// PUT /store/next-order/draft: saves the whole draft (SaveDraftRequest) and answers like the GET.
storeRouter.put('/next-order/draft', async (req, res) => {
  res.json(await saveDraft(callerOf(req), SaveDraftRequest.parse(req.body)));
});

// POST /store/next-order/place: places the drafts it names (PlaceOrdersRequest) and answers with the next
// order and the orders it placed (PlaceOrdersResponse).
storeRouter.post('/next-order/place', async (req, res) => {
  res.json(await placeOrders(callerOf(req), PlaceOrdersRequest.parse(req.body)));
});

// GET /store/orders?list=today|open|past&cursor=: the shop's orders (StoreOrdersQuery, StoreOrderList).
storeRouter.get('/orders', async (req, res) => {
  res.json(await listOrders(callerOf(req), StoreOrdersQuery.parse(req.query)));
});
