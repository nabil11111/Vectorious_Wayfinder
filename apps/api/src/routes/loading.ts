import { LoadingTruck, MarkReadyRequest, RaiseFlagRequest, StartLoadingRequest, StopLoadedRequest } from '@wayfinder/contracts';
import { Router, type Request } from 'express';
import { getLoadingDay } from '../loading/day';
import { markReady, markStopLoaded, raiseFlag, startLoading } from '../loading/writes';
import { depotCallerOf, requireDepot, requireRole } from '../middleware/auth';

// The loader's day (spec 012): reading it, starting a truck, marking a stop loaded, flagging a problem and marking the
// truck ready. Every route works on the caller's own depot (depotCallerOf); nothing in a request names a depot. Tasks
// T1 and T2 of spec 012 add the five routes.
export const loadingRouter = Router();
loadingRouter.use(requireRole('loader'), requireDepot);

// GET /loading: the loader's day, its sent plan and its trucks (LoadingDay).
loadingRouter.get('/', async (req, res) => { res.json(await getLoadingDay(depotCallerOf(req))); });

// The four writes on one truck. Each names the trip's revision and carries an id made on the phone, and answers the
// loading day.
const tripIdOf = (req: Request) => LoadingTruck.shape.tripId.parse(req.params.tripId);
loadingRouter.post('/trips/:tripId/start', async (req, res) => { res.json(await startLoading(depotCallerOf(req), tripIdOf(req), StartLoadingRequest.parse(req.body))); });
loadingRouter.post('/trips/:tripId/stop-loaded', async (req, res) => { res.json(await markStopLoaded(depotCallerOf(req), tripIdOf(req), StopLoadedRequest.parse(req.body))); });
loadingRouter.post('/trips/:tripId/flags', async (req, res) => { res.json(await raiseFlag(depotCallerOf(req), tripIdOf(req), RaiseFlagRequest.parse(req.body))); });
loadingRouter.post('/trips/:tripId/ready', async (req, res) => { res.json(await markReady(depotCallerOf(req), tripIdOf(req), MarkReadyRequest.parse(req.body))); });
