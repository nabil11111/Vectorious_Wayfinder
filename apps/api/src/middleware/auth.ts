import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
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
    .select({ id: users.id, username: users.username, displayName: users.displayName, role: users.role, depotId: users.depotId, outletId: users.outletId, active: users.active })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())));
  if (row?.active) {
    const { active: _a, ...me } = row;
    req.user = me;
  }
  next();
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
