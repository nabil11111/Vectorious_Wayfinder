import { Router, type Request, type RequestHandler } from 'express';
import { depotCallerOf, requireDepot, requireRole, type DepotCaller } from '../middleware/auth';
import { AcceptDecisionsRequest, ApplyArrangeRequest, ApplyCompareRequest, ArrangeRequest, PlanScenarioRequest, BOTH_DEPOTS, JoinOrderRequest, PlanBoard, SavePlanRequest, SendPlanRequest, SlotQuery, SplitOrderRequest, SuggestPlanRequest, UnsendPlanRequest } from '@wayfinder/contracts';
import { HttpError } from '../lib/errors';
import { CrewQuery } from '@wayfinder/contracts';
import { getBoard } from '../plans/board';
import { previewPlanScenario } from '../plans/scenario';
import { applyArrangement, previewArrangement } from '../plans/arrange';
import { applyComparison, previewComparison } from '../plans/compare';
import { findCrews } from '../plans/crews';
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

// A plan, its send and its checks belong to one depot (D-96). A session on both depots together plans neither, so every
// plan route refuses it before it reads or writes anything, and the board asks which depot to plan (spec 021, rule 2).
const requireOneDepot: RequestHandler = (req, _res, next) => {
  if (req.user!.depotId === BOTH_DEPOTS) return next(new HttpError(409, 'pick_a_depot', 'A plan belongs to one depot. Pick the depot to plan.'));
  next();
};

plansRouter.use(requireRole('dispatcher'), requireDepot, requireOneDepot);

// The dispatcher asking and their depot. The checks above have passed, so it is one depot.
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
plansRouter.get('/:date/crews', async (req, res) => { res.json(await findCrews(plannerOf(req), dateOf(req), CrewQuery.parse(req.query))); });
plansRouter.post('/:date/suggest', async (req, res) => { res.json(await suggestPlan(plannerOf(req), dateOf(req), SuggestPlanRequest.parse(req.body))); });
plansRouter.post('/:date/decisions', async (req, res) => { res.json(await acceptDecisions(plannerOf(req), dateOf(req), AcceptDecisionsRequest.parse(req.body))); });

plansRouter.post('/:date/scenario', async (req, res) => { res.json(await previewPlanScenario(plannerOf(req), dateOf(req), PlanScenarioRequest.parse(req.body))); });
plansRouter.post('/:date/arrange', async (req, res) => { res.json(await previewArrangement(plannerOf(req), dateOf(req), ArrangeRequest.parse(req.body))); });
plansRouter.post('/:date/arrange/apply', async (req, res) => { res.json(await applyArrangement(plannerOf(req), dateOf(req), ApplyArrangeRequest.parse(req.body))); });
plansRouter.post('/:date/compare', async (req, res) => { res.json(await previewComparison(plannerOf(req), dateOf(req))); });
plansRouter.post('/:date/compare/apply', async (req, res) => { res.json(await applyComparison(plannerOf(req), dateOf(req), ApplyCompareRequest.parse(req.body))); });
