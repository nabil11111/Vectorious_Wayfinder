import { BOTH_DEPOTS, DecideIssueRequest, Issue } from '@wayfinder/contracts';
import { Router, type Request } from 'express';
import { decideIssue } from '../issues/decide';
import { issueDepotOf, issuePhoto, listIssues } from '../issues/read';
import { depotCallerOf, readerOf, requireDepot, requireRole, type DepotCaller } from '../middleware/auth';

// What needs the dispatcher (spec 012): the depot's open problems, and the answer to one. Task T3 of spec 012 adds the
// two routes. The list and a photo are of the depot the read is for (readerOf), which a session on both depots names
// (spec 021). An answer works on the session's depot, or on both depots together on the problem's own depot.
export const issuesRouter = Router();
issuesRouter.use(requireRole('dispatcher'), requireDepot);

// GET /issues: the depot's open problems, oldest first, and the loader's day (IssueList).
issuesRouter.get('/', async (req, res) => { res.json(await listIssues(await readerOf(req))); });

issuesRouter.get('/:issueId/photo', async (req, res) => {
  const reader = await readerOf(req);
  const jpeg = await issuePhoto(reader, Issue.shape.id.parse(req.params.issueId));
  res.set('Cache-Control', 'private, no-store').type('image/jpeg').send(jpeg);
});

// POST /issues/:issueId/decide: the answer, naming the problem's revision (DecideIssueRequest). It answers the open list
// of the problem's depot and the problem just answered (DecideIssueResponse).
issuesRouter.post('/:issueId/decide', async (req, res) => {
  const issueId = Issue.shape.id.parse(req.params.issueId);
  const body = DecideIssueRequest.parse(req.body);
  res.json(await decideIssue(await answererOf(req, issueId), issueId, body));
});

// Who answers, and for which depot: the session's, or on both depots together the problem's own, so the answer is saved
// and told exactly as it is with that depot chosen (spec 021, rule 3).
async function answererOf(req: Request, issueId: string): Promise<DepotCaller> {
  const caller = depotCallerOf(req);
  return caller.depotId === BOTH_DEPOTS ? { ...caller, depotId: await issueDepotOf(issueId) } : caller;
}
