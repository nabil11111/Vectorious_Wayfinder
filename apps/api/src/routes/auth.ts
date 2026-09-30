import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { eq } from 'drizzle-orm';
import { LoginRequest, type Me } from '@wayfinder/contracts';
import { db } from '../db/client';
import { sessions, users } from '../db/schema';
import { config } from '../lib/config';
import { HttpError } from '../lib/errors';
import { SESSION_COOKIE, hashToken, requireRole } from '../middleware/auth';

export const authRouter = Router();

// Ten failed tries per 15 minutes per address, so nobody can guess passwords at speed. Sign-ins that work do not
// count: judges who share one network share one address, and each of them signs in as every role.
const loginLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, skipSuccessfulRequests: true, standardHeaders: 'draft-8', legacyHeaders: false, validate: { xForwardedForHeader: false },
  message: { error: { code: 'too_many_attempts', message: 'Too many sign-in attempts. Try again in a few minutes.' } } });

// A made-up account's hash, made once on first use. An unknown username is checked against it, so the answer takes
// as long as a wrong password would and its timing does not reveal which usernames exist either.
let nobody: Promise<string> | undefined;
const nobodysHash = () => (nobody ??= hash(randomBytes(16).toString('base64url')));

authRouter.post('/login', loginLimit, async (req, res) => {
  const body = LoginRequest.parse(req.body);
  const [user] = await db.select().from(users).where(eq(users.username, body.username.toLowerCase()));
  const known = user?.active ? user : null;
  const matches = await verify(known?.passwordHash ?? await nobodysHash(), body.password);
  // Same message whether the name or the password is wrong, so the error does not reveal which usernames exist.
  if (!known || !matches) {
    throw new HttpError(401, 'bad_credentials', 'That username and password do not match.');
  }
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3_600_000);
  await db.insert(sessions).values({ id: hashToken(token), userId: known.id, expiresAt });
  // Secure whenever the request came over https, which hosted means through a proxy the app trusts (TRUST_PROXY).
  // On plain http://localhost a Secure cookie would be dropped by browsers that do not treat localhost as secure.
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, expires: expiresAt, path: '/' });
  const me: Me = { id: known.id, username: known.username, displayName: known.displayName, role: known.role, depotId: known.depotId, outletId: known.outletId };
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
