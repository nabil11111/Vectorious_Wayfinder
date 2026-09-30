import { Router, type Request, type RequestHandler } from 'express';
import { HttpError } from '../lib/errors';
import { requireRole } from '../middleware/auth';
import { JoinOrderRequest, PlanBoard, SavePlanRequest, SendPlanRequest, SlotQuery, SplitOrderRequest, UnsendPlanRequest } from '@wayfinder/contracts';
import { getBoard } from '../plans/board';
import { saveDraft } from '../plans/draft';
import { joinOrder, splitOrder } from '../plans/split';
import { sendPlan, unsendPlan } from '../plans/send';
import { findSlots } from '../plans/slots';

// The dispatcher's plan board (spec 010): the board of a day, saving its draft, splitting and joining an order,
// sending the plan and taking it back to edit, and finding a slot. Every route works on the caller's own depot.
// Nothing in a request names a depot, so there is no way to plan another depot's day. The router is mounted here
// and tasks T1 to T4 of spec 010 add the eight routes.
export const plansRouter = Router();

// requireRole lets an admin through every door, but a plan belongs to one depot and an admin has none.
const requireDepot: RequestHandler = (req, _res, next) => {
  if (!req.user?.depotId) return next(new HttpError(403, 'no_depot', 'This account does not belong to a depot.'));
  next();
};
plansRouter.use(requireRole('dispatcher'), requireDepot);

// The person asking and the depot their account belongs to. Both checks above have passed.
export interface Planner { userId: string; depotId: string }
export const plannerOf = (req: Request): Planner => ({ userId: req.user!.id, depotId: req.user!.depotId! });

const dateOf = (req: Request) => PlanBoard.shape.day.unwrap().shape.date.parse(req.params.date);
plansRouter.get('/', async (req, res) => { res.json(await getBoard(plannerOf(req))); });
plansRouter.get('/:date', async (req, res) => { res.json(await getBoard(plannerOf(req), dateOf(req))); });
plansRouter.put('/:date/draft', async (req, res) => { res.json(await saveDraft(plannerOf(req), dateOf(req), SavePlanRequest.parse(req.body))); });
plansRouter.post('/:date/split', async (req, res) => { res.json(await splitOrder(plannerOf(req), dateOf(req), SplitOrderRequest.parse(req.body))); });
plansRouter.post('/:date/join', async (req, res) => { res.json(await joinOrder(plannerOf(req), dateOf(req), JoinOrderRequest.parse(req.body))); });
plansRouter.post('/:date/send', async (req, res) => { res.json(await sendPlan(plannerOf(req), dateOf(req), SendPlanRequest.parse(req.body))); });
plansRouter.post('/:date/unsend', async (req, res) => { res.json(await unsendPlan(plannerOf(req), dateOf(req), UnsendPlanRequest.parse(req.body))); });
plansRouter.get('/:date/slots', async (req, res) => { res.json(await findSlots(plannerOf(req), dateOf(req), SlotQuery.parse(req.query))); });
