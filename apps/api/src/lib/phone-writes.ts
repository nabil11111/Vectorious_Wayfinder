import { createHash } from 'node:crypto';
import { PHONE_ACCOUNT_HEADER } from '@wayfinder/contracts';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import type { Tx } from '../db/client';
import { phoneWrites } from '../db/schema';
import { HttpError } from './errors';

// The writes a phone saves first and sends once (D-45, D-57): the driver's six and the shop's receipt. Each carries an
// id made on the phone, which the server binds to the account, the trip, the kind and the body it applied it with, so
// the same write sent again is answered as done and an id sent again with anything else is refused.

// The phone names the account that saved the write in a header, and the write is taken only under that account's
// session. Another account signed in in another tab after the phone read its day holds the cookie the send carries, and
// may manage the same shop or drive the same trip, so without this the write would apply as theirs. It runs after the
// route's session and role checks, and the phone keeps the write waiting until its account signs in again.
export const requireWriteOwner: RequestHandler = (req, _res, next) => {
  if (!req.user || req.get(PHONE_ACCOUNT_HEADER) !== req.user.id) {
    return next(new HttpError(409, 'other_account', 'This record was saved by another account. Sign in as that account to send it.'));
  }
  next();
};

export interface PhoneWrite {
  writeId: string;
  userId: string;
  tripId: string;
  kind: string;
  // The parsed write, photo and all.
  body: unknown;
}

// Object key order is immaterial, while array order and every parsed value (including the photo) are kept.
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, ordered(value)]));
  return value;
}

// The SHA-256 of the parsed write as JSON with its keys sorted.
const hashOf = (body: unknown) => createHash('sha256').update(JSON.stringify(ordered(body))).digest('hex');

// The write id step, inside the transaction that applies the write and after the trip's lock is held: 'new' once the
// id is reserved for this write, which a failed write's rollback gives back, or 'repeat' when the server applied this
// very write before, whose answered time then moves on. Two copies sent at once queue on the trip's lock, so the second
// finds the first's row. An id applied with another account, trip, kind or body is write_reused. Reserving the id also
// keeps two different trips racing for one id apart: after a conflict, a separate read sees the committed winner.
export async function reserveWrite(tx: Tx, write: PhoneWrite): Promise<'new' | 'repeat'> {
  const bodyHash = hashOf(write.body);
  const [saved] = await tx.insert(phoneWrites).values({ id: write.writeId, userId: write.userId, tripId: write.tripId, kind: write.kind, bodyHash })
    .onConflictDoNothing({ target: phoneWrites.id }).returning({ id: phoneWrites.id });
  if (saved) return 'new';
  const [previous] = await tx.select().from(phoneWrites).where(eq(phoneWrites.id, write.writeId));
  if (!previous || previous.userId !== write.userId || previous.tripId !== write.tripId || previous.kind !== write.kind || previous.bodyHash !== bodyHash) {
    throw new HttpError(409, 'write_reused', 'This record was already sent with other details.', { writeId: write.writeId });
  }
  await tx.update(phoneWrites).set({ answeredAt: sql`now()` }).where(eq(phoneWrites.id, write.writeId));
  return 'repeat';
}

// The ids of every write the account had applied, or had answered again, in the last 48 hours of real time, whatever
// its day shows, so a write leaves the phone once a fetched day lists it (D-45). Real time, because the demo clock is
// moved and reset.
export async function appliedWriteIdsOf(tx: Tx, userId: string): Promise<string[]> {
  const rows = await tx.select({ id: phoneWrites.id }).from(phoneWrites)
    .where(and(eq(phoneWrites.userId, userId), gte(phoneWrites.answeredAt, sql`now() - interval '48 hours'`))).orderBy(phoneWrites.id);
  return rows.map(row => row.id);
}
