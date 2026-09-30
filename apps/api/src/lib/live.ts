import type { Response } from 'express';
import type { Me } from '@wayfinder/contracts';
import { HttpError } from './errors';

// Live updates (spec 008, D-21). Each open screen keeps one stream to the server, and a change is announced
// to the streams of the people it concerns. A message says what changed, never the data. The open streams
// are a list in memory, which is right for one process (D-01).
//
// The names and what they take and return are fixed here so every piece can announce its changes. The
// stream itself (the list, the scoping, the heartbeat) is task T2 of spec 008.

// What changed and who it concerns. No depot and no outlet means everyone, such as the clock. A depot means
// that depot's dispatcher, loaders and drivers. An outlet adds that outlet's store manager, so a change about
// a shop passes both its outlet and its depot. Admins hear everything.
export interface Announcement {
  topic: string;
  id?: string;
  depotId?: string;
  outletId?: string;
}

// Sends the stream's headers on this response, keeps it open and adds it to the list with the person's
// role, depot and outlet. Takes it off when the request closes. Throws 503 too_many_streams when the list
// is full.
export function openStream(_user: Me, _res: Response): void {
  throw new HttpError(501, 'not_built', 'Live updates are not built yet.');
}

// Tells the streams the rule above picks. Call it after the change's transaction has committed, never
// inside it. Until T2 lands nothing is sent, and the screens catch up on their timer.
export function announce(_change: Announcement): void {}

// Ends every open stream. server.ts calls it before it closes, or open streams would hold the process.
export function closeStreams(): void {}
