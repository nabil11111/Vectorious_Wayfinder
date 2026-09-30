import { DecideIssueRequest, Issue } from '@wayfinder/contracts';
import { Router } from 'express';
import { decideIssue } from '../issues/decide';
import { listIssues } from '../issues/read';
import { depotCallerOf, requireDepot, requireRole } from '../middleware/auth';

// What needs the dispatcher (spec 012): the depot's open problems, and the answer to one. Every route works on the
// caller's own depot (depotCallerOf). Task T3 of spec 012 adds the two routes.
export const issuesRouter = Router();
issuesRouter.use(requireRole('dispatcher'), requireDepot);

// GET /issues: the depot's open problems, oldest first, and the loader's day (IssueList).
issuesRouter.get('/', async (req, res) => { res.json(await listIssues(depotCallerOf(req))); });

// POST /issues/:issueId/decide: the answer, naming the problem's revision (DecideIssueRequest). It answers the open list
// and the problem just answered (DecideIssueResponse).
issuesRouter.post('/:issueId/decide', async (req, res) => {
  res.json(await decideIssue(depotCallerOf(req), Issue.shape.id.parse(req.params.issueId), DecideIssueRequest.parse(req.body)));
});
