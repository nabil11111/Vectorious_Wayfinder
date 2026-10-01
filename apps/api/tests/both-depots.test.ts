import { BOTH_DEPOTS, Me, type LoginRequest } from '@wayfinder/contracts';
import { eq, inArray } from 'drizzle-orm';
import type { Request, Response } from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { sessions, users } from '../src/db/schema';
import { closeStreams } from '../src/lib/live';
import { DEPOT_HEADER, hashToken, readDepotOf, requireShownDepot } from '../src/middleware/auth';
import { serve, stop } from './serve';
import { signInAs } from './sign-in';

// Spec 021: both depots together (D-96). A dispatcher's session can be on Both, and then every dispatcher read names the
// depot it reads, a plan write is refused, an answer goes to the problem's own depot and the live stream carries both
// depots. Signing in still starts at the dispatcher's own depot.

const server = await serve(createApp());
type Agent = ReturnType<typeof request.agent>;
const SWITCH = '/api/v1/me/depot';
const code = (res: request.Response) => [res.status, res.body.error?.code];

afterAll(async () => {
  closeStreams();
  await stop(server);
  await pool.end();
});

// An account signed in on an agent of its own, the Me it was answered with, and its session's id as the table keeps it.
async function signIn(who: string | LoginRequest): Promise<{ agent: Agent; me: Me; session: string }> {
  const agent = request.agent(server);
  const res = await signInAs(agent, who);
  expect([who, res.status]).toEqual([who, 200]);
  const token = res.headers['set-cookie']![0]!.split(';')[0]!.split('=')[1]!;
  return { agent, me: Me.parse(res.body), session: hashToken(token) };
}
const switchTo = (agent: Agent, depotId: unknown) => agent.put(SWITCH).send({ depotId });
const meOf = async (agent: Agent) => Me.parse((await agent.get('/api/v1/auth/me')).body);
// What a session keeps of the switch.
const chosenOn = async (session: string) => (await db.select({ depotId: sessions.depotId, allDepots: sessions.allDepots }).from(sessions)
  .where(eq(sessions.id, session)))[0];
// A dispatcher as the session middleware gives a request, on the scope a test names.
const dispatcher: Me = { id: '00000000-0000-4000-8000-000000000000', username: 'ruwan', staffId: 'X-000', displayName: 'Ruwan', role: 'dispatcher', depotId: null, outletId: null };
const readOf = (scope: string, query: Record<string, unknown>) => readDepotOf({ user: { ...dispatcher, depotId: scope }, query } as unknown as Request);

describe('the switch to Both', () => {
  it('AC-1 answers Ruwan\'s Me with Both and keeps it on his session, and Peliyagoda or Kandy afterwards brings back one depot', async () => {
    expect(BOTH_DEPOTS).toBe('Both');
    const { agent, me, session } = await signIn('ruwan');
    expect(me.depotId).toBe('Peliyagoda');

    const both = await switchTo(agent, 'Both');
    expect(both.status).toBe(200);
    expect(Me.parse(both.body)).toEqual({ ...me, depotId: 'Both' });
    expect(await meOf(agent)).toEqual({ ...me, depotId: 'Both' });
    expect(await chosenOn(session)).toEqual({ depotId: null, allDepots: true });

    // Kandy brings back one depot, and Both again, then Peliyagoda.
    expect(Me.parse((await switchTo(agent, 'Kandy')).body)).toEqual({ ...me, depotId: 'Kandy' });
    expect(await meOf(agent)).toEqual({ ...me, depotId: 'Kandy' });
    expect(await chosenOn(session)).toEqual({ depotId: 'Kandy', allDepots: false });
    expect(Me.parse((await switchTo(agent, 'Both')).body)).toEqual({ ...me, depotId: 'Both' });
    expect(await chosenOn(session)).toEqual({ depotId: null, allDepots: true });
    expect(Me.parse((await switchTo(agent, 'Peliyagoda')).body)).toEqual(me);
    expect(await meOf(agent)).toEqual(me);
    expect(await chosenOn(session)).toEqual({ depotId: 'Peliyagoda', allDepots: false });
  });

  it('AC-1 starts a new sign-in at his own depot, and the session on Both keeps it for each of its tabs until it signs out', async () => {
    const first = await signIn('ruwan');
    expect((await switchTo(first.agent, 'Both')).status).toBe(200);

    const second = await signIn('ruwan');
    expect(second.me.depotId).toBe('Peliyagoda');
    expect((await meOf(second.agent)).depotId).toBe('Peliyagoda');
    expect(await chosenOn(second.session)).toEqual({ depotId: null, allDepots: false });
    expect((await meOf(first.agent)).depotId).toBe('Both');

    // Signing out ends the session, and Both with it.
    expect((await first.agent.post('/api/v1/auth/logout').set('Content-Type', 'application/json')).status).toBe(204);
    expect(code(await first.agent.get('/api/v1/auth/me'))).toEqual([401, 'signed_out']);
    expect(await chosenOn(first.session)).toBeUndefined();
  });

  it('AC-1 answers 403 to a loader, a driver, a store manager and an admin asking for Both, and leaves their sessions as they were', async () => {
    const others = ['kasun', 'dilshan', 'prasanna', 'nadeesha', 'admin'];
    for (const username of others) {
      const { agent, me } = await signIn(username);
      expect([username, ...code(await switchTo(agent, 'Both'))]).toEqual([username, 403, 'forbidden']);
      expect(await meOf(agent)).toEqual(me);
    }
    const kept = await db.select({ depotId: sessions.depotId, allDepots: sessions.allDepots }).from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId)).where(inArray(users.username, others));
    expect(kept.length).toBeGreaterThanOrEqual(others.length);
    expect(new Set(kept.map((session) => JSON.stringify(session)))).toEqual(new Set([JSON.stringify({ depotId: null, allDepots: false })]));
  });

  it('AC-1 keeps Both when a switch is refused: a depot not on the list, Both written another way, or no depot', async () => {
    const { agent, me, session } = await signIn('ruwan');
    expect((await switchTo(agent, 'Both')).status).toBe(200);
    for (const depotId of ['Galle', 'both', 'BOTH']) {
      const res = await switchTo(agent, depotId);
      expect([depotId, ...code(res)]).toEqual([depotId, 400, 'unknown_record']);
      expect(res.body.error.details).toEqual({ id: depotId });
    }
    for (const body of [{}, { depotId: '' }, { depotId: null }, { depot: 'Both' }]) {
      expect([body, ...code(await agent.put(SWITCH).send(body))]).toEqual([body, 400, 'invalid_input']);
    }
    expect(await meOf(agent)).toEqual({ ...me, depotId: 'Both' });
    expect(await chosenOn(session)).toEqual({ depotId: null, allDepots: true });
  });
});

describe('a tab that names its scope (rule 5, D-95)', () => {
  it('refuses a tab that still names one depot once the session is on Both, and a tab on Both once the session is on one depot', async () => {
    const { agent } = await signIn('ruwan');
    expect((await switchTo(agent, 'Both')).status).toBe(200);
    for (const depot of ['Peliyagoda', 'Kandy']) {
      for (const path of ['/api/v1/operations', '/api/v1/issues', '/api/v1/lookup/fleet', '/api/v1/plans']) {
        expect([depot, path, ...code(await agent.get(path).set(DEPOT_HEADER, depot))]).toEqual([depot, path, 409, 'depot_changed']);
      }
    }
    expect((await switchTo(agent, 'Kandy')).status).toBe(200);
    for (const path of ['/api/v1/operations', '/api/v1/issues', '/api/v1/lookup/fleet', '/api/v1/plans']) {
      expect([path, ...code(await agent.get(path).set(DEPOT_HEADER, 'Both'))]).toEqual([path, 409, 'depot_changed']);
    }
    // The switch itself goes through whatever the tab names.
    expect(Me.parse((await switchTo(agent, 'Both').set(DEPOT_HEADER, 'Kandy')).body).depotId).toBe('Both');
    expect(Me.parse((await switchTo(agent, 'Kandy').set(DEPOT_HEADER, 'Both')).body).depotId).toBe('Kandy');
  });

  it('lets a request through when the scope it names is the session\'s, Both included', () => {
    const shown = (scope: string, named: string | undefined) => {
      const passed: unknown[] = [];
      const req = { get: () => named, user: { ...dispatcher, depotId: scope }, path: '/operations' } as unknown as Request;
      requireShownDepot(req, {} as Response, (err?: unknown) => { passed.push(err ?? null); });
      return passed;
    };
    expect(shown('Both', 'Both')).toEqual([null]);
    expect(shown('Both', undefined)).toEqual([null]);
    expect(shown('Kandy', 'Kandy')).toEqual([null]);
    expect(shown('Both', 'Kandy')).toEqual([expect.objectContaining({ status: 409, code: 'depot_changed' })]);
    expect(shown('Peliyagoda', 'Both')).toEqual([expect.objectContaining({ status: 409, code: 'depot_changed' })]);
  });
});

describe('the depot of a dispatcher\'s read', () => {
  it('on one depot is that depot, named or not, and a read that names the other depot was made by a tab the session left', async () => {
    expect(await readOf('Kandy', {})).toBe('Kandy');
    expect(await readOf('Kandy', { depot: 'Kandy' })).toBe('Kandy');
    expect(await readOf('Peliyagoda', { depot: 'Peliyagoda', range: 'day' })).toBe('Peliyagoda');
    await expect(readOf('Kandy', { depot: 'Peliyagoda' })).rejects.toMatchObject({ status: 409, code: 'depot_changed' });
    await expect(readOf('Peliyagoda', { depot: 'Both' })).rejects.toMatchObject({ status: 409, code: 'depot_changed' });
  });

  it('on Both is the depot the read names, which must be on the list, and a read that names none is refused', async () => {
    expect(await readOf('Both', { depot: 'Peliyagoda' })).toBe('Peliyagoda');
    expect(await readOf('Both', { depot: 'Kandy', date: '2026-06-25' })).toBe('Kandy');
    await expect(readOf('Both', {})).rejects.toMatchObject({ status: 400, code: 'pick_a_depot' });
    await expect(readOf('Both', { range: 'day' })).rejects.toMatchObject({ status: 400, code: 'pick_a_depot' });
    for (const depot of ['Galle', 'kandy', 'Both']) {
      await expect(readOf('Both', { depot })).rejects.toMatchObject({ status: 400, code: 'unknown_record', details: { id: depot } });
    }
  });

  it('takes one depot name, never an empty one or two', async () => {
    for (const scope of ['Both', 'Kandy']) {
      for (const depot of ['', ['Kandy', 'Peliyagoda'], 'x'.repeat(65)]) {
        await expect(readOf(scope, { depot })).rejects.toBeInstanceOf(ZodError);
      }
    }
  });
});
