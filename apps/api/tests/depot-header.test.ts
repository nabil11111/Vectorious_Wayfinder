import { Me, PlanBoard, type LoginRequest } from '@wayfinder/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { demoDay, plans } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { closeStreams } from '../src/lib/live';
import { resetDay } from './loading-plan';
import { address, serve, stop } from './serve';
import { PIN, signInAs } from './sign-in';

// D-95: every request a dispatcher's tab makes names the depot the tab shows, and the server refuses one whose depot the
// session has left (409 depot_changed) before the route reads or writes anything, instead of acting on the other depot.
// Signing in and out, the switch, the clock, the live stream and the health check go on whatever depot is named. A
// request that names none passes as before, so the walk scripts, older tabs and every other role are untouched.

// The app's clock is held where a test puts it.
const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at || clock.demoClockAt(...args).now }) };
});
const freeze = (date: string, minute: number) => { const at = depotInstant(date, minute); testClock.at = at.toISOString(); setClockForTests(at); };
const WED = '2026-06-24';
const THU = '2026-06-25';
const DEPOT = 'x-wayfinder-depot';

const server = await serve(createApp());
type Agent = ReturnType<typeof request.agent>;
const code = (res: request.Response) => [res.status, res.body.error?.code];

async function signIn(who: string | LoginRequest): Promise<{ agent: Agent; me: Me; cookie: string }> {
  const agent = request.agent(server);
  const res = await signInAs(agent, who);
  expect([who, res.status]).toEqual([who, 200]);
  return { agent, me: Me.parse(res.body), cookie: res.headers['set-cookie']![0]!.split(';')[0]! };
}
const switchTo = (agent: Agent, depotId: string) => agent.put('/api/v1/me/depot').send({ depotId });
const boardOf = async (agent: Agent) => PlanBoard.parse((await agent.get('/api/v1/plans')).body);

let ruwan: { agent: Agent; me: Me; cookie: string };
let originalClock: typeof demoDay.$inferSelect;
beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  ruwan = await signIn('ruwan');
});
beforeEach(async () => {
  await resetDay();
  await initClock();
  // Orders for Thursday have closed, so the plan board takes writes.
  freeze(WED, 16 * 60);
  expect((await switchTo(ruwan.agent, 'Peliyagoda')).status).toBe(200);
});
afterAll(async () => {
  await resetDay();
  await db.update(demoDay).set(originalClock);
  testClock.at = '';
  setClockForTests(null);
  closeStreams();
  await stop(server);
  await pool.end();
});

describe('a dispatcher\'s request that names the depot its tab shows', () => {
  it('D-95 refuses a write that names a depot the session left, before it runs, and writes nothing', async () => {
    // Ruwan's session is on Peliyagoda, and a tab of his still shows Kandy.
    const start = await boardOf(ruwan.agent);
    const before = await db.select().from(plans);
    const res = await ruwan.agent.post(`/api/v1/plans/${THU}/suggest`).set(DEPOT, 'Kandy').send({ planId: null, demoDay: start.demoDay });
    expect(code(res)).toEqual([409, 'depot_changed']);
    expect(res.body.error.message).toBe('The depot was switched in another tab.');
    expect(await db.select().from(plans)).toEqual(before);
  });

  it('D-95 refuses a read that names a depot the session left', async () => {
    for (const path of ['/api/v1/plans', `/api/v1/plans/${THU}`, '/api/v1/operations', '/api/v1/issues', '/api/v1/lookup/orders?range=day', '/api/v1/lookup/fleet']) {
      expect([path, ...code(await ruwan.agent.get(path).set(DEPOT, 'Kandy'))]).toEqual([path, 409, 'depot_changed']);
    }
  });

  it('D-95 answers as before when the depot named is the session\'s, after a switch too, and when none is named', async () => {
    const named = await ruwan.agent.get('/api/v1/plans').set(DEPOT, 'Peliyagoda');
    expect(named.status).toBe(200);
    expect(PlanBoard.parse(named.body).depot).toBe('Peliyagoda');
    expect(PlanBoard.parse((await ruwan.agent.get('/api/v1/plans')).body).depot).toBe('Peliyagoda');

    // A write that names the session's depot goes through.
    const built = await ruwan.agent.post(`/api/v1/plans/${THU}/suggest`).set(DEPOT, 'Peliyagoda').send({ planId: null, demoDay: PlanBoard.parse(named.body).demoDay });
    expect(built.status).toBe(200);
    expect(PlanBoard.parse(built.body)).toMatchObject({ depot: 'Peliyagoda', plan: { status: 'draft' } });

    // Once the session is on Kandy, a tab that shows Kandy is served and one that still shows Peliyagoda is refused.
    expect((await switchTo(ruwan.agent, 'Kandy')).status).toBe(200);
    expect(PlanBoard.parse((await ruwan.agent.get('/api/v1/plans').set(DEPOT, 'Kandy')).body).depot).toBe('Kandy');
    expect(code(await ruwan.agent.get('/api/v1/plans').set(DEPOT, 'Peliyagoda'))).toEqual([409, 'depot_changed']);
    expect(PlanBoard.parse((await ruwan.agent.get('/api/v1/plans')).body).depot).toBe('Kandy');
  });

  it('D-95 lets signing in and out, the switch, the clock, the live stream and the health check through whatever depot is named', async () => {
    expect(Me.parse((await ruwan.agent.get('/api/v1/auth/me').set(DEPOT, 'Kandy')).body).depotId).toBe('Peliyagoda');
    const clock = await ruwan.agent.get('/api/v1/clock').set(DEPOT, 'Kandy');
    expect(clock.status).toBe(200);
    expect((await ruwan.agent.get('/api/v1/health').set(DEPOT, 'Kandy')).status).toBe(200);
    // The demo control moves the one clock and resets the whole day, which belong to no depot.
    expect((await ruwan.agent.post('/api/v1/demo/clock/next').set(DEPOT, 'Kandy').send({ revision: clock.body.revision })).status).toBe(200);
    expect((await ruwan.agent.post('/api/v1/demo/reset').set(DEPOT, 'Kandy').send({})).status).toBe(200);
    // The switch itself names the depot the tab shows, which is the one it is leaving.
    expect(Me.parse((await switchTo(ruwan.agent, 'Kandy').set(DEPOT, 'Peliyagoda')).body).depotId).toBe('Kandy');
    expect(Me.parse((await switchTo(ruwan.agent, 'Peliyagoda').set(DEPOT, 'Kandy')).body).depotId).toBe('Peliyagoda');

    // The live stream opens.
    const stream = new AbortController();
    const live = await fetch(`${address(server)}/api/v1/events`, { headers: { cookie: ruwan.cookie, [DEPOT]: 'Kandy' }, signal: stream.signal });
    expect(live.status).toBe(200);
    stream.abort();

    // Another session of his signs in and out naming a depot it does not work on.
    const other = request.agent(server);
    expect((await signInAs(other, 'ruwan').set(DEPOT, 'Kandy')).status).toBe(200);
    expect((await other.post('/api/v1/auth/logout').set(DEPOT, 'Kandy').send({})).status).toBe(204);
  });

  it('D-95 leaves every other role alone, whatever depot a request names', async () => {
    const kasun = await signIn('kasun');
    expect((await kasun.agent.get('/api/v1/loading').set(DEPOT, 'Kandy')).status).toBe(200);
    const dilshan = await signIn('dilshan');
    expect((await dilshan.agent.get('/api/v1/driver').set(DEPOT, 'Kandy')).status).toBe(200);
    const nadeesha = await signIn('nadeesha');
    expect((await nadeesha.agent.get('/api/v1/store/next-order').set(DEPOT, 'Kandy')).status).toBe(200);
    const sarath = await signIn({ staffId: 'L-002', pin: PIN });
    expect((await sarath.agent.get('/api/v1/loading').set(DEPOT, 'Peliyagoda')).status).toBe(200);
    const admin = await signIn('admin');
    expect((await admin.agent.get('/api/v1/admin/vehicles').set(DEPOT, 'Kandy')).status).toBe(200);
  });
});
