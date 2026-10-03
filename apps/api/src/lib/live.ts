import type { Response } from 'express';
import { BOTH_DEPOTS, type LiveEvent, type Me } from '@wayfinder/contracts';
import { config } from './config';
import { HttpError } from './errors';
import { logger } from './logger';

// Live updates (spec 008, D-21). Each open screen keeps one stream to the server, and a change is announced
// to the streams of the people it concerns. A message says what changed, never the data. The open streams
// are a list in memory, which is right for one process (D-01).

// What changed and who it concerns. No depot and no outlet means everyone, such as the clock. A depot means
// that depot's dispatcher, loaders and drivers, and a dispatcher on both depots. An outlet adds that outlet's
// store manager, so a change about a shop passes both its outlet and its depot. Admins hear everything.
export interface Announcement {
  topic: string;
  id?: string;
  depotId?: string;
  outletId?: string;
  // When supplied, only these accounts may hear it, still subject to the existing depot/outlet rules.
  recipientIds?: readonly string[];
}

// The open streams, each with the person it belongs to.
const streams = new Map<Response, Me>();
// One timer for all of them, running only while there is a stream to keep open.
let heartbeat: ReturnType<typeof setInterval> | undefined;

function drop(res: Response): void {
  streams.delete(res);
  if (streams.size === 0) {
    clearInterval(heartbeat);
    heartbeat = undefined;
  }
}

// A write that fails must not reach the caller: the code that announced has already saved its change, and
// the other streams still need theirs. The stream is cut instead, so its screen opens a new one and fetches
// everything again.
function send(res: Response, text: string): void {
  try {
    res.write(text);
  } catch (err) {
    logger.warn({ err }, 'live stream cut after a failed write');
    drop(res);
    res.destroy();
  }
}

// The rule above Announcement. A store manager is matched on the outlet alone: her shop belongs to a depot
// too, but a change about the depot is not hers to hear. A dispatcher on both depots together hears every
// depot's changes (spec 021), and still none that concerns an outlet alone.
function hears(user: Me, change: Announcement): boolean {
  if (change.recipientIds && !change.recipientIds.includes(user.id)) return false;
  if (user.role === 'admin' || (change.depotId === undefined && change.outletId === undefined)) return true;
  if (user.role === 'store_manager') return user.outletId === change.outletId;
  if (user.role === 'dispatcher' && user.depotId === BOTH_DEPOTS) return change.depotId !== undefined;
  return user.depotId === change.depotId;
}

// Sends the stream's headers on this response, keeps it open and adds it to the list with the person's
// role, depot and outlet. Takes it off when the connection closes. Throws 503 too_many_streams when the list
// is full.
export function openStream(user: Me, res: Response): void {
  const connection = res.req.socket;
  // The session is looked up before this runs, and a screen can be gone by then. Nothing will say so a second
  // time, so on the list it would stay for good.
  if (connection.destroyed) return;
  if (streams.size >= config.LIVE_MAX_STREAMS) throw new HttpError(503, 'too_many_streams', 'Too many live streams are open right now.');
  // The headers go out at once, so the screen knows the stream is open before there is anything to say.
  // no-transform and X-Accel-Buffering keep a proxy from compressing the stream or holding it back.
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  streams.set(res, user);
  // Node tells a response that its connection closed only while the response holds that connection. A request
  // sent behind another on the same connection does not hold it, so there the connection itself is watched.
  if (res.socket) res.once('close', () => drop(res));
  else connection.once('close', () => drop(res));
  // A comment line to every stream, so the proxies in front of the hosted app keep a quiet one open.
  heartbeat ??= setInterval(() => {
    for (const open of streams.keys()) send(open, ': ping\n\n');
  }, config.LIVE_HEARTBEAT_MS);
}

// Tells the streams the rule above picks. Call it after the change's transaction has committed, never
// inside it. It never throws, whatever happens to a stream.
export function announce(change: Announcement): void {
  // Only the topic and the id go out. Who the change concerns stays here.
  const event: LiveEvent = { topic: change.topic, id: change.id };
  const message = `event: change\ndata: ${JSON.stringify(event)}\n\n`;
  for (const [res, user] of streams) if (hears(user, change)) send(res, message);
}

// Ends every open stream. server.ts calls it before it closes, or open streams would hold the process.
export function closeStreams(): void {
  for (const res of streams.keys()) {
    res.end();
    drop(res);
  }
}
