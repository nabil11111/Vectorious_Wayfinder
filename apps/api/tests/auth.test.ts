import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { pool } from '../src/db/client';

const app = createApp();
const password = process.env.SEED_PASSWORD ?? 'wayfinder-demo';
afterAll(() => pool.end());

describe('health', () => {
  it('reports the database is up', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: 'up' });
  });
});

describe('sign in', () => {
  it('rejects a wrong password without saying which part was wrong', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ username: 'ruwan', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('bad_credentials');
  });

  it('signs in, returns the role and sets an httpOnly cookie', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ username: 'ruwan', password });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: 'ruwan', role: 'dispatcher', depotId: 'Peliyagoda' });
    expect(res.headers['set-cookie']?.[0]).toMatch(/wf_session=.+HttpOnly/);
  });

  it('knows who you are from the cookie, and forgets you after logout', async () => {
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ username: 'nadeesha', password });
    const me = await agent.get('/api/v1/auth/me');
    expect(me.body).toMatchObject({ role: 'store_manager', outletId: 'OUT001' });
    await agent.post('/api/v1/auth/logout').set('Content-Type', 'application/json');
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('refuses a missing field with the shared error shape', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ username: 'ruwan' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_input');
  });
});

describe('security basics', () => {
  it('refuses writes that are not JSON', async () => {
    const res = await request(app).post('/api/v1/auth/login').type('form').send('username=ruwan&password=x');
    expect(res.status).toBe(415);
  });

  it('blocks rapid password guessing', async () => {
    const tries = [];
    for (let i = 0; i < 12; i++) tries.push(await request(app).post('/api/v1/auth/login').set('X-Forwarded-For', '203.0.113.9').send({ username: 'kasun', password: 'guess' + i }));
    expect(tries.at(-1)!.status).toBe(429);
  });

  it('sends security headers', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
