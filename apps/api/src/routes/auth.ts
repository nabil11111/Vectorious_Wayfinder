import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { LoginRequest, type Me } from '@wayfinder/contracts';
import { db } from '../db/client';
import { sessions, users } from '../db/schema';
import { config } from '../lib/config';
import { HttpError } from '../lib/errors';
import { SESSION_COOKIE, hashToken, requireRole } from '../middleware/auth';

export const authRouter = Router();

// Ten failed tries per 15 minutes per address, so nobody can guess PINs at speed. Sign-ins that work do not count:
// judges who share one network share one address, and each of them signs in as every role.
const loginLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, skipSuccessfulRequests: true, standardHeaders: 'draft-8', legacyHeaders: false, validate: { xForwardedForHeader: false },
  message: { error: { code: 'too_many_attempts', message: 'Too many sign-in attempts. Try again in a few minutes.' } } });

// A made-up account's hash. An unknown staff ID is checked against it, so the answer takes as long as a wrong PIN
// would and its timing does not reveal which staff IDs exist either. It is made once, as this file loads, and
// server.ts waits for it before it listens, so no sign-in has to make it first, not even the first one.
const nobodysHash = hash(randomBytes(16).toString('base64url'));
export async function signInReady(): Promise<void> {
  await nobodysHash;
}

// One answer for any wrong pair (spec 018, rule 3), so the error does not reveal which staff IDs exist.
const wrongPair = () => new HttpError(401, 'bad_credentials', "Staff ID or PIN isn't correct. Try again.");

// Five wrong PINs in a row lock the staff ID for 15 minutes, because four digits are easy to try in turn (rule 4,
// D-90). The address limit above still applies on top.
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60_000;
const tooManyTries = () => new HttpError(429, 'locked', 'Too many tries. Wait 15 minutes, or contact your depot.');
// A staff ID whose lock has run out by then, or that never had one.
const unlockedAt = (at: Date) => or(isNull(users.lockedUntil), lte(users.lockedUntil, at));

authRouter.post('/login', loginLimit, async (req, res) => {
  // The contract trims and upper-cases the staff ID, and lets only four digits through as a PIN.
  const body = LoginRequest.parse(req.body);
  // The lock runs on real time, as the session does, so moving the demo clock never lifts it.
  const at = new Date();
  const [user] = await db.select().from(users).where(eq(users.staffId, body.staffId));
  // An account that is switched off, or a row with no PIN, is as unknown as a staff ID nobody has.
  const known = user?.active && user.staffId !== null && user.pinHash !== null ? { ...user, staffId: user.staffId, pinHash: user.pinHash } : null;
  // A locked staff ID is answered without checking the PIN.
  if (known?.lockedUntil && known.lockedUntil > at) throw tooManyTries();
  const matches = await verify(known?.pinHash ?? await nobodysHash, body.pin);
  if (!known) throw wrongPair();
  if (!matches) {
    // One statement adds the wrong PIN, so tries that arrive together all count. The fifth in a row locks the staff
    // ID and sets the count back to 0, and is answered as locked itself. No row back means another try locked it
    // in the meantime.
    const fifth = sql`${users.failedPins} + 1 >= ${LOCK_AFTER}`;
    const [counted] = await db.update(users)
      .set({
        failedPins: sql`case when ${fifth} then 0 else ${users.failedPins} + 1 end`,
        lockedUntil: sql`case when ${fifth} then ${new Date(at.getTime() + LOCK_MS).toISOString()}::timestamptz end`,
      })
      .where(and(eq(users.id, known.id), unlockedAt(at)))
      .returning({ lockedUntil: users.lockedUntil });
    throw counted && !counted.lockedUntil ? wrongPair() : tooManyTries();
  }
  // A right PIN sets the count back to 0 and clears a lock that has run out, unless a wrong try locked it meanwhile.
  const [opened] = await db.update(users).set({ failedPins: 0, lockedUntil: null })
    .where(and(eq(users.id, known.id), unlockedAt(at))).returning({ id: users.id });
  if (!opened) throw tooManyTries();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(at.getTime() + config.SESSION_TTL_HOURS * 3_600_000);
  await db.insert(sessions).values({ id: hashToken(token), userId: known.id, expiresAt });
  // Secure whenever the request came over https, which hosted means through a proxy the app trusts (TRUST_PROXY).
  // On plain http://localhost a Secure cookie would be dropped by browsers that do not treat localhost as secure.
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, expires: expiresAt, path: '/' });
  const me: Me = { id: known.id, username: known.username, staffId: known.staffId, displayName: known.displayName, role: known.role, depotId: known.depotId, outletId: known.outletId };
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
