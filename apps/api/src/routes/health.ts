import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';

export const healthRouter = Router();

// Railway and Docker poll this. It says ok only when the database answers too.
healthRouter.get('/', async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ ok: true, db: 'up' });
  } catch {
    res.status(503).json({ ok: false, db: 'down' });
  }
});
