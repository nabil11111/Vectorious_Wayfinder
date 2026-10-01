import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { pool } from '../src/db/client';
import { serve, stop } from './serve';
import { signInAs } from './sign-in';

const app = await serve(createApp());
afterAll(async () => {
  await stop(app);
  await pool.end();
});

// One address gets ten sign-ins in 15 minutes, so each account signs in once here and its cookie is reused.
const signIn = async (username: string) => {
  const agent = request.agent(app);
  await signInAs(agent, username);
  return agent;
};
type Asker = ReturnType<typeof request.agent>;
const askAll = async (as: Asker) => [
  await as.get('/api/v1/store/next-order'),
  await as.put('/api/v1/store/next-order/draft').send({}),
  await as.post('/api/v1/store/next-order/place').send({}),
  await as.get('/api/v1/store/orders'),
];
const answers = async (as: Asker) => (await askAll(as)).map((res) => [res.status, res.body.error?.code]);

// The shared wiring of spec 009: who gets to the store manager's endpoints at all. What each endpoint
// answers is tested with the task that builds it.
describe('the store endpoints', () => {
  it('are there and need a session', async () => {
    expect(await answers(request.agent(app))).toEqual(Array(4).fill([401, 'signed_out']));
  });

  it('refuse another role', async () => {
    expect(await answers(await signIn('ruwan'))).toEqual(Array(4).fill([403, 'forbidden']));
  });

  it('refuse an account with no shop, which is what an admin gets', async () => {
    expect(await answers(await signIn('admin'))).toEqual(Array(4).fill([403, 'no_outlet']));
  });

  it('let a store manager through both checks', async () => {
    const statuses = (await askAll(await signIn('nadeesha'))).map((res) => res.status);
    for (const status of statuses) expect([401, 403, 404]).not.toContain(status);
  });
});
