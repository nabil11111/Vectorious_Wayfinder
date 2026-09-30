import { Router, type RequestHandler } from 'express';
import { HttpError } from '../lib/errors';
import { requireRole } from '../middleware/auth';

// The store manager's endpoints (spec 009): the next order with its draft, placing it, and the lists of
// orders. Every one works on the caller's own shop. Nothing in a request names a shop, so there is no way to
// ask for another shop's orders. The routes are mounted. Tasks T2 and T3 of spec 009 fill them in.
export const storeRouter = Router();

// requireRole lets an admin through every door, but these screens belong to one shop and an admin has none.
const requireOutlet: RequestHandler = (req, _res, next) => {
  if (!req.user?.outletId) return next(new HttpError(403, 'no_outlet', 'This account does not belong to a shop.'));
  next();
};
storeRouter.use(requireRole('store_manager'), requireOutlet);

const notBuilt: RequestHandler = () => {
  throw new HttpError(501, 'not_built', 'Shop orders are not built yet.');
};

// GET /store/next-order: the shop, its items, the day an order placed now is for and when that day closes,
// the draft and what is already placed for that day (StoreNextOrder).
storeRouter.get('/next-order', notBuilt);

// PUT /store/next-order/draft: saves the whole draft (SaveDraftRequest) and answers like the GET.
storeRouter.put('/next-order/draft', notBuilt);

// POST /store/next-order/place: places the drafts it names (PlaceOrdersRequest) and answers with the next
// order and the orders it placed (PlaceOrdersResponse).
storeRouter.post('/next-order/place', notBuilt);

// GET /store/orders?list=today|open|past&cursor=: the shop's orders (StoreOrdersQuery, StoreOrderList).
storeRouter.get('/orders', notBuilt);
