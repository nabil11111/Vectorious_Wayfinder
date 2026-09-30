import { Router } from 'express';
import { openStream } from '../lib/live';
import { requireRole } from '../middleware/auth';

// GET /events: the live stream, for anyone signed in (spec 008). A message holds no data, so there is no
// record to check here. Who hears a change is decided when it is announced (lib/live.ts).
export const eventsRouter = Router();
eventsRouter.get('/', requireRole(), (req, res) => openStream(req.user!, res));
