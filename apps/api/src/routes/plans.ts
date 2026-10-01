import { Router, type Request } from 'express';
import { depotCallerOf, requireDepot, requireRole, type DepotCaller } from '../middleware/auth';
import { AcceptDecisionsRequest, JoinOrderRequest, PlanBoard, SavePlanRequest, SendPlanRequest, SlotQuery, SplitOrderRequest, SuggestPlanRequest, UnsendPlanRequest } from '@wayfinder/contracts';
import { getBoard } from '../plans/board';
import { saveDraft } from '../plans/draft';
import { joinOrder, splitOrder } from '../plans/split';
import { sendPlan, unsendPlan } from '../plans/send';
import { findSlots } from '../plans/slots';
import { acceptDecisions, suggestPlan } from '../plans/suggest';

// The dispatcher's plan board (spec 010): the board of a day, saving its draft, splitting and joining an order,
// sending the plan and taking it back to edit, and finding a slot. Spec 014 adds building the suggested plan and
// accepting the planner's decisions. Every route works on the caller's own depot. Nothing in a request names a depot,
// so there is no way to plan another depot's day.
export const plansRouter = Router();

plansRouter.use(requireRole('dispatcher'), requireDepot);

// The dispatcher asking and their depot. Both checks above have passed.
export type Planner = DepotCaller;
export const plannerOf = depotCallerOf;

const dateOf = (req: Request) => PlanBoard.shape.day.unwrap().shape.date.parse(req.params.date);
plansRouter.get('/', async (req, res) => { res.json(await getBoard(plannerOf(req))); });
plansRouter.get('/:date', async (req, res) => { res.json(await getBoard(plannerOf(req), dateOf(req))); });
plansRouter.put('/:date/draft', async (req, res) => { res.json(await saveDraft(plannerOf(req), dateOf(req), SavePlanRequest.parse(req.body))); });
plansRouter.post('/:date/split', async (req, res) => { res.json(await splitOrder(plannerOf(req), dateOf(req), SplitOrderRequest.parse(req.body))); });
plansRouter.post('/:date/join', async (req, res) => { res.json(await joinOrder(plannerOf(req), dateOf(req), JoinOrderRequest.parse(req.body))); });
plansRouter.post('/:date/send', async (req, res) => { res.json(await sendPlan(plannerOf(req), dateOf(req), SendPlanRequest.parse(req.body))); });
plansRouter.post('/:date/unsend', async (req, res) => { res.json(await unsendPlan(plannerOf(req), dateOf(req), UnsendPlanRequest.parse(req.body))); });
plansRouter.get('/:date/slots', async (req, res) => { res.json(await findSlots(plannerOf(req), dateOf(req), SlotQuery.parse(req.query))); });
plansRouter.post('/:date/suggest', async (req, res) => { res.json(await suggestPlan(plannerOf(req), dateOf(req), SuggestPlanRequest.parse(req.body))); });
plansRouter.post('/:date/decisions', async (req, res) => { res.json(await acceptDecisions(plannerOf(req), dateOf(req), AcceptDecisionsRequest.parse(req.body))); });
