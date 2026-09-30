import { once } from 'node:events';
import type { Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApiError, LiveEvent } from '@wayfinder/contracts';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { pool } from '../src/db/client';
import { announce, closeStreams, type Announcement } from '../src/lib/live';

// config.ts reads the settings when it loads, so they are made small before anything imports it: a heartbeat
// every 50 ms instead of every 20 seconds, and room for five streams instead of 200.
vi.hoisted(() => {
  process.env.LIVE_HEARTBEAT_MS = '50';
  process.env.LIVE_MAX_STREAMS = '5';
});

// supertest cannot hold a stream open, so the app listens on a free port and the tests read it with fetch.
const address = (of: Server) => `http://127.0.0.1:${(of.address() as AddressInfo).port}`;
const server = createApp().listen(0);
await once(server, 'listening');
const base = address(server);

// The server's end of every request, so a test can make the write to one stream fail.
const served: ServerResponse[] = [];
server.on('request', (_req, res) => served.push(res));

async function signIn(username: string, password = process.env.SEED_PASSWORD ?? 'wayfinder-demo'): Promise<string> {
  const res = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  if (!res.ok) throw new Error(`Could not sign in as ${username}: ${res.status} ${await res.text()}`);
  await res.body?.cancel();
  return res.headers.getSetCookie()[0]!.split(';')[0]!;
}

// One address gets ten sign-ins in 15 minutes, so each person signs in once and the cookie is used again.
const cookies = {
  nadeesha: await signIn('nadeesha'), // store manager of OUT001, a Peliyagoda shop
  ruwan: await signIn('ruwan'), // dispatcher at Peliyagoda
  kasun: await signIn('kasun'), // loader at Peliyagoda
  dilshan: await signIn('dilshan'), // driver at Peliyagoda
  prasanna: await signIn('prasanna'), // driver at Kandy
  admin: await signIn('admin', process.env.SEED_ADMIN_PASSWORD ?? 'wayfinder-admin'),
};
type Person = keyof typeof cookies;

const events = (cookie?: string, at = base) => fetch(`${at}/api/v1/events`, { headers: cookie ? { cookie } : {} });

// Opens the stream as an open screen does and keeps reading it in the background. `text` is everything the
// server has written so far. `state` says whether the stream is open, was ended by the server or was cut.
async function listen(person: Person, at = base) {
  const res = await events(cookies[person], at);
  if (res.status !== 200) throw new Error(`The stream was refused: ${res.status} ${await res.text()}`);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let state: 'open' | 'ended' | 'cut' = 'open';
  const over = (async () => {
    try {
      for (let piece = await reader.read(); !piece.done; piece = await reader.read()) text += decoder.decode(piece.value, { stream: true });
      state = 'ended';
    } catch {
      state = 'cut';
    }
  })();
  return { res, over, hangUp: () => reader.cancel(), get text() { return text; }, get state() { return state; } };
}
type Stream = Awaited<ReturnType<typeof listen>>;

// What a stream has been sent so far, one entry per message, without the heartbeats. The last piece is left
// out: it is empty, or a message that has not fully arrived.
const messages = (stream: Stream) => stream.text.split('\n\n').slice(0, -1).filter((block) => !block.startsWith(':'));
// The changes in those messages. LiveEvent is strict, so one that holds more than a topic and an id fails here.
const changes = (stream: Stream) => messages(stream).map((block) => LiveEvent.parse(JSON.parse(block.replace('event: change\ndata: ', ''))));
// Waits for what the server sends a moment after it was asked.
const soon = (check: () => unknown) => vi.waitFor(check, { timeout: 2000, interval: 10 });

// Opens a stream for each of these people, announces the change and says who was sent it. A second change for
// everyone follows it. A stream that has that one has everything sent before it, so the test knows who was
// left out without waiting to see whether something still comes.
async function whoHears(change: Announcement, people: Person[]): Promise<Person[]> {
  const open = await Promise.all(people.map(async (person) => ({ person, stream: await listen(person) })));
  announce(change);
  announce({ topic: 'last' });
  await soon(() => open.forEach(({ stream }) => expect(changes(stream)).toContainEqual({ topic: 'last' })));
  closeStreams();
  return open.filter(({ stream }) => changes(stream).some((heard) => heard.topic === change.topic)).map(({ person }) => person);
}

afterEach(() => {
  closeStreams();
  vi.useRealTimers();
});
// An open stream or server would keep the test run from ending. close() alone waits for every connection,
// and fetch can hold a spare one that never sent a request, so they are all closed here.
afterAll(async () => {
  const closed = new Promise((done) => server.close(done));
  server.closeAllConnections();
  await closed;
  await pool.end();
});

describe('the live stream', () => {
  it('AC-17 answers a signed-in person with an event stream, keeps it open and sends a heartbeat', async () => {
    const ruwan = await listen('ruwan');
    expect(ruwan.res.headers.get('content-type')).toBe('text/event-stream');
    expect(ruwan.res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(ruwan.res.headers.get('x-accel-buffering')).toBe('no');
    // fetch says it takes gzip. A compressed stream would hold a message back until a block is full.
    expect(ruwan.res.headers.has('content-encoding')).toBe(false);
    // Every 50 ms in this file, every 20 seconds in the app.
    await soon(() => expect(ruwan.text).toMatch(/^(: ping\n\n){3}/));
    expect(ruwan.state).toBe('open');
  });

  it('sends the headers at once, before there is anything to say', async () => {
    // With the heartbeat's timer held still nothing is written after the headers, so fetch can only answer
    // when they were sent on their own.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const ruwan = await listen('ruwan');
    expect(ruwan.res.status).toBe(200);
  });

  it('AC-18 answers a signed-out person with 401 signed_out', async () => {
    for (const cookie of [undefined, 'wf_session=not-a-session']) {
      const res = await events(cookie);
      expect(res.status).toBe(401);
      expect(ApiError.parse(await res.json()).error.code).toBe('signed_out');
    }
  });

  it('AC-19 sends a depot\'s change to its dispatcher, loaders and drivers and to admins, and to nobody else', async () => {
    const change = { topic: 'plans', depotId: 'Peliyagoda' };
    expect(await whoHears(change, ['ruwan', 'kasun', 'dilshan', 'admin', 'prasanna'])).toEqual(['ruwan', 'kasun', 'dilshan', 'admin']);
    // A store manager is left out too, though her shop belongs to that depot.
    expect(await whoHears(change, ['nadeesha', 'ruwan'])).toEqual(['ruwan']);
  });

  it('AC-20 sends an outlet\'s change to its store manager as well, and to no other store manager', async () => {
    const people: Person[] = ['nadeesha', 'ruwan', 'dilshan', 'admin', 'prasanna'];
    expect(await whoHears({ topic: 'orders', id: 'an-order', outletId: 'OUT001', depotId: 'Peliyagoda' }, people)).toEqual(['nadeesha', 'ruwan', 'dilshan', 'admin']);
    // OUT002 is another Peliyagoda shop, so its change is not Nadeesha's to hear.
    expect(await whoHears({ topic: 'orders', id: 'another-order', outletId: 'OUT002', depotId: 'Peliyagoda' }, people)).toEqual(['ruwan', 'dilshan', 'admin']);
  });

  it('AC-21 sends a change for everyone to every open stream', async () => {
    const people: Person[] = ['nadeesha', 'ruwan', 'kasun', 'prasanna', 'admin'];
    expect(await whoHears({ topic: 'clock' }, people)).toEqual(people);
  });

  it('AC-22 sends the topic and one id, and nothing else', async () => {
    const nadeesha = await listen('nadeesha');
    announce({ topic: 'orders', id: 'an-order', outletId: 'OUT001', depotId: 'Peliyagoda' });
    announce({ topic: 'clock' });
    await soon(() => expect(messages(nadeesha)).toEqual([
      'event: change\ndata: {"topic":"orders","id":"an-order"}',
      'event: change\ndata: {"topic":"clock"}',
    ]));
  });

  it('keeps a failed write to one stream away from the code that announced and from the other streams', async () => {
    const ruwan = await listen('ruwan');
    const broken = await listen('kasun');
    vi.spyOn(served.at(-1)!, 'write').mockImplementation(() => {
      throw new Error('write EPIPE');
    });
    expect(() => announce({ topic: 'plans', depotId: 'Peliyagoda' })).not.toThrow();
    await soon(() => expect(changes(ruwan)).toEqual([{ topic: 'plans' }]));
    // The broken stream is cut, so its screen opens a new one and fetches everything again.
    await broken.over;
    expect(broken.state).toBe('cut');
  });

  it('AC-24 leaves an open stream out of the rate limit', async () => {
    // What is left of the limit, as a request that does count is told: `"300-in-1min"; r=297; t=60`.
    const left = async () => {
      const health = await fetch(`${base}/api/v1/health`);
      await health.body?.cancel();
      return Number(health.headers.get('ratelimit')?.match(/r=(\d+)/)?.[1]);
    };
    const before = await left();
    const ruwan = await listen('ruwan');
    expect(ruwan.res.headers.has('ratelimit')).toBe(false);
    // Only the second health check was counted, not the stream opened between the two.
    expect(before - (await left())).toBe(1);
  });

  it('AC-25 answers a new stream with 503 too_many_streams when the limit of open streams is reached', async () => {
    for (const person of ['nadeesha', 'ruwan', 'kasun', 'prasanna', 'admin'] as const) await listen(person);
    const sixth = await events(cookies.dilshan);
    expect(sixth.status).toBe(503);
    expect(ApiError.parse(await sixth.json()).error.code).toBe('too_many_streams');
  });

  it('gives the place of a stream back when its screen goes away', async () => {
    const gone = await listen('nadeesha');
    for (const person of ['ruwan', 'kasun', 'prasanna', 'admin'] as const) await listen(person);
    await gone.hangUp();
    // The server hears that the connection closed a moment later.
    await soon(() => listen('dilshan'));
  });

  it('keeps no place for a stream whose screen was gone before it opened', async () => {
    // The session is looked up before the stream opens, and a screen can leave in that moment. Here the
    // connection is closed as soon as the request is in.
    server.once('request', (req) => req.socket.destroy());
    await expect(events(cookies.ruwan)).rejects.toThrow();
    // Had it been put on the list it would stay there for good, and the fifth stream would be refused.
    for (const person of ['nadeesha', 'ruwan', 'kasun', 'prasanna', 'admin'] as const) await listen(person);
  });

  it('AC-26 ends every open stream when the server is told to stop, so that it can close', async () => {
    // A server of its own, stopped the way server.ts stops on SIGTERM: the streams first, then the server.
    const stopping = createApp().listen(0);
    await once(stopping, 'listening');
    const at = address(stopping);
    const streams = [await listen('ruwan', at), await listen('nadeesha', at), await listen('admin', at)];
    closeStreams();
    // close() calls back once no connection is left open. A stream that was still open would hold it, and
    // the process, for good.
    await new Promise<void>((done, failed) => stopping.close((err) => (err ? failed(err) : done())));
    await Promise.all(streams.map((stream) => stream.over));
    expect(streams.map((stream) => stream.state)).toEqual(['ended', 'ended', 'ended']);
  });
});
