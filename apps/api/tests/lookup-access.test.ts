import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { pool } from '../src/db/client';
import { heldDriverRows } from './driver-plan';
import { code, resetDay, signIn } from './loading-plan';
import { serve, stop } from './serve';

const server = await serve(createApp());
const nadeesha = request.agent(server), kasun = request.agent(server), dilshan = request.agent(server), admin = request.agent(server);
beforeAll(async () => {
  for (const [agent, username] of [[nadeesha, 'nadeesha'], [kasun, 'kasun'], [dilshan, 'dilshan'], [admin, 'admin']] as const) await signIn(agent, username);
});
afterAll(async () => { await resetDay(); await stop(server); await pool.end(); });

it('AC-1 lookup requires dispatcher and depot checks on every GET without writes', async () => {
  const before = await heldDriverRows();
  for (const path of ['orders', 'history', 'fleet', `stops/${randomUUID()}/photo`]) {
    const url = `/api/v1/lookup/${path}`;
    expect(code(await request(server).get(url))).toEqual([401, 'signed_out']);
    for (const agent of [nadeesha, kasun, dilshan]) expect(code(await agent.get(url))).toEqual([403, 'forbidden']);
    expect(code(await admin.get(url))).toEqual([403, 'no_depot']);
  }
  expect(await heldDriverRows()).toEqual(before);
});
