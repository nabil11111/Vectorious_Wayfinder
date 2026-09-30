import { Router } from 'express';
import { openStream } from '../lib/live';
import { requireRole } from '../middleware/auth';

// GET /events: the live stream, for anyone signed in (spec 008). It answers 501 until task T2 fills in
// openStream.
export const eventsRouter = Router();
eventsRouter.get('/', requireRole(), (req, res) => openStream(req.user!, res));
