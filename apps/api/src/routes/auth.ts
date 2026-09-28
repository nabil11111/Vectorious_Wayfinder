import { randomBytes } from 'node:crypto';
import { verify } from '@node-rs/argon2';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { eq } from 'drizzle-orm';
import { LoginRequest, type Me } from '@wayfinder/contracts';
import { db } from '../db/client';
import { sessions, users } from '../db/schema';
import { config, isProd } from '../lib/config';
import { HttpError } from '../lib/errors';
import { SESSION_COOKIE, hashToken, requireRole } from '../middleware/auth';

export const authRouter = Router();

// Ten tries per 15 minutes per address, so nobody can guess passwords at speed.
const loginLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { code: 'too_many_attempts', message: 'Too many sign-in attempts. Try again in a few minutes.' } } });

authRouter.post('/login', loginLimit, async (req, res) => {
  const body = LoginRequest.parse(req.body);
  const [user] = await db.select().from(users).where(eq(users.username, body.username.toLowerCase()));
  // Same message whether the name or the password is wrong, so the error does not reveal which usernames exist.
  if (!user || !user.active || !(await verify(user.passwordHash, body.password))) {
    throw new HttpError(401, 'bad_credentials', 'That username and password do not match.');
  }
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3_600_000);
  await db.insert(sessions).values({ id: hashToken(token), userId: user.id, expiresAt });
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: isProd, expires: expiresAt, path: '/' });
  const me: Me = { id: user.id, username: user.username, displayName: user.displayName, role: user.role, depotId: user.depotId, outletId: user.outletId };
  res.json(me);
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.status(204).end();
});

authRouter.get('/me', requireRole(), (req, res) => {
  res.json(req.user);
});
