import { createHash } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { and, eq, gt } from 'drizzle-orm';
import type { Me, Role } from '@wayfinder/contracts';
import { db } from '../db/client';
import { sessions, users } from '../db/schema';
import { HttpError } from '../lib/errors';

export const SESSION_COOKIE = 'wf_session';
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

declare global {
  namespace Express {
    interface Request { user?: Me }
  }
}

// Looks up the session cookie on every request. It does not block anything; requireRole does.
export const loadUser: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  const [row] = await db
    .select({ id: users.id, username: users.username, staffId: users.staffId, displayName: users.displayName, role: users.role, depotId: users.depotId, outletId: users.outletId, active: users.active, chosenDepotId: sessions.depotId })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())));
  // An account with no staff ID, which only a row seeded before staff IDs can be, is signed out: the sign-in treats
  // it as unknown too (spec 018).
  if (row?.active && row.staffId !== null) {
    // A dispatcher works on the depot this session switched to, once it has (spec 020, D-93), so every route that reads
    // the caller's depot follows the switch. Every other role keeps the depot of its account.
    const depotId = row.role === 'dispatcher' && row.chosenDepotId !== null ? row.chosenDepotId : row.depotId;
    req.user = { id: row.id, username: row.username, staffId: row.staffId, displayName: row.displayName, role: row.role, depotId, outletId: row.outletId };
  }
  next();
};

// D-95: every request a dispatcher's tab makes names the depot the tab shows. The session can have switched in another
// tab since, and then the request is refused before any route reads or writes anything, rather than acting on the other
// depot. Signing in and out, the switch itself, the clock with the demo control's move and reset, the live stream and
// the health check belong to no depot and go on whatever depot is named. A request that names none passes as before,
// as do other roles, so walk scripts and older tabs keep working.
export const DEPOT_HEADER = 'x-wayfinder-depot';
const ANY_DEPOT = [
  /^\/auth(\/|$)/, /^\/me\/depot\/?$/, /^\/clock(\/|$)/, /^\/demo\/clock(\/|$)/, /^\/demo\/reset\/?$/, /^\/events(\/|$)/, /^\/health(\/|$)/,
];
export const requireShownDepot: RequestHandler = (req, _res, next) => {
  const shown = req.get(DEPOT_HEADER);
  if (shown === undefined || req.user?.role !== 'dispatcher' || shown === req.user.depotId || ANY_DEPOT.some((path) => path.test(req.path))) return next();
  next(new HttpError(409, 'depot_changed', 'The depot was switched in another tab.'));
};

// Put this on every route. With no roles it only needs a signed-in user; admin can open everything.
export const requireRole = (...roles: Role[]): RequestHandler => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'signed_out', 'Please sign in.'));
  if (roles.length && !roles.includes(req.user.role) && req.user.role !== 'admin') {
    return next(new HttpError(403, 'forbidden', 'Your role cannot do this.'));
  }
  next();
};

// Browsers cannot send a cross-site JSON body without asking first, so insisting on JSON for every change
// closes the usual cross-site form trick on top of the SameSite cookie.
export const jsonOnlyWrites: RequestHandler = (req, _res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json') && req.headers['content-length'] !== '0') {
    return next(new HttpError(415, 'json_only', 'Send JSON.'));
  }
  next();
};

// requireRole lets an admin through every door, but a depot's plan, its loading and its problems belong to one depot
// and an admin has none.
export const requireDepot: RequestHandler = (req, _res, next) => {
  if (!req.user?.depotId) return next(new HttpError(403, 'no_depot', 'This account does not belong to a depot.'));
  next();
};

// The person asking and the depot they work on, once requireRole and requireDepot have passed: their account's, or for a
// dispatcher the one their session switched to (loadUser).
export interface DepotCaller { userId: string; depotId: string }
export const depotCallerOf = (req: Request): DepotCaller => ({ userId: req.user!.id, depotId: req.user!.depotId! });
